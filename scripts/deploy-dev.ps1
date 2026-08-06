param(
    [switch]$DisableAutoAttach
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$BuildScript = Join-Path $PSScriptRoot 'build-agent.ps1'
$InstallScript = Join-Path $PSScriptRoot 'install.ps1'
$BuiltAgent = Join-Path $RepositoryRoot 'dist\QuotaPin.Agent.exe'
$InstalledAgent = Join-Path $env:LOCALAPPDATA 'QuotaPin\QuotaPin.Agent.exe'

function Get-QuotaPinSha256([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    try {
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant() }
        finally { $Hasher.Dispose() }
    }
    finally { $Stream.Dispose() }
}

& $BuildScript
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BuiltAgent -PathType Leaf)) {
    throw 'QuotaPin development Agent build failed.'
}
$BuiltHash = Get-QuotaPinSha256 $BuiltAgent

if ($DisableAutoAttach) {
    & $InstallScript -DisableAutoAttach -NoDesktopShortcut
}
else {
    & $InstallScript -EnableAutoAttach -NoDesktopShortcut
}
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $InstalledAgent -PathType Leaf)) {
    throw 'QuotaPin development installation failed.'
}

$InstalledHash = Get-QuotaPinSha256 $InstalledAgent
if (-not [string]::Equals($BuiltHash, $InstalledHash, [StringComparison]::Ordinal)) {
    throw 'QuotaPin development deployment did not install the Agent that was just built.'
}

$Origin = (& $InstalledAgent '--build-origin' | Select-Object -First 1) | ConvertFrom-Json
$Version = (& $InstalledAgent '--agent-version' | Select-Object -First 1)
if ($Origin.schemaVersion -ne 'quotapin-origin/v1' -or $Origin.version -ne $Version) {
    throw 'QuotaPin installed Agent origin receipt is invalid.'
}

[ordered]@{
    deployed = $true
    version = [string]$Version
    commit = [string]$Origin.commit
    sha256 = $InstalledHash
    codexRestarted = $false
} | ConvertTo-Json -Compress
