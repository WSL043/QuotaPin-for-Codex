param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$ReleaseApiUrl = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OfficialRepository = 'https://github.com/WSL043/QuotaPin-for-Codex'
$WindowsPackageMaximumBytes = 160MB
$MacPackageMaximumBytes = 128MB
$VersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
if ($Version -notmatch $VersionPattern) { throw 'QuotaPin update version is invalid.' }

function ConvertTo-QuotaPinWindowsFileVersion([string]$SemanticVersion) {
    $Match = [regex]::Match($SemanticVersion, '^(\d+\.\d+\.\d+)(?:-(?:alpha|beta)\.(\d+))?$')
    if (-not $Match.Success) { throw 'QuotaPin version cannot be represented as a Windows file version.' }
    $Revision = if ($Match.Groups[2].Success) { $Match.Groups[2].Value } else { '0' }
    return '{0}.{1}' -f $Match.Groups[1].Value, $Revision
}

function Compare-QuotaPinVersion([string]$Left, [string]$Right) {
    $Pattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
    $L = [regex]::Match($Left, $Pattern)
    $R = [regex]::Match($Right, $Pattern)
    if (-not $L.Success -or -not $R.Success) { throw 'Cannot compare an invalid QuotaPin version.' }
    foreach ($Index in 1..3) {
        $LeftNumber = [long]$L.Groups[$Index].Value
        $RightNumber = [long]$R.Groups[$Index].Value
        if ($LeftNumber -lt $RightNumber) { return -1 }
        if ($LeftNumber -gt $RightNumber) { return 1 }
    }
    $LeftPre = [string]$L.Groups[4].Value
    $RightPre = [string]$R.Groups[4].Value
    if (-not $LeftPre -or -not $RightPre) {
        if (-not $LeftPre -and -not $RightPre) { return 0 }
        return $(if (-not $LeftPre) { 1 } else { -1 })
    }
    $LeftParts = @($LeftPre -split '\.')
    $RightParts = @($RightPre -split '\.')
    $Length = [Math]::Max($LeftParts.Count, $RightParts.Count)
    foreach ($Index in 0..($Length - 1)) {
        if ($Index -ge $LeftParts.Count) { return -1 }
        if ($Index -ge $RightParts.Count) { return 1 }
        $LeftPart = $LeftParts[$Index]
        $RightPart = $RightParts[$Index]
        if ($LeftPart -ceq $RightPart) { continue }
        $LeftNumeric = $LeftPart -match '^\d+$'
        $RightNumeric = $RightPart -match '^\d+$'
        if ($LeftNumeric -and $RightNumeric) {
            $LeftValue = [long]$LeftPart
            $RightValue = [long]$RightPart
            return $(if ($LeftValue -lt $RightValue) { -1 } else { 1 })
        }
        if ($LeftNumeric -ne $RightNumeric) { return $(if ($LeftNumeric) { -1 } else { 1 }) }
        return $(if ([string]::CompareOrdinal($LeftPart, $RightPart) -lt 0) { -1 } else { 1 })
    }
    return 0
}

$InstallRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin'
$InstalledVersionPath = Join-Path $InstallRoot 'VERSION'
$LogRoot = Join-Path $InstallRoot 'logs'
$UpdateLogPath = Join-Path $LogRoot 'update.log'
$UpdateResultPath = Join-Path $LogRoot 'update-result.json'
$UpdateCompletionPath = Join-Path $LogRoot 'update-completion.json'
$InstalledVersion = if (Test-Path -LiteralPath $InstalledVersionPath -PathType Leaf) {
    (Get-Content -Raw -LiteralPath $InstalledVersionPath).Trim()
}
else { '' }
if ($InstalledVersion -notmatch $VersionPattern) { throw 'The installed QuotaPin version is unavailable or invalid.' }
$UpdateDirection = switch (Compare-QuotaPinVersion $Version $InstalledVersion) {
    -1 { 'rollback' }
    0 { 'repair' }
    default { 'update' }
}

function Write-QuotaPinUpdateLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        Add-Content -LiteralPath $UpdateLogPath -Value ('{0:o} {1}' -f (Get-Date), ($Message -replace '[\r\n]+', ' '))
    }
    catch {}
}

