import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trustScript = path.join(root, "src", "runtime-trust.ps1");
const powershell = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const version = "1.0.0-beta.1";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeBundle(directory, mutateManifest = (value) => value) {
  fs.mkdirSync(directory, { recursive: true });
  const agent = Buffer.from("isolated-agent-fixture");
  const notices = Buffer.from("isolated-notices-fixture");
  const agentHash = sha256(agent);
  const noticesHash = sha256(notices);
  const manifest = mutateManifest({
    schemaVersion: "quotapin-release/v1",
    product: "QuotaPin",
    installMode: "command",
    version,
    source: {
      repository: "https://github.com/WSL043/QuotaPin-for-Codex",
      commit: "a".repeat(40),
      tag: `v${version}`,
      dirty: false,
    },
    build: {
      context: "github-release-workflow",
      workflowRunId: "123456",
    },
    artifacts: [
      { name: "QuotaPin.Agent.exe", bytes: agent.length, sha256: agentHash },
      { name: "THIRD_PARTY_NOTICES.txt", bytes: notices.length, sha256: noticesHash },
    ],
  });
  const manifestText = `${JSON.stringify(manifest)}\n`;
  const manifestHash = sha256(Buffer.from(manifestText));
  const files = {
    manifest: path.join(directory, "QuotaPin-release.json"),
    manifestChecksum: path.join(directory, "QuotaPin-release.json.sha256"),
    sums: path.join(directory, "SHA256SUMS"),
    agent: path.join(directory, "QuotaPin.Agent.exe"),
    agentChecksum: path.join(directory, "QuotaPin.Agent.exe.sha256"),
    notices: path.join(directory, "THIRD_PARTY_NOTICES.txt"),
    noticesChecksum: path.join(directory, "THIRD_PARTY_NOTICES.txt.sha256"),
  };
  fs.writeFileSync(files.manifest, manifestText);
  fs.writeFileSync(files.manifestChecksum, `${manifestHash}  QuotaPin-release.json\r\n`);
  fs.writeFileSync(files.sums, `${manifestHash}  QuotaPin-release.json\r\n${agentHash}  QuotaPin.Agent.exe\r\n${noticesHash}  THIRD_PARTY_NOTICES.txt\r\n`);
  fs.writeFileSync(files.agent, agent);
  fs.writeFileSync(files.agentChecksum, `${agentHash}  QuotaPin.Agent.exe\r\n`);
  fs.writeFileSync(files.notices, notices);
  fs.writeFileSync(files.noticesChecksum, `${noticesHash}  THIRD_PARTY_NOTICES.txt\r\n`);
  return { files, agentHash, noticesHash, manifestHash };
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function verify(files) {
  const source = `
$ErrorActionPreference = 'Stop'
. ${quotePowerShell(trustScript)}
$Result = Test-QuotaPinReleaseTrustBundle -Version ${quotePowerShell(version)} -ManifestPath ${quotePowerShell(files.manifest)} -ManifestChecksumPath ${quotePowerShell(files.manifestChecksum)} -Sha256SumsPath ${quotePowerShell(files.sums)} -AgentPath ${quotePowerShell(files.agent)} -AgentChecksumPath ${quotePowerShell(files.agentChecksum)} -NoticesPath ${quotePowerShell(files.notices)} -NoticesChecksumPath ${quotePowerShell(files.noticesChecksum)}
$Result | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
}

test("release trust accepts one internally consistent official command bundle", { skip: process.platform !== "win32" }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "QuotaPin-release-trust-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const expected = writeBundle(directory);
  const result = verify(expected.files);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const actual = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(actual.commit, "a".repeat(40));
  assert.equal(actual.agentSha256, expected.agentHash);
  assert.equal(actual.noticesSha256, expected.noticesHash);
  assert.equal(actual.manifestSha256, expected.manifestHash);
});

test("release trust rejects a locally produced manifest even when every hash agrees", { skip: process.platform !== "win32" }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "QuotaPin-release-context-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = writeBundle(directory, (manifest) => ({
    ...manifest,
    build: { ...manifest.build, context: "local-or-untrusted-workflow" },
  }));
  const result = verify(fixture.files);
  assert.notEqual(result.status, 0, "a self-consistent local manifest must still fail closed");
});

test("release trust rejects an Agent changed after checksums were published", { skip: process.platform !== "win32" }, (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "QuotaPin-release-tamper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = writeBundle(directory);
  fs.appendFileSync(fixture.files.agent, "tampered");
  const result = verify(fixture.files);
  assert.notEqual(result.status, 0, "a modified Agent must fail before installation");
});
