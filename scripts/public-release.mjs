import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const OFFICIAL_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";

export const PUBLIC_RELEASE_ASSETS = Object.freeze([
  "QuotaPin-Windows-x64.zip",
  "QuotaPin-Windows-x64.zip.sha256",
]);

export const RELEASE_BUNDLE_MEMBERS = Object.freeze([
  "QuotaPin.Agent.exe",
  "QuotaPin.Agent.exe.sha256",
  "THIRD_PARTY_NOTICES.txt",
  "THIRD_PARTY_NOTICES.txt.sha256",
  "OFFICIAL_SOURCE.txt",
  "origin.json",
  "QuotaPin.spdx.json",
  "QuotaPin-release.json",
  "QuotaPin-release.json.sha256",
  "SHA256SUMS",
  "LICENSE",
]);

const CHECKSUM_MEMBERS = Object.freeze(RELEASE_BUNDLE_MEMBERS.filter((name) => name !== "SHA256SUMS"));
const PRIMARY_ARTIFACTS = Object.freeze([
  "QuotaPin.Agent.exe",
  "THIRD_PARTY_NOTICES.txt",
  "OFFICIAL_SOURCE.txt",
  "origin.json",
  "LICENSE",
]);
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ZIP_BUNDLE_NAME = "QuotaPin-Windows-x64.zip";

const CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
}));

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipTimestamp(instant) {
  const date = new Date(instant);
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: ((date.getUTCHours() & 0x1f) << 11) | ((date.getUTCMinutes() & 0x3f) << 5) | ((Math.floor(date.getUTCSeconds() / 2)) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getUTCMonth() + 1) & 0x0f) << 5) | (date.getUTCDate() & 0x1f),
  };
}

