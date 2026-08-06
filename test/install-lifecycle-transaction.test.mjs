import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const powershell = path.join(
  process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const lifecycle = path.join(root, "src", "lifecycle.ps1").replaceAll("'", "''");

function runPowerShell(source) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
}

function lastJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

test("fresh install fault removes every newly-created persistent entry", { skip: process.platform !== "win32" }, () => {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-fresh-fault-' + [Guid]::NewGuid().ToString('N'))
$Install = Join-Path $Outer 'install'
$Startup = Join-Path $Outer 'startup\QuotaPin Auto Attach.lnk'
$StartMenu = Join-Path $Outer 'programs\QuotaPin'
$RegistryPath = 'HKCU:\Software\QuotaPin-Test-' + [Guid]::NewGuid().ToString('N')
try {
    New-Item -ItemType Directory -Path $Outer -Force | Out-Null
    . '${lifecycle}' -InstallRootOverride $Install -RegistryPathOverride $RegistryPath
    $Snapshot = New-QuotaPinRollbackSnapshot -Paths @($Install, $Startup, $StartMenu) -SnapshotRoot (Join-Path $Outer 'rollback')
    $RegistrySnapshot = Get-QuotaPinInstallRegistrySnapshot
    try {
        New-Item -ItemType Directory -Path (Join-Path $Install 'logs') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $Install 'install-state.json'), '{"owner":"command"}')
        [IO.File]::WriteAllText((Join-Path $Install 'logs\watcher.json'), '{"processId":1}')
        New-Item -ItemType Directory -Path (Split-Path -Parent $Startup) -Force | Out-Null
        [IO.File]::WriteAllText($Startup, 'unverified-startup')
        New-Item -ItemType Directory -Path $StartMenu -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $StartMenu 'Uninstall QuotaPin.lnk'), 'new-entry')
        New-Item -Path $RegistryPath -Force | Out-Null
        New-ItemProperty -LiteralPath $RegistryPath -Name InstallOwner -Value command -PropertyType String -Force | Out-Null
        throw 'fault-after-persistent-write'
    }
    catch {
        if ($_.Exception.Message -ne 'fault-after-persistent-write') { throw }
        Restore-QuotaPinRollbackSnapshot -Snapshot $Snapshot
        Restore-QuotaPinInstallRegistrySnapshot -Snapshot $RegistrySnapshot
    }
    [ordered]@{
        install = Test-Path -LiteralPath $Install
        startup = Test-Path -LiteralPath $Startup
        startMenu = Test-Path -LiteralPath $StartMenu
        registry = Test-Path -LiteralPath $RegistryPath
    } | ConvertTo-Json -Compress
}
finally {
    Remove-Item -LiteralPath $RegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  assert.deepEqual(lastJson(runPowerShell(script)), {
    install: false,
    startup: false,
    startMenu: false,
    registry: false,
  });
});

