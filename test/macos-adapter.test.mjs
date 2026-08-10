import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodexAppServerCommand } from "../src/agent/app-server-runtime.mjs";
import {
  macAgentResumeDelayMs,
  macAutoAttachDecision,
  macProcessIdentityKey,
  macProcessIdentityMatches,
} from "../src/macos/auto-attach-policy.mjs";
import {
  codexOpenArguments,
  defaultCodexBundleCandidates,
  isPathInsideBundle,
  macosLaunchPlan,
  matchesRendererReceipt,
  resolveCodexBundle,
  resolveCodexCommand,
  resolveCodexNodeRuntime,
  validateOfficialCodexIdentity,
  validateOfficialCodexRuntimeIdentity,
} from "../src/macos/launcher-runtime.mjs";

function macFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-macos-"));
  const bundle = path.join(root, "Codex.app");
  const command = path.join(bundle, "Contents", "Resources", "app", "bin", "codex");
  const node = path.join(bundle, "Contents", "Resources", "cua_node", "bin", "node");
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(command, "#!/bin/sh\nexit 0\n", "utf8");
  fs.writeFileSync(node, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(command, 0o755);
  fs.chmodSync(node, 0o755);
  return { root, bundle, command, node };
}

test("macOS adapter resolves one explicit Codex bundle and one executable inside it", (t) => {
  const fixture = macFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal(resolveCodexBundle({ candidates: [fixture.bundle] }), fs.realpathSync(fixture.bundle));
  assert.equal(resolveCodexCommand(fixture.bundle), fs.realpathSync(fixture.command));
  assert.equal(resolveCodexNodeRuntime(fixture.bundle), fs.realpathSync(fixture.node));
  assert.equal(isPathInsideBundle(fixture.bundle, fixture.command), true);
  assert.equal(isPathInsideBundle(fixture.bundle, path.join(fixture.root, "codex")), false);
});

test("macOS adapter refuses to download or substitute a runtime when official Codex has no bundled Node", (t) => {
  const fixture = macFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.rmSync(fixture.node);
  assert.throws(() => resolveCodexNodeRuntime(fixture.bundle), /signed Node\.js runtime.*not found/i);
});

test("macOS adapter fails closed on ambiguous bundles and commands outside Codex.app", (t) => {
  const first = macFixture();
  const second = macFixture();
  t.after(() => {
    fs.rmSync(first.root, { recursive: true, force: true });
    fs.rmSync(second.root, { recursive: true, force: true });
  });
  assert.throws(() => resolveCodexBundle({ candidates: [first.bundle, second.bundle] }), /More than one Codex\.app/);
  const external = path.join(first.root, "external-codex");
  fs.writeFileSync(external, "#!/bin/sh\n", "utf8");
  fs.chmodSync(external, 0o755);
  assert.throws(() => resolveCodexCommand(first.bundle, { override: external }), /not found inside Codex\.app/);
});

test("macOS launch plan binds the Electron debugging endpoint to loopback", (t) => {
  const fixture = macFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const plan = macosLaunchPlan({ candidates: [fixture.bundle], port: 43124, installRoot: path.join(fixture.root, "install") });
  assert.equal(plan.commandPath, fs.realpathSync(fixture.command));
  assert.deepEqual(plan.openArguments, [
    "-na",
    fs.realpathSync(fixture.bundle),
    "--args",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=43124",
  ]);
  assert.throws(() => codexOpenArguments(fixture.bundle, 80), /unprivileged debugging port/);
});