function Write-QuotaPinUpdateResult([string]$Status, [string]$Phase, [string]$Message) {
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $SafeMessage = ($Message -replace '[\r\n]+', ' ').Trim()
    if ($SafeMessage.Length -gt 200) { $SafeMessage = $SafeMessage.Substring(0, 200) }
    $Value = [ordered]@{
        schema = 2
        status = $Status
        phase = $Phase
        version = $Version
        fromVersion = $InstalledVersion
        direction = $UpdateDirection
        writtenAt = [DateTimeOffset]::Now.ToString('o')
        message = $SafeMessage
    }
    $Targets = @($UpdateResultPath)
    if ($Status -in @('succeeded', 'degraded', 'failed', 'rolled-back', 'rollback-failed')) {
        $Targets += $UpdateCompletionPath
    }
    foreach ($Target in $Targets) {
        $Temporary = $Target + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        try {
            [IO.File]::WriteAllText($Temporary, ($Value | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath $Temporary -Destination $Target -Force
        }
        finally {
            if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Receive-QuotaPinInstaller([string]$Uri, [string]$Destination, [string]$DisplayName, [long]$ExpectedBytes) {
    $CurlPath = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $CurlPath -PathType Leaf)) { throw 'Windows curl.exe is unavailable.' }
    $ExitCode = -1
    foreach ($Attempt in 1..6) {
        Write-QuotaPinUpdateLog ("download attempt={0} expectedBytes={1}" -f $Attempt, $ExpectedBytes)
        & $CurlPath --ipv4 --http1.1 --fail --location --show-error --connect-timeout 20 --speed-limit 1024 --speed-time 90 --max-time 900 --continue-at - --output $Destination $Uri
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) { break }
        if ((Test-Path -LiteralPath $Destination) -and (Get-Item -LiteralPath $Destination).Length -gt $WindowsPackageMaximumBytes) {
            throw 'QuotaPin installer exceeded its size limit.'
        }
        if ($Attempt -lt 6) { Start-Sleep -Seconds ([Math]::Min(16, [Math]::Pow(2, $Attempt))) }
    }
    if ($ExitCode -ne 0) { throw "QuotaPin installer download failed with curl exit code $ExitCode." }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf) -or
        (Get-Item -LiteralPath $Destination).Length -ne $ExpectedBytes -or
        (Get-Item -LiteralPath $Destination).Length -gt $WindowsPackageMaximumBytes) {
        throw 'QuotaPin installer download has an invalid size.'
    }
}

