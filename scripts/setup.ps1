# Remote Agent Console - One-Click Setup

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\start-common.ps1"

function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host '▸ ' -ForegroundColor Cyan -NoNewline
    Write-Host $Message -ForegroundColor White
}

function Write-Item {
    param([string]$Status, [string]$Text, [System.ConsoleColor]$Color = 'White')
    $glyph = switch ($Status) {
        'ok'   { '✓' }
        'warn' { '⚠' }
        'err'  { '✗' }
        default { '·' }
    }
    $glyphColor = switch ($Status) {
        'ok'   { 'Green'  }
        'warn' { 'Yellow' }
        'err'  { 'Red'    }
        default { 'DarkGray' }
    }
    Write-Host '  ' -NoNewline
    Write-Host $glyph -ForegroundColor $glyphColor -NoNewline
    Write-Host ' ' -NoNewline
    Write-Host $Text -ForegroundColor $Color
}

Write-OxHorseConnecterBanner -Mode 'Remote Agent Console - Setup'
Write-Host '  ' ('─' * 56) -ForegroundColor DarkGray

# pnpm
Write-Step 'Checking prerequisites'
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Item 'err' 'pnpm not installed — run: npm install -g pnpm' Red
    exit 1
}
Write-Item 'ok' "pnpm $(pnpm --version)"

# .env
if (Test-Path '.env') {
    Write-Item 'ok' '.env present'
} else {
    Write-Item 'warn' '.env missing — Host will auto-generate a temporary admin password on first launch' Yellow
    Write-Item 'info' 'For fixed credentials, copy .env.example to .env and edit' DarkGray
}

# Install
Write-Step 'Installing dependencies'
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Item 'err' 'pnpm install failed' Red; exit 1 }

# Build
Write-Step 'Building project'
pnpm -s run build:packages
if ($LASTEXITCODE -ne 0) { Write-Item 'err' 'package build failed' Red; exit 1 }
pnpm -s run build:host
if ($LASTEXITCODE -ne 0) { Write-Item 'err' 'host build failed' Red; exit 1 }
Write-Item 'ok' 'build complete'

Write-Host ''
Write-Host '  Setup complete — start with:' -ForegroundColor Cyan
Write-Host '    pnpm start' -ForegroundColor White -NoNewline
Write-Host '   (Host + Web in separate windows)' -ForegroundColor DarkGray
Write-Host '    pnpm dev  ' -ForegroundColor White -NoNewline
Write-Host '   (Host + Web in current terminal)' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Web Console  http://localhost:5173' -ForegroundColor Green
Write-Host '  Host API     http://localhost:3001' -ForegroundColor Green
Write-Host ''
