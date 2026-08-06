param([string]$IsccPath)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$OutputRoot = Join-Path $RepositoryRoot 'dist'
$Version = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'VERSION')).Trim()

if (-not $IsccPath) {
    $Candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    )
    $IsccPath = $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath)) { throw 'Inno Setup 6 compiler was not found.' }

foreach ($Required in @('QuotaPin.Agent.exe', 'QuotaPin.Tray.exe', 'THIRD_PARTY_NOTICES.txt')) {
    $Path = Join-Path $OutputRoot $Required
    if (-not (Test-Path -LiteralPath $Path)) { throw "Release input not found: $Path" }
}

& (Join-Path $PSScriptRoot 'build-release-metadata.ps1') -Phase Stamp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $IsccPath "/DMyAppVersion=$Version" (Join-Path $RepositoryRoot 'installer\QuotaPin.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }

$SetupPath = Join-Path $OutputRoot 'QuotaPin-Setup.exe'
$ProductVersion = ([string](Get-Item -LiteralPath $SetupPath).VersionInfo.ProductVersion).Trim()
if ($ProductVersion -ne $Version) { throw "Setup version mismatch. Expected $Version; found $ProductVersion" }

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

foreach ($Name in @('QuotaPin-Setup.exe', 'QuotaPin.Agent.exe', 'THIRD_PARTY_NOTICES.txt')) {
    $Path = Join-Path $OutputRoot $Name
    $Hash = Get-Sha256 $Path
    [IO.File]::WriteAllText(($Path + '.sha256'), "$Hash  $Name`r`n", [Text.Encoding]::ASCII)
}

[pscustomobject]@{
    version = $Version
    setup = $SetupPath
    setupBytes = (Get-Item -LiteralPath $SetupPath).Length
} | ConvertTo-Json -Compress
