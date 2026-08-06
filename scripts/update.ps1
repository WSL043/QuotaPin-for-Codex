param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$ArchiveUrl = '',
    [string]$ReleaseBaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$OfficialRepository = 'https://github.com/WSL043/QuotaPin-for-Codex'
$MinimumSafeVersion = '0.3.0-alpha.25'
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw 'QuotaPin update version is invalid.'
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

if ((Compare-QuotaPinVersion $Version $MinimumSafeVersion) -lt 0) {
    throw "QuotaPin $Version is outside the safe rollback range."
}

$InstallRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin'
$AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
$InstalledVersionPath = Join-Path $InstallRoot 'VERSION'
$LogRoot = Join-Path $InstallRoot 'logs'
$UpdateLogPath = Join-Path $LogRoot 'update.log'
$UpdateResultPath = Join-Path $LogRoot 'update-result.json'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$InstalledVersion = if (Test-Path -LiteralPath $InstalledVersionPath -PathType Leaf) { (Get-Content -Raw -LiteralPath $InstalledVersionPath).Trim() } else { '' }
if ($InstalledVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw 'The installed QuotaPin version is unavailable or invalid.'
}
$UpdateDirection = switch (Compare-QuotaPinVersion $Version $InstalledVersion) {
    -1 { 'rollback' }
    0 { 'repair' }
    default { 'update' }
}

function Write-QuotaPinUpdateLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        if ((Test-Path -LiteralPath $UpdateLogPath) -and (Get-Item -LiteralPath $UpdateLogPath).Length -ge 512KB) {
            $Older = $UpdateLogPath + '.2'
            $Previous = $UpdateLogPath + '.1'
            if (Test-Path -LiteralPath $Older) { Remove-Item -LiteralPath $Older -Force }
            if (Test-Path -LiteralPath $Previous) { Move-Item -LiteralPath $Previous -Destination $Older -Force }
            Move-Item -LiteralPath $UpdateLogPath -Destination $Previous -Force
        }
        Add-Content -LiteralPath $UpdateLogPath -Value ('{0:o} {1}' -f (Get-Date), ($Message -replace '[\r\n]+', ' '))
    }
    catch {}
}

