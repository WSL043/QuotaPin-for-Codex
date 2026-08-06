param(
    [string]$Version = '',
    [switch]$DisableAutoAttach,
    [switch]$EnableAutoAttach,
    [switch]$CreateLauncherShortcut,
    [switch]$NoDesktopShortcut
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($DisableAutoAttach -and $EnableAutoAttach) { throw 'Choose either -DisableAutoAttach or -EnableAutoAttach, not both.' }
$OfficialRepository = 'https://github.com/WSL043/QuotaPin-for-Codex'
$VersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
$RequestedVersion = $Version.Trim()
if ($RequestedVersion -and $RequestedVersion -notmatch $VersionPattern) {
    throw 'QuotaPin version is invalid.'
}
$ReleaseApiUrl = if ($RequestedVersion) {
    "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases/tags/v$RequestedVersion"
}
else {
    'https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases/latest'
}

function Invoke-QuotaPinInstaller([string]$InstallerPath) {
    $PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $PowerShellExe -PathType Leaf)) {
        throw "Windows PowerShell is unavailable: $PowerShellExe"
    }
    $Arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $InstallerPath)
    if ($DisableAutoAttach) { $Arguments += '-DisableAutoAttach' }
    if ($EnableAutoAttach) { $Arguments += '-EnableAutoAttach' }
    if ($CreateLauncherShortcut) { $Arguments += '-CreateLauncherShortcut' }
    if ($NoDesktopShortcut) { $Arguments += '-NoDesktopShortcut' }
    & $PowerShellExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "QuotaPin installer exited with code $LASTEXITCODE."
    }
}

function Receive-QuotaPinBootstrapArchive([string]$Uri, [string]$Destination) {
    $CurlPath = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $CurlPath -PathType Leaf)) {
        throw 'Windows curl.exe is unavailable.'
    }
    $ExitCode = -1
    foreach ($Attempt in 1..6) {
        & $CurlPath --ipv4 --http1.1 --fail --location --silent --show-error --connect-timeout 20 --speed-limit 1024 --speed-time 30 --max-time 60 --continue-at - --output $Destination $Uri
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) { break }
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            if ((Get-Item -LiteralPath $Destination).Length -gt 64MB) {
                throw 'QuotaPin source archive exceeds the 64 MB safety limit.'
            }
        }
        if ($Attempt -lt 6) { Start-Sleep -Seconds ([Math]::Min(8, [Math]::Pow(2, $Attempt))) }
    }
    if ($ExitCode -ne 0) {
        throw "QuotaPin source download failed after resumable retries with curl exit code $ExitCode."
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf) -or
        (Get-Item -LiteralPath $Destination).Length -le 0 -or
        (Get-Item -LiteralPath $Destination).Length -gt 64MB) {
        throw 'QuotaPin source archive has an invalid size.'
    }
}

$LocalInstaller = $null
if ($PSScriptRoot) {
    $Candidate = Join-Path $PSScriptRoot 'scripts\install.ps1'
    if (Test-Path -LiteralPath $Candidate) { $LocalInstaller = $Candidate }
}

if ($LocalInstaller) {
    if ($RequestedVersion) {
        $LocalVersion = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'VERSION')).Trim()
        if ($LocalVersion -cne $RequestedVersion) {
            throw "Local QuotaPin source is $LocalVersion, not requested version $RequestedVersion."
        }
    }
    Invoke-QuotaPinInstaller $LocalInstaller
    return
}

$TempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$TempRoot = Join-Path $TempBase ('QuotaPin-bootstrap-' + [Guid]::NewGuid().ToString('N'))
$ArchivePath = Join-Path $TempRoot 'QuotaPin.zip'
$ExtractRoot = Join-Path $TempRoot 'source'

try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ReleaseHeaders = @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = 'QuotaPin/bootstrap'
        'X-GitHub-Api-Version' = '2026-03-10'
    }
    $Release = Invoke-RestMethod -UseBasicParsing -Uri $ReleaseApiUrl -Headers $ReleaseHeaders -TimeoutSec 20
    $SelectedTag = [string]$Release.tag_name
    if (-not $SelectedTag.StartsWith('v', [StringComparison]::Ordinal) -or $SelectedTag.Substring(1) -notmatch $VersionPattern) {
        throw 'The selected QuotaPin release has an invalid tag.'
    }
    $SelectedVersion = $SelectedTag.Substring(1)
    if ($RequestedVersion -and $SelectedVersion -cne $RequestedVersion) {
        throw "QuotaPin release $SelectedTag does not match requested version $RequestedVersion."
    }
    $SelectedIsPrerelease = $SelectedVersion.Contains('-')
    if ([bool]$Release.draft -or $Release.immutable -ne $true -or [bool]$Release.prerelease -ne $SelectedIsPrerelease) {
        throw "QuotaPin release $SelectedTag is not a published immutable release with consistent channel metadata."
    }
    if (-not $RequestedVersion -and $SelectedIsPrerelease) {
        throw 'GitHub returned a prerelease for the stable QuotaPin install channel.'
    }
    $ArchiveUrl = "$OfficialRepository/archive/refs/tags/$SelectedTag.zip"
    Receive-QuotaPinBootstrapArchive $ArchiveUrl $ArchivePath
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force

    $SourceRoots = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory)
    if ($SourceRoots.Count -ne 1) {
        throw "Expected one QuotaPin source root; found $($SourceRoots.Count)."
    }
    $DownloadedVersionPath = Join-Path $SourceRoots[0].FullName 'VERSION'
    $DownloadedInstaller = Join-Path $SourceRoots[0].FullName 'scripts\install.ps1'
    if (-not (Test-Path -LiteralPath $DownloadedVersionPath) -or -not (Test-Path -LiteralPath $DownloadedInstaller)) {
        throw 'The downloaded QuotaPin release is incomplete.'
    }
    $DownloadedVersion = (Get-Content -Raw -LiteralPath $DownloadedVersionPath).Trim()
    if ($DownloadedVersion -cne $SelectedVersion) {
        throw "Downloaded QuotaPin version $DownloadedVersion does not match selected version $SelectedVersion."
    }
    Invoke-QuotaPinInstaller $DownloadedInstaller
}
finally {
    $ResolvedTempRoot = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
    $ExpectedPrefix = $TempBase + '\QuotaPin-bootstrap-'
    if ($ResolvedTempRoot.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedTempRoot)) {
        try { Remove-Item -LiteralPath $ResolvedTempRoot -Recurse -Force -ErrorAction Stop }
        catch { Write-Warning "QuotaPin installed, but its temporary download could not be removed: $ResolvedTempRoot" }
    }
}
