param(
    [switch]$IgnoreExisting,
    [switch]$SelfTest,
    [switch]$PolicySelfTest
)

$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $PSScriptRoot
$LaunchScript = Join-Path $PSScriptRoot 'launch.ps1'
$LogRoot = Join-Path $InstallRoot 'logs'
$WatcherLog = Join-Path $LogRoot 'auto-attach.log'
$RuntimePath = Join-Path $LogRoot 'runtime.json'
$GuardPath = Join-Path $LogRoot 'auto-attach-guard.json'
$WatcherStatePath = Join-Path $LogRoot 'watcher.json'
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$LifecycleHelpers = Join-Path $PSScriptRoot 'lifecycle.ps1'
$ProcessHelpers = Join-Path $PSScriptRoot 'codex-process.ps1'
$PolicyHelpers = Join-Path $PSScriptRoot 'auto-attach-policy.ps1'

foreach ($Required in @($LaunchScript, $LifecycleHelpers, $ProcessHelpers, $PolicyHelpers)) {
    if (-not (Test-Path -LiteralPath $Required)) { throw "QuotaPin runtime file not found: $Required" }
}
. $LifecycleHelpers
. $ProcessHelpers
. $PolicyHelpers

function Write-WatcherLog([string]$Message) {
    Write-QuotaPinLog -Path $WatcherLog -Message $Message
}

function Get-QuotaPinRuntimeHandoff(
    [string]$Generation,
    [int]$SourcePid,
    [datetimeoffset]$NotBefore,
    [string]$PackageRoot
) {
    try {
        $ReadyPath = Join-Path $LogRoot ('attach-ready.{0}.json' -f $Generation)
        if (-not (Test-Path -LiteralPath $RuntimePath) -or -not (Test-Path -LiteralPath $ReadyPath)) { return $null }
        $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
        $Ready = Get-Content -Raw -LiteralPath $ReadyPath | ConvertFrom-Json
        if ([int]$Runtime.schema -ne 2 -or [int]$Ready.schema -ne 1) { return $null }
        if (-not [string]::Equals([string]$Runtime.generation, $Generation, [StringComparison]::Ordinal) -or
            -not [string]::Equals([string]$Ready.generation, $Generation, [StringComparison]::Ordinal)) { return $null }
        if ([int]$Runtime.sourceCodexPid -ne $SourcePid -or [string]$Ready.state -ne 'renderer-attached') { return $null }
        $WrittenAt = [DateTimeOffset]::Parse([string]$Runtime.writtenAt)
        $ReadyAt = [DateTimeOffset]::Parse([string]$Ready.writtenAt)
        if ($WrittenAt -lt $NotBefore.AddSeconds(-2) -or $ReadyAt -lt $NotBefore.AddSeconds(-2)) { return $null }
        $SuccessorPid = [int]$Runtime.codexPid
        $AgentPid = [int]$Runtime.agentPid
        $Port = [int]$Runtime.port
        if ($SuccessorPid -le 0 -or $SuccessorPid -eq $SourcePid -or $AgentPid -le 0 -or $Port -lt 1024 -or $Port -gt 65535) { return $null }
        if ([int]$Ready.agentPid -ne $AgentPid -or [int]$Ready.port -ne $Port) { return $null }
        $Successor = @(Get-QuotaPinCodexRootProcesses $PackageRoot | Where-Object { [int]$_.ProcessId -eq $SuccessorPid } | Select-Object -First 1)
        if ($Successor.Count -ne 1) { return $null }
        $ExpectedCreation = [DateTimeOffset]::Parse([string]$Runtime.codexCreationTimeUtc).UtcDateTime
        if ([Math]::Abs((([datetime]$Successor[0].CreationTimeUtc) - $ExpectedCreation).TotalSeconds) -gt 2) { return $null }
        $ExpectedAgent = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'QuotaPin.Agent.exe'))
        $Agent = Get-Process -Id $AgentPid -ErrorAction Stop
        if (-not $Agent.Path -or -not ([IO.Path]::GetFullPath($Agent.Path)).Equals($ExpectedAgent, [StringComparison]::OrdinalIgnoreCase)) { return $null }
        [pscustomobject]@{
            successorPid = $SuccessorPid
            successorCreationTimeUtc = [datetime]$Successor[0].CreationTimeUtc
            agentPid = $AgentPid
            port = $Port
        }
    }
    catch { return $null }
}