function Write-QuotaPinUpdateResult([string]$Status, [string]$Message) {
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $SafeMessage = ($Message -replace '[\r\n]+', ' ').Trim()
    if ($SafeMessage.Length -gt 200) { $SafeMessage = $SafeMessage.Substring(0, 200) }
    $Value = [ordered]@{
        schema = 1
        status = $Status
        version = $Version
        fromVersion = $InstalledVersion
        direction = $UpdateDirection
        writtenAt = [DateTimeOffset]::Now.ToString('o')
        message = $SafeMessage
    }
    $Temporary = $UpdateResultPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($Temporary, ($Value | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $Temporary -Destination $UpdateResultPath -Force
    }
    finally {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
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
$ArchivePath = Join-Path $TempRoot 'QuotaPin.zip'
$ExtractRoot = Join-Path $TempRoot 'source'
$PayloadRoot = Join-Path $TempRoot 'payload'
$ReleaseBundleName = 'QuotaPin-Windows-x64.zip'
$ReleaseBundlePath = Join-Path $PayloadRoot $ReleaseBundleName
$ReleaseBundleChecksumPath = $ReleaseBundlePath + '.sha256'
$ReleaseBundleRoot = Join-Path $PayloadRoot 'bundle'
$ManifestPath = Join-Path $ReleaseBundleRoot 'QuotaPin-release.json'
$ManifestChecksumPath = $ManifestPath + '.sha256'
$Sha256SumsPath = Join-Path $ReleaseBundleRoot 'SHA256SUMS'
$StagedAgentPath = Join-Path $ReleaseBundleRoot 'QuotaPin.Agent.exe'
$StagedAgentChecksumPath = $StagedAgentPath + '.sha256'
$StagedNoticesPath = Join-Path $ReleaseBundleRoot 'THIRD_PARTY_NOTICES.txt'
$StagedNoticesChecksumPath = $StagedNoticesPath + '.sha256'
$RollbackSnapshot = $null
$RollbackRegistry = $null
$RollbackTerminalWritten = $false
$ProgramsRoot = [Environment]::GetFolderPath('Programs')
$DesktopRoot = [Environment]::GetFolderPath('Desktop')
$StartupRoot = [Environment]::GetFolderPath('Startup')
$AutoAttachShortcut = Join-Path $StartupRoot 'QuotaPin Auto Attach.lnk'
$QuotaPinStartMenuRoot = Join-Path $ProgramsRoot 'QuotaPin'
$DesktopShortcut = Join-Path $DesktopRoot 'Codex.lnk'
$StartMenuShortcut = Join-Path $ProgramsRoot 'Codex.lnk'
$FallbackDesktopShortcut = Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'
$FallbackStartMenuShortcut = Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk'

function Assert-QuotaPinUpdateUri([string]$Value, [string]$OfficialValue, [string]$Purpose) {
    $Uri = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$Uri)) { throw "$Purpose URL is invalid." }
    if ([string]::Equals($Value.TrimEnd('/'), $OfficialValue.TrimEnd('/'), [StringComparison]::Ordinal)) { return $Uri }
    if ($Uri.Scheme -eq 'http' -and $Uri.IsLoopback) { return $Uri }
    throw "$Purpose must use the exact official GitHub URL or a loopback fixture."
}

function Receive-QuotaPinUpdateFile([string]$Uri, [string]$Destination, [long]$MaximumBytes, [int]$TimeoutSeconds = 60) {
    $CurlPath = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $CurlPath -PathType Leaf)) { throw 'Windows curl.exe is unavailable.' }
    $ExitCode = -1
    foreach ($Attempt in 1..6) {
        & $CurlPath --ipv4 --http1.1 --fail --location --silent --show-error --connect-timeout 20 --speed-limit 1024 --speed-time 90 --max-time $TimeoutSeconds --continue-at - --output $Destination $Uri
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) { break }
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            $PartialLength = (Get-Item -LiteralPath $Destination).Length
            if ($PartialLength -gt $MaximumBytes) { throw "QuotaPin update asset exceeded its size limit: $Uri" }
        }
        if ($Attempt -lt 6) { Start-Sleep -Seconds ([Math]::Min(16, [Math]::Pow(2, $Attempt))) }
    }
    if ($ExitCode -ne 0) { throw "QuotaPin update download failed after resumable retries with curl exit code $ExitCode." }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw 'QuotaPin update download did not create a file.' }
    $Length = (Get-Item -LiteralPath $Destination).Length
    if ($Length -le 0 -or $Length -gt $MaximumBytes) { throw "QuotaPin update download has an invalid size: $([IO.Path]::GetFileName($Destination))" }
}

function Invoke-QuotaPinAgentProbe([string]$Executable, [string]$Argument) {
    foreach ($Attempt in 1..5) {
        try {
            $StartInfo = New-Object Diagnostics.ProcessStartInfo
            $StartInfo.FileName = $Executable
            $StartInfo.Arguments = $Argument
            $StartInfo.UseShellExecute = $false
            $StartInfo.CreateNoWindow = $true
            $StartInfo.RedirectStandardOutput = $true
            $StartInfo.RedirectStandardError = $true
            $Process = New-Object Diagnostics.Process
            $Process.StartInfo = $StartInfo
            try {
                if (-not $Process.Start()) { throw 'Agent probe did not start.' }
                if (-not $Process.WaitForExit(10000)) { try { $Process.Kill() } catch {} }
                elseif ($Process.ExitCode -eq 0) {
                    $Output = $Process.StandardOutput.ReadToEnd().Trim()
                    if ($Output) { return $Output }
                }
            }
            finally { $Process.Dispose() }
        }
        catch {
            if ($Attempt -eq 5) { throw }
        }
        if ($Attempt -lt 5) { Start-Sleep -Milliseconds 250 }
    }
    throw 'QuotaPin could not verify the staged Agent.'
}

