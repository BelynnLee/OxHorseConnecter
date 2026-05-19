# Remote Agent Console - One-Click Start
# Launches Host + Web in two separate PowerShell windows.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\start-common.ps1"

if (!(Test-Path 'apps/host/dist')) {
    Write-Host 'First-time setup required. Run: pnpm run setup' -ForegroundColor Yellow
    exit 1
}

$launchConfig = Get-RacLaunchConfig
$hostPort = $launchConfig.HostPort
$hostHealthUrl = $launchConfig.HostHealthUrl
$preferredWebPort = $launchConfig.PreferredWebPort
$webPort = $launchConfig.WebPort
$cwdLiteral = ConvertTo-RacPowerShellLiteral -Value ([string]$PWD)
$corsLiteral = ConvertTo-RacPowerShellLiteral -Value $launchConfig.CorsOrigins

Write-OxHorseConnecterBanner -Mode 'Remote Agent Console - Start'
Write-Host '  ' ('─' * 56) -ForegroundColor DarkGray
Write-Host "    Web Console  http://localhost:$webPort" -ForegroundColor Green
Write-Host "    Host API     http://localhost:$hostPort" -ForegroundColor Green
if ($webPort -ne $preferredWebPort) {
    Write-Host "    Web port $preferredWebPort is in use; using $webPort instead." -ForegroundColor Yellow
}
Write-Host ''

$encodingPrefix = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8;'
Start-Process powershell -ArgumentList "-NoExit", "-Command", "$encodingPrefix cd $cwdLiteral; `$env:CORS_ORIGINS = $corsLiteral; pnpm -s --filter '@rac/host' dev" | Out-Null

Write-Host "    Waiting for Host API to become ready ($hostHealthUrl)..." -ForegroundColor DarkGray
if (!(Wait-RacHttpReady -Url $hostHealthUrl -TimeoutSeconds 120 -Label 'Host API')) {
    Write-Host '    Web Console was not started because Host API did not become healthy.' -ForegroundColor Yellow
    Write-Host '    Check the Host window for startup errors.' -ForegroundColor DarkGray
    exit 1
}

Write-Host '    Host API ready. Starting Web Console...' -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "$encodingPrefix cd $cwdLiteral; pnpm -s --filter '@rac/web' dev -- --port $webPort --strictPort"  | Out-Null

Write-Host '    Two windows opened — close them to stop the services.' -ForegroundColor DarkGray
Write-Host '    Login: admin / (see Host window for first-run password)' -ForegroundColor DarkGray
Write-Host ''
Read-Host 'Press Enter to close this launcher window (services keep running)' | Out-Null
