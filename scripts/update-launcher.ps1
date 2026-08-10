param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'QuotaPin')
)

$ErrorActionPreference = 'Stop'
$VersionPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
if ($Version -notmatch $VersionPattern) { throw 'QuotaPin update version is invalid.' }

$ResolvedRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$UpdaterPath = Join-Path $ResolvedRoot 'update.ps1'
$ResultPath = Join-Path $ResolvedRoot 'logs\update-result.json'
$LogPath = Join-Path $ResolvedRoot 'logs\update-launch.log'
$PowerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $UpdaterPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $PowerShellPath -PathType Leaf)) {
    throw 'QuotaPin update components are unavailable.'
}

function Write-QuotaPinUpdateLaunchLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
        Add-Content -LiteralPath $LogPath -Value ('{0:o} {1}' -f (Get-Date), ($Message -replace '[\r\n]+', ' '))
    }
    catch {}
}

$LaunchedAt = [DateTimeOffset]::Now
$Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Version "{1}"' -f $UpdaterPath, $Version
$Updater = $null
try {
    # A detached PowerShell child created directly by Node on Windows can exit
    # successfully before evaluating -File.  Start it from this short-lived,
    # attached PowerShell host instead, then prove that the updater published a
    # fresh receipt before handing lifecycle ownership back to the Agent.
    $Updater = Start-Process -FilePath $PowerShellPath -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    Write-QuotaPinUpdateLaunchLog ("spawned version={0} pid={1}" -f $Version, $Updater.Id)
    $Deadline = [DateTimeOffset]::Now.AddSeconds(15)
    do {
        if (Test-Path -LiteralPath $ResultPath -PathType Leaf) {
            $Receipt = $null
            try {
                $Receipt = Get-Content -Raw -LiteralPath $ResultPath | ConvertFrom-Json
            }
            catch {}
            if ($Receipt) {
                try { $WrittenAt = [DateTimeOffset]::Parse([string]$Receipt.writtenAt) }
                catch { $WrittenAt = [DateTimeOffset]::MinValue }
                if ([int]$Receipt.schema -in @(1, 2) -and
                    [string]$Receipt.version -ceq $Version -and
                    [string]$Receipt.status -in @('started', 'succeeded', 'degraded') -and
                    $WrittenAt -ge $LaunchedAt.AddSeconds(-1) -and
                    $WrittenAt -le [DateTimeOffset]::Now.AddMinutes(5)) {
                    Write-QuotaPinUpdateLaunchLog ("accepted version={0} pid={1} status={2}" -f $Version, $Updater.Id, [string]$Receipt.status)
                    exit 0
                }
                if ([int]$Receipt.schema -in @(1, 2) -and
                    [string]$Receipt.version -ceq $Version -and
                    [string]$Receipt.status -in @('failed', 'rolled-back', 'rollback-failed') -and
                    $WrittenAt -ge $LaunchedAt.AddSeconds(-1)) {
                    throw 'QuotaPin updater reported a terminal failure before launch handoff.'
                }
            }
        }
        $Updater.Refresh()
        if ($Updater.HasExited) {
            throw ('QuotaPin updater exited before publishing its launch receipt (exit {0}).' -f $Updater.ExitCode)
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTimeOffset]::Now -lt $Deadline)
    throw 'QuotaPin updater did not publish its launch receipt in time.'
}
catch {
    Write-QuotaPinUpdateLaunchLog ("failed version={0} code={1}" -f $Version, $_.Exception.GetType().Name)
    throw
}
finally {
    if ($Updater) { $Updater.Dispose() }
}
