import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_REPOSITORY,
  PUBLIC_RELEASE_ASSETS,
  RELEASE_BUNDLE_MEMBERS,
  preparePublicRelease,
  verifyPublicRelease,
} from "../scripts/public-release.mjs";

const VERSION = "1.0.0";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS_POWERSHELL = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
function git(root, ...arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], { encoding: "utf8", windowsHide: true }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-public-release-"));
  const source = path.join(root, "dist");
  const output = path.join(root, "public");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), `${VERSION}\n`);
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version: VERSION })}\n`);
  fs.writeFileSync(path.join(root, "package-lock.json"), `${JSON.stringify({ version: VERSION, lockfileVersion: 3, packages: { "": { version: VERSION } } })}\n`);
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\npublic/\n");
  fs.writeFileSync(path.join(source, "QuotaPin.Agent.exe"), Buffer.from("agent-fixture\0binary"));
  fs.writeFileSync(path.join(source, "THIRD_PARTY_NOTICES.txt"), "Node.js fixture notices\n");
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.name", "QuotaPin release test");
  git(root, "config", "user.email", "release-test@invalid.example");
  git(root, "add", ".gitignore", "VERSION", "package.json", "package-lock.json", "LICENSE");
  git(root, "commit", "-q", "-m", "fixture");
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "tag", `v${VERSION}`);
  return { root, source, output, commit };
}

function prepare(paths) {
  return preparePublicRelease({
    ...paths,
    repository: OFFICIAL_REPOSITORY,
    commit: paths.commit,
    tag: `v${VERSION}`,
    workflowRunId: "123456789",
    createdAt: "2026-08-05T00:00:00.000Z",
  });
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function verifyWithRuntimeTrust(paths) {
  const output = paths.output;
  const script = `
$ErrorActionPreference = 'Stop'
. ${quotePowerShell(path.join(PROJECT_ROOT, "src", "runtime-trust.ps1"))}
$Payload = Join-Path ${quotePowerShell(output)} 'verified-payload'
$null = Expand-QuotaPinReleaseBundle -ArchivePath ${quotePowerShell(path.join(output, "QuotaPin-Windows-x64.zip"))} -ArchiveChecksumPath ${quotePowerShell(path.join(output, "QuotaPin-Windows-x64.zip.sha256"))} -DestinationRoot $Payload
$Result = Test-QuotaPinReleaseTrustBundle -Version ${quotePowerShell(VERSION)} -ManifestPath (Join-Path $Payload 'QuotaPin-release.json') -ManifestChecksumPath (Join-Path $Payload 'QuotaPin-release.json.sha256') -Sha256SumsPath (Join-Path $Payload 'SHA256SUMS') -AgentPath (Join-Path $Payload 'QuotaPin.Agent.exe') -AgentChecksumPath (Join-Path $Payload 'QuotaPin.Agent.exe.sha256') -NoticesPath (Join-Path $Payload 'THIRD_PARTY_NOTICES.txt') -NoticesChecksumPath (Join-Path $Payload 'THIRD_PARTY_NOTICES.txt.sha256')
$Result | ConvertTo-Json -Compress
`;
  return spawnSync(WINDOWS_POWERSHELL, ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8" });
}

test("command release preparation emits one exact Setup-free asset set", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  const result = prepare(paths);
  assert.deepEqual(fs.readdirSync(paths.output).sort(), [...PUBLIC_RELEASE_ASSETS].sort());
  assert.deepEqual(result.assets, PUBLIC_RELEASE_ASSETS);
  assert.ok(result.agentSha256.match(/^[0-9a-f]{64}$/));
  assert.ok(result.bundleSha256.match(/^[0-9a-f]{64}$/));
  assert.deepEqual(RELEASE_BUNDLE_MEMBERS.includes("QuotaPin-release.json"), true);
  assert.deepEqual(PUBLIC_RELEASE_ASSETS, ["QuotaPin-Windows-x64.zip", "QuotaPin-Windows-x64.zip.sha256"]);
});

test("Windows-built release ZIP members remain readable to Unix attestation jobs", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  prepare(paths);
  const archive = fs.readFileSync(path.join(paths.output, "QuotaPin-Windows-x64.zip"));
  const count = archive.readUInt16LE(archive.length - 12);
  let cursor = archive.readUInt32LE(archive.length - 6);
  const modes = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    const madeBy = archive.readUInt16LE(cursor + 4);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    modes.push({ name, creatorSystem: madeBy >>> 8, mode: archive.readUInt32LE(cursor + 38) >>> 16 });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.ok(modes.length > 0);
  assert.ok(modes.every(({ creatorSystem, mode }) => creatorSystem === 3 && mode === 0o100644), JSON.stringify(modes));
});

test("prepared public bundle passes the shared command install trust boundary", { skip: process.platform !== "win32" }, (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  prepare(paths);
  const verified = verifyWithRuntimeTrust(paths);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  const result = JSON.parse(verified.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(result.version, VERSION);
  assert.equal(result.commit, paths.commit);
});

test("command release verification rejects leaked Setup and any unlisted file", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  prepare(paths);
  fs.writeFileSync(path.join(paths.output, "QuotaPin-Setup.exe"), "forbidden");
  assert.throws(() => verifyPublicRelease({
    directory: paths.output,
    repository: OFFICIAL_REPOSITORY,
    commit: paths.commit,
    tag: `v${VERSION}`,
  }), /unexpected asset set|forbidden/i);
});

test("command release verification rejects checksum and provenance drift", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  prepare(paths);
  fs.appendFileSync(path.join(paths.output, "QuotaPin-Windows-x64.zip"), "tampered\n");
  assert.throws(() => verifyPublicRelease({
    directory: paths.output,
    repository: OFFICIAL_REPOSITORY,
    commit: paths.commit,
    tag: `v${VERSION}`,
  }), /checksum mismatch/i);

  fs.rmSync(paths.output, { recursive: true, force: true });
  prepare(paths);
  assert.throws(() => verifyPublicRelease({
    directory: paths.output,
    repository: OFFICIAL_REPOSITORY,
    commit: "f".repeat(40),
    tag: `v${VERSION}`,
  }), /manifest source is invalid/i);
});

test("command release preparation requires tag, package, and VERSION identity to agree", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  assert.throws(() => preparePublicRelease({
    ...paths,
    repository: OFFICIAL_REPOSITORY,
    commit: paths.commit,
    tag: "v1.0.1",
  }), /does not match version/);
  fs.writeFileSync(path.join(paths.root, "package.json"), `${JSON.stringify({ version: "0.0.0" })}\n`);
  assert.throws(() => prepare(paths), /does not match VERSION|clean source checkout/);
});

test("command release preparation refuses a dirty checkout", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(paths.root, "unexpected.txt"), "dirty\n");
  assert.throws(() => prepare(paths), /clean source checkout/);
});

test("command release preparation requires official workflow provenance", (t) => {
  const paths = fixture();
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }));
  assert.throws(() => preparePublicRelease({
    ...paths,
    repository: OFFICIAL_REPOSITORY,
    commit: paths.commit,
    tag: `v${VERSION}`,
    workflowRunId: "local",
  }), /workflow run id/i);
});
