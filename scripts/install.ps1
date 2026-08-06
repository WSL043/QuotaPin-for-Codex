param(
    [switch]$DisableAutoAttach,
    [switch]$EnableAutoAttach,
    [switch]$CreateLauncherShortcut,
    [switch]$NoDesktopShortcut,
    [switch]$DeferRuntimeResume,
    [string]$AgentUrl
)

$ErrorActionPreference = 'Stop'
if ($DisableAutoAttach -and $EnableAutoAttach) { throw 'Choose either -DisableAutoAttach or -EnableAutoAttach, not both.' }
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$SourceRoot = Join-Path $RepositoryRoot 'src'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin'
$InstallSourceRoot = Join-Path $InstallRoot 'src'
$AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
$NoticesPath = Join-Path $InstallRoot 'THIRD_PARTY_NOTICES.txt'
$Version = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'VERSION')).Trim()
$LocalAgent = Join-Path $RepositoryRoot 'dist\QuotaPin.Agent.exe'
$LocalNotices = Join-Path $RepositoryRoot 'dist\THIRD_PARTY_NOTICES.txt'
$ProgramsRoot = [Environment]::GetFolderPath('Programs')
$DesktopRoot = [Environment]::GetFolderPath('Desktop')
$StartupRoot = [Environment]::GetFolderPath('Startup')
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$LaunchScript = Join-Path $InstallSourceRoot 'launch.ps1'
$AutoAttachScript = Join-Path $InstallSourceRoot 'auto-attach.ps1'
$AutoAttachGuard = Join-Path $InstallRoot 'logs\auto-attach-guard.json'
$AutoAttachShortcut = Join-Path $StartupRoot 'QuotaPin Auto Attach.lnk'
$QuotaPinStartMenuRoot = Join-Path $ProgramsRoot 'QuotaPin'
$UninstallShortcut = Join-Path $QuotaPinStartMenuRoot 'Uninstall QuotaPin.lnk'
$DesktopShortcut = Join-Path $DesktopRoot 'Codex.lnk'
$StartMenuShortcut = Join-Path $ProgramsRoot 'Codex.lnk'
$FallbackDesktopShortcut = Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'
$FallbackStartMenuShortcut = Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk'
$SetupUninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{D3C316B5-8F18-45DF-98BD-2C9F579D9E24}_is1'
$LegacyShortcutCandidates = @(
    $DesktopShortcut,
    $StartMenuShortcut,
    $FallbackDesktopShortcut,
    $FallbackStartMenuShortcut,
    (Join-Path $DesktopRoot 'QuotaPin.lnk'),
    (Join-Path $DesktopRoot 'Codex Usage.lnk'),
    (Join-Path (Join-Path $ProgramsRoot 'QuotaPin') 'QuotaPin.lnk')
)
if ($env:OS -ne 'Windows_NT') { throw 'QuotaPin currently supports Windows only.' }
foreach ($RequiredFile in @('launch.ps1', 'auto-attach.ps1', 'auto-attach-policy.ps1', 'codex-process.ps1', 'codex-command.ps1', 'runtime-trust.ps1', 'ui.ps1', 'lifecycle.ps1')) {
    $Path = Join-Path $SourceRoot $RequiredFile
    if (-not (Test-Path -LiteralPath $Path)) { throw "Missing repository file: $Path" }
}
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'config.default.json'))) {
    throw 'Missing repository file: config.default.json'
}
. (Join-Path $SourceRoot 'lifecycle.ps1') -InstallRootOverride $InstallRoot
. (Join-Path $SourceRoot 'runtime-trust.ps1')
if (-not (Get-Command Test-QuotaPinReleaseTrustBundle -ErrorAction SilentlyContinue)) {
    throw 'QuotaPin release verification is unavailable.'
}
$MutexSuffix = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$MutationMutexes = @()
try {
    # Every mutating path acquires these locks in the same order. update.ps1
    # invokes this script in the same PowerShell runspace, so its already-held
    # update mutex is acquired recursively and remains held for the full handoff.
    foreach ($MutexName in @('Local\QuotaPin.Update.{0}' -f $MutexSuffix, 'Local\QuotaPin.Install.{0}' -f $MutexSuffix)) {
        $Mutex = New-Object Threading.Mutex($false, $MutexName)
        $Acquired = $false
        try { $Acquired = $Mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $Acquired = $true }
        if (-not $Acquired) {
            $Mutex.Dispose()
            throw 'Another QuotaPin install, update, or uninstall is already running.'
        }
        $MutationMutexes += $Mutex
    }
}
catch {
    for ($Index = $MutationMutexes.Count - 1; $Index -ge 0; $Index--) {
        try { $MutationMutexes[$Index].ReleaseMutex() } catch {}
        $MutationMutexes[$Index].Dispose()
    }
    throw
}
try {
$ExistingOwner = Get-QuotaPinInstallOwner
$SetupOwned = $ExistingOwner -eq 'setup' -or (Test-Path -LiteralPath $SetupUninstallKey) -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'unins000.exe')) -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'QuotaPin.Tray.exe'))
if ($SetupOwned) {
    throw 'QuotaPin is currently owned by the Windows Setup installation. Uninstall it from Windows Apps before using the command installer.'
}
$ExistingCommandInstall = $ExistingOwner -eq 'command' -or ((Test-Path -LiteralPath (Join-Path $InstallRoot 'VERSION')) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'QuotaPin.Tray.exe')))
$ExistingAutoAttach = Test-Path -LiteralPath $AutoAttachShortcut
$SavedPreferences = $null
try {
    $SavedStatePath = Join-Path $InstallRoot 'install-state.json'
    if (Test-Path -LiteralPath $SavedStatePath -PathType Leaf) {
        $SavedState = Get-Content -Raw -LiteralPath $SavedStatePath | ConvertFrom-Json
        if ([int]$SavedState.schema -eq 1 -and [string]$SavedState.owner -eq 'command') { $SavedPreferences = $SavedState.preferences }
    }
}
catch {}
$SavedAutoAttach = if ($null -ne $SavedPreferences -and $null -ne $SavedPreferences.autoAttach) { [bool]$SavedPreferences.autoAttach } else { $ExistingAutoAttach }
$SavedStartMenuLauncher = if ($null -ne $SavedPreferences -and $null -ne $SavedPreferences.startMenuLauncher) { [bool]$SavedPreferences.startMenuLauncher } else { $false }
$SavedDesktopLauncher = if ($null -ne $SavedPreferences -and $null -ne $SavedPreferences.desktopLauncher) { [bool]$SavedPreferences.desktopLauncher } else { $false }
$AutoAttachEnabled = if ($DisableAutoAttach) {
    $false
} elseif ($EnableAutoAttach) {
    $true
} elseif ($ExistingCommandInstall) {
    $SavedAutoAttach
} else {
    $true
}

