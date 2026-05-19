# Remote Agent Console - Health Check Probe
#
# Hits /api/health and exits non-zero on failure. Designed for cron / Task
# Scheduler / external monitors (UptimeRobot, etc).
#
# Usage:
#   .\scripts\health-check.ps1                           # Probe http://127.0.0.1:3001
#   .\scripts\health-check.ps1 -BaseUrl https://console.example.com
#   .\scripts\health-check.ps1 -TimeoutSec 10 -AlertWebhook https://hooks.slack.com/...
#
# Exit codes:
#   0 - healthy
#   1 - HTTP error / unreachable
#   2 - response payload invalid
#   3 - timed out

param(
    [string]$BaseUrl      = "",
    [int]$TimeoutSec      = 5,
    [string]$AlertWebhook = "",
    [switch]$Quiet
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $BaseUrl) {
    $envBase = $env:PUBLIC_BASE_URL
    if ($envBase) {
        $BaseUrl = $envBase
    } else {
        $BaseUrl = "http://127.0.0.1:3001"
    }
}

$probeUrl  = "$BaseUrl/api/health"
$startTime = Get-Date

function Send-Alert {
    param([string]$Message)
    if (-not $AlertWebhook) { return }
    try {
        $payload = @{ text = "[RAC Health] $Message" } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri $AlertWebhook -Method Post -Body $payload `
            -ContentType 'application/json' -TimeoutSec 5 | Out-Null
    } catch {
        if (-not $Quiet) {
            Write-Host "Failed to send alert: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

try {
    $response = Invoke-RestMethod -Uri $probeUrl -Method Get -TimeoutSec $TimeoutSec
    $elapsed  = (Get-Date) - $startTime

    if ($response.ok -ne $true) {
        $msg = "Health endpoint reported NOT ok at ${probeUrl}: $($response | ConvertTo-Json -Compress)"
        if (-not $Quiet) { Write-Host $msg -ForegroundColor Red }
        Send-Alert $msg
        exit 2
    }

    if (-not $Quiet) {
        $ms = [math]::Round($elapsed.TotalMilliseconds, 0)
        Write-Host "OK   $probeUrl  (${ms}ms)" -ForegroundColor Green
    }
    exit 0
} catch [System.Net.WebException], [Microsoft.PowerShell.Commands.HttpResponseException] {
    $msg = "Health probe HTTP error at ${probeUrl}: $($_.Exception.Message)"
    if (-not $Quiet) { Write-Host $msg -ForegroundColor Red }
    Send-Alert $msg
    exit 1
} catch [System.TimeoutException] {
    $msg = "Health probe timed out after ${TimeoutSec}s at $probeUrl"
    if (-not $Quiet) { Write-Host $msg -ForegroundColor Red }
    Send-Alert $msg
    exit 3
} catch {
    $msg = "Health probe failed at ${probeUrl}: $($_.Exception.Message)"
    if (-not $Quiet) { Write-Host $msg -ForegroundColor Red }
    Send-Alert $msg
    exit 1
}