test("upgrade fault restores old files, entries, preferences, and registry types", { skip: process.platform !== "win32" }, () => {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-upgrade-fault-' + [Guid]::NewGuid().ToString('N'))
$Install = Join-Path $Outer 'install'
$Startup = Join-Path $Outer 'startup\QuotaPin Auto Attach.lnk'
$StartMenu = Join-Path $Outer 'programs\QuotaPin'
$RegistryPath = 'HKCU:\Software\QuotaPin-Test-' + [Guid]::NewGuid().ToString('N')
try {
    New-Item -ItemType Directory -Path $Install -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $Startup) -Force | Out-Null
    New-Item -ItemType Directory -Path $StartMenu -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Install 'VERSION'), 'old-version')
    [IO.File]::WriteAllText((Join-Path $Install 'config.json'), '{"keep":"old"}')
    [IO.File]::WriteAllText((Join-Path $Install 'install-state.json'), '{"schema":1,"owner":"command","preferences":{"autoAttach":true}}')
    [IO.File]::WriteAllText($Startup, 'old-startup')
    [IO.File]::WriteAllText((Join-Path $StartMenu 'Uninstall QuotaPin.lnk'), 'old-uninstall')
    . '${lifecycle}' -InstallRootOverride $Install -RegistryPathOverride $RegistryPath
    New-Item -Path $RegistryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name InstallOwner -Value command -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name InstallSchema -Value 1 -PropertyType DWord -Force | Out-Null
    $Snapshot = New-QuotaPinRollbackSnapshot -Paths @($Install, $Startup, $StartMenu) -SnapshotRoot (Join-Path $Outer 'rollback')
    $RegistrySnapshot = Get-QuotaPinInstallRegistrySnapshot
    try {
        [IO.File]::WriteAllText((Join-Path $Install 'VERSION'), 'new-version')
        [IO.File]::WriteAllText((Join-Path $Install 'config.json'), '{"keep":"changed"}')
        [IO.File]::WriteAllText((Join-Path $Install 'install-state.json'), '{"schema":1,"owner":"command","preferences":{"autoAttach":false}}')
        [IO.File]::WriteAllText($Startup, 'new-startup')
        [IO.File]::WriteAllText((Join-Path $StartMenu 'Uninstall QuotaPin.lnk'), 'new-uninstall')
        New-ItemProperty -LiteralPath $RegistryPath -Name InstallOwner -Value setup -PropertyType String -Force | Out-Null
        New-ItemProperty -LiteralPath $RegistryPath -Name InstallSchema -Value 9 -PropertyType DWord -Force | Out-Null
        throw 'fault-after-upgrade-write'
    }
    catch {
        if ($_.Exception.Message -ne 'fault-after-upgrade-write') { throw }
        Restore-QuotaPinRollbackSnapshot -Snapshot $Snapshot
        Restore-QuotaPinInstallRegistrySnapshot -Snapshot $RegistrySnapshot
    }
    $State = Get-Content -Raw -LiteralPath (Join-Path $Install 'install-state.json') | ConvertFrom-Json
    $Key = Get-Item -LiteralPath $RegistryPath
    [ordered]@{
        version = [string](Get-Content -Raw -LiteralPath (Join-Path $Install 'VERSION'))
        config = [string](Get-Content -Raw -LiteralPath (Join-Path $Install 'config.json'))
        preference = [bool]$State.preferences.autoAttach
        startup = [string](Get-Content -Raw -LiteralPath $Startup)
        uninstall = [string](Get-Content -Raw -LiteralPath (Join-Path $StartMenu 'Uninstall QuotaPin.lnk'))
        owner = [string]$Key.GetValue('InstallOwner')
        schema = [int]$Key.GetValue('InstallSchema')
        schemaKind = [string]$Key.GetValueKind('InstallSchema')
    } | ConvertTo-Json -Compress
}
finally {
    Remove-Item -LiteralPath $RegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  assert.deepEqual(lastJson(runPowerShell(script)), {
    version: "old-version",
    config: '{"keep":"old"}',
    preference: true,
    startup: "old-startup",
    uninstall: "old-uninstall",
    owner: "command",
    schema: 1,
    schemaKind: "DWord",
  });
});

test("install and uninstall transaction ordering is fail-closed", () => {
  const install = fs.readFileSync(path.join(root, "scripts", "install.ps1"), "utf8");
  const uninstall = fs.readFileSync(path.join(root, "scripts", "uninstall.ps1"), "utf8");
  const installFlow = install.slice(install.indexOf("$TransactionRoot ="));
  const uninstallFlow = uninstall.slice(uninstall.indexOf("$TransactionRoot ="));

  assert.ok(installFlow.indexOf("New-QuotaPinRollbackSnapshot") < installFlow.indexOf("& (Join-Path $PSScriptRoot 'stop.ps1') -TemporaryExit"));
  assert.ok(installFlow.indexOf("Start-QuotaPinVerifiedWatcher $AutoAttachScript") < installFlow.indexOf("if ($AutoAttachEnabled) { New-QuotaPinAutoAttachShortcut }"));
  assert.ok(installFlow.includes("Restore-QuotaPinRollbackSnapshot"));
  assert.ok(installFlow.includes("Restore-QuotaPinInstallRegistrySnapshot"));
  assert.match(installFlow, /RollbackFailures\.Count[\s\S]*?Remove-Item -LiteralPath \$AutoAttachShortcut/);

  assert.ok(uninstallFlow.indexOf("New-QuotaPinRollbackSnapshot") < uninstallFlow.indexOf("& $StopScript"));
  assert.ok(uninstallFlow.includes("Restore-QuotaPinRollbackSnapshot"));
  assert.ok(uninstallFlow.includes("Restore-QuotaPinInstallRegistrySnapshot"));
  assert.match(uninstallFlow, /RollbackFailures\.Count[\s\S]*?Remove-Item -LiteralPath \$AutoAttachShortcut/);
});