function createReleaseZip(directory, names, createdAt) {
  const local = [];
  const central = [];
  let offset = 0;
  const timestamp = zipTimestamp(createdAt);
  for (const name of [...names].sort()) {
    const nameBytes = Buffer.from(name, "utf8");
    const content = fs.readFileSync(path.join(directory, name));
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    local.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    // The archive declares a Unix creator (3). Give every payload member a
    // regular-file 0644 mode so Linux attestation jobs can read files emitted
    // by the Windows builder instead of extracting them as mode 000.
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function readReleaseZip(archivePath) {
  const archive = fs.readFileSync(archivePath);
  if (archive.length < 22 || archive.readUInt32LE(archive.length - 22) !== 0x06054b50) fail("Release ZIP end record is invalid.");
  const count = archive.readUInt16LE(archive.length - 12);
  const centralOffset = archive.readUInt32LE(archive.length - 6);
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) fail("Release ZIP central directory is invalid.");
    const madeBy = archive.readUInt16LE(cursor + 4);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (!/^[A-Za-z0-9._-]+$/.test(name) || entries.has(name)) fail(`Release ZIP member is invalid: ${name || "(empty)"}`);
    const creatorSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (creatorSystem === 3 && (unixMode & 0o444) === 0) fail(`Release ZIP member is not readable after Unix extraction: ${name}`);
    if (method !== 8 || localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) fail(`Release ZIP member encoding is invalid: ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(start, start + compressedSize);
    if (compressed.length !== compressedSize) fail(`Release ZIP member is truncated: ${name}`);
    const content = zlib.inflateRawSync(compressed, { maxOutputLength: 160 * 1024 * 1024 });
    if (content.length !== size || crc32(content) !== checksum) fail(`Release ZIP member checksum is invalid: ${name}`);
    entries.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function fail(message) {
  throw new Error(message);
}

function normalizeDirectory(value, label) {
  if (!value) fail(`${label} is required.`);
  return path.resolve(String(value));
}

function assertOutputIsInsideRoot(root, output) {
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("Public release output must be a child directory of the repository root.");
  }
}

function readText(filePath, maximumBytes = 2 * 1024 * 1024) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > maximumBytes) fail(`Release text file is invalid: ${path.basename(filePath)}`);
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    fail(`Release JSON is invalid: ${path.basename(filePath)} (${error.message})`);
  }
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function fileRecord(directory, name) {
  const filePath = path.join(directory, name);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) fail(`Release artifact is not a regular file: ${name}`);
  return { name, bytes: stat.size, sha256: sha256File(filePath) };
}

function checksumLine(directory, name) {
  return `${sha256File(path.join(directory, name))}  ${name}`;
}

function writeSidecar(directory, name) {
  writeText(path.join(directory, `${name}.sha256`), `${checksumLine(directory, name)}\n`);
}

function parseStrictChecksum(document, expectedName) {
  const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)\r?\n?$/.exec(document);
  if (!match || match[2] !== expectedName) fail(`Checksum sidecar is invalid: ${expectedName}.sha256`);
  return match[1];
}

function normalizeIdentity(options) {
  const repository = String(options.repository ?? "");
  const commit = String(options.commit ?? "").toLowerCase();
  const tag = String(options.tag ?? "");
  const version = String(options.version ?? "");
  if (repository !== OFFICIAL_REPOSITORY) fail("Release repository identity is invalid.");
  if (!COMMIT_PATTERN.test(commit)) fail("Release commit must be a full lowercase Git object id.");
  if (!VERSION_PATTERN.test(version)) fail("Release version is invalid.");
  if (tag !== `v${version}`) fail(`Release tag ${tag || "(missing)"} does not match version ${version}.`);
  return { repository, commit, tag, version };
}

function runGit(root, arguments_) {
  try {
    return execFileSync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? "git failed").trim();
    fail(`Could not verify release source with git: ${detail}`);
  }
}

function assertCleanGitSource(root, identity) {
  const head = runGit(root, ["rev-parse", "HEAD"]).toLowerCase();
  const tagCommit = runGit(root, ["rev-parse", `${identity.tag}^{commit}`]).toLowerCase();
  if (head !== identity.commit || tagCommit !== identity.commit) {
    fail("Release commit, tag, and checked-out HEAD do not match.");
  }
  const dirty = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty) fail("Public release preparation requires a clean source checkout.");
}

function assertVersionDocuments(root, version) {
  const versionDocument = readText(path.join(root, "VERSION"), 256).trim();
  const packageDocument = readJson(path.join(root, "package.json"));
  const packageLockDocument = readJson(path.join(root, "package-lock.json"));
  const lockVersion = packageLockDocument?.packages?.[""]?.version ?? packageLockDocument?.version;
  if (versionDocument !== version) fail(`VERSION ${versionDocument} does not match release ${version}.`);
  if (packageDocument.version !== version) fail(`package.json ${packageDocument.version} does not match VERSION ${version}.`);
  if (lockVersion !== version) fail(`package-lock.json ${lockVersion ?? "(missing)"} does not match VERSION ${version}.`);
}

function buildOrigin(identity, agentHash) {
  return {
    schemaVersion: "quotapin-origin-file/v1",
    product: "QuotaPin",
    version: identity.version,
    license: "MIT",
    freeOpenSource: true,
    repository: identity.repository,
    support: `${identity.repository}/issues`,
    releases: `${identity.repository}/releases`,
    commit: identity.commit,
    source: `${identity.repository}/commit/${identity.commit}`,
    artifact: { name: "QuotaPin.Agent.exe", sha256: agentHash },
    verification: {
      releaseManifest: "QuotaPin-release.json",
      checksums: "SHA256SUMS",
      githubAttestationRepository: "WSL043/QuotaPin-for-Codex",
    },
  };
}

function buildOfficialSource(identity, agentHash) {
  return [
    "QuotaPin is free and open source under the MIT license.",
    "",
    `Official project: ${identity.repository}`,
    `Official releases: ${identity.repository}/releases`,
    `Official support: ${identity.repository}/issues`,
    "",
    `Installed version: ${identity.version}`,
    `Source commit: ${identity.commit}`,
    `Source snapshot: ${identity.repository}/commit/${identity.commit}`,
    `QuotaPin.Agent.exe SHA-256: ${agentHash}`,
    "",
    "For an official build, compare the version, commit, and SHA-256 with the",
    "release manifest, SHA256SUMS, and GitHub artifact attestation published by",
    "the official project.",
    "",
  ].join("\r\n");
}

function buildSpdx(identity, createdAt, nodeVersion) {
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `QuotaPin-${identity.version}`,
    documentNamespace: `${identity.repository}/spdx/${identity.version}/${identity.commit}`,
    creationInfo: {
      created: createdAt,
      creators: ["Tool: scripts/public-release.mjs"],
    },
    packages: [
      {
        name: "QuotaPin",
        SPDXID: "SPDXRef-Package-QuotaPin",
        versionInfo: identity.version,
        downloadLocation: `${identity.repository}/tree/${identity.tag}`,
        filesAnalyzed: false,
        licenseConcluded: "MIT",
        licenseDeclared: "MIT",
        copyrightText: "Copyright (c) 2026 WSL043",
      },
      {
        name: "Node.js",
        SPDXID: "SPDXRef-Package-NodeJS",
        versionInfo: nodeVersion,
        downloadLocation: `https://github.com/nodejs/node/tree/v${nodeVersion}`,
        filesAnalyzed: false,
        licenseConcluded: "MIT",
        licenseDeclared: "MIT",
        copyrightText: "Copyright Node.js contributors",
      },
    ],
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: "SPDXRef-Package-QuotaPin",
      },
      {
        spdxElementId: "SPDXRef-Package-QuotaPin",
        relationshipType: "CONTAINS",
        relatedSpdxElement: "SPDXRef-Package-NodeJS",
      },
    ],
  };
}

