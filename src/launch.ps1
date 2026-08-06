param(
    [switch]$NoRelaunchPrompt,
    [switch]$AutoAttach,
    [int]$VerifiedCodexPid = 0,
    [long]$VerifiedCreationFileTime = 0,
    [ValidateRange(1, 3)][int]$AttachAttempt = 1,
    [string]$AttachGeneration = ''
)

$ErrorActionPreference = 'Stop'
$ProductName = 'QuotaPin'
$LogRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin\logs'
$ConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config.json'
$InstallRoot = Split-Path -Parent $PSScriptRoot
$Agent = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
$CodexHelpers = Join-Path $PSScriptRoot 'codex-command.ps1'
$QuotaPinUi = Join-Path $PSScriptRoot 'ui.ps1'
$LifecycleHelpers = Join-Path $PSScriptRoot 'lifecycle.ps1'
$ProcessHelpers = Join-Path $PSScriptRoot 'codex-process.ps1'
$GuardPath = Join-Path $LogRoot 'auto-attach-guard.json'
$RuntimeStatePath = Join-Path $LogRoot 'runtime.json'

New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$LauncherLog = Join-Path $LogRoot 'launcher.log'
$AgentLog = Join-Path $LogRoot 'agent.log'
$AgentStdout = Join-Path $LogRoot 'agent.stdout.log'
$AgentStderr = Join-Path $LogRoot 'agent.stderr.log'

function Write-LauncherLog([string]$Message) {
    if (Get-Command Write-QuotaPinLog -ErrorAction SilentlyContinue) {
        Write-QuotaPinLog -Path $LauncherLog -Message $Message
    } else {
        Add-Content -LiteralPath $LauncherLog -Value ('{0:o} {1}' -f (Get-Date), $Message) -ErrorAction SilentlyContinue
    }
}

function Find-CodexProcesses([string]$PackageRoot) {
    $ExpectedPrefix = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\') + '\'
    @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and ([IO.Path]::GetFullPath($_.Path)).StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
    })
}

function Test-QuotaPinAttachAuthorization([string]$PackageRoot) {
    if (-not $AutoAttach) { return $true }
    if ($VerifiedCodexPid -le 0 -or $VerifiedCreationFileTime -le 0 -or $AttachGeneration -notmatch '^[0-9a-fA-F]{32}$') { return $false }
    $Roots = @(Get-QuotaPinCodexRootProcesses $PackageRoot)
    if ($Roots.Count -ne 1 -or [int]$Roots[0].ProcessId -ne $VerifiedCodexPid) { return $false }
    $ExpectedCreation = [DateTime]::FromFileTimeUtc($VerifiedCreationFileTime)
    if ([Math]::Abs((([datetime]$Roots[0].CreationTimeUtc) - $ExpectedCreation).TotalSeconds) -gt 2) { return $false }
    try {
        $Guard = Get-Content -Raw -LiteralPath $GuardPath | ConvertFrom-Json
        return (
            [int]$Guard.schema -eq 1 -and
            [string]$Guard.state -eq 'handoff-pending' -and
            [string]::Equals([string]$Guard.generation, $AttachGeneration, [StringComparison]::Ordinal) -and
            [int]$Guard.sourcePid -eq $VerifiedCodexPid
        )
    }
    catch { return $false }
}

function Test-QuotaPinRendererReady([string]$Generation, [int]$AgentPid, [int]$Port, [DateTimeOffset]$NotBefore) {
    try {
        if (-not (Test-Path -LiteralPath $ReadyStatePath)) { return $false }
        $Ready = Get-Content -Raw -LiteralPath $ReadyStatePath | ConvertFrom-Json
        $WrittenAt = [DateTimeOffset]::Parse([string]$Ready.writtenAt)
        return (
            [int]$Ready.schema -eq 1 -and
            [string]$Ready.state -eq 'renderer-attached' -and
            [string]::Equals([string]$Ready.generation, $Generation, [StringComparison]::Ordinal) -and
            [int]$Ready.agentPid -eq $AgentPid -and
            [int]$Ready.port -eq $Port -and
            $WrittenAt -ge $NotBefore.AddSeconds(-2)
        )
    }
    catch { return $false }
}

