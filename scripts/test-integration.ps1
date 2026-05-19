$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hostDir = Join-Path $root 'apps\host'
$dataDir = Join-Path $root 'data'
$dbPath = Join-Path $dataDir 'integration-smoke.db'
$stdoutLog = Join-Path $dataDir 'integration-smoke-host.log'
$stderrLog = Join-Path $dataDir 'integration-smoke-host.err.log'
$baseUrl = 'http://127.0.0.1:3102'
$script:ApiSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Remove-TestArtifacts {
  foreach ($path in @(
    $dbPath,
    "$dbPath-wal",
    "$dbPath-shm",
    $stdoutLog,
    $stderrLog
  )) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}

function Read-HostLogs {
  $stdout = if (Test-Path -LiteralPath $stdoutLog) { Get-Content -LiteralPath $stdoutLog -Raw } else { '' }
  $stderr = if (Test-Path -LiteralPath $stderrLog) { Get-Content -LiteralPath $stderrLog -Raw } else { '' }
  return ($stdout + [Environment]::NewLine + $stderr).Trim()
}

function Wait-ForValue {
  param(
    [string]$Label,
    [scriptblock]$Action,
    [int]$TimeoutMs = 15000,
    [int]$IntervalMs = 200
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $value = & $Action
    if ($null -ne $value) {
      return $value
    }
    Start-Sleep -Milliseconds $IntervalMs
  }

  $logs = Read-HostLogs
  if ($logs) {
    throw "$Label timed out.`n$logs"
  }

  throw "$Label timed out."
}

function Invoke-Api {
  param(
    [ValidateSet('GET', 'POST')]
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $Headers
    WebSession = $script:ApiSession
  }

  if ($Method -ne 'GET' -and -not $Headers.ContainsKey('X-RAC-CSRF')) {
    $Headers['X-RAC-CSRF'] = '1'
  }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }

  return Invoke-RestMethod @params
}

function Invoke-ApiFailure {
  param(
    [ValidateSet('GET', 'POST')]
    [string]$Method,
    [string]$Uri,
    [int]$ExpectedStatus,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  try {
    Invoke-Api -Method $Method -Uri $Uri -Headers $Headers -Body $Body | Out-Null
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response -and [int]$response.StatusCode -eq $ExpectedStatus) {
      return
    }
    throw
  }

  throw "Expected $Method $Uri to fail with HTTP $ExpectedStatus."
}

function Get-TaskDetail {
  param(
    [string]$TaskId,
    [hashtable]$Headers
  )

  return Invoke-Api -Method GET -Uri "$baseUrl/api/tasks/$TaskId" -Headers $Headers
}

function Wait-ForApproval {
  param(
    [string]$TaskId,
    [hashtable]$Headers
  )

  return Wait-ForValue -Label "approval for task $TaskId" -TimeoutMs 12000 -IntervalMs 150 -Action {
    $detail = Get-TaskDetail -TaskId $TaskId -Headers $Headers
    $pending = @($detail.data.approvals | Where-Object { $_.status -eq 'pending' })
    if ($pending.Count -gt 0) {
      return $pending[0]
    }
    return $null
  }
}

function Wait-ForTerminalTask {
  param(
    [string]$TaskId,
    [hashtable]$Headers
  )

  return Wait-ForValue -Label "terminal state for task $TaskId" -TimeoutMs 20000 -IntervalMs 200 -Action {
    $detail = Get-TaskDetail -TaskId $TaskId -Headers $Headers
    if ($detail.data.task.status -in @('completed', 'failed', 'cancelled')) {
      return $detail.data
    }
    return $null
  }
}

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

Remove-TestArtifacts

$env:HOST_PORT = '3102'
$env:HOST_HOSTNAME = '127.0.0.1'
$env:DB_PATH = $dbPath
$env:ALLOWED_WORK_DIR = $root
$env:APPROVAL_TIMEOUT_SECONDS = '4'
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = 'IntegrationAdminPassword-2026-Secure!'
$env:JWT_SECRET = 'integration-jwt-secret-for-smoke-tests-2026'