function exactFileNames(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile()) fail(`Release directory contains a non-file entry: ${entry.name}`);
    return entry.name;
  }).sort();
}

function assertExactNames(actual, expected, label) {
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    fail(`${label} has an unexpected asset set. Expected [${wanted.join(", ")}], found [${actual.join(", ")}].`);
  }
}

function verifySidecar(directory, name) {
  const expected = parseStrictChecksum(readText(path.join(directory, `${name}.sha256`), 4096), name);
  const actual = sha256File(path.join(directory, name));
  if (actual !== expected) fail(`Checksum mismatch: ${name}`);
}

function verifyChecksumDocument(directory) {
  const document = readText(path.join(directory, "SHA256SUMS"), 64 * 1024);
  const lines = document.split(/\r?\n/).filter(Boolean);
  const names = [];
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match) fail(`SHA256SUMS contains an invalid line: ${line}`);
    const [, expected, name] = match;
    if (names.includes(name)) fail(`SHA256SUMS contains a duplicate entry: ${name}`);
    names.push(name);
    const filePath = path.join(directory, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`SHA256SUMS references a missing file: ${name}`);
    if (sha256File(filePath) !== expected) fail(`SHA256SUMS mismatch: ${name}`);
  }
  assertExactNames(names.sort(), CHECKSUM_MEMBERS, "SHA256SUMS");
}

