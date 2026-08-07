import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootIndex = process.argv.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : defaultRoot);
const requireStable = process.argv.includes("--require-stable");
const requireBeta = process.argv.includes("--require-beta");
if (requireStable && requireBeta) fail("choose one release channel gate");
const ignoredDirectories = new Set([".git", ".audit", "dist", "node_modules"]);
const textExtensions = new Set(["", ".cs", ".css", ".html", ".iss", ".js", ".json", ".md", ".mjs", ".ps1", ".sh", ".txt", ".yml", ".yaml"]);

function fail(message) {
  throw new Error(`Public baseline check failed: ${message}`);
}

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`missing ${relativePath}`);
  return fs.readFileSync(absolute, "utf8");
}

function walk(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else if (entry.isFile()) files.push(relative.replaceAll("\\", "/"));
  }
  return files;
}

const files = walk(root);
for (const relative of files) {
  if (/^(?:build|coverage|temp|tmp|work)(?:\/|$)/i.test(relative)) fail(`generated path is present: ${relative}`);
  if (!textExtensions.has(path.extname(relative).toLowerCase())) continue;
  const absolute = path.join(root, relative);
  if (fs.statSync(absolute).size > 2 * 1024 * 1024) continue;
  const text = fs.readFileSync(absolute, "utf8");
  for (const [pattern, label] of [
    [new RegExp("QuotaPin-" + "private-archive", "i"), "private repository name"],
    [new RegExp("codex/" + "private-preview", "i"), "private review branch"],
    [/[A-Za-z]:\\Users\\[^\\\r\n]+\\(?:Documents|Desktop|Downloads|AppData)\\/i, "local user path"],
    [/codex-clipboard-[0-9a-f-]+/i, "temporary screenshot name"],
    [/2026-08-01\\new-chat/i, "local workspace path"],
  ]) {
    if (pattern.test(text)) fail(`${label} leaked through ${relative}`);
  }
}

const version = read("VERSION").trim();
if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) fail(`unsupported VERSION ${version}`);
if (requireStable) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`public releases require a stable VERSION, found ${version}`);
  const prereleaseNotes = files.filter((relative) => /^\.github\/release-notes\/v[^/]+-(?:alpha|beta|dev|preview|rc)[^/]*\.md$/i.test(relative));
  if (prereleaseNotes.length) fail(`prerelease release notes remain in the public source: ${prereleaseNotes.join(", ")}`);
  if (/private candidate/i.test(read("docs/compatibility.md"))) fail("private candidate compatibility evidence remains in the public source");
}
if (requireBeta && !/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  fail(`public beta export requires a beta VERSION, found ${version}`);
}
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
if (packageJson.version !== version || packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
  fail("VERSION, package.json, and package-lock.json differ");
}
if (!fs.existsSync(path.join(root, ".github", "release-notes", `v${version}.md`))) fail(`missing release notes for v${version}`);

const defaultConfig = JSON.parse(read("config.default.json"));
const configSource = read("src/core/config.mjs");
const configVersion = Number(configSource.match(/export const CURRENT_CONFIG_VERSION = (\d+);/)?.[1]);
if (!Number.isInteger(configVersion) || defaultConfig.version !== configVersion) fail("default configuration schema differs from the runtime schema");

const bootstrap = read("install.ps1");
if (!bootstrap.includes("/releases/latest") || !bootstrap.includes("/releases/tags/v$RequestedVersion")) {
  fail("remote installer does not expose stable-default and explicit-version channels");
}
if (!bootstrap.includes("$Release.immutable -ne $true") || !bootstrap.includes("GitHub returned a prerelease for the stable")) {
  fail("remote installer lost immutable stable-channel validation");
}

const macBootstrap = read("install-macos.sh");
if (!macBootstrap.includes("/releases/latest") || !macBootstrap.includes("/releases/tags/v$REQUESTED_VERSION")) {
  fail("macOS remote installer does not expose stable-default and explicit-version channels");
}
if (!macBootstrap.includes('IMMUTABLE" == "true"') || !macBootstrap.includes('assets.$index.digest')) {
  fail("macOS remote installer lost immutable release or GitHub digest validation");
}
if (!macBootstrap.includes('QuotaPin-macOS-$VERSION.dmg') || !macBootstrap.includes('hdiutil attach -quiet -readonly -nobrowse')) {
  fail("macOS remote installer does not consume the verified read-only disk image");
}

for (const readme of ["README.md", "README.zh-CN.md", "README.ja.md"]) {
  const text = read(readme);
  if (!text.includes("https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1")) fail(`${readme} does not use the stable bootstrap`);
  const quickStart = text.match(/```powershell\s*([\s\S]*?)```/)?.[1] ?? "";
  if (!quickStart.includes("install.ps1")) fail(`${readme} has no PowerShell Quick Start`);
  if (/\s-Version\s/.test(quickStart)) fail(`${readme} mixes advanced version selection into the default onboarding path`);
}

const agentGuide = read("AGENTS.md");
if (!agentGuide.includes("https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1")) fail("AGENTS.md does not use the stable bootstrap");
if (!agentGuide.includes(`-Version '${version}'`) && !agentGuide.includes("-Version '1.0.0'")) fail("AGENTS.md does not retain an exact-version maintenance path");

console.log(`Public baseline OK: ${version} (${files.length} files inspected)`);
