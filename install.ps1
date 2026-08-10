param([string]$Version = '')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OfficialRepository = 'https://github.com/WSL043/QuotaPin-for-Codex'
$WindowsPackageMaximumBytes = 160MB
$MacPackageMaximumBytes = 192MB
$VersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
$RequestedVersion = $Version.Trim()
if ($RequestedVersion -and $RequestedVersion -notmatch $VersionPattern) {
    throw 'QuotaPin version is invalid.'
}

function ConvertTo-QuotaPinWindowsFileVersion([string]$SemanticVersion) {
    $Match = [regex]::Match($SemanticVersion, '^(\d+\.\d+\.\d+)(?:-(?:alpha|beta)\.(\d+))?$')
    if (-not $Match.Success) { throw 'QuotaPin version cannot be represented as a Windows file version.' }
    $Revision = if ($Match.Groups[2].Success) { $Match.Groups[2].Value } else { '0' }
    return '{0}.{1}' -f $Match.Groups[1].Value, $Revision
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
    & $PowerShellExe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "QuotaPin installer exited with code $LASTEXITCODE."
    }
}

function Invoke-QuotaPinPackage([string]$PackagePath) {
    $Arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/COMMANDINSTALL=1')
    # PowerShell's Start-Process -Wait follows the installer's descendant tree.
    # QuotaPin intentionally leaves its watcher running, so -Wait would make a
    # successful command install appear hung forever. Wait for the installer
    # process itself through System.Diagnostics.Process instead.
    $Process = Start-Process -FilePath $PackagePath -ArgumentList $Arguments -PassThru
    try {
        $Process.WaitForExit()
        if ($Process.ExitCode -ne 0) { throw "QuotaPin installer exited with code $($Process.ExitCode)." }
    }
    finally { $Process.Dispose() }
}

