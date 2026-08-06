param(
    [ValidateSet('Stamp', 'Manifest')]
    [string]$Phase = 'Manifest'
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$OutputRoot = Join-Path $RepositoryRoot 'dist'
$Version = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'VERSION')).Trim()
if ($Version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$') {
    throw "VERSION is not a supported semantic version: $Version"
}
$RepositoryUrl = 'https://github.com/WSL043/QuotaPin-for-Codex'
$SupportUrl = 'https://github.com/WSL043/QuotaPin-for-Codex/issues'
$ReleasesUrl = 'https://github.com/WSL043/QuotaPin-for-Codex/releases'
$Commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Commit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve the source commit.' }

function Get-Sha256([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        ([BitConverter]::ToString($Algorithm.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Algorithm.Dispose()
        $Stream.Dispose()
    }
}

function Get-BytesSha256([byte[]]$Value) {
    $Algorithm = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($Algorithm.ComputeHash($Value))).Replace('-', '').ToLowerInvariant() }
    finally { $Algorithm.Dispose() }
}

function Write-Utf8Json([string]$Path, $Value, [int]$Depth = 12) {
    $Json = $Value | ConvertTo-Json -Depth $Depth
    [IO.File]::WriteAllText($Path, ($Json + "`n"), [Text.UTF8Encoding]::new($false))
}

function Import-BuildSecurityModule {
    # npm can inherit a PowerShell 7 module path even when this script runs in
    # Windows PowerShell 5.1. Import the module that belongs to this host
    # explicitly so signature inspection never depends on module auto-loading.
    $ModulePath = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
    if (-not (Test-Path -LiteralPath $ModulePath)) {
        throw "Authenticode inspection module was not found for this PowerShell host: $ModulePath"
    }
    Import-Module -Name $ModulePath -ErrorAction Stop
    if (-not (Get-Command 'Microsoft.PowerShell.Security\Get-AuthenticodeSignature' -ErrorAction SilentlyContinue)) {
        throw 'Authenticode inspection is unavailable; release metadata cannot be trusted.'
    }
}

function Get-AuthenticodeRecord([string]$Path) {
    $Signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $Path
    $CertificateSha256 = $null
    $Subject = $null
    if ($Signature.SignerCertificate) {
        $Subject = [string]$Signature.SignerCertificate.Subject
        $CertificateSha256 = Get-BytesSha256 $Signature.SignerCertificate.RawData
    }
    [ordered]@{
        status = [string]$Signature.Status
        subject = $Subject
        certificateSha256 = $CertificateSha256
        timeStamper = if ($Signature.TimeStamperCertificate) { [string]$Signature.TimeStamperCertificate.Subject } else { $null }
    }
}

function Get-TrustedCertificatePins {
    $UpdaterPath = Join-Path $RepositoryRoot 'src\tray\Updater.cs'
    $Source = Get-Content -Raw -LiteralPath $UpdaterPath
    $Block = [regex]::Match($Source, '(?s)TRUSTED_CERTIFICATE_SHA256_BEGIN(?<pins>.*?)TRUSTED_CERTIFICATE_SHA256_END')
    if (-not $Block.Success) { throw 'Updater trust-pin markers were not found.' }
    @([regex]::Matches($Block.Groups['pins'].Value, '"(?<hash>[0-9a-fA-F]{64})"') | ForEach-Object {
        $_.Groups['hash'].Value.ToLowerInvariant()
    } | Select-Object -Unique)
}

function Get-ReleaseArtifact([string]$Name) {
    $Path = if ($Name -eq 'LICENSE') { Join-Path $RepositoryRoot $Name } else { Join-Path $OutputRoot $Name }
    if (-not (Test-Path -LiteralPath $Path)) { throw "Release artifact not found: $Path" }
    $Record = [ordered]@{
        name = $Name
        bytes = (Get-Item -LiteralPath $Path).Length
        sha256 = Get-Sha256 $Path
    }
    if ([IO.Path]::GetExtension($Name) -eq '.exe') { $Record.authenticode = Get-AuthenticodeRecord $Path }
    $Record
}