$proc = Start-Process -FilePath node `
  -ArgumentList 'dist/index.js' `
  -WorkingDirectory $hostDir `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

try {
  Wait-ForValue -Label 'host health check' -TimeoutMs 15000 -IntervalMs 300 -Action {
    try {
      $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method GET
      if ($health.ok) {
        return $health
      }
    } catch {
      if ($proc.HasExited) {
        $logs = Read-HostLogs
        throw "Host exited early with code $($proc.ExitCode).`n$logs"
      }
    }
    return $null
  } | Out-Null

  $login = Invoke-Api -Method POST -Uri "$baseUrl/api/auth/login" -Body @{
    username = 'admin'
    password = 'IntegrationAdminPassword-2026-Secure!'
  }
  $headers = @{}

  $devices = Invoke-Api -Method GET -Uri "$baseUrl/api/devices" -Headers $headers
  Assert-True ($devices.data.Count -ge 1) 'Expected the host to auto-register one device.'
  $device = $devices.data[0]

  $trusted = Invoke-Api -Method POST -Uri "$baseUrl/api/devices/$($device.id)/trust" -Headers $headers
  Assert-True ($trusted.data.trusted -eq $true) 'Expected the host device to become trusted.'

  $remoteRegistration = Invoke-Api -Method POST -Uri "$baseUrl/api/devices/register" -Headers $headers -Body @{
    name = 'integration-remote'
    platform = 'test'
    fingerprint = 'integration-remote:test'
    executors = @(@{ type = 'mock'; available = $true })
    workRoot = $root
    workRootExists = $true
  }
  $remoteDevice = $remoteRegistration.data.device
  $remoteToken = [string]$remoteRegistration.data.deviceToken
  $remoteCredentialId = [string]$remoteRegistration.data.credential.id
  Assert-True ($remoteToken.StartsWith('racw_')) 'Remote registration should return a racw credential token.'
  Assert-True ($remoteCredentialId.Length -gt 0) 'Remote registration should return credential metadata.'

  $legacyHeaders = @{
    'x-rac-device-id' = $remoteDevice.id
    'x-rac-device-token' = $remoteDevice.id
  }
  Invoke-ApiFailure -Method POST -Uri "$baseUrl/api/remote/heartbeat" -Headers $legacyHeaders -ExpectedStatus 401 -Body @{
    executors = @(@{ type = 'mock'; available = $true })
  }

  $remoteHeaders = @{
    'x-rac-device-id' = $remoteDevice.id
    'x-rac-device-token' = $remoteToken
  }
  $remoteHeartbeat = Invoke-Api -Method POST -Uri "$baseUrl/api/remote/heartbeat" -Headers $remoteHeaders -Body @{
    executors = @(@{ type = 'mock'; available = $true })
    workRoot = $root
    workRootExists = $true
  }
  Assert-True ($remoteHeartbeat.data.device.id -eq $remoteDevice.id) 'Remote heartbeat should accept the issued credential.'

  Invoke-Api -Method POST -Uri "$baseUrl/api/devices/$($remoteDevice.id)/trust" -Headers $headers | Out-Null
  $remoteTask = Invoke-Api -Method POST -Uri "$baseUrl/api/tasks" -Headers $headers -Body @{
    deviceId = $remoteDevice.id
    executorType = 'mock'
    title = 'Remote claim path'
    prompt = 'Remote worker claim smoke'
    autoApprove = $true
  }
  $claim = Invoke-Api -Method POST -Uri "$baseUrl/api/remote/tasks/claim" -Headers $remoteHeaders -Body @{
    executors = @(@{ type = 'mock'; available = $true })
    workRoot = $root
    workRootExists = $true
  }
  Assert-True ($claim.data.task.id -eq $remoteTask.data.id) 'Trusted remote worker should claim its queued task.'
  Invoke-Api -Method POST -Uri "$baseUrl/api/remote/tasks/$($remoteTask.data.id)/events" -Headers $remoteHeaders -Body @{
    type = 'task.log'
    level = 'info'
    payload = @{ message = 'remote smoke event'; stream = 'system' }
  } | Out-Null
  Invoke-Api -Method POST -Uri "$baseUrl/api/remote/tasks/$($remoteTask.data.id)/complete" -Headers $remoteHeaders -Body @{
    summary = 'remote smoke complete'
  } | Out-Null
  $remoteDetail = Wait-ForTerminalTask -TaskId $remoteTask.data.id -Headers $headers
  Assert-True ($remoteDetail.task.status -eq 'completed') 'Remote complete report should finish the task.'

  Invoke-Api -Method POST -Uri "$baseUrl/api/devices/$($remoteDevice.id)/untrust" -Headers $headers | Out-Null
  Invoke-ApiFailure -Method POST -Uri "$baseUrl/api/remote/tasks/claim" -Headers $remoteHeaders -ExpectedStatus 403 -Body @{
    executors = @(@{ type = 'mock'; available = $true })
    workRoot = $root
    workRootExists = $true
  }

  $rotatedCredential = Invoke-Api -Method POST -Uri "$baseUrl/api/devices/$($remoteDevice.id)/credentials" -Headers $headers -Body @{
    name = 'integration-rotated'
  }
  Assert-True (($rotatedCredential.data.token -as [string]).StartsWith('racw_')) 'Credential rotation should issue a new racw token.'
  Invoke-Api -Method POST -Uri "$baseUrl/api/devices/$($remoteDevice.id)/credentials/$remoteCredentialId/revoke" -Headers $headers | Out-Null
  Invoke-ApiFailure -Method POST -Uri "$baseUrl/api/remote/heartbeat" -Headers $remoteHeaders -ExpectedStatus 401 -Body @{
    executors = @(@{ type = 'mock'; available = $true })
  }

  $audit = Invoke-Api -Method GET -Uri "$baseUrl/api/security/audit?limit=50" -Headers $headers
  Assert-True ((@($audit.data | Where-Object { $_.eventType -eq 'device.credential_revoked' })).Count -ge 1) 'Security audit should record credential revocation.'

  $approvedTask = Invoke-Api -Method POST -Uri "$baseUrl/api/tasks" -Headers $headers -Body @{
    deviceId = $device.id
    executorType = 'mock'
    title = 'Approve path'
    prompt = 'Run a normal smoke task'
    workDir = '.'
    autoApprove = $false
  }
  $approvedApproval = Wait-ForApproval -TaskId $approvedTask.data.id -Headers $headers
  Invoke-Api -Method POST -Uri "$baseUrl/api/approvals/$($approvedApproval.id)/approve" -Headers $headers | Out-Null
  $approvedDetail = Wait-ForTerminalTask -TaskId $approvedTask.data.id -Headers $headers
  Assert-True ($approvedDetail.task.status -eq 'completed') 'Approve flow should finish in completed state.'
  Assert-True ($null -ne $approvedDetail.diff) 'Approve flow should produce a diff summary.'
  Assert-True (($approvedDetail.task.summary -match 'patch') -or ($approvedDetail.task.summary -match 'successfully')) 'Approve flow should produce a completion summary.'

  $rejectedTask = Invoke-Api -Method POST -Uri "$baseUrl/api/tasks" -Headers $headers -Body @{
    deviceId = $device.id
    executorType = 'mock'
    title = 'Reject path'
    prompt = 'Run a smoke task and reject the risky step'
    autoApprove = $false
  }
  $rejectedApproval = Wait-ForApproval -TaskId $rejectedTask.data.id -Headers $headers
  Invoke-Api -Method POST -Uri "$baseUrl/api/approvals/$($rejectedApproval.id)/reject" -Headers $headers | Out-Null
  $rejectedDetail = Wait-ForTerminalTask -TaskId $rejectedTask.data.id -Headers $headers
  Assert-True ($rejectedDetail.approvals[0].status -eq 'rejected') 'Reject flow should persist rejected approval status.'
  Assert-True (($rejectedDetail.task.status -eq 'completed') -or ($rejectedDetail.task.status -eq 'failed')) 'Reject flow should finish safely.'

  $cancelledTask = Invoke-Api -Method POST -Uri "$baseUrl/api/tasks" -Headers $headers -Body @{
    deviceId = $device.id
    executorType = 'mock'
    title = 'Cancel path'
    prompt = 'Cancel this task before it finishes'
    autoApprove = $false
  }
  Invoke-Api -Method POST -Uri "$baseUrl/api/tasks/$($cancelledTask.data.id)/cancel" -Headers $headers | Out-Null
  $cancelledDetail = Wait-ForTerminalTask -TaskId $cancelledTask.data.id -Headers $headers
  Assert-True ($cancelledDetail.task.status -eq 'cancelled') 'Cancel flow should finish in cancelled state.'
  Assert-True ((@($cancelledDetail.events | Where-Object { $_.type -eq 'task.cancelled' })).Count -ge 1) 'Cancel flow should record a task.cancelled event.'

  $timeoutTask = Invoke-Api -Method POST -Uri "$baseUrl/api/tasks" -Headers $headers -Body @{
    deviceId = $device.id
    executorType = 'mock'
    title = 'Timeout path'
    prompt = 'Let approval time out'
    autoApprove = $false
  }
  Wait-ForApproval -TaskId $timeoutTask.data.id -Headers $headers | Out-Null
  $timeoutDetail = Wait-ForTerminalTask -TaskId $timeoutTask.data.id -Headers $headers
  Assert-True ($timeoutDetail.task.status -eq 'failed') 'Timeout flow should finish in failed state.'
  Assert-True ($timeoutDetail.approvals[0].status -eq 'expired') 'Timeout flow should persist expired approval status.'
  Assert-True ($timeoutDetail.task.errorMessage -match 'timed out') 'Timeout flow should record an approval timeout error.'

  [pscustomobject]@{
    approveFlow = $approvedDetail.task.status
    rejectFlow = $rejectedDetail.task.status
    cancelFlow = $cancelledDetail.task.status
    timeoutFlow = $timeoutDetail.task.status
    approvedEvents = @($approvedDetail.events).Count
    timeoutEvents = @($timeoutDetail.events).Count
    smokeDb = $dbPath
  } | ConvertTo-Json -Depth 4
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
  Remove-TestArtifacts
}
