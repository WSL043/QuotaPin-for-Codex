import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");
const version = read("VERSION").trim();

test("the moving bootstrap defaults to immutable stable and accepts an explicit published version", () => {
  const source = read("install.ps1");
  assert.match(source, /\[string\]\$Version = ''/);
  assert.match(source, /releases\/latest/);
  assert.match(source, /releases\/tags\/v\$RequestedVersion/);
  assert.match(source, /\$Release\.immutable -ne \$true/);
  assert.match(source, /GitHub returned a prerelease for the stable/);
  assert.match(source, /\$PackageName = "QuotaPin-\$SelectedVersion\.exe"/);
  assert.match(source, /Receive-QuotaPinBootstrapFile/);
  assert.match(source, /Write-Host "Downloading \$DisplayName\$SizeText/);
  assert.match(source, /OriginalFilename\)\.Trim\(\) -cne \$PackageName/);
  assert.match(source, /\$Process\.WaitForExit\(\)/);
  assert.doesNotMatch(source, /Start-Process -FilePath \$PackagePath[^\r\n]*-Wait/);
  assert.match(source, /--continue-at -/);
  assert.match(source, /--progress-bar/);
  assert.match(source, /foreach \(\$Attempt in 1\.\.6\)/);
  assert.doesNotMatch(source, /\$BootstrapVersion\s*=/);
});

test("localized quick starts install the latest stable release without forcing a version", () => {
  for (const relativePath of ["README.md", "README.zh-CN.md", "README.ja.md"]) {
    const source = read(relativePath);
    const quickStart = source.match(/```powershell\s*([\s\S]*?)```/)?.[1] ?? "";
    assert.match(source, /raw\.githubusercontent\.com\/WSL043\/QuotaPin-for-Codex\/main\/install\.ps1/);
    assert.match(quickStart, /^irm\s+https:\/\/raw\.githubusercontent\.com\/WSL043\/QuotaPin-for-Codex\/main\/install\.ps1\s*\|\s*iex\s*$/im);
    assert.doesNotMatch(quickStart, /scriptblock/i);
    assert.doesNotMatch(quickStart, /\s-Version\s/);
  }
});

test("advanced maintenance retains exact stable version selection outside Quick Start", () => {
  for (const relativePath of ["AGENTS.md", "docs/configuration.md"]) {
    const source = read(relativePath);
    assert.match(source, /raw\.githubusercontent\.com\/WSL043\/QuotaPin-for-Codex\/main\/install\.ps1/);
    assert.match(source, /\[scriptblock\]::Create/);
    assert.ok(source.includes(`-Version '${version}'`));
  }
});

test("the updater installs the shared package, defers attachment, and never launches Codex", () => {
  const update = read("scripts/update.ps1");
  const trust = read("src/runtime-trust.ps1");
  assert.match(update, /\$PackageName = "QuotaPin-\$Version\.exe"/);
  assert.match(update, /'\/COMMANDINSTALL=1'/);
  assert.match(update, /'\/NORESTART'/);
  assert.match(update, /\$Process\.WaitForExit\(\)/);
  assert.doesNotMatch(update, /Start-Process -FilePath \$PackagePath[^\r\n]*-Wait/);
  assert.match(update, /Attachment will retry on the next Codex launch/);
  assert.doesNotMatch(update, /Start-Process[^\r\n]*(?:ChatGPT|Codex\.exe|launch\.ps1)/i);
  assert.match(trust, /Start-Process -FilePath \$ResolvedAgentPath/);
  assert.doesNotMatch(trust, /Start-Process[^\r\n]*(?:ChatGPT|Codex\.exe|launch\.ps1)/i);
});
