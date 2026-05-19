# Shared launch helpers for RAC PowerShell dev/start scripts.

function Write-OxHorseConnecterBanner {
    param([string]$Mode)

    $block = [string][char]0x2588
    $tl = [string][char]0x2554
    $tr = [string][char]0x2557
    $bl = [string][char]0x255A
    $br = [string][char]0x255D
    $h = [string][char]0x2550
    $v = [string][char]0x2551
    $esc = [string][char]27
    $reset = "$esc[0m"
    $primary = "$esc[38;2;241;221;223m"
    $primaryShadow = "$esc[38;2;188;161;166m"
    $primaryDim = "$esc[38;2;128;112;116m"
    $pink = "$esc[38;2;231;45;72m"
    $pinkShadow = "$esc[38;2;166;32;52m"
    $pinkDim = "$esc[38;2;122;38;51m"

    $logoTemplate = @(
        " ######] ##]  ##]##]  ##] ######] ######] #######]#######]",
        "##[===##]{##]##[}##!  ##!##[===##]##[==##]##[====}##[====}",
        "##!   ##! {###[} #######!##!   ##!######[}#######]#####]  ",
        "##!   ##! ##[##] ##[==##!##!   ##!##[==##]{====##!##[==}  ",
        "{######[}##[} ##]##!  ##!{######[}##!  ##!#######!#######]",
        " {=====} {=}  {=}{=}  {=} {=====} {=}  {=}{======}{======}",
        "",
        " ######] ######] ###]   ##]###]   ##]#######] ######]########]#######]######] ",
        "##[====}##[===##]####]  ##!####]  ##!##[====}##[====}{==##[==}##[====}##[==##]",
        "##!     ##!   ##!##[##] ##!##[##] ##!#####]  ##!        ##!   #####]  ######[}",
        "##!     ##!   ##!##!{##]##!##!{##]##!##[==}  ##!        ##!   ##[==}  ##[==##]",
        "{######]{######[}##! {####!##! {####!#######]{######]   ##!   #######]##!  ##!",
        " {=====} {=====} {=}  {===}{=}  {===}{======} {=====}   {=}   {======}{=}  {=}"
    )

    $logo = $logoTemplate | ForEach-Object {
        $_.Replace('#', $block).
            Replace('[', $tl).
            Replace(']', $tr).
            Replace('{', $bl).
            Replace('}', $br).
            Replace('=', $h).
            Replace('!', $v)
    }
    $shadowChars = @($tl, $tr, $bl, $br, $h, $v)

    Write-Host ''
    $row = 0
    foreach ($line in $logo) {
        Write-Host '  ' -NoNewline
        $chars = $line.ToCharArray()
        for ($column = 0; $column -lt $chars.Length; $column++) {
            $text = [string]$chars[$column]
            $isPink = (($row -le 5) -and (($column -ge 0 -and $column -le 7) -or ($column -ge 17 -and $column -le 24))) -or ($row -ge 7)
            if ($text -eq $block) {
                $color = if ($isPink) { $pink } else { $primary }
                Write-Host "$color$text$reset" -NoNewline
            } elseif ($shadowChars -contains $text) {
                $color = if ($isPink) { $pinkShadow } else { $primaryShadow }
                Write-Host "$color$text$reset" -NoNewline
            } elseif ([string]::IsNullOrWhiteSpace($text)) {
                Write-Host $text -NoNewline
            } else {
                $color = if ($isPink) { $pinkDim } else { $primaryDim }
                Write-Host "$color$text$reset" -NoNewline
            }
        }
        Write-Host ''
        $row++
    }

    Write-Host "  $primary`$$reset " -NoNewline
    Write-Host "$pink`O$reset" -NoNewline
    Write-Host "$primary`x$reset" -NoNewline
    Write-Host "$pink`H$reset" -NoNewline
    Write-Host "$primary`orse$reset" -NoNewline
    Write-Host "$pink`Connecter$reset" -NoNewline
    if (![string]::IsNullOrWhiteSpace($Mode)) {
        Write-Host "  $Mode" -ForegroundColor DarkGray
    } else {
        Write-Host ''
    }
}