export function preparePublicRelease(options) {
  const root = normalizeDirectory(options.root, "Repository root");
  const source = normalizeDirectory(options.source, "Build output");
  const output = normalizeDirectory(options.output, "Public release output");
  assertOutputIsInsideRoot(root, output);

  const version = readText(path.join(root, "VERSION"), 256).trim();
  const identity = normalizeIdentity({ ...options, version });
  assertVersionDocuments(root, version);
  assertCleanGitSource(root, identity);
  const workflowRunId = String(options.workflowRunId ?? process.env.GITHUB_RUN_ID ?? "");
  if (!/^[1-9]\d*$/.test(workflowRunId)) fail("A numeric GitHub release workflow run id is required.");
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) fail("Release creation time is invalid.");

  for (const name of ["QuotaPin.Agent.exe", "THIRD_PARTY_NOTICES.txt"]) {
    const filePath = path.join(source, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`Build output is missing: ${name}`);
  }
  const licensePath = path.join(root, "LICENSE");
  if (!fs.existsSync(licensePath) || !fs.statSync(licensePath).isFile()) fail("Repository LICENSE is missing.");

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), "QuotaPin-release-payload-"));
  try {
    fs.copyFileSync(path.join(source, "QuotaPin.Agent.exe"), path.join(payload, "QuotaPin.Agent.exe"));
    fs.copyFileSync(path.join(source, "THIRD_PARTY_NOTICES.txt"), path.join(payload, "THIRD_PARTY_NOTICES.txt"));
    fs.copyFileSync(licensePath, path.join(payload, "LICENSE"));

    writeSidecar(payload, "QuotaPin.Agent.exe");
    writeSidecar(payload, "THIRD_PARTY_NOTICES.txt");
    const agentHash = sha256File(path.join(payload, "QuotaPin.Agent.exe"));
    writeJson(path.join(payload, "origin.json"), buildOrigin(identity, agentHash));
    writeText(path.join(payload, "OFFICIAL_SOURCE.txt"), buildOfficialSource(identity, agentHash));
    writeJson(path.join(payload, "QuotaPin.spdx.json"), buildSpdx(identity, createdAt, process.versions.node));

    const manifest = {
      schemaVersion: "quotapin-release/v1",
      product: "QuotaPin",
      version: identity.version,
      installMode: "command",
      source: {
        repository: identity.repository,
        commit: identity.commit,
        tag: identity.tag,
        dirty: false,
      },
      build: {
        createdAt,
        context: "github-release-workflow",
        workflowRunId,
        node: process.versions.node,
        packageLockSha256: sha256File(path.join(root, "package-lock.json")),
      },
      trust: {
        distribution: "github-release",
        autoUpdateEligible: false,
        userConfirmationRequired: true,
        automaticInstallation: false,
        attestationSubject: ZIP_BUNDLE_NAME,
      },
      artifacts: PRIMARY_ARTIFACTS.map((name) => fileRecord(payload, name)),
      sbom: {
        format: "SPDX-2.3",
        name: "QuotaPin.spdx.json",
        sha256: sha256File(path.join(payload, "QuotaPin.spdx.json")),
      },
    };
    writeJson(path.join(payload, "QuotaPin-release.json"), manifest);
    writeSidecar(payload, "QuotaPin-release.json");
    writeText(path.join(payload, "SHA256SUMS"), `${CHECKSUM_MEMBERS.map((name) => checksumLine(payload, name)).join("\n")}\n`);
    verifyReleasePayload({ directory: payload, root, ...identity });

    fs.writeFileSync(path.join(output, ZIP_BUNDLE_NAME), createReleaseZip(payload, RELEASE_BUNDLE_MEMBERS, createdAt));
    writeSidecar(output, ZIP_BUNDLE_NAME);
    return verifyPublicRelease({ directory: output, root, ...identity });
  } finally {
    fs.rmSync(payload, { recursive: true, force: true });
  }
}

