param(
    [Parameter(Mandatory = $true)]
    [string]$PackagePath
)

$ErrorActionPreference = 'Stop'
$PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$ExpectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'VERSION')).Trim()
$InstallRoot = Join-Path $env:LOCALAPPDATA 'QuotaPin'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Wait-ProcessExit([Diagnostics.Process]$Process, [int]$TimeoutMilliseconds, [string]$Operation, [string]$FailureLog = '') {
    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        try { $Process.Kill() } catch {}
        throw "$Operation timed out after $([Math]::Round($TimeoutMilliseconds / 1000)) seconds."
    }
    if ($Process.ExitCode -ne 0) {
        $Detail = ''
        if ($FailureLog -and (Test-Path -LiteralPath $FailureLog -PathType Leaf)) {
            $Tail = @(Get-Content -LiteralPath $FailureLog -Tail 80 -ErrorAction SilentlyContinue)
            if ($Tail.Count) { $Detail = "`r`nInstaller log tail:`r`n" + ($Tail -join "`r`n") }
        }
        throw "$Operation failed with exit code $($Process.ExitCode).$Detail"
    }
}

function Get-PeMachine([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    $Reader = New-Object IO.BinaryReader($Stream)
    try {
        $Stream.Position = 0x3c
        $PeOffset = $Reader.ReadInt32()
        $Stream.Position = $PeOffset + 4
        return $Reader.ReadUInt16()
    }
    finally {
        $Reader.Dispose()
        $Stream.Dispose()
    }
}

$NativeArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($NativeArchitecture -cne 'Arm64') {
    throw "This acceptance test requires a native Windows Arm64 runner; found $NativeArchitecture."
}
if (Test-Path -LiteralPath $InstallRoot) {
    throw "Arm64 acceptance requires a fresh runner; install root already exists: $InstallRoot"
}

try {
    $InstallerLog = Join-Path $env:RUNNER_TEMP 'quotapin-arm64-install.log'
    $Installer = Start-Process -FilePath $PackagePath -ArgumentList @(
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        '/SP-',
        '/CIARM64ACCEPTANCE=1',
        ('/LOG="' + $InstallerLog + '"')
    ) -PassThru
    Wait-ProcessExit $Installer 120000 'QuotaPin Arm64-emulation install' $InstallerLog

    $AgentPath = Join-Path $InstallRoot 'QuotaPin.Agent.exe'
    $TrayPath = Join-Path $InstallRoot 'QuotaPin.Tray.exe'
    foreach ($Required in @($AgentPath, $TrayPath, (Join-Path $InstallRoot 'unins000.exe'))) {
        if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) {
            throw "Installed package file is missing: $Required"
        }
    }

    if ((Get-PeMachine $AgentPath) -ne 0x8664) { throw 'The Windows Agent is not the expected x64 payload.' }
    if ((Get-PeMachine $TrayPath) -ne 0x8664) { throw 'The Windows tray is not the expected x64 payload.' }

    $ReportedVersion = @(& $AgentPath '--agent-version' 2>$null) | Select-Object -First 1
    if (([string]$ReportedVersion).Trim() -cne $ExpectedVersion) {
        throw "The x64 Agent did not execute correctly under Arm64 emulation. Expected $ExpectedVersion; found $ReportedVersion"
    }

    Get-Process -Name 'QuotaPin.Tray' -ErrorAction SilentlyContinue | Stop-Process -Force
    $Tray = Start-Process -FilePath $TrayPath -PassThru
    Start-Sleep -Seconds 4
    $Tray.Refresh()
    if ($Tray.HasExited) { throw "The x64 tray exited under Arm64 emulation with code $($Tray.ExitCode)." }
    Stop-Process -Id $Tray.Id -Force

    $UninstallerPath = Join-Path $InstallRoot 'unins000.exe'
    $Uninstaller = Start-Process -FilePath $UninstallerPath -ArgumentList @(
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART'
    ) -PassThru
    Wait-ProcessExit $Uninstaller 90000 'QuotaPin Arm64-emulation uninstall'

    Start-Sleep -Seconds 2
    if (Get-Process -Name 'QuotaPin.Agent', 'QuotaPin.Tray' -ErrorAction SilentlyContinue) {
        throw 'QuotaPin left a running process after Arm64-emulation uninstall.'
    }
    if (Get-ItemProperty -LiteralPath $RunKey -Name 'QuotaPin' -ErrorAction SilentlyContinue) {
        throw 'QuotaPin left its automatic-start registry value after Arm64-emulation uninstall.'
    }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'QuotaPin.Agent.exe')) {
        throw 'QuotaPin left the Agent payload after Arm64-emulation uninstall.'
    }

    Write-Output "Windows 11 Arm64 x64-emulation lifecycle: OK ($ExpectedVersion)"
}
finally {
    Get-Process -Name 'QuotaPin.Agent', 'QuotaPin.Tray' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