if ($Phase -eq 'Stamp') {
    $Rcedit = Join-Path $RepositoryRoot 'node_modules\rcedit\bin\rcedit-x64.exe'
    if (-not (Test-Path -LiteralPath $Rcedit)) { throw "Release metadata tool not found: $Rcedit" }
    $SourceUrl = "$RepositoryUrl/commit/$Commit"
    $AgentPath = Join-Path $OutputRoot 'QuotaPin.Agent.exe'
    if (-not (Test-Path -LiteralPath $AgentPath)) { throw "Release binary not found: $AgentPath" }
    $AgentSha256 = Get-Sha256 $AgentPath
    $Origin = [ordered]@{
        schemaVersion = 'quotapin-origin-file/v1'
        product = 'QuotaPin'
        version = $Version
        license = 'MIT'
        freeOpenSource = $true
        repository = $RepositoryUrl
        support = $SupportUrl
        releases = $ReleasesUrl
        commit = $Commit
        source = $SourceUrl
        artifact = [ordered]@{
            name = 'QuotaPin.Agent.exe'
            sha256 = $AgentSha256
        }
        verification = [ordered]@{
            releaseManifest = 'QuotaPin-release.json'
            checksums = 'SHA256SUMS'
            githubAttestationRepository = 'WSL043/QuotaPin-for-Codex'
        }
    }
    Write-Utf8Json (Join-Path $OutputRoot 'origin.json') $Origin
    $OfficialSource = @"
QuotaPin is free and open source under the MIT license.

Official project: $RepositoryUrl
Official releases: $ReleasesUrl
Official support: $SupportUrl

Installed version: $Version
Source commit: $Commit
Source snapshot: $SourceUrl
QuotaPin.Agent.exe SHA-256: $AgentSha256

For an official build, compare the version, commit, and SHA-256 with the files
and GitHub artifact attestation published by the official project. If a third
party charged you, confirm what service they sold; the official source itself
is available without charge from the project above.
"@
    [IO.File]::WriteAllText((Join-Path $OutputRoot 'OFFICIAL_SOURCE.txt'), ($OfficialSource.Trim() + "`r`n"), [Text.UTF8Encoding]::new($false))
    foreach ($Name in @('QuotaPin.Tray.exe')) {
        $Path = Join-Path $OutputRoot $Name
        if (-not (Test-Path -LiteralPath $Path)) { throw "Release binary not found: $Path" }
        & $Rcedit $Path `
            --set-file-version $Version `
            --set-product-version $Version `
            --set-version-string ProductName 'QuotaPin' `
            --set-version-string FileDescription "QuotaPin | $RepositoryUrl" `
            --set-version-string CompanyName 'QuotaPin contributors' `
            --set-version-string LegalCopyright 'Copyright (c) 2026 WSL043' `
            --set-version-string Comments "Official source: $RepositoryUrl | Support: $SupportUrl | Source: $SourceUrl" `
            --set-version-string ProductVersion $Version `
            --set-version-string OriginalFilename $Name
        if ($LASTEXITCODE -ne 0) { throw "Could not stamp release metadata on $Name" }
    }
    Write-Output "Stamped release origin metadata for $Commit"
    exit 0
}

Import-BuildSecurityModule

$Required = @('QuotaPin-Setup.exe', 'QuotaPin.Agent.exe', 'QuotaPin.Tray.exe', 'THIRD_PARTY_NOTICES.txt', 'OFFICIAL_SOURCE.txt', 'origin.json')
foreach ($Name in $Required) {
    if (-not (Test-Path -LiteralPath (Join-Path $OutputRoot $Name))) { throw "Release artifact not found: $Name" }
}

$CreatedAt = [DateTimeOffset]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
$SourceDirty = @(& git -C $RepositoryRoot status --porcelain).Count -gt 0
$NodeVersion = (& node --version).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^\d+\.\d+\.\d+') { throw 'Could not resolve the Node.js build version.' }
$Package = Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'package.json') | ConvertFrom-Json
$PackageLockPath = Join-Path $RepositoryRoot 'package-lock.json'
if (-not (Test-Path -LiteralPath $PackageLockPath)) { throw 'package-lock.json was not found.' }
$BuildDependencies = @()
foreach ($Property in $Package.devDependencies.PSObject.Properties | Sort-Object Name) {
    $BuildDependencies += [ordered]@{ name = [string]$Property.Name; version = [string]$Property.Value }
}
$Tag = if ($env:GITHUB_REF_TYPE -eq 'tag' -and $env:GITHUB_REF_NAME) { [string]$env:GITHUB_REF_NAME } else { "v$Version" }
$OfficialWorkflow = $env:GITHUB_REPOSITORY -eq 'WSL043/QuotaPin-for-Codex' -and $env:GITHUB_REF_TYPE -eq 'tag' -and $Tag -eq "v$Version"

$SpdxPath = Join-Path $OutputRoot 'QuotaPin.spdx.json'
$Spdx = [ordered]@{
    spdxVersion = 'SPDX-2.3'
    dataLicense = 'CC0-1.0'
    SPDXID = 'SPDXRef-DOCUMENT'
    name = "QuotaPin-$Version"
    documentNamespace = "$RepositoryUrl/spdx/$Version/$Commit"
    creationInfo = [ordered]@{
        created = $CreatedAt
        creators = @('Tool: QuotaPin build-release-metadata.ps1')
    }
    packages = @(
        [ordered]@{
            name = 'QuotaPin'
            SPDXID = 'SPDXRef-Package-QuotaPin'
            versionInfo = $Version
            downloadLocation = "$RepositoryUrl/tree/$Tag"
            filesAnalyzed = $false
            licenseConcluded = 'MIT'
            licenseDeclared = 'MIT'
            copyrightText = 'Copyright (c) 2026 WSL043'
        },
        [ordered]@{
            name = 'Node.js'
            SPDXID = 'SPDXRef-Package-NodeJS'
            versionInfo = $NodeVersion
            downloadLocation = "https://github.com/nodejs/node/tree/v$NodeVersion"
            filesAnalyzed = $false
            licenseConcluded = 'MIT'
            licenseDeclared = 'MIT'
            copyrightText = 'Copyright Node.js contributors'
        }
    )
    relationships = @(
        [ordered]@{ spdxElementId = 'SPDXRef-DOCUMENT'; relationshipType = 'DESCRIBES'; relatedSpdxElement = 'SPDXRef-Package-QuotaPin' },
        [ordered]@{ spdxElementId = 'SPDXRef-Package-QuotaPin'; relationshipType = 'CONTAINS'; relatedSpdxElement = 'SPDXRef-Package-NodeJS' }
    )
}
Write-Utf8Json $SpdxPath $Spdx

$Artifacts = @(
    (Get-ReleaseArtifact 'QuotaPin-Setup.exe'),
    (Get-ReleaseArtifact 'QuotaPin.Agent.exe'),
    (Get-ReleaseArtifact 'QuotaPin.Tray.exe'),
    (Get-ReleaseArtifact 'THIRD_PARTY_NOTICES.txt'),
    (Get-ReleaseArtifact 'OFFICIAL_SOURCE.txt'),
    (Get-ReleaseArtifact 'origin.json')
)
$Setup = @($Artifacts | Where-Object { $_.name -eq 'QuotaPin-Setup.exe' })[0]
$TrustedPins = @(Get-TrustedCertificatePins)
$SetupCertificate = [string]$Setup.authenticode.certificateSha256
$SetupSignatureMatchesUpdater = (
    $Setup.authenticode.status -eq 'Valid' -and
    $SetupCertificate -and
    $TrustedPins -contains $SetupCertificate.ToLowerInvariant()
)

$ManifestPath = Join-Path $OutputRoot 'QuotaPin-release.json'
$Manifest = [ordered]@{
    schemaVersion = 'quotapin-release/v1'
    product = 'QuotaPin'
    version = $Version
    source = [ordered]@{
        repository = $RepositoryUrl
        commit = $Commit
        tag = $Tag
        dirty = $SourceDirty
    }
    build = [ordered]@{
        createdAt = $CreatedAt
        context = if ($OfficialWorkflow) { 'github-release-workflow' } else { 'local-or-untrusted-workflow' }
        workflowRunId = if ($env:GITHUB_RUN_ID) { [string]$env:GITHUB_RUN_ID } else { $null }
        node = $NodeVersion
        innoSetup = if ($env:QUOTAPIN_INNO_VERSION) { [string]$env:QUOTAPIN_INNO_VERSION } else { 'unrecorded' }
        packageLockSha256 = Get-Sha256 $PackageLockPath
        dependencies = $BuildDependencies
    }
    trust = [ordered]@{
        authenticodeRequiredForAutomaticUpdate = $true
        trustedCertificatePinsConfigured = $TrustedPins.Count -gt 0
        setupCertificateSha256 = if ($SetupSignatureMatchesUpdater) { $SetupCertificate.ToLowerInvariant() } else { $null }
        autoUpdateEligible = [bool]$SetupSignatureMatchesUpdater
    }
    artifacts = $Artifacts
    sbom = [ordered]@{
        format = 'SPDX-2.3'
        name = 'QuotaPin.spdx.json'
        sha256 = Get-Sha256 $SpdxPath
    }
}
Write-Utf8Json $ManifestPath $Manifest

$ManifestHash = Get-Sha256 $ManifestPath
[IO.File]::WriteAllText(($ManifestPath + '.sha256'), "$ManifestHash  QuotaPin-release.json`r`n", [Text.Encoding]::ASCII)

Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'LICENSE') -Destination (Join-Path $OutputRoot 'LICENSE') -Force

$ChecksumNames = @(
    'QuotaPin-Setup.exe',
    'QuotaPin.Agent.exe',
    'THIRD_PARTY_NOTICES.txt',
    'OFFICIAL_SOURCE.txt',
    'origin.json',
    'QuotaPin-release.json',
    'QuotaPin.spdx.json',
    'LICENSE'
)
$ChecksumLines = foreach ($Name in $ChecksumNames) {
    $Path = Join-Path $OutputRoot $Name
    '{0}  {1}' -f (Get-Sha256 $Path), $Name
}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'SHA256SUMS'), (($ChecksumLines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)

[pscustomobject]@{
    version = $Version
    commit = $Commit
    manifest = $ManifestPath
    sbom = $SpdxPath
    autoUpdateEligible = [bool]$SetupSignatureMatchesUpdater
} | ConvertTo-Json -Compress