function Invoke-QuotaPinInstallAgentProbe([string]$Path, [string]$Argument) {
    foreach ($Attempt in 1..5) {
        $StartInfo = New-Object Diagnostics.ProcessStartInfo
        $StartInfo.FileName = $Path
        $StartInfo.Arguments = $Argument
        $StartInfo.UseShellExecute = $false
        $StartInfo.CreateNoWindow = $true
        $StartInfo.RedirectStandardOutput = $true
        $StartInfo.RedirectStandardError = $true
        $Process = New-Object Diagnostics.Process
        $Process.StartInfo = $StartInfo
        try {
            if (-not $Process.Start()) { throw 'Agent probe did not start.' }
            if (-not $Process.WaitForExit(10000)) {
                try { $Process.Kill() } catch {}
            }
            else {
                $ProbeOutput = $Process.StandardOutput.ReadToEnd().Trim()
                if ($Process.ExitCode -eq 0 -and $ProbeOutput) { return $ProbeOutput }
            }
        }
        catch {
            if ($Attempt -eq 5) { throw }
        }
        finally { $Process.Dispose() }
        if ($Attempt -lt 5) { Start-Sleep -Milliseconds 250 }
    }
    return $null
}

function Test-QuotaPinInstallAgentIdentity([string]$Path, [string]$ExpectedCommit = '') {
    $ReportedVersion = Invoke-QuotaPinInstallAgentProbe $Path '--agent-version'
    if (-not [string]::Equals([string]$ReportedVersion, [string]$Version, [StringComparison]::Ordinal)) {
        throw "QuotaPin agent version mismatch. Expected $Version; found $ReportedVersion"
    }
    $OriginJson = Invoke-QuotaPinInstallAgentProbe $Path '--build-origin'
    if (-not $OriginJson) { throw 'QuotaPin agent origin metadata is unavailable.' }
    try { $Origin = $OriginJson | ConvertFrom-Json }
    catch { throw 'QuotaPin agent origin metadata is invalid.' }
    if ($Origin.schemaVersion -ne 'quotapin-origin/v1' -or
        $Origin.product -ne 'QuotaPin' -or
        $Origin.version -ne $Version -or
        $Origin.repository -ne 'https://github.com/WSL043/QuotaPin-for-Codex' -or
        $Origin.commit -notmatch '^[0-9a-f]{40}$' -or
        ($ExpectedCommit -and [string]$Origin.commit -cne $ExpectedCommit)) {
        throw 'QuotaPin agent origin metadata does not match this installer.'
    }
    $script:QuotaPinAgentOrigin = $Origin
}

