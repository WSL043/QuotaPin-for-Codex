import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { isPathInsideBundle, macosInstallRoot, macosLaunchPlan, matchesRendererReceipt, validateOfficialCodexIdentity } from "./launcher-runtime.mjs";

const VERSION = "1.0.2";
const SOURCE_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";
const BUILD_COMMIT = "__QUOTAPIN_BUILD_COMMIT__";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : "";
}

function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function codexIsRunning(bundlePath) {
  const marker = `${bundlePath}/Contents/MacOS/`;
  const result = spawnSync("/usr/bin/pgrep", ["-f", marker], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`open failed with ${signal ?? `code ${code}`}`));
    });
  });
}

function inspectOfficialBundle(bundlePath) {
  const infoPath = path.join(bundlePath, "Contents", "Info.plist");
  const plist = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", infoPath], { encoding: "utf8" });
  const verification = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundlePath], { encoding: "utf8" });
  const details = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", bundlePath], { encoding: "utf8" });
  const signatureText = `${details.stdout ?? ""}\n${details.stderr ?? ""}`;
  const teamIdentifier = /^TeamIdentifier=(.+)$/m.exec(signatureText)?.[1]?.trim() ?? "";
  return validateOfficialCodexIdentity({
    bundleIdentifier: plist.status === 0 ? plist.stdout.trim() : "",
    teamIdentifier,
    signatureValid: verification.status === 0 && details.status === 0,
  });
}

async function waitForRenderer(readyPath, agent, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (agent.exitCode !== null) throw new Error(`QuotaPin Agent exited before attachment with code ${agent.exitCode}`);
    try {
      const value = JSON.parse(fs.readFileSync(readyPath, "utf8"));
      if (matchesRendererReceipt(value, { ...expected, agentPid: agent.pid })) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("QuotaPin did not attach to Codex within 30 seconds");
}

function stopAgent(agent) {
  try { agent.kill("SIGTERM"); } catch {}
}

async function main() {
  if (process.argv.includes("--launcher-version")) {
    console.log(VERSION);
    return;
  }
  if (process.argv.includes("--build-origin")) {
    console.log(JSON.stringify({
      schemaVersion: "quotapin-origin/v1",
      product: "QuotaPin Mac Developer Launcher",
      version: VERSION,
      repository: SOURCE_REPOSITORY,
      commit: BUILD_COMMIT,
    }));
    return;
  }
  if (process.argv.includes("--self-test")) {
    const port = 43124;
    const bundlePath = path.resolve("/Applications/Codex.app");
    const commandPath = path.join(bundlePath, "Contents", "Resources", "app", "bin", "codex");
    const plan = macosLaunchPlan({
      port,
      bundleOverride: bundlePath,
      commandOverride: commandPath,
      candidates: [bundlePath],
      fsImpl: {
        existsSync: (value) => value === bundlePath || value === commandPath,
        realpathSync: (value) => value,
        accessSync: () => {},
      },
      installRoot: "/tmp/QuotaPin",
    });
    console.log(JSON.stringify({
      ok: plan.openArguments.includes("--remote-debugging-address=127.0.0.1"),
      loopbackOnly: plan.openArguments.includes("--remote-debugging-address=127.0.0.1"),
      commandInsideBundle: isPathInsideBundle(plan.bundlePath, plan.commandPath),
    }));
    return;
  }
  if (process.platform !== "darwin") throw new Error("QuotaPin Mac Developer Launcher runs only on macOS");

  const installRoot = macosInstallRoot();
  const configPath = argumentValue("--config") || path.join(installRoot, "config.json");
  const bundleOverride = argumentValue("--codex-app");
  const commandOverride = argumentValue("--codex-command");
  const agentPath = argumentValue("--agent") || process.env.QUOTAPIN_AGENT || path.join(path.dirname(process.execPath), "QuotaPin.Agent");
  const port = await allocateLoopbackPort();
  const plan = macosLaunchPlan({
    port,
    bundleOverride,
    commandOverride: commandOverride || undefined,
    env: process.env,
    installRoot,
  });
  const officialIdentity = inspectOfficialBundle(plan.bundlePath);

  if (codexIsRunning(plan.bundlePath)) {
    throw new Error("Quit Codex manually before this developer preview. QuotaPin will not close an active Mac session.");
  }
  if (!fs.existsSync(agentPath)) throw new Error(`QuotaPin Agent was not found: ${agentPath}`);

  const generation = randomUUID().replaceAll("-", "");
  const logRoot = path.join(installRoot, "logs");
  const logPath = path.join(logRoot, "macos-dev.log");
  const readyPath = path.join(logRoot, `attach-ready.${generation}.json`);
  fs.mkdirSync(logRoot, { recursive: true });
  fs.rmSync(readyPath, { force: true });
  const logHandle = fs.openSync(logPath, "a");
  const agent = spawn(agentPath, [
    "--port", String(port),
    "--config", configPath,
    "--log", logPath,
    "--attach-generation", generation,
  ], {
    env: { ...process.env, QUOTAPIN_CODEX_COMMAND: plan.commandPath },
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
  });
  fs.closeSync(logHandle);

  try {
    const opener = spawn("/usr/bin/open", plan.openArguments, { stdio: "ignore" });
    await waitForExit(opener);
    const ready = await waitForRenderer(readyPath, agent, { generation, port });
    fs.writeFileSync(path.join(logRoot, "macos-agent.pid"), `${agent.pid}\n`, "utf8");
    const launchReceiptPath = path.join(logRoot, "macos-launch.json");
    const launchReceipt = {
      schema: 1,
      state: ready.state,
      version: VERSION,
      bundlePath: plan.bundlePath,
      bundleIdentifier: officialIdentity.bundleIdentifier,
      teamIdentifier: officialIdentity.teamIdentifier,
      agentPid: agent.pid,
      port,
      generation,
      attachedAt: ready.writtenAt,
    };
    const temporaryReceipt = `${launchReceiptPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryReceipt, JSON.stringify(launchReceipt), "utf8");
    fs.renameSync(temporaryReceipt, launchReceiptPath);
    agent.unref();
    console.log(JSON.stringify({ ok: true, state: ready.state, version: VERSION }));
  } catch (error) {
    stopAgent(agent);
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
