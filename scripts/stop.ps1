param(
    [switch]$TemporaryExit,
    [switch]$InstallerHandoff
)

$ErrorActionPreference = 'Stop'
$InstallRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin'
$AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
$TrayPath = Join-Path $InstallRoot 'QuotaPin.Tray.exe'
$LogRoot = Join-Path $InstallRoot 'logs'
$RuntimePath = Join-Path $LogRoot 'runtime.json'
$LifecyclePath = Join-Path $LogRoot 'lifecycle.json'
$WatcherStatePath = Join-Path $LogRoot 'watcher.json'
$StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'QuotaPin Auto Attach.lnk'
$InstallerHandoffPath = Join-Path $LogRoot 'installer-handoff.json'
if ($TemporaryExit -and $InstallerHandoff) { throw 'Choose either TemporaryExit or InstallerHandoff.' }

function Get-OwnedProcess([string]$Name, [string]$ExpectedPath) {
    $Expected = [IO.Path]::GetFullPath($ExpectedPath)
    @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and [IO.Path]::GetFullPath($_.Path).Equals($Expected, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
    })
}

function Stop-OwnedProcesses([string]$Name, [string]$ExpectedPath) {
    foreach ($Process in @(Get-OwnedProcess $Name $ExpectedPath)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction Stop
    }
    $Deadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
    while (@(Get-OwnedProcess $Name $ExpectedPath).Count -gt 0 -and [DateTimeOffset]::UtcNow -lt $Deadline) {
        Start-Sleep -Milliseconds 100
    }
    if (@(Get-OwnedProcess $Name $ExpectedPath).Count -gt 0) {
        throw "QuotaPin $Name process did not stop."
    }
}

function Test-QuotaPinWatcherMutexAvailable {
    $Probe = [Threading.Mutex]::new($false, 'Local\QuotaPinAutoAttach')
    $Acquired = $false
    try {
        try { $Acquired = $Probe.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $Acquired = $true }
        return $Acquired
    }
    finally {
        if ($Acquired) { try { $Probe.ReleaseMutex() } catch {} }
        $Probe.Dispose()
    }
}