function Get-QuotaPinAgent([string]$Destination) {
    if (-not (Test-Path -LiteralPath $LocalAgent -PathType Leaf)) { throw 'The verified local Agent is unavailable.' }
    Copy-Item -LiteralPath $LocalAgent -Destination $Destination -Force
    Test-QuotaPinInstallAgentIdentity $Destination
}

function Get-QuotaPinNotices([string]$Destination) {
    if (-not (Test-Path -LiteralPath $LocalNotices -PathType Leaf)) { throw 'The verified local notices file is unavailable.' }
    Copy-Item -LiteralPath $LocalNotices -Destination $Destination -Force
}

function Receive-QuotaPinInstallFile([string]$Url, [string]$Destination, [long]$MaximumBytes, [int]$TimeoutSeconds) {
    $CurlPath = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (-not (Test-Path -LiteralPath $CurlPath -PathType Leaf)) { throw 'Windows curl.exe is unavailable.' }
    $ExitCode = -1
    foreach ($Attempt in 1..6) {
        & $CurlPath --ipv4 --http1.1 --fail --location --silent --show-error --connect-timeout 20 --speed-limit 1024 --speed-time 90 --max-time $TimeoutSeconds --continue-at - --output $Destination $Url
        $ExitCode = $LASTEXITCODE
        if ($ExitCode -eq 0) { break }
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            $PartialLength = (Get-Item -LiteralPath $Destination).Length
            if ($PartialLength -gt $MaximumBytes) { throw "QuotaPin release asset exceeded its size limit: $Url" }
        }
        if ($Attempt -lt 6) { Start-Sleep -Seconds ([Math]::Min(16, [Math]::Pow(2, $Attempt))) }
    }
    if ($ExitCode -ne 0) { throw "QuotaPin release download failed after resumable retries with curl exit code $ExitCode." }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { throw 'QuotaPin release download did not create a file.' }
    $Length = (Get-Item -LiteralPath $Destination).Length
    if ($Length -le 0 -or $Length -gt $MaximumBytes) { throw "QuotaPin release asset has an invalid size: $Url" }
}

