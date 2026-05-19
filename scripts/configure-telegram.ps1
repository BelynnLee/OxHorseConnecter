param(
  [switch]$ShowOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
$examplePath = Join-Path $repoRoot ".env.example"

function Read-Default {
  param(
    [string]$Prompt,
    [string]$Default = ""
  )

  if ($Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) {
      return $Default
    }
    return $value.Trim()
  }

  return (Read-Host $Prompt).Trim()
}

function Read-Choice {
  param(
    [string]$Prompt,
    [string[]]$Choices,
    [string]$Default
  )

  while ($true) {
    $value = Read-Default -Prompt "$Prompt ($($Choices -join '/'))" -Default $Default
    if ($Choices -contains $value) {
      return $value
    }
    Write-Host "Please choose one of: $($Choices -join ', ')" -ForegroundColor Yellow
  }
}

function New-RandomSecret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Set-EnvValue {
  param(
    [string[]]$Lines,
    [string]$Key,
    [string]$Value
  )

  $pattern = "^\s*#?\s*$([regex]::Escape($Key))="
  $replacement = "$Key=$Value"
  $updated = $false
  $next = foreach ($line in $Lines) {
    if (-not $updated -and $line -match $pattern) {
      $updated = $true
      $replacement
    } else {
      $line
    }
  }

  if (-not $updated) {
    $next += $replacement
  }

  return $next
}

function Get-ExistingValue {
  param(
    [string[]]$Lines,
    [string]$Key
  )

  $pattern = "^\s*$([regex]::Escape($Key))=(.*)$"
  foreach ($line in $Lines) {
    if ($line -match $pattern) {
      return $Matches[1]
    }
  }
  return ""
}

if ($ShowOnly) {
  Write-Host "Telegram can also be configured in the web UI: open /config, then the Notifications section."
  Write-Host "The host must be restarted after changing TELEGRAM_GATEWAY_* values."
  exit 0
}

if (-not (Test-Path $envPath)) {
  if (Test-Path $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host "Created .env from .env.example" -ForegroundColor Green
  } else {
    New-Item -Path $envPath -ItemType File | Out-Null
    Write-Host "Created empty .env" -ForegroundColor Green
  }
}

$lines = [System.Collections.Generic.List[string]]::new()
[string[]](Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue) | ForEach-Object {
  $lines.Add($_)
}

Write-Host ""
Write-Host "Telegram Agent Gateway setup" -ForegroundColor Cyan
Write-Host "This writes Telegram settings into $envPath."
Write-Host ""

$botToken = Read-Default "Telegram bot token" (Get-ExistingValue $lines "TELEGRAM_BOT_TOKEN")
$mode = Read-Choice "Gateway mode" @("polling", "webhook", "auto") (Get-ExistingValue $lines "TELEGRAM_MODE")
if (-not $mode) {
  $mode = "polling"
}

$webhookUrl = Get-ExistingValue $lines "TELEGRAM_WEBHOOK_URL"
$webhookSecret = Get-ExistingValue $lines "TELEGRAM_WEBHOOK_SECRET"
if ($mode -eq "webhook") {
  $webhookUrl = Read-Default "Webhook URL" $webhookUrl
  if (-not $webhookSecret) {
    $webhookSecret = New-RandomSecret
  }
  $webhookSecret = Read-Default "Webhook secret" $webhookSecret
}

$allowedUsers = Read-Default "Allowed Telegram user IDs/usernames, comma-separated" (Get-ExistingValue $lines "TELEGRAM_ALLOWED_USERS")
$allowAll = Read-Choice "Allow all Telegram users" @("false", "true") ((Get-ExistingValue $lines "TELEGRAM_ALLOW_ALL_USERS") -replace "^$", "false")
$allowedGroups = Read-Default "Allowed group chat IDs, comma-separated (optional)" (Get-ExistingValue $lines "TELEGRAM_GROUP_ALLOWED_CHATS")
$requireMention = Read-Choice "Require @bot mention in groups" @("true", "false") ((Get-ExistingValue $lines "TELEGRAM_REQUIRE_MENTION") -replace "^$", "true")

$defaultProjectId = Read-Default "Default registered project ID (optional)" (Get-ExistingValue $lines "TELEGRAM_DEFAULT_PROJECT_ID")
$defaultProjectPath = Read-Default "Default registered project path" ((Get-ExistingValue $lines "TELEGRAM_DEFAULT_PROJECT_PATH") -replace "^$", $repoRoot)
$defaultExecutor = Read-Choice "Default executor" @("codex", "claude-code", "mock", "custom-command") ((Get-ExistingValue $lines "TELEGRAM_DEFAULT_EXECUTOR") -replace "^$", "codex")
$defaultMode = Read-Choice "Default mode" @("agent", "plan", "review") ((Get-ExistingValue $lines "TELEGRAM_DEFAULT_MODE") -replace "^$", "agent")
$defaultPermission = Read-Choice "Default permission mode" @("default", "read-only", "auto-review", "full-access") ((Get-ExistingValue $lines "TELEGRAM_DEFAULT_PERMISSION_MODE") -replace "^$", "default")
$streaming = Read-Choice "Enable Telegram streaming edits" @("false", "true") ((Get-ExistingValue $lines "TELEGRAM_STREAMING_ENABLED") -replace "^$", "false")

$lines = Set-EnvValue $lines "TELEGRAM_BOT_TOKEN" $botToken
$lines = Set-EnvValue $lines "TELEGRAM_GATEWAY_ENABLED" "true"
$lines = Set-EnvValue $lines "TELEGRAM_MODE" $mode
$lines = Set-EnvValue $lines "TELEGRAM_ALLOWED_USERS" $allowedUsers
$lines = Set-EnvValue $lines "TELEGRAM_ALLOW_ALL_USERS" $allowAll
$lines = Set-EnvValue $lines "TELEGRAM_GROUP_ALLOWED_CHATS" $allowedGroups
$lines = Set-EnvValue $lines "TELEGRAM_REQUIRE_MENTION" $requireMention
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_DEVICE_ID" "host"
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_PROJECT_ID" $defaultProjectId
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_PROJECT_PATH" $defaultProjectPath
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_EXECUTOR" $defaultExecutor
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_MODE" $defaultMode
$lines = Set-EnvValue $lines "TELEGRAM_DEFAULT_PERMISSION_MODE" $defaultPermission
$lines = Set-EnvValue $lines "TELEGRAM_STREAMING_ENABLED" $streaming
if ($mode -eq "webhook") {
  $lines = Set-EnvValue $lines "TELEGRAM_WEBHOOK_URL" $webhookUrl
  $lines = Set-EnvValue $lines "TELEGRAM_WEBHOOK_SECRET" $webhookSecret
}

Set-Content -LiteralPath $envPath -Value $lines -Encoding UTF8

Write-Host ""
Write-Host "Telegram gateway configuration saved." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "1. Make sure the default project is registered and enabled in ox."
Write-Host "2. Restart the host so TELEGRAM_GATEWAY_* settings are loaded."
Write-Host "3. Open Telegram and send /start to the bot."
Write-Host ""
Write-Host "Web UI alternative: open /config, edit the Notifications section, save, then restart host."
