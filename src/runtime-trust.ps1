function ConvertTo-QuotaPinInstant($Value) {
    # Windows PowerShell 5.1 keeps ISO JSON dates as strings, while PowerShell
    # 7 converts them to DateTime by default.  Re-stringifying the latter drops
    # its Kind/offset and can apply the local offset twice.  Preserve the
    # already-parsed instant when one exists and round-trip strings otherwise.
    if ($Value -is [DateTimeOffset]) { return ([DateTimeOffset]$Value).ToUniversalTime() }
    if ($Value -is [DateTime]) { return ([DateTimeOffset]([DateTime]$Value)).ToUniversalTime() }
    [DateTimeOffset]::Parse(
        [string]$Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime()
}

function Get-QuotaPinTrustedRuntime(
    [string]$InstallRoot,
    [switch]$RequireAgent,
    [string]$AgentPath = ''
) {
    try {
        $ResolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
        $RuntimePath = Join-Path $ResolvedRoot 'logs\runtime.json'
        $LifecyclePath = Join-Path $ResolvedRoot 'logs\lifecycle.json'
        $ProcessHelper = Join-Path $ResolvedRoot 'src\codex-process.ps1'
        if (-not (Test-Path -LiteralPath $RuntimePath -PathType Leaf) -or
            -not (Test-Path -LiteralPath $ProcessHelper -PathType Leaf)) { return $null }

        $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
        if ([int]$Runtime.schema -ne 2 -or $Runtime.rendererAttached -ne $true -or
            [string]$Runtime.generation -notmatch '^[0-9a-f]{32}$') { return $null }
        $Port = [int]$Runtime.port
        $CodexPid = [int]$Runtime.codexPid
        $AgentPid = [int]$Runtime.agentPid
        if ($Port -lt 1024 -or $Port -gt 65535 -or $CodexPid -le 0 -or $AgentPid -le 0) { return $null }

        $RuntimeWrittenAt = ConvertTo-QuotaPinInstant $Runtime.writtenAt
        if ($RuntimeWrittenAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { return $null }
        $CodexCreationTimeUtc = (ConvertTo-QuotaPinInstant $Runtime.codexCreationTimeUtc).UtcDateTime

        . $ProcessHelper
        $PackageRoot = Get-QuotaPinCodexPackageRoot
        if (-not (Test-QuotaPinOfficialCodexIdentity -ProcessId $CodexPid -PackageRoot $PackageRoot -ExpectedCreationTimeUtc $CodexCreationTimeUtc)) {
            return $null
        }

        $TargetsResponse = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 2
        if ($TargetsResponse.StatusCode -ne 200) { return $null }
        # Windows PowerShell 5.1 can keep a JSON array as one nested pipeline
        # object when ConvertFrom-Json is wrapped directly in @(...).  Assign
        # first so Where-Object receives each target rather than the array.
        $Targets = $TargetsResponse.Content | ConvertFrom-Json
        if (-not @($Targets | Where-Object { [string]$_.url -ceq 'app://-/index.html' }).Count) { return $null }

        $Lifecycle = $null
        if ($RequireAgent) {
            if (-not $AgentPath) { $AgentPath = Join-Path $ResolvedRoot 'QuotaPin.Agent.exe' }
            $ExpectedAgentPath = [IO.Path]::GetFullPath($AgentPath)
            $Agent = Get-Process -Id $AgentPid -ErrorAction Stop
            if (-not $Agent.Path -or
                -not ([IO.Path]::GetFullPath($Agent.Path)).Equals($ExpectedAgentPath, [StringComparison]::OrdinalIgnoreCase)) { return $null }
            $AgentStartedAt = [DateTimeOffset]::new($Agent.StartTime.ToUniversalTime())
            if ($AgentStartedAt -gt $RuntimeWrittenAt.AddMinutes(2)) { return $null }

            if (-not (Test-Path -LiteralPath $LifecyclePath -PathType Leaf)) { return $null }
            $Lifecycle = Get-Content -Raw -LiteralPath $LifecyclePath | ConvertFrom-Json
            $LifecycleWrittenAt = ConvertTo-QuotaPinInstant $Lifecycle.writtenAt
            if ($LifecycleWrittenAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5) -or
                [string]$Lifecycle.generation -cne [string]$Runtime.generation -or
                [int]$Lifecycle.codexPid -ne $CodexPid -or
                [int]$Lifecycle.agentPid -ne $AgentPid -or
                [int]$Lifecycle.port -ne $Port -or
                [string]$Lifecycle.state -notin @('attached', 'quota-ready')) { return $null }
        }

        [pscustomobject]@{
            schema = 1
            port = $Port
            codexPid = $CodexPid
            codexCreationTimeUtc = $CodexCreationTimeUtc.ToString('o')
            agentPid = $AgentPid
            generation = [string]$Runtime.generation
            runtimeWrittenAt = $RuntimeWrittenAt.ToString('o')
            runtime = $Runtime
            lifecycle = $Lifecycle
        }
    }
    catch { $null }
}

function Get-QuotaPinResumableRuntime(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [string]$AgentPath = ''
) {
    # Prefer a receipt that is also bound to the live installed Agent.  The
    # Agent can legitimately exit immediately before an install or updater
    # captures it, though, so that process is not the authority for whether the
    # already-running Codex session may be resumed.  The fallback still proves
    # the exact official Codex PID, creation time, loopback CDP port, app target,
    # and attachment generation through Get-QuotaPinTrustedRuntime.
    $Runtime = Get-QuotaPinTrustedRuntime -InstallRoot $InstallRoot -RequireAgent -AgentPath $AgentPath
    if ($Runtime) { return $Runtime }
    Get-QuotaPinTrustedRuntime -InstallRoot $InstallRoot
}

function Resume-QuotaPinTrustedRuntime(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)]$ExpectedRuntime,
    [string]$AgentPath = ''
) {
    if (-not $ExpectedRuntime) { return 'not-needed' }
    $ResolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    if (-not $AgentPath) { $AgentPath = Join-Path $ResolvedRoot 'QuotaPin.Agent.exe' }
    $ResolvedAgentPath = [IO.Path]::GetFullPath($AgentPath)
    $LogRoot = Join-Path $ResolvedRoot 'logs'
    $CurrentRuntime = Get-QuotaPinTrustedRuntime -InstallRoot $ResolvedRoot
    $SameRuntime = $CurrentRuntime -and
        [int]$CurrentRuntime.port -eq [int]$ExpectedRuntime.port -and
        [int]$CurrentRuntime.codexPid -eq [int]$ExpectedRuntime.codexPid -and
        [string]$CurrentRuntime.codexCreationTimeUtc -ceq [string]$ExpectedRuntime.codexCreationTimeUtc -and
        [string]$CurrentRuntime.generation -ceq [string]$ExpectedRuntime.generation
    if (-not $SameRuntime) { throw 'The verified Codex runtime changed while QuotaPin was updating.' }

    $ResumePort = [int]$CurrentRuntime.port
    $Endpoint = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}/json/list" -f $ResumePort) -TimeoutSec 2
    $Targets = $Endpoint.Content | ConvertFrom-Json
    if ($Endpoint.StatusCode -ne 200 -or -not @($Targets | Where-Object { [string]$_.url -ceq 'app://-/index.html' }).Count) {
        return 'next-launch'
    }

    . (Join-Path $ResolvedRoot 'src\codex-command.ps1')
    $env:QUOTAPIN_CODEX_COMMAND = Get-QuotaPinCodexCommand
    $ConfigPath = Join-Path $ResolvedRoot 'config.json'
    $AgentLogPath = Join-Path $LogRoot 'agent.log'
    $AgentArguments = '--port {0} --config "{1}" --log "{2}" --attach-generation {3}' -f $ResumePort, $ConfigPath, $AgentLogPath, [string]$CurrentRuntime.generation
    $ReplacementAgent = Start-Process -FilePath $ResolvedAgentPath -ArgumentList $AgentArguments -PassThru -WindowStyle Hidden
    $ReplacementStartedAt = [DateTimeOffset]::new($ReplacementAgent.StartTime.ToUniversalTime())
    . (Join-Path $ResolvedRoot 'src\lifecycle.ps1') -InstallRootOverride $ResolvedRoot
    $ReplacementRuntime = [ordered]@{
        schema = 2
        generation = [string]$CurrentRuntime.generation
        sourceCodexPid = [int]$CurrentRuntime.runtime.sourceCodexPid
        codexPid = [int]$CurrentRuntime.codexPid
        codexCreationTimeUtc = [string]$CurrentRuntime.codexCreationTimeUtc
        agentPid = [int]$ReplacementAgent.Id
        port = $ResumePort
        rendererAttached = $true
        writtenAt = [DateTimeOffset]::Now.ToString('o')
    }
    Write-QuotaPinJsonAtomic -Path (Join-Path $LogRoot 'runtime.json') -Value $ReplacementRuntime
    foreach ($Attempt in 1..60) {
        Start-Sleep -Milliseconds 250
        try {
            $Lifecycle = Get-Content -Raw -LiteralPath (Join-Path $LogRoot 'lifecycle.json') | ConvertFrom-Json
            if ([int]$Lifecycle.agentPid -eq $ReplacementAgent.Id -and [int]$Lifecycle.port -eq $ResumePort -and
                [int]$Lifecycle.codexPid -eq [int]$CurrentRuntime.codexPid -and
                [string]$Lifecycle.generation -ceq [string]$CurrentRuntime.generation -and
                $Lifecycle.state -eq 'quota-ready') { return 'quota-ready' }
        }
        catch {}
        if (-not (Get-Process -Id $ReplacementAgent.Id -ErrorAction SilentlyContinue)) { break }
    }
    # A timed-out replacement is not a trusted background runtime. Stop only
    # the exact process we launched (PID, image path, and creation time) so PID
    # reuse can never terminate an unrelated process.
    try {
        $UnreadyAgent = Get-Process -Id $ReplacementAgent.Id -ErrorAction Stop
        $UnreadyStartedAt = [DateTimeOffset]::new($UnreadyAgent.StartTime.ToUniversalTime())
        if ($UnreadyAgent.Path -and
            ([IO.Path]::GetFullPath($UnreadyAgent.Path)).Equals($ResolvedAgentPath, [StringComparison]::OrdinalIgnoreCase) -and
            [Math]::Abs(($UnreadyStartedAt - $ReplacementStartedAt).TotalSeconds) -le 2) {
            Stop-Process -Id $UnreadyAgent.Id -Force -ErrorAction Stop
        }
    }
    catch {}
    'next-launch'
}