function Get-QuotaPinRemoteReleaseBundle([string]$AgentDestination, [string]$NoticesDestination, [string]$PayloadRoot) {
    $BundleName = 'QuotaPin-Windows-x64.zip'
    $OfficialAgentUrl = "https://github.com/WSL043/QuotaPin-for-Codex/releases/download/v$Version/$BundleName"
    $ResolvedAgentUrl = if ($AgentUrl) { $AgentUrl } else { $OfficialAgentUrl }
    $ResolvedUri = $null
    if (-not [Uri]::TryCreate($ResolvedAgentUrl, [UriKind]::Absolute, [ref]$ResolvedUri) -or
        $ResolvedUri.UserInfo -or $ResolvedUri.Query -or $ResolvedUri.Fragment -or
        -not $ResolvedUri.AbsolutePath.EndsWith("/$BundleName", [StringComparison]::Ordinal)) {
        throw 'QuotaPin release bundle URL is invalid.'
    }
    $IsOfficial = [string]::Equals($ResolvedAgentUrl, $OfficialAgentUrl, [StringComparison]::Ordinal)
    $IsLoopbackFixture = $ResolvedUri.Scheme -eq 'http' -and $ResolvedUri.IsLoopback
    if (-not $IsOfficial -and -not $IsLoopbackFixture) {
        throw 'QuotaPin release bundle URL must be the official release or a loopback test fixture.'
    }
    $BundlePath = Join-Path $PayloadRoot $BundleName
    $BundleChecksumPath = $BundlePath + '.sha256'
    $ExtractedPayloadRoot = Join-Path $PayloadRoot 'bundle'
    foreach ($Download in @(
        [pscustomobject]@{ url = $ResolvedAgentUrl; destination = $BundlePath; maximumBytes = 128MB; timeoutSeconds = 300 },
        [pscustomobject]@{ url = $ResolvedAgentUrl + '.sha256'; destination = $BundleChecksumPath; maximumBytes = 4096; timeoutSeconds = 30 }
    )) {
        Receive-QuotaPinInstallFile ([string]$Download.url) ([string]$Download.destination) ([long]$Download.maximumBytes) ([int]$Download.timeoutSeconds)
    }
    $null = Expand-QuotaPinReleaseBundle -ArchivePath $BundlePath -ArchiveChecksumPath $BundleChecksumPath -DestinationRoot $ExtractedPayloadRoot
    $ManifestPath = Join-Path $ExtractedPayloadRoot 'QuotaPin-release.json'
    $ManifestChecksumPath = $ManifestPath + '.sha256'
    $Sha256SumsPath = Join-Path $ExtractedPayloadRoot 'SHA256SUMS'
    $ExtractedAgentPath = Join-Path $ExtractedPayloadRoot 'QuotaPin.Agent.exe'
    $AgentChecksumPath = $ExtractedAgentPath + '.sha256'
    $ExtractedNoticesPath = Join-Path $ExtractedPayloadRoot 'THIRD_PARTY_NOTICES.txt'
    $NoticesChecksumPath = $ExtractedNoticesPath + '.sha256'
    $ReleaseTrust = Test-QuotaPinReleaseTrustBundle `
        -Version $Version `
        -ManifestPath $ManifestPath `
        -ManifestChecksumPath $ManifestChecksumPath `
        -Sha256SumsPath $Sha256SumsPath `
        -AgentPath $ExtractedAgentPath `
        -AgentChecksumPath $AgentChecksumPath `
        -NoticesPath $ExtractedNoticesPath `
        -NoticesChecksumPath $NoticesChecksumPath
    Copy-Item -LiteralPath $ExtractedAgentPath -Destination $AgentDestination -Force
    Copy-Item -LiteralPath $ExtractedNoticesPath -Destination $NoticesDestination -Force
    Test-QuotaPinInstallAgentIdentity $AgentDestination ([string]$ReleaseTrust.commit)
    $script:QuotaPinReleaseTrust = $ReleaseTrust
}

$Package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop
$Executable = Join-Path $Package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $Executable)) { throw "Codex Desktop executable not found: $Executable" }
. (Join-Path $SourceRoot 'codex-command.ps1')
$null = Get-QuotaPinCodexCommand

function Get-Shortcut([string]$Path) {
    $Shell = New-Object -ComObject WScript.Shell
    $Shell.CreateShortcut($Path)
}

