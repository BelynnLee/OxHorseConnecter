param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$TaskName = 'RAC Remote Worker',
  [switch]$Build
)

$ErrorActionPreference = 'Stop'

if ($Build) {
  Push-Location $RepoRoot
  try {
    corepack pnpm build:packages
    corepack pnpm build:host
  } finally {
    Pop-Location
  }
}

$logDir = Join-Path $RepoRoot 'data\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$command = @"
Set-Location -LiteralPath '$RepoRoot'
`$env:NODE_ENV = if (`$env:NODE_ENV) { `$env:NODE_ENV } else { 'production' }
corepack pnpm --filter @rac/host remote:start *>> '$logDir\rac-remote-worker.log'
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started '$TaskName'."
Write-Host "Logs: $logDir\rac-remote-worker.log"