function verifyReleasePayload(options) {
  const directory = normalizeDirectory(options.directory, "Release bundle payload");
  const actualNames = exactFileNames(directory);
  assertExactNames(actualNames, RELEASE_BUNDLE_MEMBERS, "Release bundle payload");
  if (actualNames.some((name) => /(?:setup|tray)/i.test(name))) fail("Setup or tray files are forbidden in a command release.");

  const manifest = readJson(path.join(directory, "QuotaPin-release.json"));
  const identity = normalizeIdentity({
    repository: options.repository ?? manifest?.source?.repository,
    commit: options.commit ?? manifest?.source?.commit,
    tag: options.tag ?? manifest?.source?.tag,
    version: manifest?.version,
  });
  if (manifest.schemaVersion !== "quotapin-release/v1" || manifest.product !== "QuotaPin" || manifest.installMode !== "command") {
    fail("Command release manifest identity is invalid.");
  }
  if (manifest.source?.repository !== identity.repository || manifest.source?.commit !== identity.commit
    || manifest.source?.tag !== identity.tag || manifest.source?.dirty !== false) {
    fail("Command release manifest source is invalid.");
  }
  if (!HASH_PATTERN.test(String(manifest.build?.packageLockSha256 ?? ""))) fail("Command release package-lock provenance is invalid.");
  if (manifest.build?.context !== "github-release-workflow" || !/^[1-9]\d*$/.test(String(manifest.build?.workflowRunId ?? ""))) {
    fail("Command release workflow provenance is invalid.");
  }
  if (manifest.trust?.automaticInstallation !== false || manifest.trust?.autoUpdateEligible !== false
    || manifest.trust?.userConfirmationRequired !== true
    || manifest.trust?.attestationSubject !== ZIP_BUNDLE_NAME) {
    fail("Command release trust policy is invalid.");
  }
  if (/setup|tray/i.test(JSON.stringify(manifest))) fail("Command release manifest contains forbidden Setup or tray metadata.");

  if (options.root) {
    const root = normalizeDirectory(options.root, "Repository root");
    assertVersionDocuments(root, identity.version);
    if (manifest.build?.packageLockSha256 !== sha256File(path.join(root, "package-lock.json"))) {
      fail("Command release package-lock provenance does not match the source checkout.");
    }
  }

  const artifactNames = Array.isArray(manifest.artifacts) ? manifest.artifacts.map((item) => item?.name).sort() : [];
  assertExactNames(artifactNames, PRIMARY_ARTIFACTS, "Command release manifest");
  for (const record of manifest.artifacts) {
    const actual = fileRecord(directory, record.name);
    if (record.bytes !== actual.bytes || record.sha256 !== actual.sha256) fail(`Manifest artifact mismatch: ${record.name}`);
  }

  const origin = readJson(path.join(directory, "origin.json"));
  const agentHash = sha256File(path.join(directory, "QuotaPin.Agent.exe"));
  if (origin.schemaVersion !== "quotapin-origin-file/v1" || origin.product !== "QuotaPin" || origin.version !== identity.version
    || origin.repository !== identity.repository || origin.commit !== identity.commit || origin.artifact?.name !== "QuotaPin.Agent.exe"
    || origin.artifact?.sha256 !== agentHash) {
    fail("Command release origin record is invalid.");
  }

  const sbom = readJson(path.join(directory, "QuotaPin.spdx.json"));
  if (sbom.spdxVersion !== "SPDX-2.3" || sbom.name !== `QuotaPin-${identity.version}`
    || !String(sbom.documentNamespace ?? "").endsWith(`/${identity.version}/${identity.commit}`)
    || manifest.sbom?.name !== "QuotaPin.spdx.json"
    || manifest.sbom?.sha256 !== sha256File(path.join(directory, "QuotaPin.spdx.json"))) {
    fail("Command release SBOM is invalid.");
  }

  verifySidecar(directory, "QuotaPin.Agent.exe");
  verifySidecar(directory, "THIRD_PARTY_NOTICES.txt");
  verifySidecar(directory, "QuotaPin-release.json");
  verifyChecksumDocument(directory);

  const officialSource = readText(path.join(directory, "OFFICIAL_SOURCE.txt"));
  for (const anchor of [identity.repository, identity.version, identity.commit, agentHash]) {
    if (!officialSource.includes(anchor)) fail(`OFFICIAL_SOURCE.txt is missing release identity: ${anchor}`);
  }
  if (/setup|tray/i.test(officialSource)) fail("OFFICIAL_SOURCE.txt contains forbidden Setup or tray text.");

  return {
    version: identity.version,
    commit: identity.commit,
    tag: identity.tag,
    members: [...RELEASE_BUNDLE_MEMBERS],
    agentSha256: agentHash,
  };
}

export function verifyPublicRelease(options) {
  const directory = normalizeDirectory(options.directory, "Public release directory");
  const actualNames = exactFileNames(directory);
  assertExactNames(actualNames, PUBLIC_RELEASE_ASSETS, "Public release directory");
  verifySidecar(directory, ZIP_BUNDLE_NAME);
  const archivePath = path.join(directory, ZIP_BUNDLE_NAME);
  const entries = readReleaseZip(archivePath);
  assertExactNames([...entries.keys()].sort(), RELEASE_BUNDLE_MEMBERS, "Release ZIP");
  const payload = fs.mkdtempSync(path.join(os.tmpdir(), "QuotaPin-release-verify-"));
  try {
    for (const [name, content] of entries) fs.writeFileSync(path.join(payload, name), content);
    const result = verifyReleasePayload({ ...options, directory: payload });
    return {
      ...result,
      assets: [...PUBLIC_RELEASE_ASSETS],
      bundleSha256: sha256File(archivePath),
    };
  } finally {
    fs.rmSync(payload, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) fail(`Invalid argument: ${flag ?? "(missing)"}`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())] = value;
  }
  return { command, options };
}

function runCli() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "prepare") {
    const result = preparePublicRelease(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "verify") {
    const result = verifyPublicRelease(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "list") {
    process.stdout.write(`${PUBLIC_RELEASE_ASSETS.join("\n")}\n`);
    return;
  }
  fail("Usage: node scripts/public-release.mjs <prepare|verify|list> [--name value ...]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`Public release error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