function Get-RacDotEnvValue {
    param([string]$Name)

    if (!(Test-Path '.env')) { return $null }

    $escapedName = [regex]::Escape($Name)
    $line = Get-Content '.env' | Where-Object { $_ -match "^\s*$escapedName\s*=" } | Select-Object -Last 1
    if (!$line) { return $null }

    $value = ($line -replace "^\s*$escapedName\s*=\s*", '').Trim()
    if ($value.Length -ge 2) {
        $first = $value.Substring(0, 1)
        $last = $value.Substring($value.Length - 1, 1)
        if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
            return $value.Substring(1, $value.Length - 2)
        }
    }

    return ($value -replace '\s+#.*$', '').Trim()
}

function Get-RacConfigInt {
    param([string]$Name, [int]$Fallback)

    $raw = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = Get-RacDotEnvValue -Name $Name
    }

    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }

    return $Fallback
}

function Get-RacConfigString {
    param([string]$Name, [string]$Fallback)

    $raw = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($raw)) {
        $raw = Get-RacDotEnvValue -Name $Name
    }

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $Fallback
    }

    return $raw.Trim()
}

function Test-RacPortAvailable {
    param([int]$Port, [hashtable]$ListeningPorts)

    if ($ListeningPorts -and $ListeningPorts.ContainsKey($Port)) {
        return $false
    }

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Get-RacListeningPorts {
    $ports = @{}

    try {
        [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
            ForEach-Object { $ports[[int]$_.Port] = $true }
    } catch {
        return @{}
    }

    return $ports
}

function Find-RacAvailablePort {
    param([int]$StartPort)

    $listeningPorts = Get-RacListeningPorts
    for ($port = $StartPort; $port -lt ($StartPort + 100); $port++) {
        if (Test-RacPortAvailable -Port $port -ListeningPorts $listeningPorts) {
            return $port
        }
    }

    throw "No available port found from $StartPort to $($StartPort + 99)."
}

function ConvertTo-RacPowerShellLiteral {
    param([string]$Value)

    return "'$($Value.Replace("'", "''"))'"
}

function Resolve-RacProbeHost {
    param([string]$HostName)

    if ([string]::IsNullOrWhiteSpace($HostName)) {
        return '127.0.0.1'
    }

    $normalized = $HostName.Trim()
    if ($normalized -in @('0.0.0.0', '::', '*')) {
        return '127.0.0.1'
    }

    if ($normalized -eq '::1') {
        return '[::1]'
    }

    return $normalized
}

function Wait-RacHttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 120,
        [int]$IntervalMilliseconds = 500,
        [string]$Label = 'service'
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = ''

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 2
            if ($response.ok -eq $true) {
                return $true
            }

            $lastError = "unexpected response: $($response | ConvertTo-Json -Compress)"
        } catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Milliseconds $IntervalMilliseconds
    }

    Write-Host "Timed out waiting for $Label at $Url." -ForegroundColor Red
    if (![string]::IsNullOrWhiteSpace($lastError)) {
        Write-Host "Last error: $lastError" -ForegroundColor DarkGray
    }

    return $false
}

function Get-RacCorsOrigins {
    param([int]$WebPort)

    $existing = [Environment]::GetEnvironmentVariable('CORS_ORIGINS', 'Process')
    if ([string]::IsNullOrWhiteSpace($existing)) {
        $existing = Get-RacDotEnvValue -Name 'CORS_ORIGINS'
    }

    $origins = @()
    if (![string]::IsNullOrWhiteSpace($existing)) {
        $origins += $existing.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    $origins += "http://localhost:$WebPort"
    $origins += "http://127.0.0.1:$WebPort"

    return ($origins | Select-Object -Unique) -join ','
}

function Get-RacLaunchConfig {
    $hostPort = Get-RacConfigInt -Name 'HOST_PORT' -Fallback 3001
    $hostHostname = Get-RacConfigString -Name 'HOST_HOSTNAME' -Fallback '127.0.0.1'
    $preferredWebPort = Get-RacConfigInt -Name 'WEB_PORT' -Fallback 5173
    $webPort = Find-RacAvailablePort -StartPort $preferredWebPort
    $corsOrigins = Get-RacCorsOrigins -WebPort $webPort
    $hostProbeHost = Resolve-RacProbeHost -HostName $hostHostname
    $hostHealthUrl = "http://${hostProbeHost}:$hostPort/api/health"

    return [pscustomobject]@{
        HostPort = $hostPort
        HostHostname = $hostHostname
        HostHealthUrl = $hostHealthUrl
        PreferredWebPort = $preferredWebPort
        WebPort = $webPort
        CorsOrigins = $corsOrigins
    }
}
