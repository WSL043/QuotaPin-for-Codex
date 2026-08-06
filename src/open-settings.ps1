$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $PSScriptRoot
$AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
$LaunchScript = Join-Path $PSScriptRoot 'launch.ps1'
$QuotaPinUi = Join-Path $PSScriptRoot 'ui.ps1'
$PowerShellExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$TrayIcon = Join-Path $InstallRoot 'QuotaPin.Tray.exe'
$RuntimePath = Join-Path $InstallRoot 'logs\runtime.json'

function Get-QuotaPinAgentProcess {
    if (-not (Test-Path -LiteralPath $RuntimePath -PathType Leaf)) { return @() }
    try {
        $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
        $Process = Get-Process -Id ([int]$Runtime.agentPid) -ErrorAction Stop
        $Expected = [IO.Path]::GetFullPath($AgentPath)
        $Actual = [IO.Path]::GetFullPath($Process.Path)
        $Port = [int]$Runtime.port
        if (-not $Actual.Equals($Expected, [StringComparison]::OrdinalIgnoreCase) -or $Port -lt 1024 -or $Port -gt 65535) { return @() }
        @([pscustomobject]@{ ProcessId = $Process.Id; Port = $Port })
    }
    catch { @() }
}

if (-not (Test-Path -LiteralPath $QuotaPinUi)) { exit 7 }
. $QuotaPinUi

if (-not (Test-Path -LiteralPath $AgentPath)) {
    Show-QuotaPinInformation 'Incomplete'
    exit 5
}

$ConnectingForm = Show-QuotaPinConnectingForm -IconPath $TrayIcon
$Agent = $null
$Launcher = $null
$LauncherExitCode = $null
$Cancelled = $false
$ResultCode = 0
$ErrorMessageKey = $null

try {
    $Agent = Get-QuotaPinAgentProcess
    if (-not $Agent.Count) {
        if (-not (Test-Path -LiteralPath $LaunchScript)) {
            $ResultCode = 6
            $ErrorMessageKey = 'LauncherMissing'
        }
        else {
            $Launcher = Start-Process -FilePath $PowerShellExe `
                -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"{0}"' -f $LaunchScript)) `
                -WindowStyle Hidden -PassThru
            $Deadline = (Get-Date).AddSeconds(18)
            do {
                [System.Windows.Forms.Application]::DoEvents()
                if ($ConnectingForm.IsDisposed -or $ConnectingForm.Tag -eq 'cancelled') {
                    $Cancelled = $true
                    break
                }
                $Agent = Get-QuotaPinAgentProcess
                if ($Agent.Count) { break }
                if ($Launcher.HasExited) {
                    $LauncherExitCode = $Launcher.ExitCode
                    break
                }
                Start-Sleep -Milliseconds 100
            } while ((Get-Date) -lt $Deadline)
        }
    }

    if (-not $Cancelled -and -not $ErrorMessageKey) {
        if (-not $Agent.Count) {
            if ($LauncherExitCode -eq 2) {
                $Cancelled = $true
            }
            else {
                $ResultCode = 3
                $ErrorMessageKey = 'SettingsUnavailable'
            }
        }
        else {
            $AgentPort = [int]$Agent[0].Port
            if ($AgentPort -lt 1024 -or $AgentPort -gt 65535) {
                $ResultCode = 4
                $ErrorMessageKey = 'ConnectionMissing'
            }
            else {
                & $AgentPath --open-settings --port $AgentPort
                $ResultCode = $LASTEXITCODE
                if ($ResultCode -ne 0) { $ErrorMessageKey = 'SettingsNoResponse' }
            }
        }
    }
}
catch {
    $ResultCode = 3
    $ErrorMessageKey = 'SettingsUnavailable'
}
finally {
    Close-QuotaPinForm $ConnectingForm
}

if ($Cancelled) { exit 0 }
if ($ErrorMessageKey) { Show-QuotaPinInformation $ErrorMessageKey }
exit $ResultCode
