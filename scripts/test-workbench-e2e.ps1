$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataDir = Join-Path $root 'data'
$dbPath = Join-Path $dataDir 'workbench-e2e.db'
$hostDir = Join-Path $root 'apps\host'
$hostStdout = Join-Path $dataDir 'workbench-e2e-host.log'
$hostStderr = Join-Path $dataDir 'workbench-e2e-host.err.log'
$webStdout = Join-Path $dataDir 'workbench-e2e-web.log'
$webStderr = Join-Path $dataDir 'workbench-e2e-web.err.log'
$projectDir = Join-Path $dataDir 'workbench-e2e-projects'
$hostProc = $null
$webProc = $null

function Remove-E2EArtifacts {
  foreach ($path in @(
    $dbPath,
    "$dbPath-wal",
    "$dbPath-shm",
    $hostStdout,
    $hostStderr,
    $webStdout,
    $webStderr,
    $projectDir
  )) {
    Remove-Item -LiteralPath $path -Force -Recurse -ErrorAction SilentlyContinue
  }
}

function Wait-ForUrl {
  param(
    [string]$Label,
    [string]$Url,
    [int]$TimeoutMs = 30000
  )

  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  $hostLog = if (Test-Path -LiteralPath $hostStderr) { Get-Content -LiteralPath $hostStderr -Raw } else { '' }
  $webLog = if (Test-Path -LiteralPath $webStderr) { Get-Content -LiteralPath $webStderr -Raw } else { '' }
  throw "$Label did not become ready at $Url.`nHost stderr:`n$hostLog`nWeb stderr:`n$webLog"
}

function Invoke-Checked {
  param(
    [scriptblock]$Command
  )
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE."
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Test-PortAvailable {
  param([int]$Port)
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) {
      $listener.Stop()
    }
  }
}

function Get-FreePort {
  param(
    [int]$PreferredPort,
    [int[]]$Exclude = @()
  )
  if (($Exclude -notcontains $PreferredPort) -and (Test-PortAvailable -Port $PreferredPort)) {
    return $PreferredPort
  }

  while ($true) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
    try {
      $listener.Start()
      $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
      if ($Exclude -notcontains $port) {
        return $port
      }
    } finally {
      $listener.Stop()
    }
  }
}

function Resolve-BrowserExecutable {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

Remove-E2EArtifacts

$hostPort = Get-FreePort -PreferredPort 3201
$webPort = Get-FreePort -PreferredPort 5177 -Exclude @($hostPort)

$env:E2E_DB_PATH = $dbPath
$env:E2E_PROJECT_ROOT = $projectDir
$env:E2E_ALLOWED_WORK_DIR = $root
$env:E2E_HOST_PORT = "$hostPort"
$env:E2E_WEB_PORT = "$webPort"
$env:E2E_ADMIN_USERNAME = 'admin'
$env:E2E_ADMIN_PASSWORD = 'WorkbenchE2EPassword-2026!'
$env:E2E_JWT_SECRET = 'workbench-e2e-jwt-secret-2026-with-enough-length'
$env:HOST_PORT = $env:E2E_HOST_PORT
$env:HOST_HOSTNAME = '127.0.0.1'
$env:PUBLIC_BASE_URL = "http://127.0.0.1:$($env:E2E_HOST_PORT)"
$env:CORS_ORIGINS = "http://127.0.0.1:$($env:E2E_WEB_PORT),http://localhost:$($env:E2E_WEB_PORT)"
$env:DB_PATH = $dbPath
$env:ALLOWED_WORK_DIR = $root
$env:ADMIN_USERNAME = $env:E2E_ADMIN_USERNAME
$env:ADMIN_PASSWORD = $env:E2E_ADMIN_PASSWORD
$env:JWT_SECRET = $env:E2E_JWT_SECRET
$env:VITE_API_URL = "http://127.0.0.1:$($env:E2E_HOST_PORT)"
$env:PW_TEST_SCREENSHOT_NO_FONTS_READY = '1'

if (-not $env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  $browserExecutable = Resolve-BrowserExecutable
  if ($browserExecutable) {
    $env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = $browserExecutable
  }
}

try {
  Invoke-Checked { corepack pnpm --filter '@rac/shared' build }
  Invoke-Checked { corepack pnpm --filter '@rac/storage' build }
  Invoke-Checked { corepack pnpm --filter '@rac/security' build }
  Invoke-Checked { corepack pnpm --filter '@rac/executors' build }
  Invoke-Checked { corepack pnpm --filter '@rac/host' build }

  $hostProc = Start-Process -FilePath node `
    -ArgumentList 'dist/index.js' `
    -WorkingDirectory $hostDir `
    -RedirectStandardOutput $hostStdout `
    -RedirectStandardError $hostStderr `
    -WindowStyle Hidden `
    -PassThru

  Wait-ForUrl -Label 'Workbench host' -Url "http://127.0.0.1:$($env:E2E_HOST_PORT)/api/health" -TimeoutMs 90000

  $webProc = Start-Process -FilePath corepack `
    -ArgumentList @('pnpm', '--filter', '@rac/web', 'dev', '--host', '127.0.0.1', '--port', $env:E2E_WEB_PORT, '--strictPort') `
    -WorkingDirectory $root `
    -RedirectStandardOutput $webStdout `
    -RedirectStandardError $webStderr `
    -WindowStyle Hidden `
    -PassThru

  Wait-ForUrl -Label 'Workbench web' -Url "http://127.0.0.1:$($env:E2E_WEB_PORT)" -TimeoutMs 90000

  Invoke-Checked { corepack pnpm exec playwright test e2e/agent-workbench.spec.ts }
}
finally {
  if ($webProc -and -not $webProc.HasExited) {
    Stop-ProcessTree -ProcessId $webProc.Id
  }
  if ($hostProc -and -not $hostProc.HasExited) {
    Stop-ProcessTree -ProcessId $hostProc.Id
  }
  Start-Sleep -Milliseconds 500
  Remove-E2EArtifacts
}
