import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const has = (text, fragment, message) => assert.ok(text.includes(fragment), message);
const lacks = (text, fragment, message) => assert.ok(!text.includes(fragment), message);
const matches = (text, pattern, message) => assert.match(text, pattern, message);
const unsealContract = (encoded) => Buffer.from(encoded, "base64").toString("utf8");

const version = read("VERSION").trim();
const packageJson = JSON.parse(read("package.json"));
const injector = read("src/injector.mjs");
const appServerRuntime = read("src/agent/app-server-runtime.mjs");
const tray = read("src/tray/Program.cs");
const updater = read("src/tray/Updater.cs");
const bootstrap = read("install.ps1");
const sourceInstaller = read("scripts/install.ps1");
const sourceUninstaller = read("scripts/uninstall.ps1");
const commandUpdater = read("scripts/update.ps1");
const updateLauncher = read("scripts/update-launcher.ps1");
const updateRuntime = read("src/agent/update-runtime.mjs");
const runtimeTrust = read("src/runtime-trust.ps1");
const stopScript = read("scripts/stop.ps1");
const autoAttach = read("src/auto-attach.ps1");
const agentBuilder = read("scripts/build-agent.ps1");
const windowsBuilder = read("scripts/build-windows.ps1");
const installerBuilder = read("scripts/build-installer.ps1");
const innoCiInstaller = read("scripts/install-inno-ci.ps1");
const codexHelpers = read("src/codex-command.ps1");
const prerequisites = read("scripts/check-prerequisites.ps1");
const macBootstrap = read("install-macos.sh");
const macBuilder = read("scripts/macos/build.sh");
const macPackager = read("scripts/macos/package-universal.sh");
const macInstaller = read("scripts/macos/install.sh");
const macInstallerApp = read("scripts/macos/installer-app.sh");
const macRuntimeEntry = read("src/macos/runtime-entry.mjs");
const macThinHost = read("src/macos/QuotaPinHost.swift");
const firstRun = read("src/first-run.ps1");
const ui = read("src/ui.ps1");
const verifierSafety = read("scripts/verify-safety.mjs");
const setup = read("installer/QuotaPin.iss");
const checkWorkflow = read(".github/workflows/check.yml");
const release = read(".github/workflows/release.yml");
const windowsArm64Acceptance = read("scripts/test-windows-arm64-emulation.ps1");
const publicRelease = read("scripts/public-release.mjs");
const readmes = [read("README.md"), read("README.zh-CN.md"), read("README.ja.md")];
const compatibility = read("docs/compatibility.md");
const publicDocs = [...readmes, compatibility, read("docs/configuration.md"), read("docs/architecture.md")].join("\n");

assert.equal(
  fs.existsSync(path.join(root, "src/open-settings.ps1")),
  false,
  "the retired external settings bridge must stay deleted",
);
assert.equal(packageJson.version, version, "package.json and VERSION must agree");
has(injector, `const VERSION = "${version}"`, "injector version must match VERSION");
const versionMatch = /^(\d+\.\d+\.\d+)(?:-(?:alpha|beta)\.(\d+))?$/.exec(version);
assert.ok(versionMatch, "VERSION must be stable, alpha.N, or beta.N semantic version");
const assemblyVersion = `${versionMatch[1]}.${versionMatch[2] ?? "0"}`;
has(tray, `AssemblyVersion("${assemblyVersion}")`, "tray assembly version must match VERSION");
has(tray, `AssemblyFileVersion("${assemblyVersion}")`, "tray file version must match VERSION");