function Receive-QuotaPinBootstrapFile(
    [string]$Uri,
    [string]$Destination,
    [long]$MaximumBytes,
    [int]$TimeoutSeconds,
    [string]$DisplayName,
    [long]$ExpectedBytes = 0
) {
    $CurlPath = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $CurlPath -PathType Leaf)) {
        throw 'Windows curl.exe is unavailable.'
    }
    $ExitCode = -1
    foreach ($Attempt in 1..6) {
        $SizeText = if ($ExpectedBytes -gt 0) { ' ({0:N1} MiB)' -f ($ExpectedBytes / 1MB) } else { '' }
        Write-Host "Downloading $DisplayName$SizeText - attempt $Attempt of 6"
        & $CurlPath --ipv4 --http1.1 --fail --location --show-error --progress-bar --connect-timeout 20 --speed-limit 1024 --speed-time 90 --max-time $TimeoutSeconds --continue-at - --output $Destination $Uri
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) { break }
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            if ((Get-Item -LiteralPath $Destination).Length -gt $MaximumBytes) {
                throw 'QuotaPin download exceeds its safety limit.'
            }
        }
        if ($Attempt -lt 6) {
            $Delay = [Math]::Min(8, [Math]::Pow(2, $Attempt))
            Write-Warning "Download was interrupted; keeping the partial file and retrying in $Delay seconds."
            Start-Sleep -Seconds $Delay
        }
    }
    if ($ExitCode -ne 0) {
        throw "QuotaPin download failed after resumable retries with curl exit code $ExitCode."
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf) -or
        (Get-Item -LiteralPath $Destination).Length -le 0 -or
        (Get-Item -LiteralPath $Destination).Length -gt $MaximumBytes) {
        throw 'QuotaPin download has an invalid size.'
    }
    Write-Host "Downloaded $DisplayName. Verifying SHA-256..."
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
$PackagePath = $null

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
    $PackageName = "QuotaPin-$SelectedVersion.exe"
    $MacPackageName = "QuotaPin-macOS-$SelectedVersion.dmg"
    $Assets = @($Release.assets)
    $PackageAssets = @($Assets | Where-Object { [string]$_.name -ceq $PackageName })
    if ($PackageAssets.Count -eq 1) {
        if ($Assets.Count -eq 2) {
            $MacAssets = @($Assets | Where-Object { [string]$_.name -ceq $MacPackageName })
            if ($MacAssets.Count -ne 1) { throw "Release $SelectedTag does not match the two-platform package policy." }
            $MacAsset = $MacAssets[0]
            $ExpectedMacUrl = "$OfficialRepository/releases/download/$SelectedTag/$MacPackageName"
            if ([string]$MacAsset.browser_download_url -cne $ExpectedMacUrl -or
                [string]$MacAsset.digest -notmatch '^sha256:[0-9a-f]{64}$' -or
                [long]$MacAsset.size -le 0 -or [long]$MacAsset.size -gt $MacPackageMaximumBytes) {
                throw 'The companion macOS package does not have an exact official URL and SHA-256 digest.'
            }
        }
        elseif ($Assets.Count -ne 1) { throw "Release $SelectedTag contains an unexpected public asset set." }
        $PackageAsset = $PackageAssets[0]
        $ExpectedPackageUrl = "$OfficialRepository/releases/download/$SelectedTag/$PackageName"
        $PackageUrl = [string]$PackageAsset.browser_download_url
        $PackageDigest = [string]$PackageAsset.digest
        $PackageBytes = [long]$PackageAsset.size
        if ($PackageUrl -cne $ExpectedPackageUrl -or $PackageDigest -notmatch '^sha256:[0-9a-f]{64}$' -or
            $PackageBytes -le 0 -or $PackageBytes -gt $WindowsPackageMaximumBytes) {
            throw 'The QuotaPin installer asset does not have an exact official URL and SHA-256 digest.'
        }
        $PackagePath = Join-Path $TempRoot $PackageName
        Receive-QuotaPinBootstrapFile $PackageUrl $PackagePath $WindowsPackageMaximumBytes 900 $PackageName $PackageBytes
        $ActualDigest = 'sha256:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $PackagePath).Hash.ToLowerInvariant()
        if ($ActualDigest -cne $PackageDigest) { throw 'The downloaded QuotaPin installer failed SHA-256 verification.' }
        $PackageVersionInfo = (Get-Item -LiteralPath $PackagePath).VersionInfo
        $PackageVersion = ([string]$PackageVersionInfo.ProductVersion).Trim()
        $PackageDescription = [string]$PackageVersionInfo.FileDescription
        $ExpectedPackageVersion = ConvertTo-QuotaPinWindowsFileVersion $SelectedVersion
        if ($PackageVersion -cne $ExpectedPackageVersion -or $PackageDescription.IndexOf($OfficialRepository, [StringComparison]::Ordinal) -lt 0 -or
            ([string]$PackageVersionInfo.OriginalFilename).Trim() -cne $PackageName) {
            throw 'The downloaded QuotaPin installer identity does not match the selected release.'
        }
        Invoke-QuotaPinPackage $PackagePath
    }
    elseif ($PackageAssets.Count -eq 0 -and $SelectedVersion -ceq '1.0.0') {
        # Compatibility path for the original 1.0.0 command release. New
        # releases publish exactly one versioned QuotaPin executable.
        $ArchiveUrl = "$OfficialRepository/archive/refs/tags/$SelectedTag.zip"
        Receive-QuotaPinBootstrapFile $ArchiveUrl $ArchivePath 64MB 120 "QuotaPin $SelectedVersion source"
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force
        $SourceRoots = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory)
        if ($SourceRoots.Count -ne 1) { throw "Expected one QuotaPin source root; found $($SourceRoots.Count)." }
        $DownloadedVersionPath = Join-Path $SourceRoots[0].FullName 'VERSION'
        $DownloadedInstaller = Join-Path $SourceRoots[0].FullName 'scripts\install.ps1'
        if (-not (Test-Path -LiteralPath $DownloadedVersionPath) -or -not (Test-Path -LiteralPath $DownloadedInstaller)) {
            throw 'The downloaded QuotaPin release is incomplete.'
        }
        $DownloadedVersion = (Get-Content -Raw -LiteralPath $DownloadedVersionPath).Trim()
        if ($DownloadedVersion -cne $SelectedVersion) { throw "Downloaded QuotaPin version $DownloadedVersion does not match selected version $SelectedVersion." }
        Invoke-QuotaPinInstaller $DownloadedInstaller
    }
    else {
        throw "The selected QuotaPin release does not contain the exact $PackageName asset."
    }
}
finally {
    $ResolvedTempRoot = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
    $ExpectedPrefix = $TempBase + '\QuotaPin-bootstrap-'
    if ($ResolvedTempRoot.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedTempRoot)) {
        try { Remove-Item -LiteralPath $ResolvedTempRoot -Recurse -Force -ErrorAction Stop }
        catch { Write-Warning "QuotaPin installed, but its temporary download could not be removed: $ResolvedTempRoot" }
    }
}