test("macOS adapter accepts only the official bundle identity and a generation-bound renderer receipt", () => {
  assert.deepEqual(validateOfficialCodexIdentity({
    bundleIdentifier: "com.openai.codex",
    teamIdentifier: "2DC432GLL2",
    signatureValid: true,
  }), { bundleIdentifier: "com.openai.codex", teamIdentifier: "2DC432GLL2", signatureValid: true });
  assert.throws(() => validateOfficialCodexIdentity({ bundleIdentifier: "com.openai.codex", teamIdentifier: "OTHER", signatureValid: true }), /signing team/);
  assert.throws(() => validateOfficialCodexIdentity({ bundleIdentifier: "com.openai.codex", teamIdentifier: "2DC432GLL2", signatureValid: false }), /strict code signature/);
  assert.deepEqual(validateOfficialCodexRuntimeIdentity({
    app: { signatureValid: true, teamIdentifier: "2DC432GLL2" },
    executable: { signatureValid: true, teamIdentifier: "2DC432GLL2" },
    node: { signatureValid: true, teamIdentifier: "2DC432GLL2" },
  }), { teamIdentifier: "2DC432GLL2", signatureValid: true });
  assert.throws(() => validateOfficialCodexRuntimeIdentity({
    app: { signatureValid: true, teamIdentifier: "2DC432GLL2" },
    executable: { signatureValid: true, teamIdentifier: "OTHER" },
    node: { signatureValid: true, teamIdentifier: "2DC432GLL2" },
  }), /main executable signing team/);
  const expected = { generation: "a".repeat(32), agentPid: 77, port: 43124 };
  assert.equal(matchesRendererReceipt({ schema: 1, state: "renderer-attached", ...expected }, expected), true);
  assert.equal(matchesRendererReceipt({ schema: 1, state: "renderer-attached", ...expected, generation: "b".repeat(32) }, expected), false);
  assert.equal(matchesRendererReceipt({ schema: 1, state: "renderer-attached", ...expected, port: 43125 }, expected), false);
});

test("macOS discovery recognizes both current ChatGPT.app and legacy Codex.app bundle names", () => {
  assert.deepEqual(defaultCodexBundleCandidates({ home: "/Users/test" }).map((value) => value.replaceAll("\\", "/")), [
    "/Applications/ChatGPT.app",
    "/Users/test/Applications/ChatGPT.app",
    "/Applications/Codex.app",
    "/Users/test/Applications/Codex.app",
  ]);
});

test("App Server command trust supports only Windows executables or executable paths inside a Mac app bundle", (t) => {
  const fixture = macFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(resolveCodexAppServerCommand({
    env: { QUOTAPIN_CODEX_COMMAND: fixture.command },
    platform: "darwin",
  }), { command: fixture.command, args: ["app-server", "--listen", "stdio://"] });
  assert.throws(() => resolveCodexAppServerCommand({
    env: { QUOTAPIN_CODEX_COMMAND: fixture.command },
    platform: "linux",
  }), /does not support the linux host adapter/);
});

test("macOS auto-attach permits one fresh handoff and then protects the successor", () => {
  const source = { pid: 100, startedAt: "Fri Aug 7 12:00:00 2026", executablePath: "/Applications/Codex.app/Contents/MacOS/Codex" };
  const successor = { ...source, pid: 200, startedAt: "Fri Aug 7 12:00:02 2026" };
  assert.equal(macAutoAttachDecision({ guardState: "none", roots: [source], candidateFresh: true }), "launch-once");
  assert.equal(macAutoAttachDecision({ guardState: "successor-observed", roots: [successor], protectedPid: 200 }), "adopt");
  assert.equal(macAutoAttachDecision({ guardState: "successor-observed", roots: [], protectedPid: 200, idleSeconds: 29 }), "wait-idle");
  assert.equal(macAutoAttachDecision({ guardState: "successor-observed", roots: [], protectedPid: 200, idleSeconds: 30 }), "rearm");
  assert.equal(macAutoAttachDecision({ guardState: "degraded-latched", roots: [successor] }), "stop");
  assert.equal(macAutoAttachDecision({ guardState: "none", roots: [source, successor], candidateFresh: true }), "ignore-ambiguous");
  assert.equal(macProcessIdentityKey(source), `100:${source.startedAt}`);
  assert.equal(macProcessIdentityMatches(source, source), true);
  assert.equal(macProcessIdentityMatches(source, successor), false);
});

test("macOS Agent recovery uses bounded exponential backoff without reopening Codex", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, failureCount) => macAgentResumeDelayMs(failureCount)),
    [0, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000],
  );
  const launcher = fs.readFileSync(new URL("../src/macos/launcher.mjs", import.meta.url), "utf8");
  assert.match(launcher, /async function resumeManagedAgent/);
  assert.match(launcher, /agent resumed without reopening Codex/);
  assert.match(launcher, /mainTargetAvailable/);
  const resumeSource = launcher.slice(
    launcher.indexOf("async function resumeManagedAgent"),
    launcher.indexOf("async function launchOnce"),
  );
  assert.doesNotMatch(resumeSource, /\/usr\/bin\/open|openArguments/);
});

