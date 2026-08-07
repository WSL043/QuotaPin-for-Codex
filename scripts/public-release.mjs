import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICIAL_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function packageNameForVersion(version) {
  const normalized = String(version ?? "").trim();
  if (!VERSION_PATTERN.test(normalized)) fail("Release package version is invalid.");
  return `QuotaPin-${normalized}.exe`;
}

export function macPackageNameForVersion(version) {
  const normalized = String(version ?? "").trim();
  if (!VERSION_PATTERN.test(normalized)) fail("Release package version is invalid.");
  return `QuotaPin-macOS-${normalized}.dmg`;
}

export function publicReleaseAssets(version) {
  return Object.freeze([packageNameForVersion(version), macPackageNameForVersion(version)]);
}

export function windowsFileVersionForVersion(version) {
  const match = /^(\d+\.\d+\.\d+)(?:-(?:alpha|beta)\.(\d+))?$/.exec(String(version ?? "").trim());
  if (!match) fail("Release version cannot be represented as a Windows file version.");
  return `${match[1]}.${match[2] ?? "0"}`;
}

function candidateFiles(version) {
  return Object.freeze([...publicReleaseAssets(version), "QuotaPin-release.json", "QuotaPin.spdx.json"]);
}

function fail(message) {
  throw new Error(message);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${path.basename(filePath)}: ${error.message}`);
  }
}

function normalizeDirectory(value, label) {
  if (!value) fail(`${label} is required.`);
  return path.resolve(String(value));
}

function assertOutputIsInsideRoot(root, output) {
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("Public release output must be a child directory of the repository.");
  }
}

function exactNames(directory, expected, label) {
  const actual = fs.readdirSync(directory, { withFileTypes: true });
  if (actual.some((entry) => !entry.isFile())) fail(`${label} contains a non-file entry.`);
  const actualNames = actual.map((entry) => entry.name).sort();
  const expectedNames = [...expected].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail(`${label} differs from policy. Expected ${expectedNames.join(", ")}; found ${actualNames.join(", ")}.`);
  }
}

function sourceIdentity(options) {
  const root = normalizeDirectory(options.root, "Repository root");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  if (!VERSION_PATTERN.test(version)) fail("VERSION is not a supported semantic version.");
  const repository = String(options.repository ?? OFFICIAL_REPOSITORY).replace(/\/$/, "");
  if (repository !== OFFICIAL_REPOSITORY) fail("Release repository is not the official project.");
  const commit = String(options.commit ?? "").trim();
  if (!COMMIT_PATTERN.test(commit)) fail("Release commit must be a full lowercase SHA.");
  const tag = String(options.tag ?? "").trim();
  if (tag !== `v${version}`) fail(`Release tag ${tag || "(empty)"} does not match VERSION ${version}.`);
  const workflowRunId = String(options.workflowRunId ?? "").trim();
  if (options.requireWorkflow && !/^[1-9]\d*$/.test(workflowRunId)) fail("A GitHub workflow run id is required.");
  return { root, version, repository, commit, tag, workflowRunId };
}

function inspectWindowsPackage(packagePath) {
  if (process.env.QUOTAPIN_TEST_SKIP_PE_IDENTITY === "1") return null;
  if (process.platform !== "win32") return null;
  const script = [
    "$ErrorActionPreference='Stop'",
    `$item=Get-Item -LiteralPath '${packagePath.replaceAll("'", "''")}'`,
    "$item.VersionInfo | Select-Object ProductVersion,FileDescription,OriginalFilename | ConvertTo-Json -Compress",
  ].join("; ");
  const raw = execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
  return JSON.parse(raw.split(/\r?\n/).at(-1));
}

function verifyCandidateDirectory(directory, identity, expectedContext = "github-release-workflow") {
  const packageName = packageNameForVersion(identity.version);
  const macPackageName = macPackageNameForVersion(identity.version);
  exactNames(directory, candidateFiles(identity.version), "Release candidate");
  const packagePath = path.join(directory, packageName);
  const macPackagePath = path.join(directory, macPackageName);
  const manifestPath = path.join(directory, "QuotaPin-release.json");
  const sbomPath = path.join(directory, "QuotaPin.spdx.json");
  if (fs.statSync(packagePath).size <= 0 || fs.statSync(packagePath).size > 160 * 1024 * 1024) fail("QuotaPin.exe has an invalid size.");
  if (fs.statSync(macPackagePath).size <= 0 || fs.statSync(macPackagePath).size > 160 * 1024 * 1024) fail("QuotaPin macOS package has an invalid size.");
  const packageHash = sha256File(packagePath);
  const macPackageHash = sha256File(macPackagePath);
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== "quotapin-release/v1" || manifest.product !== "QuotaPin" || manifest.version !== identity.version) {
    fail("Release manifest identity is invalid.");
  }
  if (manifest.source?.repository !== identity.repository || manifest.source?.commit !== identity.commit ||
      manifest.source?.tag !== identity.tag || manifest.source?.dirty !== false) {
    fail("Release manifest source is invalid.");
  }
  if (manifest.build?.context !== expectedContext || String(manifest.build?.workflowRunId ?? "") !== identity.workflowRunId) {
    fail("Release manifest workflow provenance is invalid.");
  }
  if (manifest.trust?.immutableGitHubReleaseRequired !== true ||
      manifest.trust?.exactAssetDigestRequired !== true ||
      manifest.trust?.userConfirmationRequired !== true) {
    fail("Release manifest trust policy is incomplete.");
  }
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const expectedArtifacts = new Map([
    [packageName, { sha256: packageHash, bytes: fs.statSync(packagePath).size }],
    [macPackageName, { sha256: macPackageHash, bytes: fs.statSync(macPackagePath).size }],
  ]);
  if (artifacts.length !== expectedArtifacts.size || artifacts.some((artifact) => {
    const expected = expectedArtifacts.get(artifact?.name);
    return !expected || artifact?.sha256 !== expected.sha256 || Number(artifact?.bytes) !== expected.bytes;
  })) {
    fail("Release manifest does not bind the exact cross-platform public installers.");
  }
  const sbomHash = sha256File(sbomPath);
  const sbom = readJson(sbomPath);
  if (sbom.spdxVersion !== "SPDX-2.3" || sbom.name !== `QuotaPin-${identity.version}` ||
      manifest.sbom?.name !== "QuotaPin.spdx.json" || manifest.sbom?.sha256 !== sbomHash) {
    fail("Release SBOM identity is invalid.");
  }
  const windowsIdentity = inspectWindowsPackage(packagePath);
  if (windowsIdentity && (String(windowsIdentity.ProductVersion ?? "").trim() !== windowsFileVersionForVersion(identity.version) ||
      !String(windowsIdentity.FileDescription ?? "").includes(identity.repository) ||
      String(windowsIdentity.OriginalFilename ?? "").trim() !== packageName)) {
    fail(`${packageName} version metadata does not match the release.`);
  }
  return {
    version: identity.version,
    commit: identity.commit,
    tag: identity.tag,
    asset: packageName,
    assets: publicReleaseAssets(identity.version),
    bytes: fs.statSync(packagePath).size,
    sha256: packageHash,
    macBytes: fs.statSync(macPackagePath).size,
    macSha256: macPackageHash,
    sbomSha256: sbomHash,
  };
}

