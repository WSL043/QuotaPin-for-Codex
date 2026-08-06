$ErrorActionPreference = 'Stop'
$ExpectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'QuotaPin')).TrimEnd('\')
$ProgramsRoot = [Environment]::GetFolderPath('Programs')
$DesktopRoot = [Environment]::GetFolderPath('Desktop')
$StartupRoot = [Environment]::GetFolderPath('Startup')
$StartMenuRoot = Join-Path $ProgramsRoot 'QuotaPin'
$AutoAttachShortcut = Join-Path $StartupRoot 'QuotaPin Auto Attach.lnk'
$UninstallShortcut = Join-Path $StartMenuRoot 'Uninstall QuotaPin.lnk'
$ShortcutCandidates = @(
    (Join-Path $DesktopRoot 'Codex.lnk'),
    (Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'),
    (Join-Path $DesktopRoot 'QuotaPin.lnk'),
    (Join-Path $DesktopRoot 'Codex Usage.lnk'),
    (Join-Path $ProgramsRoot 'Codex.lnk'),
    (Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk'),
    (Join-Path $StartMenuRoot 'QuotaPin.lnk')
)
$LaunchScript = Join-Path $ExpectedRoot 'src\launch.ps1'
$AutoAttachScript = Join-Path $ExpectedRoot 'src\auto-attach.ps1'
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$LifecycleHelper = Join-Path $ExpectedRoot 'src\lifecycle.ps1'
$SetupUninstaller = Join-Path $ExpectedRoot 'unins000.exe'
$StopScript = Join-Path $ExpectedRoot 'stop.ps1'

# Update holds Update and its child installer briefly holds Install. Acquire the
# same pair in that fixed order before touching any state, so uninstall can
# never race either operation or be followed by an updater reinstalling files.
$MutexSuffix = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$MutationMutexes = @()
try {
    foreach ($MutexName in @('Local\QuotaPin.Update.{0}' -f $MutexSuffix, 'Local\QuotaPin.Install.{0}' -f $MutexSuffix)) {
        $Mutex = New-Object Threading.Mutex($false, $MutexName)
        $Acquired = $false
        try { $Acquired = $Mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $Acquired = $true }
        if (-not $Acquired) {
            $Mutex.Dispose()
            throw 'Another QuotaPin install or update is running. Uninstall did not change anything.'
        }
        $MutationMutexes += $Mutex
    }

if (-not (Test-Path -LiteralPath $LifecycleHelper -PathType Leaf)) {
    throw "QuotaPin lifecycle component is missing: $LifecycleHelper"
}
. $LifecycleHelper
$ExistingOwner = Get-QuotaPinInstallOwner
if ($ExistingOwner -eq 'setup' -or (Test-Path -LiteralPath $SetupUninstaller)) {
    throw 'This installation is owned by Windows Setup. Uninstall QuotaPin from Windows Apps instead.'
}

if (-not (Test-Path -LiteralPath $StopScript -PathType Leaf)) {
    throw "QuotaPin cleanup component is missing: $StopScript"
}
function Assert-SafeExactDirectory([string]$Path, [string]$Expected) {
    $FullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $FullExpected = [IO.Path]::GetFullPath($Expected).TrimEnd('\')
    if (-not $FullPath.Equals($FullExpected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected path: $FullPath"
    }
    if (Test-Path -LiteralPath $FullPath) {
        $Item = Get-Item -LiteralPath $FullPath -Force
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to remove reparse-point directory: $FullPath"
        }
    }
    $FullPath
}

function Test-QuotaPinShortcut([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $Shell = New-Object -ComObject WScript.Shell
        $Shortcut = $Shell.CreateShortcut($Path)
        $Fingerprint = '{0}`n{1}`n{2}' -f $Shortcut.TargetPath, $Shortcut.Arguments, $Shortcut.Description
        return (
            $Fingerprint.IndexOf($LaunchScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('\QuotaPin\src\launch.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('start-codex-with-dom-usage.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    }
    catch { return $false }
}

function Stop-QuotaPinRollbackWatcher([Diagnostics.Process]$Process) {
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
    $WatcherStatePath = Join-Path $ExpectedRoot 'logs\watcher.json'
    if ($ProcessId -gt 0 -and (Test-Path -LiteralPath $WatcherStatePath -PathType Leaf)) {
        try {
            $State = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
            if ([int]$State.processId -eq $ProcessId) { Remove-Item -LiteralPath $WatcherStatePath -Force }
        }
        catch {}
    }
    try { $Process.Dispose() } catch {}
}

function Test-QuotaPinRollbackWatcherState {
    $WatcherStatePath = Join-Path $ExpectedRoot 'logs\watcher.json'
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

function Start-QuotaPinRollbackWatcher {
    if (-not (Test-Path -LiteralPath $AutoAttachScript -PathType Leaf)) {
        throw "QuotaPin auto-attach component is missing after rollback: $AutoAttachScript"
    }
    $WatcherStatePath = Join-Path $ExpectedRoot 'logs\watcher.json'
    Remove-Item -LiteralPath $WatcherStatePath -Force -ErrorAction SilentlyContinue
    $Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -IgnoreExisting' -f $AutoAttachScript
    $Process = Start-Process -FilePath $PowerShellExe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
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
        if (-not $Ready) { throw 'The previous QuotaPin watcher could not be restored.' }
        return $Process
    }
    catch {
        Stop-QuotaPinRollbackWatcher $Process
        throw
    }
}

function New-QuotaPinRollbackAutoAttachShortcut {
    New-Item -ItemType Directory -Path $StartupRoot -Force | Out-Null
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($AutoAttachShortcut)
    $Shortcut.TargetPath = $PowerShellExe
    $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $AutoAttachScript
    $Shortcut.WorkingDirectory = $ExpectedRoot
    $Shortcut.WindowStyle = 7
    $Shortcut.Description = 'Attach QuotaPin when the official Codex app starts'
    $Shortcut.Save()
}

function Get-QuotaPinRunValueSnapshot {
    $Key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $false)
    try {
        if ($null -eq $Key -or $Key.GetValueNames() -notcontains 'QuotaPin') {
            return [pscustomobject]@{ exists = $false; value = $null; kind = $null }
        }
        return [pscustomobject]@{
            exists = $true
            value = $Key.GetValue('QuotaPin', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            kind = [int]$Key.GetValueKind('QuotaPin')
        }
    }
    finally { if ($null -ne $Key) { $Key.Dispose() } }
}

function Restore-QuotaPinRunValueSnapshot($Snapshot) {
    $Key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true)
    try {
        if ([bool]$Snapshot.exists) {
            $Key.SetValue('QuotaPin', $Snapshot.value, [Microsoft.Win32.RegistryValueKind]([int]$Snapshot.kind))
        }
        else {
            $Key.DeleteValue('QuotaPin', $false)
        }
    }
    finally { $Key.Dispose() }
}

$ExistingAutoAttach = Test-Path -LiteralPath $AutoAttachShortcut
$SavedAutoAttach = $ExistingAutoAttach
try {
    $SavedStatePath = Join-Path $ExpectedRoot 'install-state.json'
    if (Test-Path -LiteralPath $SavedStatePath -PathType Leaf) {
        $SavedState = Get-Content -Raw -LiteralPath $SavedStatePath | ConvertFrom-Json
        if ([int]$SavedState.schema -eq 1 -and [string]$SavedState.owner -eq 'command' -and $null -ne $SavedState.preferences.autoAttach) {
            $SavedAutoAttach = [bool]$SavedState.preferences.autoAttach
        }
    }
}
catch {}

$TransactionRoot = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-uninstall-' + [Guid]::NewGuid().ToString('N'))
$RollbackSnapshot = $null
$RegistrySnapshot = $null
$RunValueSnapshot = $null
$RollbackWatcher = $null
try {
    New-Item -ItemType Directory -Path $TransactionRoot -Force | Out-Null
    $RollbackPaths = @(
        $ExpectedRoot,
        $AutoAttachShortcut,
        $StartMenuRoot,
        (Join-Path $DesktopRoot 'Codex.lnk'),
        (Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'),
        (Join-Path $DesktopRoot 'QuotaPin.lnk'),
        (Join-Path $DesktopRoot 'Codex Usage.lnk'),
        (Join-Path $ProgramsRoot 'Codex.lnk'),
        (Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk')
    )
    $RollbackSnapshot = New-QuotaPinRollbackSnapshot -Paths $RollbackPaths -SnapshotRoot (Join-Path $TransactionRoot 'rollback')
    $RegistrySnapshot = Get-QuotaPinInstallRegistrySnapshot
    $RunValueSnapshot = Get-QuotaPinRunValueSnapshot

    try {
        & $StopScript
        Write-QuotaPinLifecycleState -State 'stopped' -Reason 'command uninstall'
        Remove-ItemProperty -Path $RunKey -Name 'QuotaPin' -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $AutoAttachShortcut) { Remove-Item -LiteralPath $AutoAttachShortcut -Force }

        foreach ($Shortcut in $ShortcutCandidates) {
            if (Test-QuotaPinShortcut $Shortcut) { Remove-Item -LiteralPath $Shortcut -Force }
        }
        $SafeUninstallShortcut = [IO.Path]::GetFullPath($UninstallShortcut)
        $ExpectedUninstallShortcut = [IO.Path]::GetFullPath((Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'QuotaPin') 'Uninstall QuotaPin.lnk'))
        if ($SafeUninstallShortcut.Equals($ExpectedUninstallShortcut, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $SafeUninstallShortcut)) {
            Remove-Item -LiteralPath $SafeUninstallShortcut -Force
        }
        $SafeStartMenuRoot = Assert-SafeExactDirectory $StartMenuRoot (Join-Path ([Environment]::GetFolderPath('Programs')) 'QuotaPin')
        if ((Test-Path -LiteralPath $SafeStartMenuRoot) -and -not (Get-ChildItem -LiteralPath $SafeStartMenuRoot -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $SafeStartMenuRoot -Force
        }

        $SafeInstallRoot = Assert-SafeExactDirectory $ExpectedRoot (Join-Path $env:LOCALAPPDATA 'QuotaPin')
        Set-Location -LiteralPath $env:LOCALAPPDATA
        if (Test-Path -LiteralPath $SafeInstallRoot) { Remove-Item -LiteralPath $SafeInstallRoot -Force -Recurse }
        if (-not (Clear-QuotaPinInstallOwner -ExpectedOwner 'command')) {
            throw 'QuotaPin install ownership changed while uninstall was running.'
        }
    }
    catch {
        $UninstallFailure = $_.Exception
        $RollbackFailures = @()
        try { Restore-QuotaPinRollbackSnapshot -Snapshot $RollbackSnapshot }
        catch { $RollbackFailures += $_.Exception }
        try { Restore-QuotaPinInstallRegistrySnapshot -Snapshot $RegistrySnapshot }
        catch { $RollbackFailures += $_.Exception }
        try { Restore-QuotaPinRunValueSnapshot $RunValueSnapshot }
        catch { $RollbackFailures += $_.Exception }

        if (-not $RollbackFailures.Count) {
            try {
                if ($SavedAutoAttach) {
                    if (-not (Test-QuotaPinRollbackWatcherState)) {
                        $RollbackWatcher = Start-QuotaPinRollbackWatcher
                    }
                    if (-not $ExistingAutoAttach) { New-QuotaPinRollbackAutoAttachShortcut }
                }
                elseif (Test-Path -LiteralPath $AutoAttachShortcut) {
                    Remove-Item -LiteralPath $AutoAttachShortcut -Force
                }
            }
            catch { $RollbackFailures += $_.Exception }
        }
        if ($RollbackFailures.Count) {
            Stop-QuotaPinRollbackWatcher $RollbackWatcher
            $RollbackWatcher = $null
            if (Test-Path -LiteralPath $AutoAttachShortcut) { Remove-Item -LiteralPath $AutoAttachShortcut -Force -ErrorAction SilentlyContinue }
            $AllFailures = @($UninstallFailure) + @($RollbackFailures)
            throw [AggregateException]::new('QuotaPin uninstall failed and its previous automatic state could not be fully restored. Auto-attach was disabled.', [Exception[]]$AllFailures)
        }
        throw $UninstallFailure
    }

    Write-Output 'QuotaPin was removed. Codex Desktop was not changed.'
}
finally {
    if ($null -ne $RollbackWatcher) { try { $RollbackWatcher.Dispose() } catch {} }
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
