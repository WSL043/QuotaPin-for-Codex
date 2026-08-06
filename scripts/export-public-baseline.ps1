param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [ValidateSet('stable', 'beta')]
    [string]$Channel = 'stable'
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$DestinationPath = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
$RepositoryPath = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
if ($DestinationPath.Equals($RepositoryPath, [StringComparison]::OrdinalIgnoreCase) -or $DestinationPath.StartsWith($RepositoryPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The public baseline destination must be outside the source checkout.'
}
if (Test-Path -LiteralPath $DestinationPath) {
    throw "The public baseline destination already exists: $DestinationPath"
}
$Dirty = @(& git -C $RepositoryPath status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $Dirty.Count) { throw 'Export requires a clean private main checkout.' }
if ((& git -C $RepositoryPath branch --show-current).Trim() -cne 'main') { throw 'Export requires the accepted main branch.' }

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-public-export-' + [Guid]::NewGuid().ToString('N'))
$ArchivePath = Join-Path $TempRoot 'source.zip'
try {
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    & git -C $RepositoryPath archive --format=zip --output=$ArchivePath HEAD
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force
    $ChannelGate = if ($Channel -ceq 'stable') { '--require-stable' } else { '--require-beta' }
    & node (Join-Path $DestinationPath 'scripts\check-public-baseline.mjs') --root $DestinationPath $ChannelGate
    if ($LASTEXITCODE -ne 0) { throw 'The exported public baseline did not pass its source gate.' }
    Write-Output "Clean public source exported to $DestinationPath"
}
catch {
    if (Test-Path -LiteralPath $DestinationPath) {
        Write-Warning "The incomplete export was left for inspection: $DestinationPath"
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
