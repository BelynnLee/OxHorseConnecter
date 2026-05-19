# Remote Agent Console - SQLite Database Backup
#
# Usage:
#   .\scripts\backup-db.ps1                                  # Local backup with default settings
#   .\scripts\backup-db.ps1 -DbPath custom.db                # Custom DB path
#   .\scripts\backup-db.ps1 -KeepDays 14                     # Retain backups for 14 days
#   .\scripts\backup-db.ps1 -BackupDir D:\Backups\rac        # Custom backup directory
#   .\scripts\backup-db.ps1 -S3Bucket s3://my-bucket/rac/    # Upload via aws CLI
#   .\scripts\backup-db.ps1 -RcloneTarget remote:rac-backups # Upload via rclone
#   .\scripts\backup-db.ps1 -Compress                        # gzip backup before upload

param(
    [string]$DbPath        = "",
    [string]$BackupDir     = "",
    [int]$KeepDays         = 7,
    [string]$S3Bucket      = "",
    [string]$RcloneTarget  = "",
    [switch]$Compress
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Resolve DB path: parameter > env > default
if (-not $DbPath) {
    $envDbPath = $env:DB_PATH
    if ($envDbPath) {
        $DbPath = $envDbPath
    } else {
        $DbPath = Join-Path $PSScriptRoot "..\data\rac.db"
    }
}
$DbPath = [System.IO.Path]::GetFullPath($DbPath)

if (-not (Test-Path $DbPath)) {
    Write-Host "DB not found at: $DbPath" -ForegroundColor Yellow
    Write-Host "Nothing to backup." -ForegroundColor Yellow
    exit 0
}

# Resolve backup directory
if (-not $BackupDir) {
    $BackupDir = Join-Path $PSScriptRoot "..\data\backups"
}
$BackupDir = [System.IO.Path]::GetFullPath($BackupDir)

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$dbName     = [System.IO.Path]::GetFileNameWithoutExtension($DbPath)
$backupFile = Join-Path $BackupDir "$dbName-$timestamp.db"

Write-Host "=== RAC Database Backup ===" -ForegroundColor Cyan
Write-Host "Source : $DbPath"
Write-Host "Target : $backupFile"

function Copy-WithSidecars {
    param([string]$Source, [string]$Target)
    Copy-Item -Path $Source -Destination $Target -Force
    foreach ($ext in @('-wal', '-shm')) {
        $sidecar = "$Source$ext"
        if (Test-Path $sidecar) {
            Copy-Item -Path $sidecar -Destination "$Target$ext" -Force
        }
    }
}

# Backup using sqlite3 online backup if available; otherwise file copy.
# Use a temp .sql file to avoid quote injection in the .backup command.
$sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
if ($sqlite3) {
    $cmdFile = [System.IO.Path]::GetTempFileName()
    try {
        # SQLite ".backup" expects a path; quote with double-quotes to allow paths with spaces.
        # Escape any embedded double-quotes in the target path.
        $escaped = $backupFile -replace '"', '""'
        Set-Content -Path $cmdFile -Value ".backup `"$escaped`"" -Encoding ASCII
        $result = & sqlite3 $DbPath ".read $cmdFile" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "sqlite3 backup failed: $result" -ForegroundColor Red
            Write-Host "Falling back to file copy (incl. WAL/SHM sidecars)..." -ForegroundColor Yellow
            Copy-WithSidecars -Source $DbPath -Target $backupFile
        } else {
            Write-Host "Backup completed (sqlite3 online backup)." -ForegroundColor Green
        }
    } finally {
        Remove-Item $cmdFile -Force -ErrorAction SilentlyContinue
    }
} else {
    Copy-WithSidecars -Source $DbPath -Target $backupFile
    Write-Host "Backup completed (file copy)." -ForegroundColor Green
}

$sizeMb = [math]::Round((Get-Item $backupFile).Length / 1MB, 2)
Write-Host "Backup size: ${sizeMb} MB"

# Optional gzip compression
$uploadFile = $backupFile
if ($Compress) {
    $gzipFile = "$backupFile.gz"
    try {
        $input  = [System.IO.File]::OpenRead($backupFile)
        $output = [System.IO.File]::Create($gzipFile)
        $gzip   = New-Object System.IO.Compression.GZipStream($output, [System.IO.Compression.CompressionMode]::Compress)
        $input.CopyTo($gzip)
        $gzip.Close(); $output.Close(); $input.Close()
        $compressedMb = [math]::Round((Get-Item $gzipFile).Length / 1MB, 2)
        Write-Host "Compressed: ${compressedMb} MB ($gzipFile)" -ForegroundColor Green
        $uploadFile = $gzipFile
    } catch {
        Write-Host "Compression failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "Continuing with uncompressed backup." -ForegroundColor Yellow
    }
}

# Optional cloud upload via aws CLI
if ($S3Bucket) {
    $aws = Get-Command aws -ErrorAction SilentlyContinue
    if (-not $aws) {
        Write-Host "aws CLI not found in PATH; skipping S3 upload." -ForegroundColor Yellow
    } else {
        $s3Target = $S3Bucket.TrimEnd('/') + '/' + (Split-Path $uploadFile -Leaf)
        Write-Host "Uploading to $s3Target ..." -ForegroundColor Cyan
        & aws s3 cp $uploadFile $s3Target --only-show-errors
        if ($LASTEXITCODE -eq 0) {
            Write-Host "S3 upload completed." -ForegroundColor Green
        } else {
            Write-Host "S3 upload failed (exit $LASTEXITCODE)." -ForegroundColor Red
        }
    }
}

# Optional cloud upload via rclone (works for many providers: GCS, Azure, Backblaze, etc.)
if ($RcloneTarget) {
    $rclone = Get-Command rclone -ErrorAction SilentlyContinue
    if (-not $rclone) {
        Write-Host "rclone not found in PATH; skipping remote upload." -ForegroundColor Yellow
    } else {
        Write-Host "Uploading via rclone to $RcloneTarget ..." -ForegroundColor Cyan
        & rclone copy $uploadFile $RcloneTarget --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host "rclone upload completed." -ForegroundColor Green
        } else {
            Write-Host "rclone upload failed (exit $LASTEXITCODE)." -ForegroundColor Red
        }
    }
}

# Prune local backups older than KeepDays
$cutoff = (Get-Date).AddDays(-$KeepDays)
$pruned = 0
Get-ChildItem -Path $BackupDir -Filter "$dbName-*.db*" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Remove-Item $_.FullName -Force
        foreach ($ext in @('-wal', '-shm')) {
            $sidecar = "$($_.FullName)$ext"
            if (Test-Path $sidecar) { Remove-Item $sidecar -Force }
        }
        $pruned++
    }

if ($pruned -gt 0) {
    Write-Host "Pruned $pruned local backup(s) older than $KeepDays days." -ForegroundColor Yellow
}

Write-Host "Done. Backups retained in: $BackupDir" -ForegroundColor Green