function Sync-QuotaPinShortcutIcon([string]$ShortcutPath, [string]$IconLocation) {
    if (-not (Test-Path -LiteralPath $ShortcutPath)) { return }
    try {
        $Shell = New-Object -ComObject WScript.Shell
        $Shortcut = $Shell.CreateShortcut($ShortcutPath)
        $Fingerprint = '{0}`n{1}`n{2}' -f $Shortcut.TargetPath, $Shortcut.Arguments, $Shortcut.Description
        if (
            $Fingerprint.IndexOf($PSCommandPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('\QuotaPin\src\launch.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0
        ) {
            $ExpectedIcon = "$IconLocation,0"
            if (-not $Shortcut.IconLocation.Equals($ExpectedIcon, [StringComparison]::OrdinalIgnoreCase)) {
                $Shortcut.IconLocation = $ExpectedIcon
                $Shortcut.Save()
                Write-LauncherLog "shortcut icon refreshed: $ShortcutPath"
            }
        }
    }
    catch {
        Write-LauncherLog "shortcut icon refresh skipped: $ShortcutPath"
    }
}

if (-not (Test-Path -LiteralPath $Agent)) { throw "QuotaPin agent not found: $Agent" }
if (-not (Test-Path -LiteralPath $CodexHelpers)) { throw "QuotaPin Codex helper not found: $CodexHelpers" }
if (-not (Test-Path -LiteralPath $QuotaPinUi)) { throw "QuotaPin UI helper not found: $QuotaPinUi" }
if (-not (Test-Path -LiteralPath $LifecycleHelpers)) { throw "QuotaPin lifecycle helper not found: $LifecycleHelpers" }
if (-not (Test-Path -LiteralPath $ProcessHelpers)) { throw "QuotaPin process helper not found: $ProcessHelpers" }
. $CodexHelpers
. $QuotaPinUi
. $LifecycleHelpers
. $ProcessHelpers
Rotate-QuotaPinLog -Path $LauncherLog
foreach ($SessionLog in @($AgentLog, $AgentStdout, $AgentStderr)) { Rotate-QuotaPinLog -Path $SessionLog }
$CodexRuntimeCommand = Get-QuotaPinCodexCommand

$Package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop
$Executable = Join-Path $Package.InstallLocation 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $Executable)) { throw "Codex Desktop executable not found: $Executable" }
$ProgramsRoot = [Environment]::GetFolderPath('Programs')
$DesktopRoot = [Environment]::GetFolderPath('Desktop')
foreach ($ShortcutPath in @(
    (Join-Path $DesktopRoot 'Codex.lnk'),
    (Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'),
    (Join-Path $ProgramsRoot 'Codex.lnk'),
    (Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk')
)) {
    Sync-QuotaPinShortcutIcon $ShortcutPath $Executable
}
$Manifest = Get-AppxPackageManifest -Package $Package.PackageFullName
$Application = @($Manifest.Package.Applications.Application) | Select-Object -First 1
if (-not $Application.Id) { throw 'Codex application id was not found in the package manifest.' }
$AppUserModelId = '{0}!{1}' -f $Package.PackageFamilyName, $Application.Id

if (-not $AttachGeneration) { $AttachGeneration = [Guid]::NewGuid().ToString('N') }
$ReadyStatePath = Join-Path $LogRoot ('attach-ready.{0}.json' -f $AttachGeneration)
$RelaunchMutexCreated = $false
$RelaunchMutex = [Threading.Mutex]::new($true, 'Local\QuotaPinCodexRelaunch', [ref]$RelaunchMutexCreated)
if (-not $RelaunchMutexCreated) {
    Write-LauncherLog 'launch declined: another QuotaPin relaunch transaction owns the single-flight lock'
    $RelaunchMutex.Dispose()
    exit 6
}

try {
if (-not (Test-QuotaPinAttachAuthorization $Package.InstallLocation)) {
    Write-LauncherLog "auto-attach declined before any process action: identity or generation mismatch pid=$VerifiedCodexPid generation=$AttachGeneration"
    exit 3
}

$Running = @(Find-CodexProcesses $Package.InstallLocation)
if ($Running.Count) {
    if ($AutoAttach) {
        if (-not (Test-QuotaPinAttachAuthorization $Package.InstallLocation)) {
            Write-LauncherLog "auto-attach declined immediately before close: identity changed pid=$VerifiedCodexPid generation=$AttachGeneration"
            exit 3
        }
        Write-QuotaPinLifecycleState -State 'starting' -CodexPid $VerifiedCodexPid -Attempt 1 -Generation $AttachGeneration
    }
    if (-not $NoRelaunchPrompt) {
        $TrayIcon = Join-Path $InstallRoot 'QuotaPin.Tray.exe'
        if (-not (Show-QuotaPinRelaunchPrompt -IconPath $TrayIcon)) {
            Write-LauncherLog 'relaunch declined'
            exit 2
        }
    }
    Write-LauncherLog ('closing Codex processes: ' + ($Running.Id -join ','))
    foreach ($Process in @($Running | Where-Object MainWindowHandle -ne 0)) { $null = $Process.CloseMainWindow() }
    $Deadline = (Get-Date).AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        $Remaining = @(Find-CodexProcesses $Package.InstallLocation)
        $OpenWindows = @($Remaining | Where-Object MainWindowHandle -ne 0)
    } while ($OpenWindows.Count -and (Get-Date) -lt $Deadline)
    if ($OpenWindows.Count) {
        Write-LauncherLog 'Codex window did not close within 10 seconds'
        throw 'Codex did not close within 10 seconds. Close it manually, then start QuotaPin again.'
    }
    if ($Remaining.Count) {
        Write-LauncherLog ('stopping approved background processes: ' + ($Remaining.Id -join ','))
        $Remaining | Stop-Process -Force
        $Deadline = (Get-Date).AddSeconds(10)
        do {
            Start-Sleep -Milliseconds 250
            $Remaining = @(Find-CodexProcesses $Package.InstallLocation)
        } while ($Remaining.Count -and (Get-Date) -lt $Deadline)
    }
    if ($Remaining.Count) {
        Write-LauncherLog 'Codex background processes did not stop within 10 seconds'
        throw 'Codex background processes did not stop. Quit Codex manually, then start QuotaPin again.'
    }
}
elseif ($AutoAttach) {
    Write-LauncherLog "auto-attach declined: authorized source disappeared pid=$VerifiedCodexPid generation=$AttachGeneration"
    exit 3
}

$Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$Listener.Start()
$Port = ([Net.IPEndPoint]$Listener.LocalEndpoint).Port
$Listener.Stop()

$env:QUOTAPIN_CODEX_COMMAND = $CodexRuntimeCommand
Remove-Item -LiteralPath $ReadyStatePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $RuntimeStatePath -Force -ErrorAction SilentlyContinue
$AgentStartedAt = [DateTimeOffset]::Now
$AgentArguments = @(
    '--port', [string]$Port,
    '--config', ('"{0}"' -f $ConfigPath),
    '--log', ('"{0}"' -f $AgentLog),
    '--attach-generation', $AttachGeneration
)
$AgentProcess = Start-Process -FilePath $Agent -ArgumentList $AgentArguments -WindowStyle Hidden `
    -RedirectStandardOutput $AgentStdout -RedirectStandardError $AgentStderr -PassThru
Write-QuotaPinLifecycleState -State 'starting' -CodexPid $VerifiedCodexPid -AgentPid $AgentProcess.Id -Port $Port -Attempt 1 -Generation $AttachGeneration

if (-not ('QuotaPinActivation.Manager' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;

namespace QuotaPinActivation {
    [Flags]
    public enum ActivateOptions : uint {
        None = 0,
        DesignMode = 1,
        NoErrorUI = 2,
        NoSplashScreen = 4
    }

    [ComImport]
    [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            ActivateOptions options,
            out uint processId);
        [PreserveSig]
        int ActivateForFile(IntPtr appUserModelId, IntPtr itemArray, IntPtr verb, out uint processId);
        [PreserveSig]
        int ActivateForProtocol(IntPtr appUserModelId, IntPtr itemArray, out uint processId);
    }

    [ComImport]
    [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    class ApplicationActivationManager {}

    public static class Manager {
        public static uint Activate(string appUserModelId, string arguments) {
            var manager = (IApplicationActivationManager)new ApplicationActivationManager();
            uint processId;
            int result = manager.ActivateApplication(appUserModelId, arguments, ActivateOptions.NoErrorUI, out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        }
    }
}
'@
}

try {
    $Arguments = '--remote-debugging-address=127.0.0.1 --remote-debugging-port={0}' -f $Port
    $ProcessId = [QuotaPinActivation.Manager]::Activate($AppUserModelId, $Arguments)
    if ([int]$ProcessId -le 0 -or ($AutoAttach -and [int]$ProcessId -eq $VerifiedCodexPid)) {
        throw 'Codex activation did not return a distinct successor process.'
    }
    $Successor = $null
    $Deadline = (Get-Date).AddSeconds(25)
    do {
        Start-Sleep -Milliseconds 250
        if ($AgentProcess.HasExited) { throw "QuotaPin Agent exited before renderer attachment with code $($AgentProcess.ExitCode)." }
        $Successor = @(Get-QuotaPinCodexRootProcesses $Package.InstallLocation | Where-Object { [int]$_.ProcessId -eq [int]$ProcessId } | Select-Object -First 1)
        $RendererReady = Test-QuotaPinRendererReady -Generation $AttachGeneration -AgentPid $AgentProcess.Id -Port $Port -NotBefore $AgentStartedAt
    } while (($Successor.Count -ne 1 -or -not $RendererReady) -and (Get-Date) -lt $Deadline)
    if ($Successor.Count -ne 1) { throw 'The activated Codex successor could not be verified.' }
    if (-not $RendererReady) { throw 'QuotaPin renderer attachment did not become ready within 25 seconds.' }

    $RuntimeState = [ordered]@{
        schema = 2
        generation = $AttachGeneration
        sourceCodexPid = [int]$VerifiedCodexPid
        codexPid = [int]$ProcessId
        codexCreationTimeUtc = ([datetime]$Successor[0].CreationTimeUtc).ToString('o')
        agentPid = [int]$AgentProcess.Id
        port = [int]$Port
        rendererAttached = $true
        writtenAt = [DateTimeOffset]::Now.ToString('o')
    }
    Write-QuotaPinJsonAtomic -Path $RuntimeStatePath -Value $RuntimeState
    $LifecycleState = 'attached'
    try {
        $ExistingLifecycle = Get-Content -Raw -LiteralPath (Join-Path $LogRoot 'lifecycle.json') | ConvertFrom-Json
        if ([string]$ExistingLifecycle.generation -eq $AttachGeneration -and [string]$ExistingLifecycle.state -eq 'quota-ready') { $LifecycleState = 'quota-ready' }
    }
    catch {}
    Write-QuotaPinLifecycleState -State $LifecycleState -CodexPid ([int]$ProcessId) -AgentPid ([int]$AgentProcess.Id) -Port ([int]$Port) -Attempt 1 -Generation $AttachGeneration
    Write-LauncherLog "renderer attached generation=$AttachGeneration sourcePid=$VerifiedCodexPid successorPid=$ProcessId agentPid=$($AgentProcess.Id) loopbackPort=$Port"
}
catch {
    Write-LauncherLog ('activation failed: ' + $_.Exception.Message)
    Write-QuotaPinLifecycleState -State 'degraded' -CodexPid $VerifiedCodexPid -AgentPid ([int]$AgentProcess.Id) -Port ([int]$Port) -Attempt 1 -Generation $AttachGeneration -Reason $_.Exception.Message
    Stop-Process -Id $AgentProcess.Id -Force -ErrorAction SilentlyContinue
    throw
}
}
finally {
    try { $RelaunchMutex.ReleaseMutex() } catch {}
    $RelaunchMutex.Dispose()
}
