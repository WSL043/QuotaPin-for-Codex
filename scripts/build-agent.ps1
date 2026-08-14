param(
    [string]$NodePath = (Get-Command 'node.exe' -ErrorAction Stop).Source
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$OutputRoot = Join-Path $RepositoryRoot 'dist'
$BuildRoot = Join-Path $OutputRoot 'agent-build'
$BundlePath = Join-Path $BuildRoot 'quotapin-agent.cjs'
$SeaConfigPath = Join-Path $BuildRoot 'sea-config.json'
$BlobPath = Join-Path $BuildRoot 'quotapin-agent.blob'
$OutputPath = Join-Path $OutputRoot 'QuotaPin.Agent.exe'
$NoticesPath = Join-Path $OutputRoot 'THIRD_PARTY_NOTICES.txt'
$Version = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'VERSION')).Trim()
$Commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Commit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve the source commit.' }
$SourceUrl = "https://github.com/WSL043/QuotaPin-for-Codex/commit/$Commit"
$OfficialProjectUrl = 'https://github.com/WSL043/QuotaPin-for-Codex'
$OfficialSupportUrl = 'https://github.com/WSL043/QuotaPin-for-Codex/issues'
$Esbuild = Join-Path $RepositoryRoot 'node_modules\.bin\esbuild.cmd'
$Postject = Join-Path $RepositoryRoot 'node_modules\.bin\postject.cmd'
$Rcedit = Join-Path $RepositoryRoot 'node_modules\rcedit\bin\rcedit-x64.exe'
$Icon = Join-Path $RepositoryRoot 'assets\quotapin.ico'

foreach ($Required in @($NodePath, $Esbuild, $Postject, $Rcedit, $Icon)) {
    if (-not (Test-Path -LiteralPath $Required)) { throw "Agent build prerequisite not found: $Required" }
}

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
& $Esbuild (Join-Path $RepositoryRoot 'src\injector.mjs') --bundle --platform=node --format=cjs --target=node22 --outfile=$BundlePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BundlePath)) { throw 'Agent bundle failed.' }
$BundleText = [IO.File]::ReadAllText($BundlePath)
$CommitToken = '__QUOTAPIN_BUILD_COMMIT__'
if ([regex]::Matches($BundleText, [regex]::Escape($CommitToken)).Count -ne 1) {
    throw 'Agent bundle does not contain exactly one build-origin commit token.'
}
[IO.File]::WriteAllText($BundlePath, $BundleText.Replace($CommitToken, $Commit), [Text.UTF8Encoding]::new($false))

$SeaConfig = [ordered]@{
    main = $BundlePath
    output = $BlobPath
    disableExperimentalSEAWarning = $true
    useSnapshot = $false
    useCodeCache = $false
}
[IO.File]::WriteAllText($SeaConfigPath, ($SeaConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
& $NodePath --experimental-sea-config $SeaConfigPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $BlobPath)) { throw 'Agent SEA blob preparation failed.' }

$ExecutablePrepared = $false
foreach ($Attempt in 1..5) {
    try {
        # Start every attempt from a clean Node executable.  Metadata stamping
        # can wake a security scanner that briefly holds the file before SEA
        # injection; retrying a partially injected executable is not safe.
        Copy-Item -LiteralPath $NodePath -Destination $OutputPath -Force
        & $Rcedit $OutputPath --set-icon $Icon --set-file-version $Version --set-product-version $Version --set-version-string ProductName QuotaPin --set-version-string FileDescription "QuotaPin | $OfficialProjectUrl" --set-version-string CompanyName 'QuotaPin contributors' --set-version-string LegalCopyright 'Copyright (c) 2026 WSL043' --set-version-string Comments "Official source: $OfficialProjectUrl | Support: $OfficialSupportUrl | Source: $SourceUrl" --set-version-string OriginalFilename 'QuotaPin.Agent.exe'
        if ($LASTEXITCODE -ne 0) { throw 'Agent executable metadata update failed.' }

        & $Postject $OutputPath NODE_SEA_BLOB $BlobPath --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
        if ($LASTEXITCODE -ne 0) { throw 'Agent executable injection failed.' }
        $ExecutablePrepared = $true
        break
    }
    catch {
        if ($Attempt -eq 5) { throw }
        Start-Sleep -Milliseconds (250 * $Attempt)
    }
}
if (-not $ExecutablePrepared) { throw 'Agent executable preparation failed.' }

function Invoke-AgentProbe([string]$Argument) {
    foreach ($Attempt in 1..5) {
        $ProbeOutput = @(& $OutputPath $Argument 2>$null) | Select-Object -First 1
        $ProbeExitCode = $LASTEXITCODE
        if ($ProbeExitCode -eq 0 -and $ProbeOutput) { return ([string]$ProbeOutput).Trim() }
        if ($Attempt -lt 5) { Start-Sleep -Milliseconds 250 }
    }
    return $null
}

# Windows security scanners can briefly hold a newly stamped executable after
# its first launch. Keep the release gate strict, but give that transient lock a
# small bounded retry window instead of producing a false build failure.
$ReportedVersion = Invoke-AgentProbe '--agent-version'
if ($ReportedVersion -ne $Version) {
    throw "Built agent self-check failed. Expected $Version; found $ReportedVersion"
}
$OriginJson = Invoke-AgentProbe '--build-origin'
if (-not $OriginJson) { throw 'Built agent origin self-check failed.' }
$Origin = $OriginJson | ConvertFrom-Json
if ($Origin.schemaVersion -ne 'quotapin-origin/v1' -or
    $Origin.product -ne 'QuotaPin' -or
    $Origin.version -ne $Version -or
    $Origin.repository -ne 'https://github.com/WSL043/QuotaPin-for-Codex' -or
    $Origin.commit -ne $Commit) {
    throw 'Built agent origin metadata does not match the source checkout.'
}

$NodeVersion = ([Diagnostics.FileVersionInfo]::GetVersionInfo($NodePath).ProductVersion -split '-')[0]
if ($NodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Could not determine the Node.js version from $NodePath" }
$NodeLicenseUrl = "https://raw.githubusercontent.com/nodejs/node/v$NodeVersion/LICENSE"
$NodeLicense = $null
foreach ($Attempt in 1..4) {
    try {
        $NodeLicense = (Invoke-WebRequest -UseBasicParsing -Uri $NodeLicenseUrl -TimeoutSec 60).Content
        break
    }
    catch {
        if ($Attempt -eq 4) { throw }
        Start-Sleep -Seconds ([Math]::Min(8, [Math]::Pow(2, $Attempt)))
    }
}
if ($NodeLicense -notmatch 'Copyright Node\.js contributors' -or $NodeLicense -notmatch 'Permission is hereby granted') {
    throw "The Node.js license response for $NodeVersion was not recognized"
}
$NoticeHeader = @"
QuotaPin third-party notices

QuotaPin.Agent.exe embeds Node.js $NodeVersion.
Source and license: https://github.com/nodejs/node/tree/v$NodeVersion

The upstream Node.js license and bundled dependency notices follow unchanged.

"@
[IO.File]::WriteAllText($NoticesPath, ($NoticeHeader + $NodeLicense), [Text.UTF8Encoding]::new($false))
Write-Output $OutputPath