function Test-QuotaPinLauncherShortcut([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $Shortcut = Get-Shortcut $Path
        $Fingerprint = '{0}`n{1}`n{2}' -f $Shortcut.TargetPath, $Shortcut.Arguments, $Shortcut.Description
        return (
            $Fingerprint.IndexOf($LaunchScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('\QuotaPin\src\launch.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('start-codex-with-dom-usage.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    }
    catch { return $false }
}

function Remove-QuotaPinLauncherShortcut([string]$Path) {
    if (Test-QuotaPinLauncherShortcut $Path) { Remove-Item -LiteralPath $Path -Force }
}

function Resolve-ShortcutPath([string]$Preferred, [string]$Fallback) {
    if (-not (Test-Path -LiteralPath $Preferred) -or (Test-QuotaPinLauncherShortcut $Preferred)) { return $Preferred }
    $Fallback
}

function New-QuotaPinLauncherShortcut([string]$ShortcutPath) {
    $Parent = Split-Path -Parent $ShortcutPath
    New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    $Shortcut = Get-Shortcut $ShortcutPath
    $Shortcut.TargetPath = $PowerShellExe
    $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $LaunchScript
    $Shortcut.WorkingDirectory = $InstallRoot
    $Shortcut.IconLocation = "$Executable,0"
    $Shortcut.WindowStyle = 7
    $Shortcut.Description = 'Launch Codex Desktop with QuotaPin inline quota'
    $Shortcut.Save()
}

function New-QuotaPinUninstallShortcut {
    $UninstallScript = Join-Path $InstallRoot 'uninstall.ps1'
    New-Item -ItemType Directory -Path $QuotaPinStartMenuRoot -Force | Out-Null
    $Shortcut = Get-Shortcut $UninstallShortcut
    $Shortcut.TargetPath = $PowerShellExe
    $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $UninstallScript
    $Shortcut.WorkingDirectory = $env:LOCALAPPDATA
    $Shortcut.IconLocation = "$AgentPath,0"
    $Shortcut.WindowStyle = 1
    $Shortcut.Description = 'Remove QuotaPin without changing Codex Desktop'
    $Shortcut.Save()
}

function New-QuotaPinAutoAttachShortcut {
    New-Item -ItemType Directory -Path $StartupRoot -Force | Out-Null
    $Shortcut = Get-Shortcut $AutoAttachShortcut
    $Shortcut.TargetPath = $PowerShellExe
    $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $AutoAttachScript
    $Shortcut.WorkingDirectory = $InstallRoot
    $Shortcut.WindowStyle = 7
    $Shortcut.Description = 'Attach QuotaPin when the official Codex app starts'
    $Shortcut.Save()
}

function Stop-QuotaPinVerifiedWatcher([Diagnostics.Process]$Process) {
    if ($null -eq $Process) { return }
    $ProcessId = 0
    try {
        $ProcessId = $Process.Id
        $ExpectedStart = [DateTimeOffset]::new($Process.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
        $Process.Refresh()
        if (-not $Process.HasExited) {
            $CurrentStart = [DateTimeOffset]::new($Process.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
            if ([Math]::Abs(($CurrentStart - $ExpectedStart).TotalSeconds) -le 2) {
                Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
                try { Wait-Process -Id $ProcessId -Timeout 5 -ErrorAction SilentlyContinue } catch {}
            }
        }
    }
    catch {}
    $WatcherStatePath = Join-Path $InstallRoot 'logs\watcher.json'
    if ($ProcessId -gt 0 -and (Test-Path -LiteralPath $WatcherStatePath -PathType Leaf)) {
        try {
            $State = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
            if ([int]$State.processId -eq $ProcessId) { Remove-Item -LiteralPath $WatcherStatePath -Force }
        }
        catch {}
    }
    try { $Process.Dispose() } catch {}
}

function Start-QuotaPinVerifiedWatcher([string]$ScriptPath) {
    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        throw "QuotaPin auto-attach component is missing: $ScriptPath"
    }
    $WatcherStatePath = Join-Path $InstallRoot 'logs\watcher.json'
    Remove-Item -LiteralPath $WatcherStatePath -Force -ErrorAction SilentlyContinue
    $WatcherArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -IgnoreExisting' -f $ScriptPath
    $Process = Start-Process -FilePath $PowerShellExe -ArgumentList $WatcherArguments -WindowStyle Hidden -PassThru
    try {
        $Ready = $false
        $Deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
        while ([DateTimeOffset]::UtcNow -lt $Deadline) {
            $Process.Refresh()
            if ($Process.HasExited) { break }
            if (Test-Path -LiteralPath $WatcherStatePath -PathType Leaf) {
                try {
                    $State = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
                    $RecordedStart = [DateTimeOffset]::Parse([string]$State.startedAt)
                    $ActualStart = [DateTimeOffset]::new($Process.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
                    if ([int]$State.processId -eq $Process.Id -and [Math]::Abs(($ActualStart - $RecordedStart).TotalSeconds) -le 2) {
                        Start-Sleep -Milliseconds 150
                        $Process.Refresh()
                        $Ready = -not $Process.HasExited
                        if ($Ready) { break }
                    }
                }
                catch {}
            }
            Start-Sleep -Milliseconds 100
        }
        if (-not $Ready) { throw 'QuotaPin auto-attach watcher did not become ready.' }
        return $Process
    }
    catch {
        Stop-QuotaPinVerifiedWatcher $Process
        throw
    }
}

function Test-QuotaPinVerifiedWatcherState {
    $WatcherStatePath = Join-Path $InstallRoot 'logs\watcher.json'
    if (-not (Test-Path -LiteralPath $WatcherStatePath -PathType Leaf)) { return $false }
    try {
        $State = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
        $Process = Get-Process -Id ([int]$State.processId) -ErrorAction Stop
        $RecordedStart = [DateTimeOffset]::Parse([string]$State.startedAt)
        $ActualStart = [DateTimeOffset]::new($Process.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
        if ([Math]::Abs(($ActualStart - $RecordedStart).TotalSeconds) -gt 2) { return $false }
        Start-Sleep -Milliseconds 150
        $Process.Refresh()
        return -not $Process.HasExited
    }
    catch { return $false }
}

$ExistingStartMenuLauncher = $SavedStartMenuLauncher -or (Test-QuotaPinLauncherShortcut $StartMenuShortcut) -or (Test-QuotaPinLauncherShortcut $FallbackStartMenuShortcut)
$ExistingDesktopLauncher = $SavedDesktopLauncher -or (Test-QuotaPinLauncherShortcut $DesktopShortcut) -or (Test-QuotaPinLauncherShortcut $FallbackDesktopShortcut)
$StartMenuLauncherEnabled = $CreateLauncherShortcut -or -not $AutoAttachEnabled -or $ExistingStartMenuLauncher
$DesktopLauncherEnabled = -not $NoDesktopShortcut -and ($CreateLauncherShortcut -or $ExistingDesktopLauncher -or (-not $ExistingCommandInstall -and -not $AutoAttachEnabled))
$TransactionRoot = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-install-' + [Guid]::NewGuid().ToString('N'))
$StagedAgent = Join-Path $TransactionRoot 'QuotaPin.Agent.exe'
$StagedNotices = Join-Path $TransactionRoot 'THIRD_PARTY_NOTICES.txt'
$RollbackSnapshot = $null
$RegistrySnapshot = $null
$NewWatcherProcess = $null
$ResumeRuntime = $null
$ResumeState = 'not-needed'
try {
    New-Item -ItemType Directory -Path $TransactionRoot -Force | Out-Null
    $HasLocalAgent = Test-Path -LiteralPath $LocalAgent -PathType Leaf
    $HasLocalNotices = Test-Path -LiteralPath $LocalNotices -PathType Leaf
    if ($HasLocalAgent -xor $HasLocalNotices) {
        throw 'The verified local release payload is incomplete.'
    }
    if ($HasLocalAgent) {
        Get-QuotaPinAgent $StagedAgent
        Get-QuotaPinNotices $StagedNotices
    }
    else {
        Get-QuotaPinRemoteReleaseBundle $StagedAgent $StagedNotices $TransactionRoot
    }
    if (-not $DeferRuntimeResume) {
        # Runtime continuity is a property of the exact verified Codex session,
        # not of a possibly stale install-owner label or a racing Agent exit.
        $ResumeRuntime = Get-QuotaPinResumableRuntime -InstallRoot $InstallRoot -AgentPath $AgentPath
    }

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
    $RollbackSnapshot = New-QuotaPinRollbackSnapshot -Paths $RollbackPaths -SnapshotRoot (Join-Path $TransactionRoot 'rollback')
    $RegistrySnapshot = Get-QuotaPinInstallRegistrySnapshot

    try {
        & (Join-Path $PSScriptRoot 'stop.ps1') -TemporaryExit
        New-Item -ItemType Directory -Path $InstallSourceRoot -Force | Out-Null
        Move-Item -LiteralPath $StagedAgent -Destination $AgentPath -Force
        Move-Item -LiteralPath $StagedNotices -Destination $NoticesPath -Force
        foreach ($File in @('launch.ps1', 'auto-attach.ps1', 'auto-attach-policy.ps1', 'codex-process.ps1', 'codex-command.ps1', 'runtime-trust.ps1', 'ui.ps1', 'lifecycle.ps1')) {
            Copy-Item -LiteralPath (Join-Path $SourceRoot $File) -Destination $InstallSourceRoot -Force
        }
        # An explicit install or update is the repair boundary for a previously
        # latched automatic attachment. -IgnoreExisting keeps the current Codex
        # session untouched while the replacement watcher is verified.
        Remove-Item -LiteralPath $AutoAttachGuard -Force -ErrorAction SilentlyContinue
        foreach ($LegacyOwnedPath in @((Join-Path $InstallSourceRoot 'core'), (Join-Path $InstallRoot 'runtime'))) {
            if (Test-Path -LiteralPath $LegacyOwnedPath) { Remove-Item -LiteralPath $LegacyOwnedPath -Recurse -Force }
        }
        foreach ($LegacyOwnedFile in @('injector.mjs', 'cleanup.mjs', 'runtime.ps1')) {
            $LegacyPath = Join-Path $InstallSourceRoot $LegacyOwnedFile
            if (Test-Path -LiteralPath $LegacyPath) { Remove-Item -LiteralPath $LegacyPath -Force }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'config.json'))) {
            Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'config.default.json') -Destination (Join-Path $InstallRoot 'config.json')
        }
        Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'VERSION') -Destination $InstallRoot -Force
        Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'LICENSE') -Destination $InstallRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $InstallRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'stop.ps1') -Destination $InstallRoot -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update.ps1') -Destination $InstallRoot -Force
        $LegacyGeneratedIcon = Join-Path $InstallRoot 'quotapin.ico'
        if (Test-Path -LiteralPath $LegacyGeneratedIcon) { Remove-Item -LiteralPath $LegacyGeneratedIcon -Force }

        $InstalledOrigin = [ordered]@{
            schemaVersion = [string]$script:QuotaPinAgentOrigin.schemaVersion
            product = [string]$script:QuotaPinAgentOrigin.product
            repository = [string]$script:QuotaPinAgentOrigin.repository
            support = 'https://github.com/WSL043/QuotaPin-for-Codex/issues'
            releases = 'https://github.com/WSL043/QuotaPin-for-Codex/releases'
            license = 'MIT'
            freeOpenSource = $true
            version = [string]$script:QuotaPinAgentOrigin.version
            commit = [string]$script:QuotaPinAgentOrigin.commit
            source = 'https://github.com/WSL043/QuotaPin-for-Codex/commit/{0}' -f [string]$script:QuotaPinAgentOrigin.commit
            agentSha256 = Get-QuotaPinSha256 $AgentPath
        }
        Write-QuotaPinJsonAtomic -Path (Join-Path $InstallRoot 'origin.json') -Value $InstalledOrigin
        $OfficialSource = @"
QuotaPin is free and open source under the MIT license.

Official project: https://github.com/WSL043/QuotaPin-for-Codex
Official releases: https://github.com/WSL043/QuotaPin-for-Codex/releases
Official support: https://github.com/WSL043/QuotaPin-for-Codex/issues

Installed version: $($InstalledOrigin.version)
Source commit: $($InstalledOrigin.commit)
QuotaPin.Agent.exe SHA-256: $($InstalledOrigin.agentSha256)

If a third party charged you, confirm what service they sold; the official
source itself is available without charge from the project above.
"@
        [IO.File]::WriteAllText((Join-Path $InstallRoot 'OFFICIAL_SOURCE.txt'), ($OfficialSource.Trim() + "`r`n"), [Text.UTF8Encoding]::new($false))

        # A Startup entry is a committed promise. Verify the replacement
        # watcher first; only then publish or remove user-visible entry points.
        if ($AutoAttachEnabled) {
            $NewWatcherProcess = Start-QuotaPinVerifiedWatcher $AutoAttachScript
        }

        foreach ($ShortcutPath in $LegacyShortcutCandidates) { Remove-QuotaPinLauncherShortcut $ShortcutPath }
        if ((Test-Path -LiteralPath $QuotaPinStartMenuRoot) -and -not (Get-ChildItem -LiteralPath $QuotaPinStartMenuRoot -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $QuotaPinStartMenuRoot -Force
        }
        New-QuotaPinUninstallShortcut
        if ($AutoAttachEnabled) { New-QuotaPinAutoAttachShortcut }
        elseif (Test-Path -LiteralPath $AutoAttachShortcut) { Remove-Item -LiteralPath $AutoAttachShortcut -Force }
        if ($StartMenuLauncherEnabled) {
            $ResolvedStartMenuShortcut = Resolve-ShortcutPath $StartMenuShortcut $FallbackStartMenuShortcut
            New-QuotaPinLauncherShortcut $ResolvedStartMenuShortcut
        }
        if ($DesktopLauncherEnabled) {
            $ResolvedDesktopShortcut = Resolve-ShortcutPath $DesktopShortcut $FallbackDesktopShortcut
            New-QuotaPinLauncherShortcut $ResolvedDesktopShortcut
        }

        $InstallPreferences = [ordered]@{
            autoAttach = $AutoAttachEnabled
            startMenuLauncher = $StartMenuLauncherEnabled
            desktopLauncher = $DesktopLauncherEnabled
        }
        Set-QuotaPinInstallOwner -Owner 'command' -Version $Version -Origin $InstalledOrigin -Preferences $InstallPreferences
        if ($ResumeRuntime) {
            try {
                $ResumeState = Resume-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -ExpectedRuntime $ResumeRuntime -AgentPath $AgentPath
                if ($ResumeState -ne 'quota-ready') {
                    Write-Warning 'QuotaPin was installed, but the current Codex session will resume inline quota on its next launch.'
                }
            }
            catch {
                $ResumeState = 'next-launch'
                Write-Warning 'QuotaPin was installed, but the current Codex session will resume inline quota on its next launch.'
            }
        }
    }
    catch {
        $InstallFailure = $_.Exception
        $RollbackFailures = @()
        Stop-QuotaPinVerifiedWatcher $NewWatcherProcess
        $NewWatcherProcess = $null
        try { Restore-QuotaPinRollbackSnapshot -Snapshot $RollbackSnapshot }
        catch { $RollbackFailures += $_.Exception }
        try { Restore-QuotaPinInstallRegistrySnapshot -Snapshot $RegistrySnapshot }
        catch { $RollbackFailures += $_.Exception }

        $RollbackResumeFailure = $null
        if (-not $RollbackFailures.Count) {
            try {
                if ($SavedAutoAttach) {
                    $RestoredWatcher = $null
                    if (-not (Test-QuotaPinVerifiedWatcherState)) {
                        $RestoredWatcher = Start-QuotaPinVerifiedWatcher $AutoAttachScript
                    }
                    if (-not $ExistingAutoAttach) { New-QuotaPinAutoAttachShortcut }
                    if ($null -ne $RestoredWatcher) { try { $RestoredWatcher.Dispose() } catch {} }
                }
                elseif (Test-Path -LiteralPath $AutoAttachShortcut) {
                    Remove-Item -LiteralPath $AutoAttachShortcut -Force
                }
            }
            catch { $RollbackFailures += $_.Exception }
        }
        if (-not $RollbackFailures.Count -and $ResumeRuntime) {
            try {
                $RollbackResumeState = Resume-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -ExpectedRuntime $ResumeRuntime -AgentPath $AgentPath
                if ($RollbackResumeState -ne 'quota-ready') {
                    $RollbackResumeFailure = [InvalidOperationException]::new('The previous inline quota will resume on the next Codex launch.')
                }
            }
            catch { $RollbackResumeFailure = $_.Exception }
        }
        if ($RollbackFailures.Count) {
            # Never leave an unverified process scheduled to start. The restored
            # files remain available for repair, but automatic launch is off.
            if (Test-Path -LiteralPath $AutoAttachShortcut) { Remove-Item -LiteralPath $AutoAttachShortcut -Force -ErrorAction SilentlyContinue }
            $AllFailures = @($InstallFailure) + @($RollbackFailures)
            throw [AggregateException]::new('QuotaPin installation failed and the previous automatic state could not be fully restored. Auto-attach was disabled.', [Exception[]]$AllFailures)
        }
        if ($null -ne $RollbackResumeFailure) {
            throw [AggregateException]::new('QuotaPin installation failed. The previous version was restored, but its inline quota will resume on the next Codex launch.', [Exception[]]@($InstallFailure, $RollbackResumeFailure))
        }
        throw $InstallFailure
    }

    Write-Output "QuotaPin installed: $InstallRoot"
    if (-not $AutoAttachEnabled) {
        Write-Output 'Automatic attach is disabled. Use the QuotaPin launcher shortcut.'
    } else {
        Write-Output 'Codex was not restarted by this installation. Keep any current task open.'
        Write-Output 'Open Codex from its official icon as usual. After a full quit, a new Codex launch may briefly reopen once before its window is ready so QuotaPin can attach.'
    }
}
finally {
    if ($null -ne $NewWatcherProcess) { try { $NewWatcherProcess.Dispose() } catch {} }
    if ($null -ne $RollbackSnapshot -and -not (Remove-QuotaPinRollbackSnapshot -Snapshot $RollbackSnapshot)) {
        Write-Warning "QuotaPin could not remove its rollback snapshot: $($RollbackSnapshot.root)"
    }
    if (Test-Path -LiteralPath $TransactionRoot) {
        Remove-Item -LiteralPath $TransactionRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
}
finally {
    for ($Index = $MutationMutexes.Count - 1; $Index -ge 0; $Index--) {
        $Mutex = $MutationMutexes[$Index]
        try { $Mutex.ReleaseMutex() } catch {}
        $Mutex.Dispose()
    }
}
