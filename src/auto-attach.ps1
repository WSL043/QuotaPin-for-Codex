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
$CodexCommandHelpers = Join-Path $PSScriptRoot 'codex-command.ps1'

foreach ($Required in @($LaunchScript, $LifecycleHelpers, $ProcessHelpers, $PolicyHelpers, $CodexCommandHelpers)) {
    if (-not (Test-Path -LiteralPath $Required)) { throw "QuotaPin runtime file not found: $Required" }
}
. $LifecycleHelpers
. $ProcessHelpers
. $PolicyHelpers
. $CodexCommandHelpers

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

function Test-QuotaPinAgentIdentity([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    try {
        $Expected = [IO.Path]::GetFullPath((Join-Path $InstallRoot 'QuotaPin.Agent.exe'))
        $Agent = Get-Process -Id $ProcessId -ErrorAction Stop
        [bool]($Agent.Path -and [IO.Path]::GetFullPath($Agent.Path).Equals($Expected, [StringComparison]::OrdinalIgnoreCase))
    }
    catch { $false }
}

function Get-QuotaPinRecoverableRuntime($SavedGuard, [string]$PackageRoot) {
    try {
        if ([string]$SavedGuard.state -ne 'successor-observed' -or -not (Test-Path -LiteralPath $RuntimePath)) { return $null }
        $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
        if ([int]$Runtime.schema -ne 2 -or [string]$Runtime.generation -notmatch '^[0-9a-f]{32}$') { return $null }
        if (-not [string]::Equals([string]$Runtime.generation, [string]$SavedGuard.generation, [StringComparison]::Ordinal)) { return $null }
        $SuccessorPid = [int]$Runtime.codexPid
        $Port = [int]$Runtime.port
        if ($SuccessorPid -le 0 -or $Port -lt 1024 -or $Port -gt 65535 -or $SuccessorPid -ne [int]$SavedGuard.successorPid) { return $null }
        $ExpectedCreation = [DateTimeOffset]::Parse([string]$Runtime.codexCreationTimeUtc).UtcDateTime
        $GuardCreation = [DateTimeOffset]::Parse([string]$SavedGuard.successorCreationTimeUtc).UtcDateTime
        if ([Math]::Abs(($ExpectedCreation - $GuardCreation).TotalSeconds) -gt 2) { return $null }
        if (-not (Test-QuotaPinOfficialCodexIdentity -ProcessId $SuccessorPid -PackageRoot $PackageRoot -ExpectedCreationTimeUtc $ExpectedCreation)) { return $null }
        $ReadyPath = Join-Path $LogRoot ('attach-ready.{0}.json' -f [string]$Runtime.generation)
        if (-not (Test-Path -LiteralPath $ReadyPath)) { return $null }
        $Ready = Get-Content -Raw -LiteralPath $ReadyPath | ConvertFrom-Json
        if ([int]$Ready.schema -ne 1 -or [string]$Ready.state -ne 'renderer-attached' -or
            -not [string]::Equals([string]$Ready.generation, [string]$Runtime.generation, [StringComparison]::Ordinal) -or
            [int]$Ready.port -ne $Port) { return $null }
        [pscustomobject]@{
            generation = [string]$Runtime.generation
            sourcePid = [int]$SavedGuard.sourcePid
            sourceCreationTimeUtc = [DateTimeOffset]::Parse([string]$SavedGuard.sourceCreationTimeUtc).UtcDateTime
            successorPid = $SuccessorPid
            successorCreationTimeUtc = $ExpectedCreation
            agentPid = [int]$Runtime.agentPid
            port = $Port
        }
    }
    catch { $null }
}

function Test-QuotaPinMainTarget([int]$Port) {
    if ($Port -lt 1024 -or $Port -gt 65535) { return $false }
    try {
        $Response = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:{0}/json/list' -f $Port) -TimeoutSec 1
        if ([int]$Response.StatusCode -ne 200) { return $false }
        $Targets = @($Response.Content | ConvertFrom-Json)
        [bool](@($Targets | Where-Object { [string]$_.url -ceq 'app://-/index.html' }).Count -gt 0)
    }
    catch { $false }
}

function Start-QuotaPinRecoveredAgent($Runtime) {
    try {
        if (Test-QuotaPinAgentIdentity ([int]$Runtime.agentPid)) { return [pscustomobject]@{ state = 'active'; processId = [int]$Runtime.agentPid } }
        if (-not (Test-QuotaPinMainTarget ([int]$Runtime.port))) { return [pscustomobject]@{ state = 'waiting'; processId = 0 } }
        $AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
        $ConfigPath = Join-Path $InstallRoot 'config.json'
        $AgentLogPath = Join-Path $LogRoot 'agent.log'
        if (-not (Test-Path -LiteralPath $AgentPath) -or -not (Test-Path -LiteralPath $ConfigPath)) { return [pscustomobject]@{ state = 'waiting'; processId = 0 } }
        $CodexCommand = Get-QuotaPinCodexCommand
        $StartInfo = [Diagnostics.ProcessStartInfo]::new()
        $StartInfo.FileName = $AgentPath
        $StartInfo.Arguments = '--port {0} --config "{1}" --log "{2}" --attach-generation "{3}"' -f ([int]$Runtime.port), $ConfigPath, $AgentLogPath, [string]$Runtime.generation
        $StartInfo.WorkingDirectory = $InstallRoot
        $StartInfo.UseShellExecute = $false
        $StartInfo.CreateNoWindow = $true
        $StartInfo.EnvironmentVariables['QUOTAPIN_CODEX_COMMAND'] = $CodexCommand
        $Agent = [Diagnostics.Process]::Start($StartInfo)
        if (-not $Agent) { return [pscustomobject]@{ state = 'failed'; processId = 0 } }
        Write-QuotaPinLifecycleState -State 'attached' -CodexPid ([int]$Runtime.successorPid) -AgentPid $Agent.Id -Port ([int]$Runtime.port) -Generation ([string]$Runtime.generation) -Reason 'supervisor-resumed'
        [pscustomobject]@{ state = 'started'; processId = $Agent.Id }
    }
    catch {
        Write-WatcherLog ('agent recovery failed error=' + $_.Exception.GetType().Name)
        [pscustomobject]@{ state = 'failed'; processId = 0 }
    }
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
$AgentResumeFailures = 0
$NextAgentResumeAt = Get-Date
$Guard = Read-QuotaPinAutoAttachGuard $GuardPath
$StartupRoots = @(Get-QuotaPinCodexRootProcesses $PackageRoot)
if ([string]$Guard.state -eq 'successor-observed') {
    $Recovered = Get-QuotaPinRecoverableRuntime -SavedGuard $Guard -PackageRoot $PackageRoot
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

        # A command-mode installer starts its replacement watcher before the
        # updater finishes reconnecting the already-running Codex session. The
        # updater then publishes one exact successor receipt. Adopt only that
        # one-way none -> successor-observed transition and only after the
        # complete runtime identity validates; arbitrary external guard edits
        # can never steer this watcher.
        $PublishedGuard = Read-QuotaPinAutoAttachGuard $GuardPath
        if (Test-QuotaPinPublishedGuardTransition -LocalState ([string]$Guard.state) -PublishedState ([string]$PublishedGuard.state)) {
            $PublishedRuntime = Get-QuotaPinRecoverableRuntime -SavedGuard $PublishedGuard -PackageRoot $PackageRoot
            $PublishedRoot = @($Roots | Where-Object { [int]$_.ProcessId -eq [int]$PublishedGuard.successorPid })
            if ($PublishedRuntime -and $PublishedRoot.Count -eq 1) {
                $Guard = $PublishedGuard
                $ProtectedPid = [int]$PublishedRuntime.successorPid
                $AgentResumeFailures = 0
                $NextAgentResumeAt = Get-Date
                Write-WatcherLog "adopted verified hot-update runtime generation=$([string]$Guard.generation) successorPid=$ProtectedPid"
            }
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
        elseif ($Decision -eq 'adopt') {
            $Runtime = Get-QuotaPinRecoverableRuntime -SavedGuard $Guard -PackageRoot $PackageRoot
            if ($Runtime -and (Test-QuotaPinAgentIdentity ([int]$Guard.agentPid))) {
                $AgentResumeFailures = 0
                $NextAgentResumeAt = (Get-Date).AddSeconds(2)
            }
            elseif ($Runtime -and (Get-Date) -ge $NextAgentResumeAt) {
                $Recovery = Start-QuotaPinRecoveredAgent -Runtime $Runtime
                if ([string]$Recovery.state -in @('active', 'started')) {
                    $Guard = New-QuotaPinAutoAttachGuard -State 'successor-observed' -Generation ([string]$Runtime.generation) `
                        -SourcePid ([int]$Runtime.sourcePid) -SourceCreationTimeUtc ([datetime]$Runtime.sourceCreationTimeUtc) `
                        -SuccessorPid ([int]$Runtime.successorPid) -SuccessorCreationTimeUtc ([datetime]$Runtime.successorCreationTimeUtc) `
                        -AgentPid ([int]$Recovery.processId) -Port ([int]$Runtime.port)
                    Write-QuotaPinAutoAttachGuard -Path $GuardPath -Value $Guard
                    $AgentResumeFailures = 0
                    $NextAgentResumeAt = (Get-Date).AddSeconds(2)
                    if ([string]$Recovery.state -eq 'started') { Write-WatcherLog "agent resumed on existing Codex port=$([int]$Runtime.port)" }
                }
                else {
                    $AgentResumeFailures = [Math]::Min(16, $AgentResumeFailures + 1)
                    $Delay = Get-QuotaPinAgentResumeDelaySeconds -FailureCount $AgentResumeFailures
                    $NextAgentResumeAt = (Get-Date).AddSeconds($Delay)
                }
            }
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
