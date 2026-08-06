import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const powershell = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(source) {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeTrustBundle(directory, overrides = {}) {
  const version = "1.0.0-beta.1";
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const agentPath = path.join(directory, "QuotaPin.Agent.exe");
  const noticesPath = path.join(directory, "THIRD_PARTY_NOTICES.txt");
  fs.writeFileSync(agentPath, "fixture-agent", "utf8");
  fs.writeFileSync(noticesPath, "fixture-notices", "utf8");
  const manifest = {
    schemaVersion: "quotapin-release/v1",
    product: "QuotaPin",
    version,
    installMode: "command",
    source: {
      repository: "https://github.com/WSL043/QuotaPin-for-Codex",
      tag: `v${version}`,
      commit,
      dirty: false,
    },
    build: {
      context: "github-release-workflow",
      workflowRunId: "24680",
    },
    artifacts: [
      { name: "QuotaPin.Agent.exe", bytes: fs.statSync(agentPath).size, sha256: sha256(agentPath) },
      { name: "THIRD_PARTY_NOTICES.txt", bytes: fs.statSync(noticesPath).size, sha256: sha256(noticesPath) },
    ],
    ...overrides,
  };
  const manifestPath = path.join(directory, "QuotaPin-release.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checksums = {
    "QuotaPin-release.json": sha256(manifestPath),
    "QuotaPin.Agent.exe": sha256(agentPath),
    "THIRD_PARTY_NOTICES.txt": sha256(noticesPath),
  };
  fs.writeFileSync(`${manifestPath}.sha256`, `${checksums["QuotaPin-release.json"]}  QuotaPin-release.json\n`, "utf8");
  fs.writeFileSync(`${agentPath}.sha256`, `${checksums["QuotaPin.Agent.exe"]}  QuotaPin.Agent.exe\n`, "utf8");
  fs.writeFileSync(`${noticesPath}.sha256`, `${checksums["THIRD_PARTY_NOTICES.txt"]}  THIRD_PARTY_NOTICES.txt\n`, "utf8");
  fs.writeFileSync(path.join(directory, "SHA256SUMS"), `${Object.entries(checksums).map(([name, hash]) => `${hash}  ${name}`).join("\n")}\n`, "utf8");
  return { version, commit, agentPath, noticesPath, manifestPath };
}

function trustCommand(bundle, trustPath) {
  return String.raw`
$ErrorActionPreference = 'Stop'
. ${quotePowerShell(trustPath)}
$Result = Test-QuotaPinReleaseTrustBundle ` +
    `-Version ${quotePowerShell(bundle.version)} ` +
    `-ManifestPath ${quotePowerShell(bundle.manifestPath)} ` +
    `-ManifestChecksumPath ${quotePowerShell(`${bundle.manifestPath}.sha256`)} ` +
    `-Sha256SumsPath ${quotePowerShell(path.join(path.dirname(bundle.manifestPath), "SHA256SUMS"))} ` +
    `-AgentPath ${quotePowerShell(bundle.agentPath)} ` +
    `-AgentChecksumPath ${quotePowerShell(`${bundle.agentPath}.sha256`)} ` +
    `-NoticesPath ${quotePowerShell(bundle.noticesPath)} ` +
    `-NoticesChecksumPath ${quotePowerShell(`${bundle.noticesPath}.sha256`)}
$Result | ConvertTo-Json -Compress
`;
}

test("release trust bundle binds workflow identity, manifest, checksums, and payloads", { skip: process.platform !== "win32" }, (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-release-trust-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const trustPath = path.join(root, "src", "runtime-trust.ps1");
  const bundle = writeTrustBundle(fixture);
  const accepted = runPowerShell(trustCommand(bundle, trustPath));
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  const result = JSON.parse(accepted.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.version, bundle.version);
  assert.equal(result.commit, bundle.commit);
  assert.equal(result.agentSha256, sha256(bundle.agentPath));

  fs.appendFileSync(bundle.agentPath, "tampered", "utf8");
  const tampered = runPowerShell(trustCommand(bundle, trustPath));
  assert.notEqual(tampered.status, 0, "a payload changed after publication must be rejected");
});

test("release trust bundle rejects a locally-produced identity even when its hashes are self-consistent", { skip: process.platform !== "win32" }, (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-release-identity-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const trustPath = path.join(root, "src", "runtime-trust.ps1");
  const bundle = writeTrustBundle(fixture, { build: { context: "local-or-untrusted-workflow", workflowRunId: "24680" } });
  const rejected = runPowerShell(trustCommand(bundle, trustPath));
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stderr}\n${rejected.stdout}`, /identity or source provenance is invalid/i);
});

test("outer update rollback fixture restores the complete install tree and every external entry", { skip: process.platform !== "win32" }, () => {
  const lifecycle = quotePowerShell(path.join(root, "src", "lifecycle.ps1"));
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Outer = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-update-rollback-test-' + [Guid]::NewGuid().ToString('N'))
$Install = Join-Path $Outer 'installed'
$Shortcut = Join-Path $Outer 'startup\QuotaPin Auto Attach.lnk'
try {
    New-Item -ItemType Directory -Path (Join-Path $Install 'src') -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $Shortcut) -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Install 'VERSION'), 'old-version')
    [IO.File]::WriteAllText((Join-Path $Install 'config.json'), 'old-config')
    [IO.File]::WriteAllText((Join-Path $Install 'src\old.ps1'), 'old-source')
    [IO.File]::WriteAllText($Shortcut, 'old-shortcut')
    . ${lifecycle} -InstallRootOverride $Install
    $Snapshot = New-QuotaPinRollbackSnapshot -Paths @($Install, $Shortcut) -SnapshotRoot (Join-Path $Outer 'snapshot')

    foreach ($Phase in 1..3) {
        [IO.File]::WriteAllText((Join-Path $Install 'VERSION'), "new-version-$Phase")
        [IO.File]::WriteAllText((Join-Path $Install 'config.json'), "new-config-$Phase")
        Remove-Item -LiteralPath (Join-Path $Install 'src') -Recurse -Force
        New-Item -ItemType Directory -Path (Join-Path $Install 'src') -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $Install 'src\new.ps1'), "new-source-$Phase")
        [IO.File]::WriteAllText($Shortcut, "new-shortcut-$Phase")
        Restore-QuotaPinRollbackSnapshot -Snapshot $Snapshot
        if ((Get-Content -Raw -LiteralPath (Join-Path $Install 'VERSION')) -cne 'old-version' -or
            (Get-Content -Raw -LiteralPath (Join-Path $Install 'config.json')) -cne 'old-config' -or
            -not (Test-Path -LiteralPath (Join-Path $Install 'src\old.ps1') -PathType Leaf) -or
            (Test-Path -LiteralPath (Join-Path $Install 'src\new.ps1')) -or
            (Get-Content -Raw -LiteralPath $Shortcut) -cne 'old-shortcut') {
            throw "Rollback mismatch after injected phase $Phase"
        }
    }
    if (-not (Remove-QuotaPinRollbackSnapshot -Snapshot $Snapshot)) { throw 'Snapshot cleanup failed.' }
    Write-Output 'restored'
}
finally {
    Remove-Item -LiteralPath $Outer -Recurse -Force -ErrorAction SilentlyContinue
}
`;
  const result = runPowerShell(script);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /restored/);
});