function Get-QuotaPinSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Release file not found: $Path" }
    $Stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try {
        ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Hasher.Dispose()
        $Stream.Dispose()
    }
}

function Read-QuotaPinStrictChecksum([string]$Path, [string]$ExpectedName) {
    if ($ExpectedName -notmatch '^[A-Za-z0-9._-]+$') { throw 'The expected release filename is invalid.' }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -gt 4096) {
        throw "Release checksum is missing or oversized: $ExpectedName"
    }
    $Text = (Get-Content -Raw -LiteralPath $Path).Trim()
    $Match = [regex]::Match($Text, ('\A(?<hash>[0-9a-fA-F]{{64}})[ \t]+\*?{0}\z' -f [regex]::Escape($ExpectedName)))
    if (-not $Match.Success) { throw "Release checksum is invalid: $ExpectedName" }
    $Match.Groups['hash'].Value.ToLowerInvariant()
}

function Read-QuotaPinSha256Sums([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -gt 64KB) {
        throw 'SHA256SUMS is missing or oversized.'
    }
    $Result = @{}
    foreach ($RawLine in @(Get-Content -LiteralPath $Path)) {
        $Line = [string]$RawLine
        if (-not $Line.Trim()) { continue }
        $Match = [regex]::Match($Line, '\A(?<hash>[0-9a-fA-F]{64})  (?<name>[A-Za-z0-9._-]+)\z')
        if (-not $Match.Success) { throw "SHA256SUMS contains an invalid line: $Line" }
        $Name = $Match.Groups['name'].Value
        if ($Result.ContainsKey($Name)) { throw "SHA256SUMS contains a duplicate entry: $Name" }
        $Result[$Name] = $Match.Groups['hash'].Value.ToLowerInvariant()
    }
    $Result
}

