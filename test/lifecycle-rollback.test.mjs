import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const powershell = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function runPowerShell(source) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
}

test("lifecycle rollback restores files, directories, and originally absent entries", { skip: process.platform !== "win32" }, () => {
  const lifecycle = path.join(root, "src", "lifecycle.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-lifecycle-test-' + [Guid]::NewGuid().ToString('N'))
$Install = Join-Path $Outer 'install'
$SnapshotRoot = Join-Path $Outer 'snapshot'
$Version = Join-Path $Install 'VERSION'
$Source = Join-Path $Install 'src'
$NewShortcut = Join-Path $Outer 'startup\QuotaPin.lnk'
try {
    New-Item -ItemType Directory -Path $Source -Force | Out-Null
    [IO.File]::WriteAllText($Version, 'old-version')
    [IO.File]::WriteAllText((Join-Path $Source 'old.ps1'), 'old-source')
    . '${lifecycle}' -InstallRootOverride $Install
    $Snapshot = New-QuotaPinRollbackSnapshot -Paths @($Version, $Source, $NewShortcut) -SnapshotRoot $SnapshotRoot

    [IO.File]::WriteAllText($Version, 'new-version')
    Remove-Item -LiteralPath $Source -Recurse -Force
    New-Item -ItemType Directory -Path $Source -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Source 'new.ps1'), 'new-source')
    New-Item -ItemType Directory -Path (Split-Path -Parent $NewShortcut) -Force | Out-Null
    [IO.File]::WriteAllText($NewShortcut, 'new-shortcut')

    Restore-QuotaPinRollbackSnapshot -Snapshot $Snapshot
    $Result = [ordered]@{
        version = [string](Get-Content -Raw -LiteralPath $Version)
        oldSource = Test-Path -LiteralPath (Join-Path $Source 'old.ps1') -PathType Leaf
        newSource = Test-Path -LiteralPath (Join-Path $Source 'new.ps1')
        shortcut = Test-Path -LiteralPath $NewShortcut
        removed = Remove-QuotaPinRollbackSnapshot -Snapshot $Snapshot
        snapshotExists = Test-Path -LiteralPath $SnapshotRoot
    }
    $Result | ConvertTo-Json -Compress
}
finally {
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const actual = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(actual, {
    version: "old-version",
    oldSource: true,
    newSource: false,
    shortcut: false,
    removed: true,
    snapshotExists: false,
  });
});

test("lifecycle rollback rejects a snapshot that overlaps a managed target", { skip: process.platform !== "win32" }, () => {
  const lifecycle = path.join(root, "src", "lifecycle.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-lifecycle-overlap-' + [Guid]::NewGuid().ToString('N'))
try {
    $Target = Join-Path $Outer 'managed'
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    . '${lifecycle}' -InstallRootOverride $Target
    try {
        $null = New-QuotaPinRollbackSnapshot -Paths @($Target) -SnapshotRoot (Join-Path $Target 'snapshot')
        throw 'overlap was accepted'
    }
    catch {
        if ($_.Exception.Message -eq 'overlap was accepted') { throw }
        Write-Output 'rejected'
    }
}
finally {
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /rejected/);
});

test("install-owner registry snapshot restores the complete isolated key", { skip: process.platform !== "win32" }, () => {
  const lifecycle = path.join(root, "src", "lifecycle.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Install = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-registry-test-' + [Guid]::NewGuid().ToString('N'))
$RegistryPath = 'HKCU:\\Software\\QuotaPin-Test-' + [Guid]::NewGuid().ToString('N')
try {
    New-Item -ItemType Directory -Path $Install -Force | Out-Null
    . '${lifecycle}' -InstallRootOverride $Install -RegistryPathOverride $RegistryPath
    New-Item -Path $RegistryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name 'InstallOwner' -Value 'command' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name 'InstallSchema' -Value 7 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name 'FutureValue' -Value 'keep-me' -PropertyType String -Force | Out-Null
    $Snapshot = Get-QuotaPinInstallRegistrySnapshot

    Remove-Item -LiteralPath $RegistryPath -Recurse -Force
    New-Item -Path $RegistryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $RegistryPath -Name 'InstallOwner' -Value 'setup' -PropertyType String -Force | Out-Null
    Restore-QuotaPinInstallRegistrySnapshot -Snapshot $Snapshot
    $Key = Get-Item -LiteralPath $RegistryPath
    [ordered]@{
        owner = [string]$Key.GetValue('InstallOwner')
        schema = [int]$Key.GetValue('InstallSchema')
        schemaKind = [string]$Key.GetValueKind('InstallSchema')
        future = [string]$Key.GetValue('FutureValue')
    } | ConvertTo-Json -Compress
}
finally {
    Remove-Item -LiteralPath $RegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $Install -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const actual = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(actual, { owner: "command", schema: 7, schemaKind: "DWord", future: "keep-me" });
});
