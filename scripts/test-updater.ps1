$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$Compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$OutputRoot = Join-Path $RepositoryRoot 'dist\tests'
$Output = Join-Path $OutputRoot 'QuotaPin.Updater.Tests.exe'
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

& $Compiler /nologo /target:exe /optimize+ /platform:x64 "/out:$Output" `
    /reference:System.dll /reference:System.Core.dll /reference:System.Web.Extensions.dll `
    (Join-Path $RepositoryRoot 'src\tray\Updater.cs') `
    (Join-Path $RepositoryRoot 'test\updater.test.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Output)) { throw 'QuotaPin updater tests failed to compile.' }
& $Output
if ($LASTEXITCODE -ne 0) { throw "QuotaPin updater tests failed with exit code $LASTEXITCODE" }
