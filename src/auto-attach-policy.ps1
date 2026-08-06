function Get-QuotaPinAutoAttachDecision(
    [ValidateSet('none', 'handoff-pending', 'successor-observed', 'degraded-latched')][string]$GuardState,
    [int[]]$RootIds,
    [int]$ProtectedPid = 0,
    [bool]$CandidateFresh = $false,
    [bool]$CandidateIgnored = $false,
    [double]$IdleSeconds = 0
) {
    $Roots = @($RootIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    if ($GuardState -eq 'degraded-latched') { return 'stop' }
    if ($GuardState -eq 'handoff-pending') { return 'latch' }
    if ($GuardState -eq 'successor-observed') {
        if ($ProtectedPid -gt 0 -and $Roots -contains $ProtectedPid) { return 'adopt' }
        if ($Roots.Count -eq 0) {
            if ($IdleSeconds -ge 30) { return 'rearm' }
            return 'wait-idle'
        }
        return 'latch'
    }
    if ($Roots.Count -eq 0) { return 'wait' }
    if ($Roots.Count -ne 1) { return 'ignore-ambiguous' }
    if ($CandidateIgnored -or -not $CandidateFresh) { return 'ignore' }
    'launch-once'
}

function Read-QuotaPinAutoAttachGuard([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ schema = 1; state = 'none' }
    }
    try {
        $Value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
        if ([int]$Value.schema -ne 1 -or [string]$Value.state -notin @('handoff-pending', 'successor-observed', 'degraded-latched')) {
            throw 'unsupported attach guard'
        }
        return $Value
    }
    catch {
        return [pscustomobject]@{
            schema = 1
            state = 'degraded-latched'
            reason = 'attach guard is unreadable'
            writtenAt = [DateTimeOffset]::Now.ToString('o')
        }
    }
}

function Write-QuotaPinAutoAttachGuard([string]$Path, $Value) {
    Write-QuotaPinJsonAtomic -Path $Path -Value $Value
}

function New-QuotaPinAutoAttachGuard(
    [ValidateSet('handoff-pending', 'successor-observed', 'degraded-latched')][string]$State,
    [string]$Generation,
    [int]$SourcePid = 0,
    [datetime]$SourceCreationTimeUtc = [datetime]::MinValue,
    [int]$SuccessorPid = 0,
    [datetime]$SuccessorCreationTimeUtc = [datetime]::MinValue,
    [int]$AgentPid = 0,
    [int]$Port = 0,
    [string]$Reason = ''
) {
    $Value = [ordered]@{
        schema = 1
        state = $State
        generation = $Generation
        writtenAt = [DateTimeOffset]::Now.ToString('o')
    }
    if ($SourcePid -gt 0) { $Value.sourcePid = $SourcePid }
    if ($SourceCreationTimeUtc -ne [datetime]::MinValue) { $Value.sourceCreationTimeUtc = $SourceCreationTimeUtc.ToString('o') }
    if ($SuccessorPid -gt 0) { $Value.successorPid = $SuccessorPid }
    if ($SuccessorCreationTimeUtc -ne [datetime]::MinValue) { $Value.successorCreationTimeUtc = $SuccessorCreationTimeUtc.ToString('o') }
    if ($AgentPid -gt 0) { $Value.agentPid = $AgentPid }
    if ($Port -gt 0) { $Value.port = $Port }
    $SafeReason = ($Reason -replace '[\r\n]+', ' ').Trim()
    if ($SafeReason) { $Value.reason = $SafeReason.Substring(0, [Math]::Min(160, $SafeReason.Length)) }
    [pscustomobject]$Value
}