function Get-QuotaPinManifestArtifact($Manifest, [string]$Name) {
    $Matches = @($Manifest.artifacts | Where-Object { [string]$_.name -ceq $Name })
    if ($Matches.Count -ne 1) { throw "Release manifest must contain exactly one $Name artifact." }
    $Artifact = $Matches[0]
    if ([string]$Artifact.sha256 -notmatch '^[0-9a-f]{64}$' -or [long]$Artifact.bytes -le 0) {
        throw "Release manifest artifact is invalid: $Name"
    }
    $Artifact
}

function Expand-QuotaPinReleaseBundle([string]$ArchivePath, [string]$ArchiveChecksumPath, [string]$DestinationRoot) {
    $ArchiveName = 'QuotaPin-Windows-x64.zip'
    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'QuotaPin release bundle is missing.' }
    $ArchiveLength = (Get-Item -LiteralPath $ArchivePath).Length
    if ($ArchiveLength -le 0 -or $ArchiveLength -gt 128MB) { throw 'QuotaPin release bundle has an invalid size.' }
    $ArchiveHash = Get-QuotaPinSha256 $ArchivePath
    if ((Read-QuotaPinStrictChecksum $ArchiveChecksumPath $ArchiveName) -cne $ArchiveHash) {
        throw 'QuotaPin release bundle checksum does not match.'
    }
    $MaximumBytes = @{
        'QuotaPin.Agent.exe' = 128MB
        'QuotaPin.Agent.exe.sha256' = 4096
        'THIRD_PARTY_NOTICES.txt' = 2MB
        'THIRD_PARTY_NOTICES.txt.sha256' = 4096
        'OFFICIAL_SOURCE.txt' = 64KB
        'origin.json' = 256KB
        'QuotaPin.spdx.json' = 2MB
        'QuotaPin-release.json' = 256KB
        'QuotaPin-release.json.sha256' = 4096
        'SHA256SUMS' = 64KB
        'LICENSE' = 1MB
    }
    if (Test-Path -LiteralPath $DestinationRoot) {
        if (@(Get-ChildItem -LiteralPath $DestinationRoot -Force).Count) { throw 'QuotaPin release extraction directory must be empty.' }
    }
    else { New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $Entries = @($Archive.Entries)
        if ($Entries.Count -ne $MaximumBytes.Count) { throw 'QuotaPin release bundle contains an unexpected number of files.' }
        $Seen = @{}
        foreach ($Entry in $Entries) {
            $Name = [string]$Entry.FullName
            $ExactName = @($MaximumBytes.Keys | Where-Object { [string]$_ -ceq $Name }).Count -eq 1
            $AlreadySeen = @($Seen.Keys | Where-Object { [string]$_ -ceq $Name }).Count -gt 0
            if (-not $ExactName -or $AlreadySeen -or $Name -cne [IO.Path]::GetFileName($Name)) {
                throw "QuotaPin release bundle contains an unexpected file: $Name"
            }
            if ([long]$Entry.Length -le 0 -or [long]$Entry.Length -gt [long]$MaximumBytes[$Name]) {
                throw "QuotaPin release bundle contains an invalid file size: $Name"
            }
            $Seen[$Name] = $true
        }
        foreach ($Name in $MaximumBytes.Keys) {
            if (-not $Seen.ContainsKey($Name)) { throw "QuotaPin release bundle is missing: $Name" }
        }
        foreach ($Entry in $Entries) {
            [IO.Compression.ZipFileExtensions]::ExtractToFile($Entry, (Join-Path $DestinationRoot ([string]$Entry.FullName)), $false)
        }
    }
    finally { $Archive.Dispose() }
    foreach ($Name in $MaximumBytes.Keys) {
        if (-not (Test-Path -LiteralPath (Join-Path $DestinationRoot $Name) -PathType Leaf)) {
            throw "QuotaPin release bundle extraction failed: $Name"
        }
    }
    $ArchiveHash
}

