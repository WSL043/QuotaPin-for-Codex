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

export function publicReleaseAssets(version) {
  return Object.freeze([packageNameForVersion(version)]);
}

function candidateFiles(version) {
  return Object.freeze([packageNameForVersion(version), "QuotaPin-release.json", "QuotaPin.spdx.json"]);
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

function verifyCandidateDirectory(directory, identity) {
  const packageName = packageNameForVersion(identity.version);
  exactNames(directory, candidateFiles(identity.version), "Release candidate");
  const packagePath = path.join(directory, packageName);
  const manifestPath = path.join(directory, "QuotaPin-release.json");
  const sbomPath = path.join(directory, "QuotaPin.spdx.json");
  if (fs.statSync(packagePath).size <= 0 || fs.statSync(packagePath).size > 160 * 1024 * 1024) fail("QuotaPin.exe has an invalid size.");
  const packageHash = sha256File(packagePath);
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== "quotapin-release/v1" || manifest.product !== "QuotaPin" || manifest.version !== identity.version) {
    fail("Release manifest identity is invalid.");
  }
  if (manifest.source?.repository !== identity.repository || manifest.source?.commit !== identity.commit ||
      manifest.source?.tag !== identity.tag || manifest.source?.dirty !== false) {
    fail("Release manifest source is invalid.");
  }
  if (manifest.build?.context !== "github-release-workflow" || String(manifest.build?.workflowRunId ?? "") !== identity.workflowRunId) {
    fail("Release manifest workflow provenance is invalid.");
  }
  if (manifest.trust?.immutableGitHubReleaseRequired !== true ||
      manifest.trust?.exactAssetDigestRequired !== true ||
      manifest.trust?.githubArtifactAttestationRequired !== true ||
      manifest.trust?.userConfirmationRequired !== true) {
    fail("Release manifest trust policy is incomplete.");
  }
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length !== 1 || artifacts[0]?.name !== packageName ||
      artifacts[0]?.sha256 !== packageHash || Number(artifacts[0]?.bytes) !== fs.statSync(packagePath).size) {
    fail("Release manifest does not bind the single public installer.");
  }
  const sbomHash = sha256File(sbomPath);
  const sbom = readJson(sbomPath);
  if (sbom.spdxVersion !== "SPDX-2.3" || sbom.name !== `QuotaPin-${identity.version}` ||
      manifest.sbom?.name !== "QuotaPin.spdx.json" || manifest.sbom?.sha256 !== sbomHash) {
    fail("Release SBOM identity is invalid.");
  }
  const windowsIdentity = inspectWindowsPackage(packagePath);
  if (windowsIdentity && (String(windowsIdentity.ProductVersion ?? "").trim() !== identity.version ||
      !String(windowsIdentity.FileDescription ?? "").includes(identity.repository) ||
      String(windowsIdentity.OriginalFilename ?? "") !== packageName)) {
    fail(`${packageName} version metadata does not match the release.`);
  }
  return {
    version: identity.version,
    commit: identity.commit,
    tag: identity.tag,
    asset: packageName,
    bytes: fs.statSync(packagePath).size,
    sha256: packageHash,
    sbomSha256: sbomHash,
  };
}

export function preparePublicRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  const source = normalizeDirectory(options.source, "Build output");
  const output = normalizeDirectory(options.output, "Public output");
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
  return verifyCandidateDirectory(output, identity);
}

export function verifyPublicRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: true });
  const directory = normalizeDirectory(options.directory, "Release candidate directory");
  return verifyCandidateDirectory(directory, identity);
}

export function verifyPublishedRelease(options) {
  const identity = sourceIdentity({ ...options, requireWorkflow: false });
  const directory = normalizeDirectory(options.directory, "Published release directory");
  const packageName = packageNameForVersion(identity.version);
  exactNames(directory, publicReleaseAssets(identity.version), "Published release");
  const packagePath = path.join(directory, packageName);
  const actual = sha256File(packagePath);
  const expected = String(options.digest ?? "").replace(/^sha256:/, "");
  if (!HASH_PATTERN.test(expected) || actual !== expected) fail("Published QuotaPin.exe does not match GitHub's SHA-256 digest.");
  const windowsIdentity = inspectWindowsPackage(packagePath);
  if (windowsIdentity && (String(windowsIdentity.ProductVersion ?? "").trim() !== identity.version ||
      !String(windowsIdentity.FileDescription ?? "").includes(identity.repository) ||
      String(windowsIdentity.OriginalFilename ?? "") !== packageName)) {
    fail(`Published ${packageName} version metadata does not match the release.`);
  }
  return { version: identity.version, commit: identity.commit, tag: identity.tag, asset: packageName, bytes: fs.statSync(packagePath).size, sha256: actual };
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
  else if (command === "verify-published") result = verifyPublishedRelease(options);
  else fail("Usage: public-release.mjs <prepare|verify|verify-published|list> [options]");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
