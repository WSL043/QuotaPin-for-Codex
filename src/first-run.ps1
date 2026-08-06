$ErrorActionPreference = 'Stop'

$InstallRoot = Split-Path -Parent $PSScriptRoot
$UiScript = Join-Path $PSScriptRoot 'ui.ps1'
$LaunchScript = Join-Path $PSScriptRoot 'launch.ps1'
$RuntimePath = Join-Path $InstallRoot 'logs\runtime.json'
$LifecyclePath = Join-Path $InstallRoot 'logs\lifecycle.json'
$TrayIcon = Join-Path $InstallRoot 'QuotaPin.Tray.exe'
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $UiScript) -or -not (Test-Path -LiteralPath $LaunchScript)) { exit 0 }
. $UiScript

function Get-OfficialRunningCodex {
    try {
        $Package = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction Stop
        $Root = [IO.Path]::GetFullPath($Package.InstallLocation).TrimEnd('\') + '\'
        @(Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) }
            catch { $false }
        })
    }
    catch { @() }
}

function Test-PreparedCodexEndpoint {
    if (-not (Test-Path -LiteralPath $RuntimePath -PathType Leaf)) { return $false }
    try {
        $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
        $Port = [int]$Runtime.port
        $CodexPid = [int]$Runtime.codexPid
        if ($Port -lt 1024 -or $Port -gt 65535 -or -not (Get-Process -Id $CodexPid -ErrorAction Stop)) { return $false }
        $Targets = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 1 -Proxy $null
        return [bool](@($Targets | Where-Object { $_.url -eq 'app://-/index.html' }).Count)
    }
    catch { return $false }
}

$RunningCodex = @(Get-OfficialRunningCodex)
if (-not $RunningCodex.Count) { exit 0 }

# Give the tray a short, bounded window to resume a previously prepared Codex.
foreach ($Attempt in 1..20) {
    if (-not (Test-PreparedCodexEndpoint)) { break }
    if (Test-Path -LiteralPath $LifecyclePath -PathType Leaf) {
        try {
            $Lifecycle = Get-Content -Raw -LiteralPath $LifecyclePath | ConvertFrom-Json
            if ($Lifecycle.state -eq 'quota-ready') { exit 0 }
            if ($Lifecycle.state -eq 'degraded') { exit 0 }
        }
        catch {}
    }
    Start-Sleep -Milliseconds 150
}

# A valid endpoint can recover without closing Codex; never suggest a restart for it.
if (Test-PreparedCodexEndpoint) { exit 0 }

if (-not (Show-QuotaPinRelaunchPrompt -IconPath $TrayIcon)) { exit 0 }

$Launcher = Start-Process -FilePath $PowerShellExe -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', ('"{0}"' -f $LaunchScript), '-NoRelaunchPrompt'
) -WindowStyle Hidden -PassThru -Wait
exit $Launcher.ExitCode
