param([string]$InstallRoot = '')

$ErrorActionPreference = 'Stop'
$Version = '6.7.1'
$ExpectedSha256 = '4d11e8050b6185e0d49bd9e8cc661a7a59f44959a621d31d11033124c4e8a7b0'
$RunnerTemp = if ($env:RUNNER_TEMP) { [IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { [IO.Path]::GetFullPath([IO.Path]::GetTempPath()) }
if (-not $InstallRoot) { $InstallRoot = Join-Path $RunnerTemp "QuotaPin-Inno-Setup-$Version" }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DownloadRoot = Join-Path $RunnerTemp 'QuotaPin-ci-downloads'
$DownloadPath = Join-Path $DownloadRoot "innosetup-$Version.exe"

New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null
& (Join-Path $env:SystemRoot 'System32\curl.exe') --fail --location --show-error --silent `
    --output $DownloadPath `
    "https://github.com/jrsoftware/issrc/releases/download/is-6_7_1/innosetup-$Version.exe"
if ($LASTEXITCODE -ne 0) { throw 'Could not download the pinned Inno Setup compiler.' }

$ActualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $DownloadPath).Hash.ToLowerInvariant()
if ($ActualSha256 -cne $ExpectedSha256) { throw "Inno Setup digest mismatch: $ActualSha256" }
$Signature = Get-AuthenticodeSignature -LiteralPath $DownloadPath
$Publisher = [string]$Signature.SignerCertificate.Subject
if ($Signature.Status -ne 'Valid' -or $Publisher -notmatch 'Pyrsys B\.V\.') {
    throw "Inno Setup signature is not trusted: $($Signature.Status) $Publisher"
}

$Process = Start-Process -FilePath $DownloadPath -ArgumentList @(
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/CURRENTUSER',
    ("/DIR=`"{0}`"" -f $InstallRoot)
) -PassThru
try {
    $Process.WaitForExit()
    if ($Process.ExitCode -ne 0) { throw "Inno Setup install failed with code $($Process.ExitCode)." }
}
finally { $Process.Dispose() }

$IsccPath = Join-Path $InstallRoot 'ISCC.exe'
if (-not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw "ISCC.exe was not installed: $IsccPath" }
if ($env:GITHUB_ENV) {
    "QUOTAPIN_ISCC_PATH=$IsccPath" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
    "QUOTAPIN_INNO_VERSION=$Version" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}

[pscustomobject]@{
    version = $Version
    iscc = $IsccPath
    installerSha256 = $ActualSha256
    publisher = $Publisher
} | ConvertTo-Json -Compress