function Start-QuotaPinRestoredWatcher {
    try {
        $StatePath = Join-Path $InstallRoot 'install-state.json'
        if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return }
        $InstallState = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
        if ([int]$InstallState.schema -ne 1 -or [string]$InstallState.owner -cne 'command' -or $InstallState.preferences.autoAttach -ne $true) { return }
        $Watcher = Join-Path $InstallRoot 'src\auto-attach.ps1'
        if (-not (Test-Path -LiteralPath $Watcher -PathType Leaf)) { throw 'The restored watcher is unavailable.' }
        $Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -IgnoreExisting' -f $Watcher
        Start-Process -FilePath $PowerShellExe -ArgumentList $Arguments -WindowStyle Hidden | Out-Null
    }
    catch { Write-QuotaPinUpdateLog ("rollback watcher warning code={0}" -f $_.Exception.GetType().Name) }
}

try {
    Write-QuotaPinUpdateLog "started version=$Version"
    Write-QuotaPinUpdateResult 'started' 'QuotaPin is preparing the selected update.'
    $ResumeRuntime = $null
    $RuntimeTrustHelper = Join-Path $InstallRoot 'src\runtime-trust.ps1'
    if (-not (Test-Path -LiteralPath $RuntimeTrustHelper -PathType Leaf)) { throw 'QuotaPin release verification is unavailable. Run the install command to repair it.' }
    . $RuntimeTrustHelper
    if (-not (Get-Command Test-QuotaPinReleaseTrustBundle -ErrorAction SilentlyContinue)) { throw 'QuotaPin release verification is incomplete. Run the install command to repair it.' }
    try { $ResumeRuntime = Get-QuotaPinResumableRuntime -InstallRoot $InstallRoot -AgentPath $AgentPath }
    catch {}
    try {
        New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
        New-Item -ItemType Directory -Path $PayloadRoot -Force | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $OfficialReleaseBase = "$OfficialRepository/releases/download/v$Version"
        if (-not $ReleaseBaseUrl) { $ReleaseBaseUrl = $OfficialReleaseBase }
        $ReleaseBaseUrl = $ReleaseBaseUrl.TrimEnd('/')
        $null = Assert-QuotaPinUpdateUri $ReleaseBaseUrl $OfficialReleaseBase 'QuotaPin release assets'
        foreach ($Download in @(
            @($ReleaseBundleName, $ReleaseBundlePath, 128MB, 300),
            @($ReleaseBundleName + '.sha256', $ReleaseBundleChecksumPath, 4096, 30)
        )) {
            Receive-QuotaPinUpdateFile ("{0}/{1}" -f $ReleaseBaseUrl, $Download[0]) $Download[1] ([long]$Download[2]) ([int]$Download[3])
        }
        $null = Expand-QuotaPinReleaseBundle -ArchivePath $ReleaseBundlePath -ArchiveChecksumPath $ReleaseBundleChecksumPath -DestinationRoot $ReleaseBundleRoot
        $ReleaseTrust = Test-QuotaPinReleaseTrustBundle `
            -Version $Version `
            -ManifestPath $ManifestPath `
            -ManifestChecksumPath $ManifestChecksumPath `
            -Sha256SumsPath $Sha256SumsPath `
            -AgentPath $StagedAgentPath `
            -AgentChecksumPath $StagedAgentChecksumPath `
            -NoticesPath $StagedNoticesPath `
            -NoticesChecksumPath $StagedNoticesChecksumPath
        $ReportedVersion = Invoke-QuotaPinAgentProbe $StagedAgentPath '--agent-version'
        $OriginJson = Invoke-QuotaPinAgentProbe $StagedAgentPath '--build-origin'
        try { $Origin = $OriginJson | ConvertFrom-Json }
        catch { throw 'The staged Agent build origin is invalid.' }
        if ([string]$ReportedVersion -cne $Version -or
            [string]$Origin.schemaVersion -cne 'quotapin-origin/v1' -or
            [string]$Origin.product -cne 'QuotaPin' -or
            [string]$Origin.version -cne $Version -or
            [string]$Origin.repository -cne $OfficialRepository -or
            [string]$Origin.commit -cne [string]$ReleaseTrust.commit) {
            throw 'The staged Agent does not match the trusted release manifest.'
        }

        $OfficialArchiveUrl = "$OfficialRepository/archive/$($ReleaseTrust.commit).zip"
        if (-not $ArchiveUrl) { $ArchiveUrl = $OfficialArchiveUrl }
        $null = Assert-QuotaPinUpdateUri $ArchiveUrl $OfficialArchiveUrl 'QuotaPin source archive'
        Receive-QuotaPinUpdateFile $ArchiveUrl $ArchivePath 64MB 60
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force

        $SourceRoots = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory)
        if ($SourceRoots.Count -ne 1) { throw "Expected one QuotaPin source root; found $($SourceRoots.Count)." }
        $VersionPath = Join-Path $SourceRoots[0].FullName 'VERSION'
        $InstallerPath = Join-Path $SourceRoots[0].FullName 'scripts\install.ps1'
        if (-not (Test-Path -LiteralPath $VersionPath -PathType Leaf) -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
            throw 'The downloaded QuotaPin release is incomplete.'
        }
        $DownloadedVersion = (Get-Content -Raw -LiteralPath $VersionPath).Trim()
        if (-not [string]::Equals($DownloadedVersion, $Version, [StringComparison]::Ordinal)) {
            throw "Downloaded QuotaPin version $DownloadedVersion does not match requested version $Version."
        }
        $SourceDistRoot = Join-Path $SourceRoots[0].FullName 'dist'
        New-Item -ItemType Directory -Path $SourceDistRoot -Force | Out-Null
        Copy-Item -LiteralPath $StagedAgentPath -Destination (Join-Path $SourceDistRoot 'QuotaPin.Agent.exe') -Force
        Copy-Item -LiteralPath $StagedNoticesPath -Destination (Join-Path $SourceDistRoot 'THIRD_PARTY_NOTICES.txt') -Force

        $LifecycleHelper = Join-Path $InstallRoot 'src\lifecycle.ps1'
        if (-not (Test-Path -LiteralPath $LifecycleHelper -PathType Leaf)) { throw 'QuotaPin rollback support is unavailable. Run the install command to repair it.' }
        . $LifecycleHelper -InstallRootOverride $InstallRoot
        $RollbackPaths = @(
            $InstallRoot,
            $AutoAttachShortcut,
            $QuotaPinStartMenuRoot,
            $DesktopShortcut,
            $StartMenuShortcut,
            $FallbackDesktopShortcut,
            $FallbackStartMenuShortcut,
            (Join-Path $DesktopRoot 'QuotaPin.lnk'),
            (Join-Path $DesktopRoot 'Codex Usage.lnk')
        )
        $RollbackSnapshot = New-QuotaPinRollbackSnapshot -Paths $RollbackPaths -SnapshotRoot (Join-Path $TempRoot 'rollback')
        $RollbackRegistry = Get-QuotaPinInstallRegistrySnapshot
        # Stay in this runspace so scripts\install.ps1 can recursively acquire
        # the update mutex while also taking the install mutex. Spawning a new
        # PowerShell process here would either reopen a race or deadlock the
        # child behind the lock intentionally held by this updater.
        try {
            & $InstallerPath -DeferRuntimeResume
        }
        catch {
            $InstallFailure = $_
            try {
                $CurrentStop = Join-Path $InstallRoot 'stop.ps1'
                if (Test-Path -LiteralPath $CurrentStop -PathType Leaf) { & $CurrentStop -TemporaryExit }
            }
            catch { Write-QuotaPinUpdateLog ("rollback stop warning code={0}" -f $_.Exception.GetType().Name) }
            try {
                Restore-QuotaPinRollbackSnapshot -Snapshot $RollbackSnapshot
                Restore-QuotaPinInstallRegistrySnapshot -Snapshot $RollbackRegistry
                Start-QuotaPinRestoredWatcher
                $RollbackResume = 'next-launch'
                if ($ResumeRuntime) {
                    try { $RollbackResume = Resume-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -ExpectedRuntime $ResumeRuntime -AgentPath $AgentPath }
                    catch { Write-QuotaPinUpdateLog ("rollback reattach warning code={0}" -f $_.Exception.GetType().Name) }
                }
                Write-QuotaPinUpdateResult 'rolled-back' 'QuotaPin could not complete the update. The previous version was restored.'
                Write-QuotaPinUpdateLog "rolled-back version=$Version restored=$InstalledVersion resume=$RollbackResume"
                $RollbackTerminalWritten = $true
            }
            catch {
                Write-QuotaPinUpdateResult 'rollback-failed' 'QuotaPin could not complete the update or fully restore the previous version. Run the install command to repair it.'
                Write-QuotaPinUpdateLog ("rollback-failed version={0} code={1}" -f $Version, $_.Exception.GetType().Name)
                $RollbackTerminalWritten = $true
            }
            throw $InstallFailure
        }

        if ($RollbackSnapshot) {
            if (-not (Remove-QuotaPinRollbackSnapshot -Snapshot $RollbackSnapshot)) {
                Write-QuotaPinUpdateLog 'cleanup-warning rollback snapshot could not be removed'
            }
            $RollbackSnapshot = $null
        }

        $ResumeState = 'not-needed'
        if ($ResumeRuntime) {
            $ResumeState = 'next-launch'
            try { $ResumeState = Resume-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -ExpectedRuntime $ResumeRuntime -AgentPath $AgentPath }
            catch { Write-QuotaPinUpdateLog ("reattach-warning code={0}" -f $_.Exception.GetType().Name) }
        }
        if ($ResumeState -in @('not-needed', 'quota-ready')) {
            Write-QuotaPinUpdateResult 'succeeded' $(if ($ResumeState -eq 'quota-ready') { 'QuotaPin updated and reattached to Codex.' } else { 'QuotaPin updated successfully.' })
            Write-QuotaPinUpdateLog "succeeded version=$Version resume=$ResumeState"
        }
        else {
            Write-QuotaPinUpdateResult 'degraded' 'QuotaPin updated. Attachment will retry on the next Codex launch.'
            Write-QuotaPinUpdateLog "degraded version=$Version resume=$ResumeState"
        }
    }
    finally {
        $Resolved = [IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
        $ExpectedPrefix = $TempBase + '\QuotaPin-update-'
        if ($Resolved.StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $Resolved)) {
            try { Remove-Item -LiteralPath $Resolved -Recurse -Force }
            catch { Write-QuotaPinUpdateLog ("cleanup-warning temp-root code={0}" -f $_.Exception.GetType().Name) }
        }
    }
}
catch {
    Write-QuotaPinUpdateLog ("failed version={0} code={1}" -f $Version, $_.Exception.GetType().Name)
    if (-not $RollbackTerminalWritten) {
        try { Write-QuotaPinUpdateResult 'failed' 'QuotaPin could not complete the update. Open the version menu to retry.' } catch {}
    }
    throw
}
finally {
    if ($UpdateMutexAcquired) { try { $UpdateMutex.ReleaseMutex() } catch {} }
    $UpdateMutex.Dispose()
}