function Set-QuotaPinAttachLatch(
    [string]$Generation,
    [int]$SourcePid,
    [datetime]$SourceCreationTimeUtc,
    [string]$Reason
) {
    $Latched = New-QuotaPinAutoAttachGuard -State 'degraded-latched' -Generation $Generation `
        -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreationTimeUtc -Reason $Reason
    Write-QuotaPinAutoAttachGuard -Path $GuardPath -Value $Latched
    Write-QuotaPinLifecycleState -State 'degraded' -CodexPid $SourcePid -Attempt 1 -Generation $Generation -Reason $Reason
    Write-WatcherLog "auto-attach latched generation=$Generation sourcePid=$SourcePid reason=$Reason"
}

Rotate-QuotaPinLog -Path $WatcherLog
$PackageRoot = Get-QuotaPinCodexPackageRoot
if ($SelfTest) {
    [pscustomobject]@{
        mode = 'per-user-startup-companion'
        packageFound = [bool]$PackageRoot
        launcherFound = Test-Path -LiteralPath $LaunchScript
        currentRootProcesses = @(Get-QuotaPinCodexRootProcesses $PackageRoot).Count
        guardState = [string](Read-QuotaPinAutoAttachGuard $GuardPath).state
    } | ConvertTo-Json -Compress
    exit 0
}
if ($PolicySelfTest) {
    [pscustomobject]@{
        initial = Get-QuotaPinAutoAttachDecision -GuardState none -RootIds @(100) -CandidateFresh $true
        successor = Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @(200) -ProtectedPid 200
        staleSnapshot = Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @(200) -ProtectedPid 200
        unexpectedReplacement = Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @(300) -ProtectedPid 200
        failedHandoff = Get-QuotaPinAutoAttachDecision -GuardState degraded-latched -RootIds @(300)
        ambiguous = Get-QuotaPinAutoAttachDecision -GuardState none -RootIds @(100, 101) -CandidateFresh $true
    } | ConvertTo-Json -Compress
    exit 0
}

$CreatedNew = $false
$WatcherMutex = [Threading.Mutex]::new($true, 'Local\QuotaPinAutoAttach', [ref]$CreatedNew)
if (-not $CreatedNew) {
    $WatcherMutex.Dispose()
    exit 0
}

$Ignored = New-Object 'System.Collections.Generic.HashSet[string]'
$ProtectedPid = 0
$IdleSince = $null
$Guard = Read-QuotaPinAutoAttachGuard $GuardPath
$StartupRoots = @(Get-QuotaPinCodexRootProcesses $PackageRoot)
if ([string]$Guard.state -eq 'successor-observed') {
    $GuardWrittenAt = try { [DateTimeOffset]::Parse([string]$Guard.writtenAt).AddMinutes(-1) } catch { [DateTimeOffset]::Now.AddMinutes(-2) }
    $Recovered = Get-QuotaPinRuntimeHandoff -Generation ([string]$Guard.generation) -SourcePid ([int]$Guard.sourcePid) -NotBefore $GuardWrittenAt -PackageRoot $PackageRoot
    if ($Recovered -and [int]$Recovered.successorPid -eq [int]$Guard.successorPid) {
        $ExpectedSuccessorCreation = try { [DateTimeOffset]::Parse([string]$Guard.successorCreationTimeUtc).UtcDateTime } catch { [DateTime]::MinValue }
        if ($ExpectedSuccessorCreation -ne [DateTime]::MinValue -and
            [Math]::Abs((([datetime]$Recovered.successorCreationTimeUtc) - $ExpectedSuccessorCreation).TotalSeconds) -le 2) {
            $ProtectedPid = [int]$Recovered.successorPid
        }
    }
    if ($ProtectedPid -le 0 -and $StartupRoots.Count -gt 0) {
        $SourceCreation = try { [DateTimeOffset]::Parse([string]$Guard.sourceCreationTimeUtc).UtcDateTime } catch { [DateTime]::MinValue }
        Set-QuotaPinAttachLatch -Generation ([string]$Guard.generation) -SourcePid ([int]$Guard.sourcePid) -SourceCreationTimeUtc $SourceCreation -Reason 'saved successor identity or renderer health could not be recovered'
        $Guard = Read-QuotaPinAutoAttachGuard $GuardPath
    }
}
if ($IgnoreExisting) {
    foreach ($Process in $StartupRoots) {
        $null = $Ignored.Add((Get-QuotaPinProcessIdentity $Process))
    }
}

Write-WatcherLog ('started ignoreExisting={0} guardState={1}' -f [bool]$IgnoreExisting, [string]$Guard.state)
Write-QuotaPinJsonAtomic -Path $WatcherStatePath -Value ([ordered]@{
    schema = 1
    processId = $PID
    # Record the process identity rather than the time initialization happened
    # to finish.  This stays trustworthy on slow disks and under AV scanning.
    startedAt = ([DateTimeOffset]::new((Get-Process -Id $PID).StartTime.ToUniversalTime(), [TimeSpan]::Zero)).ToString('o')
})

$LastPackageRefresh = Get-Date
try {
    while ($true) {
        if (((Get-Date) - $LastPackageRefresh).TotalSeconds -ge 30) {
            $PackageRoot = Get-QuotaPinCodexPackageRoot
            $LastPackageRefresh = Get-Date
        }
        $Roots = @(Get-QuotaPinCodexRootProcesses $PackageRoot)
        if ($Roots.Count -eq 0) {
            if (-not $IdleSince) { $IdleSince = Get-Date }
        } else {
            $IdleSince = $null
        }

        $GuardState = [string]$Guard.state
        if ($GuardState -eq 'successor-observed' -and $ProtectedPid -le 0) {
            $ProtectedPid = [int]$Guard.successorPid
        }
        $Candidate = if ($Roots.Count -eq 1) { $Roots[0] } else { $null }
        $CandidateIdentity = if ($Candidate) { Get-QuotaPinProcessIdentity $Candidate } else { '' }
        $CandidateFresh = if ($Candidate) { Test-QuotaPinFreshProcess $Candidate } else { $false }
        $CandidateIgnored = [bool]($CandidateIdentity -and $Ignored.Contains($CandidateIdentity))
        $IdleSeconds = if ($IdleSince) { ((Get-Date) - $IdleSince).TotalSeconds } else { 0 }
        $Decision = Get-QuotaPinAutoAttachDecision -GuardState $GuardState `
            -RootIds @($Roots | ForEach-Object { [int]$_.ProcessId }) -ProtectedPid $ProtectedPid `
            -CandidateFresh $CandidateFresh -CandidateIgnored $CandidateIgnored -IdleSeconds $IdleSeconds

        if ($Decision -eq 'stop') {
            Write-WatcherLog 'stopped because the persistent circuit breaker is latched'
            break
        }
        if ($Decision -eq 'latch') {
            $Generation = if ([string]$Guard.generation) { [string]$Guard.generation } else { [Guid]::NewGuid().ToString('N') }
            $SourcePid = if ([int]$Guard.sourcePid -gt 0) { [int]$Guard.sourcePid } else { 0 }
            $SourceCreation = if ([string]$Guard.sourceCreationTimeUtc) { [DateTimeOffset]::Parse([string]$Guard.sourceCreationTimeUtc).UtcDateTime } else { [DateTime]::MinValue }
            Set-QuotaPinAttachLatch -Generation $Generation -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreation -Reason 'unexpected Codex process transition after one authorized relaunch'
            break
        }
        if ($Decision -eq 'rearm') {
            Remove-Item -LiteralPath $GuardPath -Force -ErrorAction SilentlyContinue
            $Guard = [pscustomobject]@{ schema = 1; state = 'none' }
            $ProtectedPid = 0
            $Ignored.Clear()
            $IdleSince = $null
            Write-WatcherLog 'rearmed after Codex remained fully closed for 30 seconds'
            continue
        }
        if ($Decision -eq 'ignore-ambiguous') {
            foreach ($Process in $Roots) { $null = $Ignored.Add((Get-QuotaPinProcessIdentity $Process)) }
            Write-WatcherLog ('ignored ambiguous root set pids=' + (($Roots | ForEach-Object ProcessId) -join ','))
        }
        elseif ($Decision -eq 'ignore' -and $CandidateIdentity -and -not $CandidateIgnored) {
            $null = $Ignored.Add($CandidateIdentity)
            Write-WatcherLog "ignored ineligible codex identity=$CandidateIdentity"
        }
        elseif ($Decision -eq 'launch-once') {
            $Generation = [Guid]::NewGuid().ToString('N')
            $SourcePid = [int]$Candidate.ProcessId
            $SourceCreation = [datetime]$Candidate.CreationTimeUtc
            $StartedAt = [DateTimeOffset]::Now
            $Guard = New-QuotaPinAutoAttachGuard -State 'handoff-pending' -Generation $Generation `
                -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreation
            Write-QuotaPinAutoAttachGuard -Path $GuardPath -Value $Guard
            $ReadyPath = Join-Path $LogRoot ('attach-ready.{0}.json' -f $Generation)
            Remove-Item -LiteralPath $ReadyPath -Force -ErrorAction SilentlyContinue
            Write-QuotaPinLifecycleState -State 'starting' -CodexPid $SourcePid -Attempt 1 -Generation $Generation
            Write-WatcherLog "fresh official launch accepted generation=$Generation sourcePid=$SourcePid budget=1/1"
            $CreationFileTime = $SourceCreation.ToFileTimeUtc()
            $Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NoRelaunchPrompt -AutoAttach -VerifiedCodexPid {1} -VerifiedCreationFileTime {2} -AttachGeneration "{3}"' -f $LaunchScript, $SourcePid, $CreationFileTime, $Generation
            $Launcher = $null
            $ExitCode = -1
            try {
                $Launcher = Start-Process -FilePath $PowerShellExe -ArgumentList $Arguments -WindowStyle Hidden -PassThru
                if ($Launcher.WaitForExit(55000)) { $ExitCode = $Launcher.ExitCode }
                else {
                    Stop-Process -Id $Launcher.Id -Force -ErrorAction SilentlyContinue
                    $ExitCode = 124
                }
            }
            catch {
                Write-WatcherLog "launcher failed generation=$Generation error=$($_.Exception.GetType().Name)"
            }
            finally {
                if ($Launcher) { $Launcher.Dispose() }
            }
            $Handoff = if ($ExitCode -eq 0) { Get-QuotaPinRuntimeHandoff -Generation $Generation -SourcePid $SourcePid -NotBefore $StartedAt -PackageRoot $PackageRoot } else { $null }
            if (-not $Handoff) {
                Set-QuotaPinAttachLatch -Generation $Generation -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreation -Reason "single attach transaction failed with launcher exit $ExitCode"
                break
            }
            $Guard = New-QuotaPinAutoAttachGuard -State 'successor-observed' -Generation $Generation `
                -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreation `
                -SuccessorPid ([int]$Handoff.successorPid) -SuccessorCreationTimeUtc ([datetime]$Handoff.successorCreationTimeUtc) `
                -AgentPid ([int]$Handoff.agentPid) -Port ([int]$Handoff.port)
            Write-QuotaPinAutoAttachGuard -Path $GuardPath -Value $Guard
            $ProtectedPid = [int]$Handoff.successorPid
            $null = $Ignored.Add($CandidateIdentity)
            Write-WatcherLog "successor adopted generation=$Generation sourcePid=$SourcePid successorPid=$ProtectedPid; destructive budget exhausted"
            continue
        }
        Start-Sleep -Milliseconds 1000
    }
}
catch {
    $Generation = if ([string]$Guard.generation) { [string]$Guard.generation } else { [Guid]::NewGuid().ToString('N') }
    $SourcePid = if ([int]$Guard.sourcePid -gt 0) { [int]$Guard.sourcePid } else { 0 }
    $SourceCreation = if ([string]$Guard.sourceCreationTimeUtc) { [DateTimeOffset]::Parse([string]$Guard.sourceCreationTimeUtc).UtcDateTime } else { [DateTime]::MinValue }
    Set-QuotaPinAttachLatch -Generation $Generation -SourcePid $SourcePid -SourceCreationTimeUtc $SourceCreation -Reason $_.Exception.Message
    throw
}
finally {
    try {
        if (Test-Path -LiteralPath $WatcherStatePath) {
            $OwnedState = Get-Content -Raw -LiteralPath $WatcherStatePath | ConvertFrom-Json
            if ([int]$OwnedState.processId -eq $PID) { Remove-Item -LiteralPath $WatcherStatePath -Force }
        }
    }
    catch {}
    try { $WatcherMutex.ReleaseMutex() } catch {}
    $WatcherMutex.Dispose()
}
