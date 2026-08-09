param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Capture', 'Resume')]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$VersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:beta)\.(0|[1-9]\d*))?$'
if ($Version -notmatch $VersionPattern) { throw 'QuotaPin handoff version is invalid.' }

$ResolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$LogRoot = Join-Path $ResolvedRoot 'logs'
$SnapshotPath = Join-Path $LogRoot 'installer-handoff.json'
$ResultPath = Join-Path $LogRoot 'installer-handoff-result.json'
$CompletionPath = Join-Path $LogRoot 'update-completion.json'
$HandoffLogPath = Join-Path $LogRoot 'installer-handoff.log'
$InstalledVersionPath = Join-Path $ResolvedRoot 'VERSION'
$RuntimeTrustPath = Join-Path $ResolvedRoot 'src\runtime-trust.ps1'
$AgentPath = Join-Path $ResolvedRoot 'QuotaPin.Agent.exe'

function Write-QuotaPinHandoffLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        Add-Content -LiteralPath $HandoffLogPath -Value ('{0:o} {1}' -f (Get-Date), ($Message -replace '[\r\n]+', ' '))
    }
    catch {}
}

function Write-QuotaPinHandoffJson([string]$Path, $Value) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $Temporary = '{0}.{1}.tmp' -f $Path, ([Guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($Temporary, ($Value | ConvertTo-Json -Depth 12 -Compress), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $Temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
    }
}

function Write-QuotaPinHandoffResult([string]$Status, [string]$Phase, [string]$FromVersion, [string]$Message) {
    $SafeMessage = ($Message -replace '[\r\n]+', ' ').Trim()
    if ($SafeMessage.Length -gt 200) { $SafeMessage = $SafeMessage.Substring(0, 200) }
    $Value = [ordered]@{
        schema = 2
        status = $Status
        phase = $Phase
        version = $Version
        writtenAt = [DateTimeOffset]::Now.ToString('o')
        message = $SafeMessage
    }
    if ($FromVersion -match $VersionPattern) { $Value.fromVersion = $FromVersion }
    Write-QuotaPinHandoffJson -Path $ResultPath -Value $Value
    if ($Status -in @('succeeded', 'degraded', 'failed', 'rolled-back', 'rollback-failed')) {
        Write-QuotaPinHandoffJson -Path $CompletionPath -Value $Value
    }
}

if ($Action -eq 'Capture') {
    Remove-Item -LiteralPath $SnapshotPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ResultPath -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $InstalledVersionPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $RuntimeTrustPath -PathType Leaf)) {
        Write-QuotaPinHandoffLog 'capture skipped reason=no-existing-runtime'
        exit 0
    }
    try {
        $FromVersion = (Get-Content -Raw -LiteralPath $InstalledVersionPath).Trim()
        if ($FromVersion -notmatch $VersionPattern) { throw 'The installed version is invalid.' }
        . $RuntimeTrustPath
        $ExpectedRuntime = Get-QuotaPinResumableRuntime -InstallRoot $ResolvedRoot -AgentPath $AgentPath
        if (-not $ExpectedRuntime) {
            Write-QuotaPinHandoffLog "capture skipped from=$FromVersion reason=no-trusted-session"
            exit 0
        }
        Write-QuotaPinHandoffJson -Path $SnapshotPath -Value ([ordered]@{
            schema = 1
            targetVersion = $Version
            fromVersion = $FromVersion
            capturedAt = [DateTimeOffset]::Now.ToString('o')
            expectedRuntime = $ExpectedRuntime
        })
        Write-QuotaPinHandoffLog "captured from=$FromVersion to=$Version codexPid=$([int]$ExpectedRuntime.codexPid)"
    }
    catch {
        Remove-Item -LiteralPath $SnapshotPath -Force -ErrorAction SilentlyContinue
        Write-QuotaPinHandoffLog ("capture skipped code={0}" -f $_.Exception.GetType().Name)
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $SnapshotPath -PathType Leaf)) {
    Write-QuotaPinHandoffLog 'resume skipped reason=no-snapshot'
    exit 0
}

$FromVersion = ''
try {
    $Snapshot = Get-Content -Raw -LiteralPath $SnapshotPath | ConvertFrom-Json
    $FromVersion = [string]$Snapshot.fromVersion
    $CapturedAt = [DateTimeOffset]::Parse([string]$Snapshot.capturedAt)
    if ([int]$Snapshot.schema -ne 1 -or [string]$Snapshot.targetVersion -cne $Version -or
        $FromVersion -notmatch $VersionPattern -or -not $Snapshot.expectedRuntime -or
        $CapturedAt -gt [DateTimeOffset]::Now.AddMinutes(5) -or $CapturedAt -lt [DateTimeOffset]::Now.AddHours(-1)) {
        throw 'The saved QuotaPin handoff is invalid or stale.'
    }
    Write-QuotaPinHandoffResult 'started' 'reconnecting' $FromVersion 'QuotaPin is reconnecting the current Codex session.'
    . $RuntimeTrustPath
    $ResumeState = Resume-QuotaPinTrustedRuntime -InstallRoot $ResolvedRoot -ExpectedRuntime $Snapshot.expectedRuntime -AgentPath $AgentPath
    if ($ResumeState -eq 'quota-ready') {
        Write-QuotaPinHandoffResult 'succeeded' 'complete' $FromVersion 'QuotaPin updated without restarting Codex.'
        Write-QuotaPinHandoffLog "resumed from=$FromVersion to=$Version state=quota-ready"
    }
    else {
        Write-QuotaPinHandoffResult 'degraded' 'complete' $FromVersion 'QuotaPin updated. Attachment will retry on the next Codex launch.'
        Write-QuotaPinHandoffLog "resumed from=$FromVersion to=$Version state=next-launch"
    }
}
catch {
    try { Write-QuotaPinHandoffResult 'degraded' 'complete' $FromVersion 'QuotaPin updated. Attachment will retry on the next Codex launch.' } catch {}
    Write-QuotaPinHandoffLog ("resume deferred from={0} to={1} code={2}" -f $FromVersion, $Version, $_.Exception.GetType().Name)
}
finally {
    Remove-Item -LiteralPath $SnapshotPath -Force -ErrorAction SilentlyContinue
}

exit 0