$UpdateMutexName = 'Local\QuotaPin.Update.{0}' -f [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$UpdateMutex = New-Object Threading.Mutex($false, $UpdateMutexName)
$UpdateMutexAcquired = $false
try { $UpdateMutexAcquired = $UpdateMutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $UpdateMutexAcquired = $true }
if (-not $UpdateMutexAcquired) {
    $UpdateMutex.Dispose()
    throw 'Another QuotaPin update is already running.'
}

$TempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$TempRoot = Join-Path $TempBase ('QuotaPin-update-' + [Guid]::NewGuid().ToString('N'))
$PackagePath = $null
try {
    $LifecyclePath = Join-Path $InstallRoot 'src\lifecycle.ps1'
    $RuntimeTrustPath = Join-Path $InstallRoot 'src\runtime-trust.ps1'
    if (-not (Test-Path -LiteralPath $LifecyclePath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $RuntimeTrustPath -PathType Leaf)) {
        throw 'QuotaPin update ownership and runtime verification are unavailable. Run the install command once to repair it.'
    }
    . $LifecyclePath -InstallRootOverride $InstallRoot
    . $RuntimeTrustPath
    $InstallOwner = Get-QuotaPinInstallOwner
    if ($InstallOwner -notin @('setup', 'command')) { throw 'QuotaPin installation ownership is unavailable.' }
    $ResumeRuntime = Get-QuotaPinResumableRuntime -InstallRoot $InstallRoot -AgentPath (Join-Path $InstallRoot 'QuotaPin.Agent.exe')
    Write-QuotaPinUpdateLog "started version=$Version owner=$InstallOwner resume=$([bool]$ResumeRuntime)"
    Write-QuotaPinUpdateResult 'started' 'preparing' 'QuotaPin is preparing the selected update.'
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $OfficialApiUrl = "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases/tags/v$Version"
    if (-not $ReleaseApiUrl) { $ReleaseApiUrl = $OfficialApiUrl }
    $ReleaseUri = $null
    if (-not [Uri]::TryCreate($ReleaseApiUrl, [UriKind]::Absolute, [ref]$ReleaseUri) -or
        ($ReleaseApiUrl -cne $OfficialApiUrl -and -not ($ReleaseUri.Scheme -eq 'http' -and $ReleaseUri.IsLoopback))) {
        throw 'QuotaPin update metadata must use the exact official GitHub URL or a loopback fixture.'
    }
    $Headers = @{
        Accept = 'application/vnd.github+json'
        'User-Agent' = "QuotaPin/$InstalledVersion"
        'X-GitHub-Api-Version' = '2026-03-10'
    }
    $Release = Invoke-RestMethod -UseBasicParsing -Uri $ReleaseApiUrl -Headers $Headers -TimeoutSec 20
    $ExpectedTag = "v$Version"
    if ([string]$Release.tag_name -cne $ExpectedTag -or [bool]$Release.draft -or $Release.immutable -ne $true -or
        [bool]$Release.prerelease -ne $Version.Contains('-')) {
        throw 'The selected QuotaPin release is not a published immutable release with consistent metadata.'
    }
    $Assets = @($Release.assets)
    $PackageName = "QuotaPin-$Version.exe"
    $MacPackageName = "QuotaPin-macOS-$Version.dmg"
    $PackageAssets = @($Assets | Where-Object { [string]$_.name -ceq $PackageName })
    if ($PackageAssets.Count -ne 1) { throw "The selected release does not contain exactly one $PackageName asset." }
    if ($Assets.Count -eq 2) {
        $MacAssets = @($Assets | Where-Object { [string]$_.name -ceq $MacPackageName })
        if ($MacAssets.Count -ne 1) { throw 'The selected release does not match the two-platform package policy.' }
        $MacAsset = $MacAssets[0]
        $ExpectedMacUrl = "$OfficialRepository/releases/download/$ExpectedTag/$MacPackageName"
        if ([string]$MacAsset.browser_download_url -cne $ExpectedMacUrl -or
            [string]$MacAsset.digest -notmatch '^sha256:[0-9a-f]{64}$' -or
            [long]$MacAsset.size -le 0 -or [long]$MacAsset.size -gt $MacPackageMaximumBytes) {
            throw 'The companion macOS package does not have an exact official URL and SHA-256 digest.'
        }
    }
    elseif ($Assets.Count -ne 1) { throw 'The selected release contains an unexpected public asset set.' }
    $Asset = $PackageAssets[0]
    $ExpectedUrl = "$OfficialRepository/releases/download/$ExpectedTag/$PackageName"
    $AssetUrl = [string]$Asset.browser_download_url
    $AssetDigest = [string]$Asset.digest
    $AssetBytes = [long]$Asset.size
    if ($AssetUrl -cne $ExpectedUrl -or $AssetDigest -notmatch '^sha256:[0-9a-f]{64}$' -or
        $AssetBytes -le 0 -or $AssetBytes -gt $WindowsPackageMaximumBytes) {
        throw 'The selected installer does not have an exact official URL and SHA-256 digest.'
    }
    $PackagePath = Join-Path $TempRoot $PackageName
    Write-QuotaPinUpdateResult 'started' 'downloading' 'QuotaPin is downloading the verified release.'
    Receive-QuotaPinInstaller $AssetUrl $PackagePath $PackageName $AssetBytes
    Write-QuotaPinUpdateResult 'started' 'verifying' 'QuotaPin is verifying the downloaded release.'
    # Keep the updater independent of PowerShell module discovery.  Some
    # otherwise healthy Windows PowerShell 5.1 hosts can resolve the web
    # cmdlets but fail to auto-load a module-provided hash command in a
    # detached update process.
    # runtime-trust.ps1 is already loaded above and its .NET SHA-256 helper is
    # part of the same trust boundary used for release payload verification.
    $ActualDigest = 'sha256:' + (Get-QuotaPinSha256 $PackagePath)
    if ($ActualDigest -cne $AssetDigest) { throw 'The downloaded QuotaPin installer failed SHA-256 verification.' }
    $VersionInfo = (Get-Item -LiteralPath $PackagePath).VersionInfo
    $ExpectedPackageVersion = ConvertTo-QuotaPinWindowsFileVersion $Version
    if (([string]$VersionInfo.ProductVersion).Trim() -cne $ExpectedPackageVersion -or
        ([string]$VersionInfo.FileDescription).IndexOf($OfficialRepository, [StringComparison]::Ordinal) -lt 0 -or
        ([string]$VersionInfo.OriginalFilename).Trim() -cne $PackageName) {
        throw 'The downloaded QuotaPin installer identity does not match the selected release.'
    }
    # Do not use Start-Process -Wait here: it waits for the long-running
    # auto-attach watcher that the installer starts after committing files.
    # The wrapper owns the one runtime handoff for panel and tray updates.  A
    # directly launched installer still performs its own best-effort handoff.
    $InstallerArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/DEFERHANDOFF=1')
    if ($InstallOwner -eq 'command') { $InstallerArguments += '/COMMANDINSTALL=1' }
    Write-QuotaPinUpdateResult 'started' 'installing' 'QuotaPin is installing the verified release.'
    $Process = Start-Process -FilePath $PackagePath -ArgumentList $InstallerArguments -PassThru
    try {
        if (-not $Process.WaitForExit(5 * 60 * 1000)) {
            try { Stop-Process -Id $Process.Id -Force -ErrorAction Stop }
            catch { Write-QuotaPinUpdateLog ("installer-timeout cleanup-warning code={0}" -f $_.Exception.GetType().Name) }
            throw 'QuotaPin installer did not finish within five minutes. Run the install command to repair it.'
        }
        if ($Process.ExitCode -ne 0) { throw "QuotaPin installer exited with code $($Process.ExitCode)." }
    }
    finally { $Process.Dispose() }
    $InstalledNow = if (Test-Path -LiteralPath $InstalledVersionPath -PathType Leaf) {
        (Get-Content -Raw -LiteralPath $InstalledVersionPath).Trim()
    }
    else { '' }
    if ($InstalledNow -cne $Version) { throw 'QuotaPin installer completed without committing the selected version.' }
    $ResumeState = 'next-launch'
    if ($ResumeRuntime) {
        Write-QuotaPinUpdateResult 'started' 'reconnecting' 'QuotaPin is reconnecting the current Codex session.'
        . (Join-Path $InstallRoot 'src\runtime-trust.ps1')
        $ResumeState = Resume-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -ExpectedRuntime $ResumeRuntime -AgentPath (Join-Path $InstallRoot 'QuotaPin.Agent.exe')
    }
    if ($ResumeState -eq 'quota-ready') {
        Write-QuotaPinUpdateResult 'succeeded' 'complete' 'QuotaPin updated without restarting Codex.'
    }
    else {
        Write-QuotaPinUpdateResult 'degraded' 'complete' 'QuotaPin updated. Attachment will retry on the next Codex launch.'
    }
    Write-QuotaPinUpdateLog "succeeded version=$Version owner=$InstallOwner resume=$ResumeState"
}
catch {
    Write-QuotaPinUpdateLog ("failed version={0} code={1}" -f $Version, $_.Exception.GetType().Name)
    try { Write-QuotaPinUpdateResult 'failed' 'complete' 'QuotaPin could not complete the update. Open the version menu to retry.' } catch {}
    throw
}
finally {
    $Resolved = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
    $ExpectedPrefix = $TempBase + '\QuotaPin-update-'
    if ($Resolved.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $Resolved)) {
        try { Remove-Item -LiteralPath $Resolved -Recurse -Force }
        catch { Write-QuotaPinUpdateLog ("cleanup-warning temp-root code={0}" -f $_.Exception.GetType().Name) }
    }
    if ($UpdateMutexAcquired) { try { $UpdateMutex.ReleaseMutex() } catch {} }
    $UpdateMutex.Dispose()
}