// The command/source path is deliberately small: temporary source bootstrap,
// one hidden watcher, no tray executable, no Apps-list registration.
has(bootstrap, 'archive/refs/tags/$SelectedTag.zip', "remote bootstrap must download the selected immutable release source archive");
has(bootstrap, "'https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases/latest'", "remote bootstrap must default to GitHub's stable release channel");
has(bootstrap, 'releases/tags/v$RequestedVersion', "remote bootstrap must inspect an explicitly requested release");
has(bootstrap, '$SelectedVersion -cne $RequestedVersion', "remote bootstrap must bind an explicit request to the returned release");
has(bootstrap, "'X-GitHub-Api-Version' = '2026-03-10'", "remote bootstrap must pin the release API contract");
has(bootstrap, '$Release.immutable -ne $true', "remote bootstrap must fail closed unless the release is immutable");
lacks(bootstrap, '[string]$ArchiveUrl', "remote bootstrap must not accept an arbitrary source archive");
lacks(bootstrap, '[string]$AgentUrl', "remote bootstrap must not forward an arbitrary executable URL");
lacks(bootstrap, "archive/refs/heads/main.zip", "remote bootstrap must not execute a moving branch archive");
has(bootstrap, "'-ExecutionPolicy', 'Bypass', '-File', $InstallerPath", "bootstrap must cross restrictive execution policy through a controlled child process");
lacks(bootstrap, "& $InstallerPath", "bootstrap must not invoke a downloaded script directly under the caller's execution policy");
has(bootstrap, "QuotaPin-bootstrap-", "remote bootstrap must use an isolated temporary directory");
has(bootstrap, "Remove-Item -LiteralPath $ResolvedTempRoot -Recurse -Force", "remote bootstrap must remove its temporary source");
matches(
  bootstrap,
  /function Receive-QuotaPinBootstrapFile[\s\S]*?foreach \(\$Attempt in 1\.\.6\)[\s\S]*?--speed-time 90[\s\S]*?--max-time \$TimeoutSeconds[\s\S]*?--continue-at -/,
  "remote bootstrap downloads must be bounded, resumable, and retry stalled transfers",
);
has(bootstrap, 'Write-Host "Downloading $DisplayName$SizeText', "remote install must show the selected download and curl progress");
lacks(bootstrap, "--silent", "remote install must not hide a long package download");
has(bootstrap, '$PackageName = "QuotaPin-$SelectedVersion.exe"', "remote install must bind the public executable name to the selected version");
has(bootstrap, "$MacPackageName", "remote Windows install must recognize the companion macOS package");
has(bootstrap, "two-platform package policy", "remote install must reject a cluttered or ambiguous release asset set");
has(bootstrap, "$Process.WaitForExit()", "remote install must wait only for the installer process");
lacks(bootstrap, "Start-Process -FilePath $PackagePath -ArgumentList $Arguments -Wait", "remote install must not wait forever on the persistent watcher descendant");
lacks(sourceInstaller, "Get-CimInstance", "normal command installation must not depend on CIM process discovery");
lacks(sourceUninstaller, "Get-CimInstance", "normal command uninstall must not depend on CIM process discovery");
lacks(autoAttach, "Get-CimInstance", "normal automatic attachment must not depend on CIM");
has(sourceUninstaller, "& $StopScript", "command uninstall must use the shared verified cleanup path");
matches(
  sourceUninstaller,
  /& \$StopScript[\s\S]*?Write-QuotaPinLifecycleState -State 'stopped'/,
  "command uninstall must preserve the live Agent port until renderer cleanup finishes",
);
has(stopScript, "watcher.json", "shared cleanup must verify the recorded watcher identity");
has(stopScript, "Get-QuotaPinTrustedRuntime", "shared cleanup must recover a strictly verified renderer even after the persistent Agent exits");
has(stopScript, "if (-not $HasRuntimeTrustHelper)", "legacy cleanup fallback must remain disabled after strict runtime trust is installed");
has(stopScript, "if ($LASTEXITCODE -ne 0)", "command uninstall must not treat a failed renderer cleanup as success");
has(stopScript, "[switch]$InstallerHandoff", "guided updates need an explicit verified handoff cleanup mode");
has(stopScript, "installer-handoff.json", "guided cleanup deferral must require the captured runtime handoff");
has(stopScript, "$InstallerHandoffVerified", "guided cleanup deferral must remain fail-closed without a fresh verified handoff");
matches(
  stopScript,
  /if \(-not \$InstallerHandoffVerified\) \{[\s\S]*?Remove-ItemProperty[\s\S]*?StartupShortcut/,
  "a failed guided update must not remove the user's startup preference before Setup commits",
);
matches(
  stopScript,
  /Stop-OwnedProcesses 'QuotaPin\.Agent' \$AgentPath[\s\S]*?& \$AgentPath --cleanup --port \$CleanupPort/,
  "shared cleanup must stop the persistent Agent before the one-shot renderer cleanup",
);
has(sourceUninstaller, "Local\\QuotaPin.Update.", "command uninstall must serialize behind an active update");
has(sourceUninstaller, "Local\\QuotaPin.Install.", "command uninstall must serialize behind an active install");
matches(sourceUninstaller, /QuotaPin\.Update\.[\s\S]*?QuotaPin\.Install\./, "command uninstall must acquire update then install locks in one fixed order");
matches(
  sourceInstaller,
  /function Receive-QuotaPinInstallFile[\s\S]*?foreach \(\$Attempt in 1\.\.6\)[\s\S]*?--speed-limit 1024[\s\S]*?--speed-time 90[\s\S]*?--max-time \$TimeoutSeconds[\s\S]*?--continue-at -/,
  "every release download must resume partial files and reject stalled transfers within a bounded attempt",
);
matches(sourceInstaller, /url = \$ResolvedAgentUrl; destination = \$BundlePath; maximumBytes = 128MB; timeoutSeconds = 300/, "release bundle downloads must allow slow links a bounded five-minute attempt before resuming");
lacks(bootstrap, "QuotaPin-Setup.exe", "remote bootstrap must not redirect to Setup.exe");
lacks(bootstrap, "QuotaPin.Tray.exe", "remote bootstrap must not install the tray companion");
has(sourceInstaller, "QuotaPin Auto Attach.lnk", "source install must register the hidden watcher shortcut");
has(sourceInstaller, "Uninstall QuotaPin.lnk", "source install must add a Start-menu uninstall entry");
has(sourceInstaller, "-ExecutionPolicy Bypass -File", "source uninstall shortcut must work under a restrictive execution policy");
matches(
  sourceInstaller,
  /function New-QuotaPinUninstallShortcut[\s\S]*?\$Shortcut\.WorkingDirectory = \$env:LOCALAPPDATA[\s\S]*?\$Shortcut\.Save\(\)/,
  "source uninstall shortcut must start outside the directory it removes",
);
matches(
  sourceInstaller,
  /function New-QuotaPinLauncherShortcut[\s\S]*?\$Shortcut\.WorkingDirectory = \$InstallRoot[\s\S]*?\$Shortcut\.Save\(\)/,
  "source launcher shortcut must keep its install-root working directory",
);
has(sourceUninstaller, 'Set-Location -LiteralPath $env:LOCALAPPDATA', "command uninstall must leave its owned tree before recursive cleanup");
has(sourceInstaller, "-IgnoreExisting", "source install must not interrupt the current Codex session");
has(setup, 'Type: files; Name: "{app}\\logs\\auto-attach-guard.json"', "guided and command updates must clear a previously latched attach transaction");
has(sourceInstaller, "$ExistingAutoAttach", "source updates must preserve the user's startup choice");
has(sourceInstaller, "Local\\QuotaPin.Install.", "source installation must hold a per-user single-flight mutex");
has(sourceInstaller, "Local\\QuotaPin.Update.", "source installation must serialize with update and uninstall");
matches(sourceInstaller, /QuotaPin\.Update\.[\s\S]*?QuotaPin\.Install\./, "source installation must acquire update then install locks in one fixed order");
has(sourceInstaller, "startMenuLauncher", "source updates must persist launcher preferences");
has(sourceInstaller, "desktopLauncher", "source updates must persist desktop-launcher preferences");
has(sourceInstaller, "$SavedPreferences", "source updates must read persisted launcher preferences before removing shortcuts");
has(sourceInstaller, "$EnableAutoAttach", "command install must provide an explicit way to restore automatic attachment");
has(sourceInstaller, "Codex was not restarted by this installation", "command install must state that it preserves the active Codex task");
has(sourceInstaller, "After a full quit, a new Codex launch may briefly reopen once", "command install must describe the later fresh-launch handoff without calling it an install restart");
lacks(sourceInstaller, "A fresh uninstrumented launch", "command install output must not expose Electron implementation jargon");
lacks(bootstrap, "$EnableAutoAttach", "remote bootstrap must expose only stable version selection");
lacks(bootstrap, "$CreateLauncherShortcut", "remote bootstrap must not mix source-only launcher controls into package installation");
has(sourceInstaller, "auto-attach watcher did not become ready", "command install must not report success before its watcher is alive");
has(sourceInstaller, "Stop-Process -Id $ProcessId", "a failed watcher handshake must stop the exact child it launched");
has(autoAttach, "StartTime.ToUniversalTime()", "watcher state must bind to the PowerShell process creation time");
has(sourceInstaller, "QuotaPin.Agent.exe", "source install must use the self-contained agent");
has(sourceInstaller, "'update.ps1'", "source install must carry the command-path updater");
has(sourceInstaller, "'update-launcher.ps1'", "source install must carry the Windows update launch handshake");
has(sourceInstaller, "'ui.ps1'", "source install must carry localized lifecycle UI");
has(sourceInstaller, "'auto-attach-policy.ps1'", "source install must carry the fail-closed attach policy");
has(sourceInstaller, "'codex-process.ps1'", "source install must carry verified process identity helpers");
has(sourceInstaller, "'runtime-trust.ps1'", "source install must carry the shared runtime trust boundary");
has(sourceInstaller, "logs\\auto-attach-guard.json", "an explicit install must clear a previously latched attachment guard");
has(sourceInstaller, "Test-QuotaPinReleaseTrustBundle", "remote command install must verify the complete release trust bundle");
has(sourceInstaller, "Expand-QuotaPinReleaseBundle", "remote command install must strictly extract the verified Windows bundle");
has(sourceInstaller, "$BundleChecksumPath", "remote command install must verify the Windows bundle transfer");
has(runtimeTrust, "QuotaPin-release.json", "runtime trust must verify the release manifest checksum");
has(runtimeTrust, "SHA256SUMS", "runtime trust must cross-check the release checksum inventory");
has(sourceInstaller, "ExpectedCommit", "the Agent build origin must match the trusted manifest commit");
has(sourceInstaller, "a loopback test fixture", "custom release URLs must be limited to isolated loopback fixtures");
has(sourceInstaller, "New-QuotaPinRollbackSnapshot", "command install must snapshot files and entry points before mutation");
has(sourceInstaller, "Restore-QuotaPinRollbackSnapshot", "command install must restore its previous files and entry points on failure");
has(sourceInstaller, "Get-QuotaPinInstallRegistrySnapshot", "command install must snapshot install ownership state");
has(sourceInstaller, "Restore-QuotaPinInstallRegistrySnapshot", "command install must restore install ownership state on failure");
has(sourceUninstaller, "New-QuotaPinRollbackSnapshot", "command uninstall must snapshot files and entry points before mutation");
has(sourceUninstaller, "Restore-QuotaPinRollbackSnapshot", "command uninstall must restore its previous files and entry points on failure");
matches(
  sourceInstaller.slice(sourceInstaller.indexOf("$TransactionRoot")),
  /Start-QuotaPinVerifiedWatcher \$AutoAttachScript[\s\S]*?New-QuotaPinAutoAttachShortcut/,
  "Startup must not be committed until the replacement watcher is verified",
);
has(sourceInstaller, "Resume-QuotaPinTrustedRuntime", "direct repair must hot-resume a verified current Codex runtime");
has(sourceInstaller, "Get-QuotaPinResumableRuntime", "direct repair must capture a verified current Codex session even if the previous Agent exits during handoff");
has(sourceInstaller, "$DeferRuntimeResume", "the update wrapper must be able to own runtime resume without duplication");
has(sourceInstaller, "THIRD_PARTY_NOTICES.txt", "source install must carry third-party notices with the Agent");
has(sourceInstaller, "'LICENSE'", "source install must carry the QuotaPin license");
lacks(sourceInstaller, "prepare-runtime.ps1", "source install must not download a private Node runtime");
lacks(sourceInstaller, "node.exe", "source install must not require or install Node.js");
lacks(sourceInstaller, "Start-Process -FilePath $Tray", "source install must not start a tray companion");
lacks(sourceInstaller, "CurrentVersion\\Run", "source install must not register the setup tray Run entry");
lacks(sourceInstaller, "open-settings", "source install must not revive the retired settings bridge");
has(commandUpdater, "--continue-at -", "command update downloads must resume after a slow-link interruption");
has(commandUpdater, '$PackageName = "QuotaPin-$Version.exe"', "command updates must bind the public executable name to the requested version");
has(commandUpdater, "$MacPackageName", "command updates must recognize the companion macOS package");
has(commandUpdater, "two-platform package policy", "command updates must reject a release with extra public assets");
has(commandUpdater, "$AssetDigest -notmatch '^sha256:[0-9a-f]{64}$'", "command updates must require GitHub's exact asset digest");
has(commandUpdater, "OriginalFilename", "command updates must verify the versioned Windows package identity");
has(commandUpdater, "$InstallOwner = Get-QuotaPinInstallOwner", "updates must resolve the existing installation owner before invoking the shared executable");
has(commandUpdater, "if ($InstallOwner -eq 'command')", "command-owned updates must preserve the command-install flavor");
has(commandUpdater, "'/DEFERHANDOFF=1'", "the update wrapper and installer must not race two runtime handoffs");
has(commandUpdater, "'/NORESTART'", "command updates must never restart Codex or Windows");
has(commandUpdater, "$Process.WaitForExit(5 * 60 * 1000)", "command updates must wait only for the installer process and must bound that wait");
has(commandUpdater, "Stop-Process -Id $Process.Id -Force", "a timed-out installer must not continue mutating the installation after the updater reports failure");
lacks(commandUpdater, "-Wait -PassThru", "command updates must not wait forever on the persistent watcher descendant");
has(commandUpdater, "Local\\QuotaPin.Update.", "command updates must hold a per-user single-flight mutex");
has(commandUpdater, "update-result.json", "command updates must publish an atomic terminal result");
has(commandUpdater, "update.log", "command updates must leave a bounded diagnostic log");
matches(runtimeTrust, /\$SameRuntime[\s\S]*?codexCreationTimeUtc[\s\S]*?generation/, "hot resume must revalidate the exact runtime after installation");
has(runtimeTrust, "--attach-generation", "hot resume must preserve the verified attach generation");
has(runtimeTrust, "Start-Process -FilePath $ResolvedAgentPath", "hot resume must restore an attached Agent without restarting Codex");
has(runtimeTrust, "codexCreationTimeUtc", "runtime trust must bind a saved PID to the exact Codex creation time");
has(runtimeTrust, "Local\\QuotaPinAgentResume", "the updater must serialize Agent recovery with the tray");
has(runtimeTrust, 'app://-/index.html', "runtime trust must verify the Codex main renderer target");
has(runtimeTrust, "$Lifecycle.generation", "runtime trust must bind lifecycle and runtime to one generation");
has(updateRuntime, "`QuotaPin-${version}.exe`", "the update picker must require the exact versioned executable");
has(updateRuntime, "`QuotaPin-macOS-${version}.dmg`", "the update picker must recognize the exact versioned macOS disk image");
has(updateRuntime, "assets.length !== 2", "cross-platform update discovery must reject releases outside the exact two-package policy");
has(updateRuntime, 'this.platform === "darwin"', "the update picker must select its installed macOS updater by platform");
has(updateRuntime, '"/bin/bash"', "macOS updates must use the system shell rather than PowerShell");
has(updateRuntime, "^sha256:[0-9a-f]{64}$", "the update picker must require GitHub's exact digest");
has(sourceInstaller, "foreach ($Attempt in 1..6)", "release downloads must have a bounded retry count");
has(sourceInstaller, "--continue-at -", "release downloads must resume partial assets");
has(runtimeTrust, "DateTimeOffset]::Parse", "runtime identity timestamps must preserve their persisted UTC offset");
lacks(runtimeTrust, "[datetime]::Parse", "runtime trust must not reinterpret UTC instants as local time");
has(updateRuntime, 'MINIMUM_SAFE_VERSION = "1.2.0"', "the update picker must hide superseded releases below the maintained compatibility floor");
has(updateRuntime, 'action?.type === "install"', "command updates must require an explicit renderer action");
has(updateRuntime, 'this.state.status === "installing"', "renderer update actions must be single-flight");
has(updateRuntime, "6 * 60 * 60 * 1000", "successful automatic release discovery must remain bounded");
has(updateRuntime, "15 * 60 * 1000", "failed release discovery must retry without hiding a verified cached result for a day");
has(updateRuntime, "checkError", "release discovery must distinguish stale verified state from a current network failure");
lacks(updateRuntime, "setInterval", "the command updater must not install or poll continuously in the background");

// Setup is the novice path: tray controls, sign-in startup, and an Apps-list
// uninstaller, all scoped to the current user.
has(setup, "PrivilegesRequired=lowest", "Setup must remain per-user and non-elevated");
has(setup, "MinVersion=10.0.19041", "Setup must accept the Codex package Windows 10 baseline");
has(setup, 'Source: "..\\dist\\QuotaPin.Tray.exe"', "Setup must include the tray companion");
has(setup, 'Source: "..\\dist\\QuotaPin.Agent.exe"', "Setup must include the self-contained agent");
has(setup, 'Source: "..\\dist\\THIRD_PARTY_NOTICES.txt"', "Setup must include third-party notices");
has(setup, 'Source: "..\\LICENSE"', "Setup must include the QuotaPin license");
has(setup, 'Source: "..\\src\\ui.ps1"', "Setup must include localized lifecycle UI");
has(setup, 'Source: "..\\src\\codex-process.ps1"', "Setup launcher must include verified process identity helpers");
has(setup, 'Name: "ja"; MessagesFile: "compiler:Languages\\Japanese.isl"', "Setup must follow the Japanese Windows locale without adding a language step");
has(setup, "ShowLanguageDialog=no", "Setup language detection must not add another novice-facing step");
lacks(setup, "open-settings.ps1", "Setup must not package the retired settings bridge");
lacks(setup, "Open QuotaPin settings", "Setup must not add a second settings entry to the Start menu");
lacks(setup, 'Source: "..\\dist\\runtime', "Setup must not carry a private Node runtime tree");
has(setup, 'ValueName: "QuotaPin"', "Setup must register the tray startup entry");
has(setup, "ExistingInstallOwner", "Setup upgrades must read the explicit installation owner instead of confusing native uninstall registration with tray ownership");
has(setup, "CompareText(ExistingInstallOwner, 'setup') = 0", "setup ownership must be resolved from persisted state");
has(setup, "Pos('auto-attach.ps1', ExistingRunCommand) > 0", "legacy command ownership must remain recoverable from its startup command");
has(setup, "HasCommandLineSwitch('/COMMANDINSTALL=1') and (not ExistingSetupInstall)", "a stale command-update flag must not replace an existing setup-owned installation while a command-owned update remains command-owned");
has(setup, "else if ExistingInstall then", "both installation flavors must preserve an explicitly disabled startup preference during update");
has(setup, "'/DEFERHANDOFF=1'", "wrapper-driven updates must suppress the installer's duplicate runtime handoff");
has(setup, "installer-handoff.ps1", "direct installer upgrades must retain a best-effort verified runtime handoff");
has(setup, "-InstallerHandoff", "direct installer upgrades must allow the replacement Agent to retire a temporarily unreachable renderer");
has(setup, "ExistingAutoAttach", "Setup upgrades must preserve the user's startup choice");
has(setup, "UninstallDisplayIcon={app}\\QuotaPin.Tray.exe", "Setup must register its Apps-list identity");
has(setup, "UninstallDisplayName=QuotaPin", "Setup must use a clean Apps-list display name");
has(setup, 'DestName: "config.json"; Flags: onlyifdoesntexist uninsneveruninstall', "Setup updates must preserve configuration");
has(setup, 'Type: files; Name: "{app}\\config.json"', "Setup uninstall must remove configuration");
has(setup, 'RunOnceId: "StopQuotaPin"', "Setup uninstall cleanup must run once");
has(release, ".\\scripts\\build-windows.ps1", "public release workflow must build the shared versioned executable");
lacks(release, "QuotaPin-Setup.exe", "public release workflow must not name or upload Setup");
has(release, "scripts/public-release.mjs prepare", "public release workflow must stage the exact cross-platform package policy");
has(release, ".\\scripts\\install-inno-ci.ps1", "release workflow must use the shared verified Inno Setup compiler bootstrap");
has(innoCiInstaller, "4d11e8050b6185e0d49bd9e8cc661a7a59f44959a621d31d11033124c4e8a7b0", "CI must pin the Inno Setup compiler digest");
has(innoCiInstaller, "Pyrsys B\\.V\\.", "CI must validate the Inno Setup publisher");
has(installerBuilder, "ISCC.exe", "the unified build must compile the Inno Setup recipe");
has(installerBuilder, "$env:QUOTAPIN_ISCC_PATH", "the unified build must accept the verified CI compiler path");
has(publicRelease, 'return `QuotaPin-${normalized}.exe`', "public asset policy must publish one versioned Windows executable");
has(publicRelease, 'return `QuotaPin-macOS-${normalized}.dmg`', "public asset policy must publish one versioned macOS disk image");
has(macBootstrap, 'hdiutil attach -quiet -readonly -nobrowse', "the macOS remote installer must mount the verified image read-only");
has(macBootstrap, 'QuotaPin Installer.app', "the macOS remote installer must use the same app payload as Finder installation");
has(macPackager, 'QuotaPin Installer.app', "the macOS disk image must contain a Finder-launchable installer app");
has(macPackager, 'hdiutil create', "the macOS packager must produce a disk image rather than a source archive");
has(macBuilder, 'src/macos/runtime-entry.mjs', "the macOS build must bundle one shared runtime entry");
has(macBuilder, 'QuotaPin.runtime.cjs', "the macOS build must carry one integrity-bound runtime payload");
has(macBuilder, '/usr/bin/swiftc', "the macOS build must compile the thin native host");
lacks(macBuilder, 'postject', "the macOS build must not embed or redistribute a Node runtime");
has(macThinHost, '/usr/bin/mdfind', "the macOS host must rediscover an official app after a stale saved path");
has(macThinHost, 'Contents/Resources/cua_node/bin/node', "the macOS host must use the exact signed runtime inside official Codex");
lacks(macThinHost, 'URLSession', "the macOS host must not download a substitute runtime");
has(macRuntimeEntry, '--quotapin-agent-runtime', "the macOS host must dispatch Agent mode explicitly");
has(macInstaller, '"$TARGET/QuotaPin.Mac" stop-agent', "macOS upgrades must stop the exact old Agent before replacing its executable");
lacks(macPackager, 'for binary in QuotaPin.Agent QuotaPin.Mac', "the macOS package must contain one universal native host");
has(macInstallerApp, '--headless', "the Finder installer must expose a CI-testable noninteractive path");
has(macInstallerApp, 'Contents/Resources/payload', "the Finder installer must run its own embedded payload");
has(publicRelease, '"QuotaPin-release.json", "QuotaPin.spdx.json"', "candidate verification must retain internal manifest and SBOM evidence");
lacks(publicRelease, '"QuotaPin-Windows-x64.zip"', "public asset policy must not revive the legacy ZIP");
lacks(release, "actions/attest", "the release workflow must not add a second public attestation beside GitHub's immutable release record");
has(release, "GitHub Releases accept reviewed stable or beta versions only", "tag releases must reject unreviewed prerelease channels");
has(release, "$isBeta = $version -cmatch '^\\d+\\.\\d+\\.\\d+-beta\\.\\d+$'", "tag releases must recognize only the reviewed beta.N channel");
has(release, "$latestFlag = if ($isStable) { 'true' } else { 'false' }", "beta releases must never replace the stable Latest channel");

for (const readme of readmes) {
  lacks(readme, "QuotaPin-Setup.exe", "README must not publish the build-gated Setup package");
  lacks(readme, "QuotaPin-Setup.exe →", "README download link must not carry a decorative arrow");
  lacks(readme, "Windows_11-alpha", "README must not claim Windows 11 exclusivity");
  lacks(readme, "Node.js 22+", "README must not require users to install Node.js");
  has(readme, '& "$env:LOCALAPPDATA\\QuotaPin\\unins000.exe"', "README uninstall must use the native executable uninstaller");
  lacks(readme, '$env:LOCALAPPDATA\\QuotaPin\\uninstall.ps1', "README must not reference the legacy script uninstaller");
  has(readme, "https://github.com/WSL043/QuotaPin-for-Codex/releases/latest", "README must expose the moving stable installer page");
  lacks(readme, "/releases/latest/download/QuotaPin-", "README must not publish a version-specific URL before its Release exists");
}
has(agentBuilder, "--experimental-sea-config", "agent build must use the official single-executable path");
has(agentBuilder, "NODE_SEA_BLOB", "agent build must inject a self-contained payload");
has(agentBuilder, "--agent-version", "agent build must self-check the produced executable");
has(windowsBuilder, "build-installer.ps1", "the Windows build must include the versioned installer");
has(windowsBuilder, "[switch]$ReleaseManifest", "local Windows builds must make cross-platform release metadata explicit");
has(setup, "ArchitecturesAllowed=x64compatible", "Setup must allow the x64 package on Windows 11 Arm64 emulation");
has(release, ".\\scripts\\build-windows.ps1 -ReleaseManifest", "public releases must bind Windows and macOS package metadata together");
has(checkWorkflow, "runs-on: windows-11-arm", "checks must exercise the x64 Windows package on a native Windows 11 Arm64 runner");
has(checkWorkflow, ".\\scripts\\test-windows-arm64-emulation.ps1", "checks must run the Windows Arm64 emulation lifecycle gate");
has(release, "runs-on: windows-11-arm", "releases must accept the exact Windows package on a native Windows 11 Arm64 runner");
has(release, "needs: [build, windows-arm64-emulation]", "publishing must wait for Windows 11 Arm64 emulation acceptance");
has(release, ".\\scripts\\test-windows-arm64-emulation.ps1", "release acceptance must run the shared Windows Arm64 lifecycle gate");
has(windowsArm64Acceptance, "OSArchitecture", "the Windows Arm64 gate must verify the native host architecture");
has(windowsArm64Acceptance, "0x8664", "the Windows Arm64 gate must verify that Agent and tray exercise x64 emulation");
has(windowsArm64Acceptance, "--agent-version", "the Windows Arm64 gate must execute the self-contained Agent");
has(windowsArm64Acceptance, "QuotaPin.Tray", "the Windows Arm64 gate must exercise the tray lifecycle");
has(windowsArm64Acceptance, "unins000.exe", "the Windows Arm64 gate must exercise the native uninstaller");
has(installerBuilder, 'ProductVersion -ne $FileVersion', "the installer build must reject a Windows file-version mismatch");
has(installerBuilder, '"/DMyFileVersion=$FileVersion"', "prerelease SemVer must map to a numeric Windows file version");
has(codexHelpers, "Get-AuthenticodeSignature", "app-managed Codex command must be signature-checked");
has(codexHelpers, "Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1", "runtime must load the signature module from PSHOME");
has(prerequisites, "Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1", "Setup must load the signature module from PSHOME");
has(codexHelpers, "Start-Sleep -Milliseconds 300", "runtime signature validation must retry transient failures");
has(prerequisites, "Start-Sleep -Milliseconds 300", "Setup signature validation must retry transient failures");
has(prerequisites, "-Encoding ASCII", "Setup result text must remain BOM-free for Inno Setup");
lacks(prerequisites, "[System.Management.Automation.SignatureStatus]", "Setup checks must work in constrained Windows PowerShell");
lacks(prerequisites, "[StringComparison]", "Setup checks must avoid constrained-language type access");
has(codexHelpers, "Get-Command 'codex.exe'", "PATH fallback must consider executable candidates only");
lacks(codexHelpers, "'.cmd'", "Codex command selection must not accept command shims");
lacks(codexHelpers, "'.bat'", "Codex command selection must not accept batch shims");
lacks(codexHelpers, "'.ps1'", "Codex command selection must not accept PowerShell shims");
has(appServerRuntime, 'toLowerCase() !== ".exe"', "the Agent must reject non-executable Codex command shims");
lacks(tray, "OpenSettings", "the tray must not control the Codex renderer through a second settings path");
lacks(tray, "settingsItem", "the tray menu must not expose a duplicate settings command");
lacks(injector, "--open-settings", "the Agent must not retain the retired external settings-control mode");
lacks(ui, "ConnectingTitle", "the lifecycle UI must not retain the retired settings-bridge dialog");
has(ui, "Restart Codex now", "the lifecycle prompt must name the disruptive action explicitly");
has(ui, "Codex を今すぐ再起動", "the lifecycle prompt must follow the Japanese Windows locale");
has(ui, "MessageBoxDefaultButton]::Button2", "the destructive restart confirmation must default to No");
has(ui, "RestartConfirmBody", "automatic restart must require a second explicit confirmation");
has(setup, 'Source: "..\\src\\first-run.ps1"', "Setup must package the bounded first-connection controller");
has(setup, "Check: RunFirstConnection", "Setup must ask about first connection only on an interactive first install");
has(firstRun, "Test-PreparedCodexEndpoint", "first connection must attempt hot resume before offering a restart");
has(firstRun, "Show-QuotaPinRelaunchPrompt", "first connection must preserve the manual or confirmed automatic restart choice");
has(autoAttach, "budget=1/1", "automatic attachment must persist one destructive relaunch budget per generation");
has(autoAttach, "degraded-latched", "automatic attachment must latch failures instead of retrying Codex");
lacks(autoAttach, "attach retry scheduled", "automatic attachment must never retry a destructive Codex relaunch");
has(read("src/launch.ps1"), "Test-QuotaPinRendererReady", "launcher success must require real renderer attachment");
has(read("src/launch.ps1"), "Local\\QuotaPinCodexRelaunch", "all launcher paths must share a single-flight relaunch lock");
lacks(read("src/launch.ps1"), "must fully close and reopen", "the launcher must not present a deferred activation as an immediate requirement");
has(tray, "CreateToolhelp32Snapshot", "Setup tray must observe Codex launches without a permanent PowerShell process");
lacks(read("scripts/build-tray.ps1"), "/reference:System.Management.dll", "tray build must not depend on a WMI process-event subscription");
has(read("scripts/build-tray.ps1"), "Updater.cs", "tray build must include the in-place updater");
has(updater, "ReleaseDownloadPrefix", "updates must accept only the project release asset origin");
has(commandUpdater, "Get-FileHash -Algorithm SHA256", "the shared update transaction must verify the downloaded installer before launch");
has(updateLauncher, "Start-Process -FilePath $PowerShellPath", "the Windows Agent must delegate update survival to an attached PowerShell launcher");
has(updateLauncher, "did not publish its launch receipt", "the Windows update launcher must fail closed without a fresh updater receipt");
has(updateRuntime, 'launcherName = this.platform === "win32" ? "update-launcher.ps1"', "the panel update path must use the Windows launch handshake");
lacks(updateRuntime, 'detached: true, stdio: "ignore", windowsHide: this.platform === "win32"', "the panel must not use Node detached mode for Windows PowerShell");
has(tray, 'Path.Combine(installRoot, "update.ps1")', "the tray must delegate to the same resumable update transaction as the panel");
lacks(tray, "DownloadedUpdate", "the tray must not retain a second package downloader and installer");
lacks(tray, "releases/latest", "the update action must not send users to a release web page");
has(tray, '"app://-/index.html"', "update resume must verify the active Codex renderer target");
has(tray, 'EnvironmentVariables["QUOTAPIN_CODEX_COMMAND"]', "hot resume must provide the verified Codex app-server command to the Agent");
has(tray, 'Local\\QuotaPinAgentResume', "the tray must serialize Agent recovery with the updater");
has(tray, 'state["agentPid"] = process.Id', "the tray must publish replacement Agent ownership before releasing recovery");
lacks(tray, "AddDays(-1)", "a valid long-running Codex endpoint must remain eligible for hot resume");
has(tray, "expectedCodexStartedAt", "hot resume must read the exact persisted Codex creation time");
has(tray, "Math.Abs((startedAt - expectedCodexStartedAt.ToUniversalTime()).TotalSeconds) > 2", "hot resume must reject a runtime handoff whose PID was reused");
has(read("scripts/verify-cdp.mjs"), "assertVerificationPermissions", "CDP diagnostics must use the shared permission boundary");
has(verifierSafety, "--allow-sensitive-capture", "screenshot diagnostics must require explicit sensitive-capture approval");
lacks(read("src/launch.ps1"), "Get-Command 'node.exe'", "launcher must not depend on system Node.js");
has(read("src/launch.ps1"), "QuotaPin.Agent.exe", "launcher must start the self-contained agent");
lacks(readmes[0], 'href="#quick-start"', "README must not put a quick-start jump link above the hero");
lacks(readmes[1], 'href="#快速开始"', "Chinese README must not put a quick-start jump link above the hero");
lacks(readmes[2], 'href="#クイックスタート"', "Japanese README must not put a quick-start jump link above the hero");
lacks(compatibility, unsealContract("RGlyZWN0aW9uLWtleSBhbmQgV0FTRA=="), "public compatibility notes must not publish sealed input instructions");
has(compatibility, version, "compatibility notes must describe the current release");
lacks(compatibility, "alpha.21", "compatibility notes must not retain superseded release archaeology");
lacks(publicDocs, "CodexBar", "public documentation must not market by naming another project");
lacks(publicDocs, "Tokscale", "public documentation must not market by naming another project");
lacks(injector, unsealContract("WyJBcnJvd1VwIiwgIkFycm93VXAi"), "the sealed input sequence must not be stored as a readable array");
lacks(injector, unsealContract("Y29uc3Qgd2FzZCA9IHsgdzo="), "the alternate sealed input path must not be stored as a readable map");
lacks(injector, "prefers-reduced-motion", "QuotaPin motion must not inherit the Windows or Codex reduced-motion preference");
lacks(injector, "matchMedia(", "QuotaPin motion must remain controlled only by its own saved view");

const sealedRendererCopy = [
  "QXJjYWRl",
  "T3ZlcmRyaXZlIGVhc3RlciBlZ2c=",
  "UXVvdGEgZmlyZQ==",
  "U2lkZWJhciBmaXJl",
  "UHJldmlldw==",
  "UGxheQ==",
  "U2VuZCBhbiBpZGVh",
  "S2VlcCBydW5uaW5n",
  "6L+Q6KGM",
  "5oyB57ut6L+Q6KGM",
  "5YaN55Sf",
  "5bi45pmC5YaN55Sf",
];
for (const [index, sealed] of sealedRendererCopy.entries()) {
  const visibleSecret = `"${Buffer.from(sealed, "base64").toString("utf8")}"`;
  lacks(injector, visibleSecret, `hidden renderer copy contract ${index + 1} must stay sealed`);
}

console.log(JSON.stringify({ ok: true, version, commandInstall: "watcher-only", setupInstall: "tray-native-observer+apps-uninstall" }));