function stageCandidate(options, identity, outputLabel, expectedContext) {
  const source = normalizeDirectory(options.source, "Build output");
  const output = normalizeDirectory(options.output, outputLabel);
  assertOutputIsInsideRoot(identity.root, output);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) fail("Build output directory was not found.");
  const files = candidateFiles(identity.version);
  for (const name of files) {
    const sourcePath = path.join(source, name);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) fail(`Required release file is missing: ${name}`);
  }
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(source, name), path.join(output, name));
  return verifyCandidateDirectory(output, identity, expectedContext);
}

export function preparePublicRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  return stageCandidate(options, identity, "Public output", "github-release-workflow");
}

export function verifyPublicRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  const directory = normalizeDirectory(options.directory, "Release candidate directory");
  return verifyCandidateDirectory(directory, identity, "github-release-workflow");
}

export function prepareCiCandidate(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  return stageCandidate(options, identity, "CI candidate output", "github-ci-workflow");
}

export function verifyCiCandidate(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  const directory = normalizeDirectory(options.directory, "CI candidate directory");
  return verifyCandidateDirectory(directory, identity, "github-ci-workflow");
}

export function verifyPublishedRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: false });
  const directory = normalizeDirectory(options.directory, "Published release directory");
  const packageName = packageNameForVersion(identity.version);
  exactNames(directory, publicReleaseAssets(identity.version), "Published release");
  const suppliedDigests = typeof options.digests === "string" ? readDigestMap(options.digests) : options.digests;
  const results = publicReleaseAssets(identity.version).map((asset) => {
    const assetPath = path.join(directory, asset);
    const actual = sha256File(assetPath);
    const expected = String(suppliedDigests?.[asset] ?? "").replace(/^sha256:/, "");
    if (!HASH_PATTERN.test(expected) || actual !== expected) fail(`Published ${asset} does not match GitHub's SHA-256 digest.`);
    return { asset, bytes: fs.statSync(assetPath).size, sha256: actual };
  });
  const packagePath = path.join(directory, packageName);
  const windowsIdentity = inspectWindowsPackage(packagePath);
  if (windowsIdentity && (String(windowsIdentity.ProductVersion ?? "").trim() !== windowsFileVersionForVersion(identity.version) ||
      !String(windowsIdentity.FileDescription ?? "").includes(identity.repository) ||
      String(windowsIdentity.OriginalFilename ?? "").trim() !== packageName)) {
    fail(`Published ${packageName} version metadata does not match the release.`);
  }
  const windows = results.find((result) => result.asset === packageName);
  return { version: identity.version, commit: identity.commit, tag: identity.tag, asset: packageName, assets: results, bytes: windows.bytes, sha256: windows.sha256 };
}

function readDigestMap(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("Published release digest map is invalid.");
    return parsed;
  } catch (error) {
    if (error?.message === "Published release digest map is invalid.") throw error;
    fail(`Published release digest map is invalid: ${error.message}`);
  }
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item.startsWith("--")) fail(`Unexpected argument: ${item}`);
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${item}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "list") {
    const root = process.cwd();
    const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
    process.stdout.write(`${publicReleaseAssets(version).join("\n")}\n`);
    return;
  }
  const options = parseArguments(rest);
  let result;
  if (command === "prepare") result = preparePublicRelease(options);
  else if (command === "verify") result = verifyPublicRelease(options);
  else if (command === "prepare-ci") result = prepareCiCandidate(options);
  else if (command === "verify-ci") result = verifyCiCandidate(options);
  else if (command === "verify-published") result = verifyPublishedRelease(options);
  else fail("Usage: public-release.mjs <prepare|verify|prepare-ci|verify-ci|verify-published|list> [options]");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
