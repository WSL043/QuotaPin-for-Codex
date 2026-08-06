import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { packageNameForVersion, publicReleaseAssets } from "../scripts/public-release.mjs";

const workflowsRoot = new URL("../.github/workflows/", import.meta.url);
const VERSION = fs.readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();
const PUBLIC_PACKAGE = packageNameForVersion(VERSION);

function workflow(name) {
  return fs.readFileSync(new URL(name, workflowsRoot), "utf8");
}

test("pull-request CI exercises source behavior without publishing an installer", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/check.yml", import.meta.url), "utf8");
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.doesNotMatch(workflow, /- beta/);
  assert.match(workflow, /- develop/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /macos-developer-preview:[\s\S]*?runs-on: macos-latest/);
  assert.match(workflow, /Verify platform-neutral quota, renderer, and Mac adapter core/);
  assert.match(workflow, /scripts\/macos\/build-dev\.sh/);
  assert.match(workflow, /QuotaPin-macOS-dev-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /retention-days: 7/);
  for (const script of ["scripts\\install-inno-ci.ps1", "scripts\\build-windows.ps1"]) {
    assert.ok(workflow.includes(script), `check workflow does not run ${script}`);
  }
  assert.doesNotMatch(workflow, /choco install innosetup/i);
  assert.match(workflow, /public-release\.mjs prepare-ci/);
  assert.match(workflow, /public-release\.mjs verify-ci/);
  assert.match(workflow, /verify-ci[^\r\n]*--workflow-run-id \$env:GITHUB_RUN_ID/);
  assert.match(workflow, /git tag \$candidateTag \$commit/);
  assert.match(workflow, /finally \{[\s\S]*?git tag --delete \$candidateTag/);
});