function Test-QuotaPinReleaseTrustBundle(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$ManifestChecksumPath,
    [Parameter(Mandatory = $true)][string]$Sha256SumsPath,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$AgentChecksumPath,
    [Parameter(Mandatory = $true)][string]$NoticesPath,
    [Parameter(Mandatory = $true)][string]$NoticesChecksumPath
) {
    if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
        throw 'The requested release version is invalid.'
    }
    if ((Get-Item -LiteralPath $ManifestPath).Length -gt 256KB) { throw 'The release manifest is oversized.' }
    $ManifestHash = Get-QuotaPinSha256 $ManifestPath
    if ((Read-QuotaPinStrictChecksum $ManifestChecksumPath 'QuotaPin-release.json') -cne $ManifestHash) {
        throw 'The release manifest checksum does not match.'
    }
    try { $Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json }
    catch { throw 'The release manifest is not valid JSON.' }
    $WorkflowRunId = [string]$Manifest.build.workflowRunId
    if ([string]$Manifest.schemaVersion -cne 'quotapin-release/v1' -or
        [string]$Manifest.product -cne 'QuotaPin' -or
        [string]$Manifest.installMode -cne 'command' -or
        [string]$Manifest.version -cne $Version -or
        [string]$Manifest.source.repository -cne 'https://github.com/WSL043/QuotaPin-for-Codex' -or
        [string]$Manifest.source.tag -cne ("v$Version") -or
        [string]$Manifest.source.commit -notmatch '^[0-9a-f]{40}$' -or
        $Manifest.source.dirty -ne $false -or
        [string]$Manifest.build.context -cne 'github-release-workflow' -or
        $WorkflowRunId -notmatch '^[1-9]\d*$') {
        throw 'The release manifest identity or source provenance is invalid.'
    }

    $AgentHash = Get-QuotaPinSha256 $AgentPath
    $NoticesHash = Get-QuotaPinSha256 $NoticesPath
    if ((Read-QuotaPinStrictChecksum $AgentChecksumPath 'QuotaPin.Agent.exe') -cne $AgentHash) {
        throw 'The Agent checksum does not match.'
    }
    if ((Read-QuotaPinStrictChecksum $NoticesChecksumPath 'THIRD_PARTY_NOTICES.txt') -cne $NoticesHash) {
        throw 'The notices checksum does not match.'
    }
    $Sums = Read-QuotaPinSha256Sums $Sha256SumsPath
    foreach ($Expected in @{
        'QuotaPin-release.json' = $ManifestHash
        'QuotaPin.Agent.exe' = $AgentHash
        'THIRD_PARTY_NOTICES.txt' = $NoticesHash
    }.GetEnumerator()) {
        if (-not $Sums.ContainsKey($Expected.Key) -or [string]$Sums[$Expected.Key] -cne [string]$Expected.Value) {
            throw "SHA256SUMS does not match $($Expected.Key)."
        }
    }

    $AgentArtifact = Get-QuotaPinManifestArtifact $Manifest 'QuotaPin.Agent.exe'
    $NoticesArtifact = Get-QuotaPinManifestArtifact $Manifest 'THIRD_PARTY_NOTICES.txt'
    if ([string]$AgentArtifact.sha256 -cne $AgentHash -or [long]$AgentArtifact.bytes -ne (Get-Item -LiteralPath $AgentPath).Length) {
        throw 'The release manifest Agent entry does not match the download.'
    }
    if ([string]$NoticesArtifact.sha256 -cne $NoticesHash -or [long]$NoticesArtifact.bytes -ne (Get-Item -LiteralPath $NoticesPath).Length) {
        throw 'The release manifest notices entry does not match the download.'
    }

    [pscustomobject]@{
        schema = 1
        version = $Version
        tag = [string]$Manifest.source.tag
        commit = [string]$Manifest.source.commit
        agentSha256 = $AgentHash
        noticesSha256 = $NoticesHash
        manifestSha256 = $ManifestHash
    }
}
