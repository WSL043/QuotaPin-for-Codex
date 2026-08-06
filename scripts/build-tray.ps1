$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$Compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$Sources = @(
    (Join-Path $RepositoryRoot 'src\tray\Program.cs'),
    (Join-Path $RepositoryRoot 'src\tray\Updater.cs')
)
$Icon = Join-Path $RepositoryRoot 'assets\quotapin.ico'
$OutputRoot = Join-Path $RepositoryRoot 'dist'
$Output = Join-Path $OutputRoot 'QuotaPin.Tray.exe'

if (-not (Test-Path -LiteralPath $Compiler)) { throw "C# compiler not found: $Compiler" }
foreach ($Source in $Sources) {
    if (-not (Test-Path -LiteralPath $Source)) { throw "Tray source not found: $Source" }
}
if (-not (Test-Path -LiteralPath $Icon)) { throw "Tray icon not found: $Icon" }
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

& $Compiler /nologo /target:winexe /optimize+ /platform:x64 "/win32icon:$Icon" "/out:$Output" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll $Sources
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output)) { throw 'QuotaPin tray build failed.' }
Write-Output $Output