test("macOS production package owns a user LaunchAgent and a bounded uninstall path", () => {
  const build = fs.readFileSync(new URL("../scripts/macos/build.sh", import.meta.url), "utf8");
  const install = fs.readFileSync(new URL("../scripts/macos/install.sh", import.meta.url), "utf8");
  const uninstall = fs.readFileSync(new URL("../scripts/macos/uninstall.sh", import.meta.url), "utf8");
  const bootstrap = fs.readFileSync(new URL("../install-macos.sh", import.meta.url), "utf8");
  const launcher = fs.readFileSync(new URL("../src/macos/launcher.mjs", import.meta.url), "utf8");
  const entry = fs.readFileSync(new URL("../src/macos/runtime-entry.mjs", import.meta.url), "utf8");
  const thinHost = fs.readFileSync(new URL("../src/macos/QuotaPinHost.swift", import.meta.url), "utf8");
  const injector = fs.readFileSync(new URL("../src/injector.mjs", import.meta.url), "utf8");
  const buildOrigin = fs.readFileSync(new URL("../src/core/build-origin.mjs", import.meta.url), "utf8");
  assert.match(build, /QuotaPin\.runtime\.cjs/);
  assert.match(build, /swiftc/);
  assert.doesNotMatch(build, /postject|NODE_SEA|cp "\$\(command -v node\)"/);
  assert.match(build, /codesign --force --sign -/);
  assert.match(build, /update\.sh/);
  assert.match(build, /src\/macos\/runtime-entry\.mjs/);
  assert.doesNotMatch(build, /build_sea .*QuotaPin\.Agent/);
  assert.match(thinHost, /Contents\/Resources\/cua_node\/bin\/node/);
  assert.match(thinHost, /2DC432GLL2/);
  assert.match(thinHost, /\/usr\/bin\/mdfind/);
  assert.match(thinHost, /kMDItemCFBundleIdentifier/);
  assert.match(thinHost, /--runtime-preflight/);
  assert.doesNotMatch(thinHost, /--deep/);
  assert.doesNotMatch(thinHost, /URLSession|curl|Homebrew|brew install|npm install/);
  assert.match(entry, /--quotapin-agent-runtime/);
  assert.match(buildOrigin, /__QUOTAPIN_BUILD_COMMIT__/);
  assert.doesNotMatch(injector, /__QUOTAPIN_BUILD_COMMIT__/);
  assert.doesNotMatch(launcher, /__QUOTAPIN_BUILD_COMMIT__/);
  assert.match(install, /Library\/LaunchAgents/);
  assert.match(install, /io\.github\.wsl043\.quotapin/);
  assert.match(install, /--ignore-existing/);
  assert.match(install, /--codex-app/);
  assert.match(install, /plutil -extract codexApp/);
  assert.match(install, /if SAVED_CODEX_APP=.*plutil -extract codexApp/);
  assert.doesNotMatch(install, /plutil -extract codexApp[^\n]+\|\| true/);
  assert.match(install, /plutil -insert codexApp/);
  assert.match(install, /plutil -insert preferences -json '\{"autoAttach":true\}'/);
  assert.doesNotMatch(install, /plutil -insert preferences -dictionary/);
  assert.match(install, /plutil -create xml1/);
  assert.match(install, /plutil -convert json/);
  assert.match(bootstrap, /plutil -create xml1/);
  assert.match(bootstrap, /plutil -convert json/);
  assert.doesNotMatch(install, /plutil -create json/);
  assert.doesNotMatch(bootstrap, /plutil -create json/);
  assert.doesNotMatch(install, /plutil -create json -o/);
  assert.doesNotMatch(bootstrap, /plutil -create json -o/);
  assert.match(install, /config\.json/);
  assert.match(install, /QuotaPin\.runtime\.cjs/);
  assert.match(install, /--runtime-preflight/);
  assert.match(uninstall, /stop-agent/);
  assert.match(uninstall, /official Codex app was not modified/);
  assert.match(bootstrap, /releases\/latest/);
  assert.match(bootstrap, /releases\/tags\/v\$REQUESTED_VERSION/);
  assert.match(bootstrap, /assets\.\$index\.digest/);
  assert.match(bootstrap, /INSTALL_ARGUMENTS\+\=\(--codex-app/);
  assert.match(bootstrap, /--write-result/);
  assert.match(install, /update\.sh/);
  assert.match(install, /"\$TARGET\/QuotaPin\.Mac" stop-agent/);
  assert.match(launcher, /budget=1\/1/);
  assert.match(launcher, /"--codex-app", bundleIdentity\.bundlePath/);
  assert.match(launcher, /degraded-latched/);
  assert.doesNotMatch(launcher, /SIGKILL/);
  assert.doesNotMatch(install, /sudo|Homebrew|brew install/);
});