function Stop-OwnedWatcher {
    if (-not (Test-Path -LiteralPath $WatcherStatePath)) {
        # One-release migration path for older command installs that predate
        # watcher.json. Failure is harmless; new installs never depend on CIM.
        $LegacyWatcherScript = Join-Path $InstallRoot 'src\auto-attach.ps1'
        if (-not (Test-Path -LiteralPath $LegacyWatcherScript) -and -not (Test-Path -LiteralPath $StartupShortcut)) { return }
        try {
            Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -OperationTimeoutSec 2 -ErrorAction Stop | Where-Object {
                $_.CommandLine -and $_.CommandLine.IndexOf($LegacyWatcherScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
            } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
        }
        catch {}
        Start-Sleep -Milliseconds 100
        if (-not (Test-QuotaPinWatcherMutexAvailable)) { throw 'QuotaPin could not verify that the legacy auto-attach watcher stopped.' }
        return $true
    }
    $State = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
    $Watcher = Get-Process -Id ([int]$State.processId) -ErrorAction SilentlyContinue
    if (-not $Watcher) {
        if (-not (Test-QuotaPinWatcherMutexAvailable)) { throw 'QuotaPin watcher state is stale while its single-instance lock remains active.' }
        Remove-Item -LiteralPath $WatcherStatePath -Force
        return $true
    }
    $RecordedStart = [DateTimeOffset]::Parse([string]$State.startedAt)
    $ActualStart = [DateTimeOffset]::new($Watcher.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
    $StartDelta = [Math]::Abs(($ActualStart - $RecordedStart).TotalSeconds)
    if ($Watcher.ProcessName -notin @('powershell', 'pwsh') -or $StartDelta -gt 2) {
        throw 'QuotaPin refused to stop an unverifiable auto-attach process.'
    }
    Stop-Process -Id $Watcher.Id -Force -ErrorAction Stop
    $Deadline = [DateTimeOffset]::UtcNow.AddSeconds(5)
    $SameWatcher = $true
    do {
        $Current = Get-Process -Id $Watcher.Id -ErrorAction SilentlyContinue
        if (-not $Current) { $SameWatcher = $false; break }
        try {
            $CurrentStart = [DateTimeOffset]::new($Current.StartTime.ToUniversalTime(), [TimeSpan]::Zero)
            $SameWatcher = [Math]::Abs(($CurrentStart - $ActualStart).TotalSeconds) -le 2
        }
        catch { $SameWatcher = $false }
        if ($SameWatcher) { Start-Sleep -Milliseconds 100 }
    } while ([DateTimeOffset]::UtcNow -lt $Deadline)
    if ($SameWatcher) {
        throw 'QuotaPin auto-attach watcher did not stop.'
    }
    Remove-Item -LiteralPath $WatcherStatePath -Force
    return $true
}

$CleanupPort = $null
$RuntimeTrustHelper = Join-Path $InstallRoot 'src\runtime-trust.ps1'
$HasRuntimeTrustHelper = Test-Path -LiteralPath $RuntimeTrustHelper -PathType Leaf
if ($HasRuntimeTrustHelper) {
    try {
        . $RuntimeTrustHelper
        $TrustedRuntime = Get-QuotaPinTrustedRuntime -InstallRoot $InstallRoot
        if ($TrustedRuntime) { $CleanupPort = [int]$TrustedRuntime.port }
    }
    catch {}
}
# One-release fallback for installations that genuinely predate
# runtime-trust.ps1. Once the verifier is installed, a failed verification is
# a hard boundary rather than permission to reuse weaker lifecycle data.
if (-not $HasRuntimeTrustHelper) {
    foreach ($StatePath in @($RuntimePath, $LifecyclePath)) {
        if ($CleanupPort) { break }
        if (-not (Test-Path -LiteralPath $StatePath)) { continue }
        try {
            $Runtime = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
            $RuntimeAgent = Get-Process -Id ([int]$Runtime.agentPid) -ErrorAction Stop
            $AgentOwned = @(Get-OwnedProcess 'QuotaPin.Agent' $AgentPath | Where-Object { $_.Id -eq $RuntimeAgent.Id }).Count -eq 1
            if ($AgentOwned -and [int]$Runtime.port -ge 1024 -and [int]$Runtime.port -le 65535) {
                $CleanupPort = [int]$Runtime.port
                break
            }
        }
        catch {}
    }
}

$InstallerHandoffVerified = $false
if ($InstallerHandoff -and (Test-Path -LiteralPath $InstallerHandoffPath -PathType Leaf)) {
    try {
        $Handoff = Get-Content -Raw -LiteralPath $InstallerHandoffPath | ConvertFrom-Json
        $CapturedAt = [DateTimeOffset]::Parse([string]$Handoff.capturedAt)
        $HandoffAge = ([DateTimeOffset]::Now - $CapturedAt).TotalMinutes
        $ExpectedPort = [int]$Handoff.expectedRuntime.port
        $ExpectedGeneration = [string]$Handoff.expectedRuntime.generation
        if ([int]$Handoff.schema -ne 1) { throw 'QuotaPin installer handoff schema is invalid.' }
        if ($HandoffAge -lt -1 -or $HandoffAge -gt 10) { throw 'QuotaPin installer handoff is stale.' }
        if ($ExpectedPort -lt 1024 -or $ExpectedPort -gt 65535) { throw 'QuotaPin installer handoff port is invalid.' }
        if ($ExpectedGeneration -notmatch '^[0-9a-f]{32}$') { throw 'QuotaPin installer handoff generation is invalid.' }
        if ($CleanupPort -and $ExpectedPort -ne [int]$CleanupPort) {
            throw 'QuotaPin installer handoff does not match the trusted runtime.'
        }
        $InstallerHandoffVerified = $true
    }
    catch {
        throw [InvalidOperationException]::new('QuotaPin installer handoff could not be verified.', $_.Exception)
    }
}

# Stop the persistent session before asking a short-lived helper to clean the
# renderer.  Cleaning first allowed the live Agent's next two-second sync to
# re-inject QuotaPin in the small race before Stop-Process ran.
Stop-OwnedProcesses 'QuotaPin.Agent' $AgentPath
$CleanupFailed = $false
if ($CleanupPort) {
    try {
        & $AgentPath --cleanup --port $CleanupPort 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $CleanupFailed = $true }
    }
    catch { $CleanupFailed = $true }
}
$null = Stop-OwnedWatcher

if (-not $TemporaryExit) {
    Stop-OwnedProcesses 'QuotaPin.Tray' $TrayPath
    # Setup has already captured the current startup preference. Keep its
    # durable entry in place until the new installation commits so a failed
    # PrepareToInstall cannot silently disable automatic attachment.
    if (-not $InstallerHandoffVerified) {
        Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'QuotaPin' -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $StartupShortcut) { Remove-Item -LiteralPath $StartupShortcut -Force }
    }
}

Start-Sleep -Milliseconds 200
$Remaining = @(Get-OwnedProcess 'QuotaPin.Agent' $AgentPath).Count
if (-not $TemporaryExit) { $Remaining += @(Get-OwnedProcess 'QuotaPin.Tray' $TrayPath).Count }
if ($Remaining -gt 0) { throw "QuotaPin could not stop $Remaining owned process(es)." }
if ($CleanupFailed -and -not $TemporaryExit -and -not $InstallerHandoffVerified) {
    throw 'QuotaPin stopped, but its renderer cleanup could not be confirmed. Close and reopen Codex, then retry uninstall.'
}
if ($CleanupFailed -and $InstallerHandoffVerified) {
    Write-Warning 'Renderer cleanup was deferred to the verified replacement Agent.'
}
