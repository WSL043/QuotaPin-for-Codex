import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");

test("the moving bootstrap defaults to immutable stable and accepts an explicit published version", () => {
  const source = read("install.ps1");
  assert.match(source, /\[string\]\$Version = ''/);
  assert.match(source, /releases\/latest/);
  assert.match(source, /releases\/tags\/v\$RequestedVersion/);
  assert.match(source, /\$Release\.immutable -ne \$true/);
  assert.match(source, /GitHub returned a prerelease for the stable/);
  assert.match(source, /Downloaded QuotaPin version \$DownloadedVersion does not match selected version/);
  assert.match(source, /Receive-QuotaPinBootstrapArchive/);
  assert.match(source, /--continue-at -/);
  assert.match(source, /foreach \(\$Attempt in 1\.\.6\)/);
  assert.doesNotMatch(source, /\$BootstrapVersion\s*=/);
});

test("localized quick starts install the latest stable release without forcing a version", () => {
  for (const relativePath of ["README.md", "README.zh-CN.md", "README.ja.md"]) {
    const source = read(relativePath);
    const quickStart = source.match(/```powershell\s*([\s\S]*?)```/)?.[1] ?? "";
    assert.match(source, /raw\.githubusercontent\.com\/WSL043\/QuotaPin-for-Codex\/main\/install\.ps1/);
    assert.match(quickStart, /install\.ps1/);
    assert.doesNotMatch(quickStart, /\s-Version\s/);
  }
});

test("advanced maintenance retains exact stable version selection outside Quick Start", () => {
  for (const relativePath of ["AGENTS.md", "docs/configuration.md"]) {
    const source = read(relativePath);
    assert.match(source, /raw\.githubusercontent\.com\/WSL043\/QuotaPin-for-Codex\/main\/install\.ps1/);
    assert.match(source, /\[scriptblock\]::Create/);
    assert.match(source, /-Version '1\.0\.0'/);
  }
});

test("the updater can hot-reattach or defer, but never launches Codex", () => {
  const update = read("scripts/update.ps1");
  const trust = read("src/runtime-trust.ps1");
  assert.match(update, /& \$InstallerPath -DeferRuntimeResume/);
  assert.match(update, /Resume-QuotaPinTrustedRuntime/);
  assert.match(update, /Attachment will retry on the next Codex launch/);
  assert.doesNotMatch(update, /Start-Process[^\r\n]*(?:ChatGPT|Codex\.exe|launch\.ps1)/i);
  assert.match(trust, /Start-Process -FilePath \$ResolvedAgentPath/);
  assert.doesNotMatch(trust, /Start-Process[^\r\n]*(?:ChatGPT|Codex\.exe|launch\.ps1)/i);
});