test("tag workflow builds and publishes only the exact versioned executable", () => {
  const release = workflow("release.yml");
  assert.doesNotMatch(release, /workflow_dispatch|QuotaPin-Setup/i);
  assert.match(release, /scripts\\build-windows\.ps1/);
  assert.match(release, /scripts\\install-inno-ci\.ps1/);
  assert.match(release, /public-release\.mjs prepare[\s\S]*?--output dist\/public/);
  assert.match(release, /public-release\.mjs verify/);
  assert.match(release, /verify[\s\S]*?--workflow-run-id \$env:GITHUB_RUN_ID/);
  assert.match(release, /path: dist\/public\//);
  assert.match(release, /node scripts\/public-release\.mjs list/);
  assert.match(release, /release delete-asset/);
  assert.match(release, /Remote draft asset set differs from policy/);
  assert.match(release, /PUBLIC_ASSET=QuotaPin-\$version\.exe/);
  assert.match(release, /subject-path: release\/\$\{\{ env\.PUBLIC_ASSET \}\}/);
  assert.match(release, /sbom-path: release\/QuotaPin\.spdx\.json/);
  assert.match(release, /artifact-metadata: write/);
  assert.match(release, /github\.event\.repository\.private == false/);
  assert.match(release, /--notes-file \$notesPath/);
  assert.doesNotMatch(release, /--generate-notes/);
  assert.match(release, /GH_REPO:\s*\$\{\{ github\.repository \}\}/);
  assert.match(release, /GitHub Releases accept reviewed stable or beta versions only/);
  assert.match(release, /git merge-base --is-ancestor \$env:GITHUB_SHA 'refs\/remotes\/origin\/main'/);
  assert.match(release, /release tag commit is not reachable from origin\/main/);
  assert.match(release, /\$isBeta = \$version -cmatch/);
  assert.match(release, /\$prereleaseFlag = if \(\$isBeta\)/);
  assert.match(release, /\$latestFlag = if \(\$isStable\)/);
  assert.match(release, /"--prerelease=\$prereleaseFlag" "--latest=\$latestFlag"/);
  assert.match(release, /Stable release \$tag was not confirmed as Latest/);
  assert.match(release, /node -p "require\('\.\/package-lock\.json'\)\.version"/);
  assert.doesNotMatch(release, /package-lock\.json \| ConvertFrom-Json/);
  assert.match(release, /repos\/\$env:GH_REPO\/releases\/tags\/\$tag/);
  assert.match(release, /Published release \$tag was not confirmed immutable/);
});

test("public entrypoints default to stable while the remote bootstrap fails closed", () => {
  const expected = "https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1";
  for (const relative of ["README.md", "README.zh-CN.md", "README.ja.md"]) {
    const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    const quickStart = source.match(/```powershell\s*([\s\S]*?)```/)?.[1] ?? "";
    assert.ok(source.includes(expected), `${relative} lost the stable bootstrap URL`);
    assert.match(quickStart, /install\.ps1/);
    assert.doesNotMatch(quickStart, /\s-Version\s/);
  }
  for (const relative of ["AGENTS.md", "docs/configuration.md"]) {
    const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.ok(source.includes(expected), `${relative} lost the stable bootstrap URL`);
    assert.ok(source.includes(`-Version '${VERSION}'`));
  }
  const bootstrap = fs.readFileSync(new URL("../install.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(bootstrap, /\[string\]\$(?:ArchiveUrl|AgentUrl)/);
  assert.match(bootstrap, /releases\/latest/);
  assert.match(bootstrap, /releases\/tags\/v\$RequestedVersion/);
  assert.match(bootstrap, /'X-GitHub-Api-Version' = '2026-03-10'/);
  assert.match(bootstrap, /\$Release\.immutable -ne \$true/);
});

test("Codex command discovery validates the exact intended publisher", () => {
  for (const relative of ["src/codex-command.ps1", "scripts/check-prerequisites.ps1"]) {
    const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.match(source, /GetNameInfo\(\[Security\.Cryptography\.X509Certificates\.X509NameType\]::SimpleName/);
    assert.match(source, /\$Publisher -ceq 'OpenAI OpCo, LLC'/);
    assert.match(source, /O=\(\?:\"OpenAI OpCo, LLC\"\|OpenAI OpCo\\\\, LLC\)/);
    assert.doesNotMatch(source, /\$Signer -match 'OpenAI'/);
  }
});

test("no workflow artifact path can leak a legacy Setup payload", () => {
  const workflowDirectory = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
  for (const entry of fs.readdirSync(workflowDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const source = fs.readFileSync(path.join(workflowDirectory, entry.name), "utf8");
    assert.doesNotMatch(source, /path:\s*[^\r\n]*(?:setup|tray)/i, entry.name);
  }
});

test("development artifacts, beta prereleases, and stable releases have separate channels", () => {
  const policy = fs.readFileSync(new URL("../docs/maintainers/release-policy.md", import.meta.url), "utf8");
  const release = workflow("release.yml");
  assert.match(policy, /Development builds use the source commit identity and Actions artifact name/);
  assert.match(policy, /Public stable tags use `vMAJOR\.MINOR\.PATCH`/);
  assert.match(policy, /public beta tags use `vMAJOR\.MINOR\.PATCH-beta\.N`/);
  assert.match(policy, /Betas are GitHub prereleases, are never Latest/);
  assert.doesNotMatch(release, /QuotaPin-macOS-dev/);
});

test("the public asset contract exposes one versioned executable and keeps build evidence internal", () => {
  const assets = publicReleaseAssets(VERSION);
  assert.deepEqual(assets, [PUBLIC_PACKAGE]);
  assert.equal(new Set(assets).size, 1);
  assert.match(PUBLIC_PACKAGE, new RegExp(`^QuotaPin-${VERSION.replaceAll(".", "\\.")}\\.exe$`));
  assert.ok(assets.every((name) => !/\.(?:zip|json|sha256)$/i.test(name)));
});

test("the public stable release has reviewed single-executable notes and a stable install path", () => {
  const notes = fs.readFileSync(new URL(`../.github/release-notes/v${VERSION}.md`, import.meta.url), "utf8");
  assert.match(notes, /QuotaPin/i);
  assert.match(notes, new RegExp(`QuotaPin-${VERSION.replaceAll(".", "\\.")}\\.exe`));
  assert.match(notes, /Windows 10 version 2004/i);
  assert.match(notes, /WSL043\/QuotaPin-for-Codex\/main\/install\.ps1/);
  assert.doesNotMatch(notes, /\s-Version\s/);
  assert.doesNotMatch(notes, /WSL043\/QuotaPin\/main\/install\.ps1/);
  assert.doesNotMatch(notes, /roadmap|changelog|internal history/i);
});

test("clean public export requires an explicit stable or beta channel", () => {
  const exporter = fs.readFileSync(new URL("../scripts/export-public-baseline.ps1", import.meta.url), "utf8");
  const checker = fs.readFileSync(new URL("../scripts/check-public-baseline.mjs", import.meta.url), "utf8");
  assert.match(exporter, /ValidateSet\('stable', 'beta'\)/);
  assert.match(exporter, /\$ChannelGate = if \(\$Channel -ceq 'stable'\) \{ '--require-stable' \} else \{ '--require-beta' \}/);
  assert.match(checker, /public releases require a stable VERSION/);
  assert.match(checker, /public beta export requires a beta VERSION/);
  assert.match(checker, /prerelease release notes remain in the public source/);
  assert.match(checker, /private candidate compatibility evidence remains in the public source/);
});

test("release metadata imports the signing module from its active PowerShell host", () => {
  const script = fs.readFileSync(new URL("../scripts/build-release-metadata.ps1", import.meta.url), "utf8");
  assert.match(script, /Join-Path \$PSHOME 'Modules\\Microsoft\.PowerShell\.Security/);
  assert.match(script, /Microsoft\.PowerShell\.Security\\Get-AuthenticodeSignature/);
  assert.match(script, /release metadata cannot be trusted/);
});

test("platform builds retry transient upstream license downloads without changing the payload contract", () => {
  const windowsBuild = fs.readFileSync(new URL("../scripts/build-agent.ps1", import.meta.url), "utf8");
  const macBuild = fs.readFileSync(new URL("../scripts/macos/build-dev.sh", import.meta.url), "utf8");
  assert.match(windowsBuild, /foreach \(\$Attempt in 1\.\.4\)/);
  assert.match(windowsBuild, /Invoke-WebRequest[^\r\n]*-TimeoutSec 60/);
  assert.match(macBuild, /--retry 4 --retry-all-errors/);
});

test("release identity checks normalize padded Windows version resources", () => {
  const verifier = fs.readFileSync(new URL("../scripts/public-release.mjs", import.meta.url), "utf8");
  assert.match(verifier, /String\(windowsIdentity\.ProductVersion \?\? ""\)\.trim\(\)/);
  assert.match(verifier, /String\(windowsIdentity\.OriginalFilename \?\? ""\)\.trim\(\)/);

  const bootstrap = fs.readFileSync(new URL("../install.ps1", import.meta.url), "utf8");
  const commandUpdater = fs.readFileSync(new URL("../scripts/update.ps1", import.meta.url), "utf8");
  const trayUpdater = fs.readFileSync(new URL("../src/tray/Updater.cs", import.meta.url), "utf8");
  assert.match(bootstrap, /PackageVersionInfo\.OriginalFilename\)\.Trim\(\)/);
  assert.match(commandUpdater, /VersionInfo\.OriginalFilename\)\.Trim\(\)/);
  assert.match(trayUpdater, /OriginalFilename \?\? ""\)\.Trim\(\)/);
});

test("the self-contained agent carries source origin and command install records it", () => {
  const source = fs.readFileSync(new URL("../src/injector.mjs", import.meta.url), "utf8");
  const build = fs.readFileSync(new URL("../scripts/build-agent.ps1", import.meta.url), "utf8");
  const install = fs.readFileSync(new URL("../scripts/install.ps1", import.meta.url), "utf8");
  assert.match(source, /quotapin-origin\/v1/);
  assert.match(source, /https:\/\/github\.com\/WSL043\/QuotaPin/);
  assert.match(build, /BUILD_COMMIT/);
  assert.match(build, /--build-origin/);
  assert.match(install, /agent origin metadata does not match this installer/);
  assert.match(install, /agentSha256/);
});

test("public diagnostics and privacy copy match the local usage implementation", () => {
  const trace = fs.readFileSync(new URL("../scripts/trace-live-modules.mjs", import.meta.url), "utf8");
  const privacy = fs.readFileSync(new URL("../PRIVACY.md", import.meta.url), "utf8");
  const install = fs.readFileSync(new URL("../scripts/install.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(trace, /textContent|innerText|outerHTML/);
  assert.match(trace, /overlapChanges/);
  assert.match(privacy, /numeric token-count and timestamp fields/);
  assert.match(privacy, /does not read or retain prompt text/);
  assert.doesNotMatch(install, /Get-FileHash/);
  assert.match(install, /Get-QuotaPinSha256/);
});

test("official builds keep canonical free-source and support anchors discoverable", () => {
  const canonical = "https://github.com/WSL043/QuotaPin-for-Codex";
  const support = `${canonical}/issues`;
  const tray = fs.readFileSync(new URL("../src/tray/Program.cs", import.meta.url), "utf8");
  const setup = fs.readFileSync(new URL("../installer/QuotaPin.iss", import.meta.url), "utf8");
  const metadata = fs.readFileSync(new URL("../scripts/build-release-metadata.ps1", import.meta.url), "utf8");
  const installerBuild = fs.readFileSync(new URL("../scripts/build-installer.ps1", import.meta.url), "utf8");
  const commandInstall = fs.readFileSync(new URL("../scripts/install.ps1", import.meta.url), "utf8");

  assert.ok(tray.includes(`OfficialProjectUrl = "${canonical}"`));
  assert.match(tray, /Official project \(free source\)/);
  assert.match(tray, /OpenOfficialProject\(\)/);

  for (const anchor of [
    `AppPublisherURL=${canonical}`,
    `AppSupportURL=${support}`,
    `VersionInfoDescription=QuotaPin | ${canonical}`,
    `VersionInfoProductVersion={#MyAppVersion}`,
    `VersionInfoVersion={#MyAppVersion}.0`,
    `ValueName: "OfficialSource"; ValueData: "${canonical}"`,
    `ValueName: "OfficialSupport"; ValueData: "${support}"`,
    'Source: "..\\dist\\OFFICIAL_SOURCE.txt"',
    'Source: "..\\dist\\origin.json"',
  ]) assert.ok(setup.includes(anchor), `Setup lost official origin anchor: ${anchor}`);

  assert.match(metadata, /schemaVersion = 'quotapin-origin-file\/v1'/);
  assert.match(metadata, /QuotaPin is free and open source under the MIT license/);
  assert.match(metadata, /\$Required = @\(\$PackageName,[^\r\n]*'OFFICIAL_SOURCE\.txt', 'origin\.json'\)/);
  assert.match(installerBuild, /build-release-metadata\.ps1'\) -Phase Stamp/);
  assert.match(commandInstall, /Join-Path \$InstallRoot 'origin\.json'/);
  assert.match(commandInstall, /Join-Path \$InstallRoot 'OFFICIAL_SOURCE\.txt'/);
  assert.ok(commandInstall.includes(`Official support: ${support}`));
  assert.match(metadata, /\$PackageName/);
});