test("remote install derives every trust asset from one loopback release base", { skip: process.platform !== "win32" }, () => {
  const installer = path.join(root, "scripts", "install.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-install-url-test-' + [Guid]::NewGuid().ToString('N'))
try {
    $Tokens = $null
    $Errors = $null
    $Ast = [Management.Automation.Language.Parser]::ParseFile('${installer}', [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count) { throw $Errors[0] }
    $Function = @($Ast.FindAll({ param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Get-QuotaPinRemoteReleaseBundle' }, $true))[0]
    Invoke-Expression $Function.Extent.Text
    $script:Downloads = @()
    function Receive-QuotaPinInstallFile([string]$Url, [string]$Destination, [long]$MaximumBytes, [int]$TimeoutSeconds) {
        $script:Downloads += [pscustomobject]@{ url = $Url; bytes = $MaximumBytes; timeout = $TimeoutSeconds }
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        [IO.File]::WriteAllText($Destination, 'fixture')
    }
    function Test-QuotaPinReleaseTrustBundle {
        param($Version, $ManifestPath, $ManifestChecksumPath, $Sha256SumsPath, $AgentPath, $AgentChecksumPath, $NoticesPath, $NoticesChecksumPath)
        [pscustomobject]@{ commit = ('a' * 40) }
    }
    function Expand-QuotaPinReleaseBundle([string]$ArchivePath, [string]$ArchiveChecksumPath, [string]$DestinationRoot) {
        New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
        foreach ($Name in @('QuotaPin.Agent.exe','QuotaPin.Agent.exe.sha256','THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt.sha256','QuotaPin-release.json','QuotaPin-release.json.sha256','SHA256SUMS')) {
            [IO.File]::WriteAllText((Join-Path $DestinationRoot $Name), ('fixture-' + $Name))
        }
    }
    function Test-QuotaPinInstallAgentIdentity([string]$Path, [string]$ExpectedCommit) {
        if ($ExpectedCommit -cne ('a' * 40)) { throw 'commit was not forwarded' }
    }
    $Version = '0.3.0-alpha.25'
    $AgentUrl = 'http://127.0.0.1:43124/releases/v0.3.0-alpha.25/QuotaPin-Windows-x64.zip'
    New-Item -ItemType Directory -Path $Outer -Force | Out-Null
    Get-QuotaPinRemoteReleaseBundle (Join-Path $Outer 'QuotaPin.Agent.exe') (Join-Path $Outer 'THIRD_PARTY_NOTICES.txt') $Outer
    $Rejected = $false
    try {
        $AgentUrl = 'https://example.invalid/releases/v0.3.0-alpha.25/QuotaPin-Windows-x64.zip'
        Get-QuotaPinRemoteReleaseBundle (Join-Path $Outer 'bad.exe') (Join-Path $Outer 'bad.txt') $Outer
    }
    catch { $Rejected = $true }
    [ordered]@{
        urls = @($script:Downloads | ForEach-Object url)
        budgets = @($script:Downloads | ForEach-Object { '{0}:{1}' -f $_.bytes, $_.timeout })
        rejected = $Rejected
    } | ConvertTo-Json -Compress
}
finally {
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  const actual = lastJson(runPowerShell(script));
  assert.deepEqual(actual.urls, [
    "http://127.0.0.1:43124/releases/v0.3.0-alpha.25/QuotaPin-Windows-x64.zip",
    "http://127.0.0.1:43124/releases/v0.3.0-alpha.25/QuotaPin-Windows-x64.zip.sha256",
  ]);
  assert.deepEqual(actual.budgets, [
    "134217728:300",
    "4096:30",
  ]);
  assert.equal(actual.rejected, true);
});
