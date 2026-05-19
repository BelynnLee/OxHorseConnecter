# Remote Agent Console - Development Mode (Single Window)
# Streams Host + Web output into the current terminal. Ctrl+C stops both.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\start-common.ps1"

$launchConfig = Get-RacLaunchConfig
$hostPort = $launchConfig.HostPort
$preferredWebPort = $launchConfig.PreferredWebPort
$webPort = $launchConfig.WebPort
$corsOrigins = $launchConfig.CorsOrigins

function Write-Banner {
    Write-OxHorseConnecterBanner -Mode 'Remote Agent Console - Dev'
    Write-Host '  ' ('─' * 56) -ForegroundColor DarkGray
    Write-Host "    Web Console  http://localhost:$webPort" -ForegroundColor Green
    Write-Host "    Host API     http://localhost:$hostPort" -ForegroundColor Green
    if ($webPort -ne $preferredWebPort) {
        Write-Host "    Web port $preferredWebPort is in use; using $webPort instead." -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '    Login: admin / (see Host startup output for password)' -ForegroundColor DarkGray
    Write-Host '    Press Ctrl+C to stop both services.' -ForegroundColor DarkGray
    Write-Host ''
}

if (!(Test-Path 'apps/host/dist')) {
    Write-Host 'First-time setup required. Run: pnpm run setup' -ForegroundColor Yellow
    exit 1
}

Write-Banner

# Use Start-Process so each child is its own console process; routing stdio
# back through Receive-Job is unreliable (it batches and re-prefixes lines).
# Instead, launch them in the same console (-NoNewWindow -Wait skipped via background jobs)
# but tag each line ourselves only when the child didn't already self-tag.
$hostJob = Start-Job -Name 'rac-host' -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    Set-Location $using:PWD
    $env:CORS_ORIGINS = $using:corsOrigins
    pnpm -s --filter '@rac/host' dev 2>&1
}

$webJob = Start-Job -Name 'rac-web' -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    Set-Location $using:PWD
    pnpm -s --filter '@rac/web' dev -- --port $using:webPort --strictPort 2>&1
}

function Stream-JobOutput {
    param([System.Management.Automation.Job]$Job, [string]$Tag, [System.ConsoleColor]$Color)

    $lines = Receive-Job -Job $Job -Keep:$false -ErrorAction SilentlyContinue
    if (-not $lines) { return }

    foreach ($line in @($lines)) {
        $text = if ($null -eq $line) { '' } else { [string]$line }
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        Write-Host "$Tag " -ForegroundColor $Color -NoNewline
        Write-Host $text
    }
}

try {
    while ($true) {
        Stream-JobOutput -Job $hostJob -Tag 'host' -Color Blue
        Stream-JobOutput -Job $webJob  -Tag 'web ' -Color Magenta

        if ($hostJob.State -in @('Failed','Completed','Stopped')) { break }
        if ($webJob.State  -in @('Failed','Completed','Stopped')) { break }

        Start-Sleep -Milliseconds 150
    }
} finally {
    Write-Host ''
    Write-Host 'Stopping services...' -ForegroundColor Yellow
    Stop-Job  -Job $hostJob, $webJob -ErrorAction SilentlyContinue
    Receive-Job -Job $hostJob, $webJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Job $hostJob, $webJob -Force -ErrorAction SilentlyContinue
    Write-Host 'Stopped.' -ForegroundColor Green
}
