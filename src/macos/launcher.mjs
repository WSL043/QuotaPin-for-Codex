import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { BUILD_COMMIT } from "../core/build-origin.mjs";
import { readBoundedJsonResponse } from "../core/http-json.mjs";
import {
  macAgentResumeDelayMs,
  macAutoAttachDecision,
  macDiscoveryRetryDelayMs,
  macProcessIdentityKey,
  macProcessIdentityMatches,
} from "./auto-attach-policy.mjs";
import {
  isPathInsideBundle,
  macosInstallRoot,
  macosLaunchPlan,
  matchesRendererReceipt,
  resolveCodexBundle,
  resolveCodexNodeRuntime,
  validateOfficialCodexIdentity,
  validateOfficialCodexRuntimeIdentity,
} from "./launcher-runtime.mjs";

const VERSION = "2.0.0-beta.2";
const SOURCE_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";
const POLL_MS = 1_000;
const AGENT_MODE_ARGUMENT = "--quotapin-agent-runtime";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : "";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID().replaceAll("-", "")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function appendLog(logPath, message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { encoding: "utf8", mode: 0o600 });
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

function plistValue(infoPath, key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", infoPath], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function signedComponentIdentity(componentPath) {
  const verification = spawnSync("/usr/bin/codesign", ["--verify", "--strict", componentPath], { encoding: "utf8" });
  const details = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", componentPath], { encoding: "utf8" });
  const signatureText = `${details.stdout ?? ""}\n${details.stderr ?? ""}`;
  return {
    signatureValid: verification.status === 0 && details.status === 0,
    teamIdentifier: /^TeamIdentifier=(.+)$/m.exec(signatureText)?.[1]?.trim() ?? "",
  };
}

function inspectOfficialBundle(bundlePath) {
  const infoPath = path.join(bundlePath, "Contents", "Info.plist");
  const bundleIdentifier = plistValue(infoPath, "CFBundleIdentifier");
  const executableName = plistValue(infoPath, "CFBundleExecutable");
  const appVersion = plistValue(infoPath, "CFBundleShortVersionString");
  const appIdentity = signedComponentIdentity(bundlePath);
  const verified = validateOfficialCodexIdentity({
    bundleIdentifier,
    teamIdentifier: appIdentity.teamIdentifier,
    signatureValid: appIdentity.signatureValid,
  });
  if (!executableName || executableName.includes("/") || executableName.includes("\\")) {
    throw new Error("Codex.app has no valid CFBundleExecutable");
  }
  const executablePath = path.join(bundlePath, "Contents", "MacOS", executableName);
  if (!fs.existsSync(executablePath)) throw new Error(`Codex executable was not found: ${executablePath}`);
  const nodePath = resolveCodexNodeRuntime(bundlePath);
  validateOfficialCodexRuntimeIdentity({
    app: appIdentity,
    executable: signedComponentIdentity(executablePath),
    node: signedComponentIdentity(nodePath),
  });
  return { ...verified, bundlePath, executablePath, nodePath, appVersion };
}

function parseProcessLine(line) {
  const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+([\s\S]+)$/.exec(line);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    startedAt: match[3].replace(/\s+/g, " ").trim(),
    command: match[4].trim(),
  };
}

function processTable() {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,lstart=,command="], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not inspect processes: ${(result.stderr ?? "").trim()}`);
  return result.stdout.split("\n").map(parseProcessLine).filter(Boolean);
}

function codexRootProcesses(bundleIdentity) {
  const executable = bundleIdentity.executablePath;
  return processTable()
    .filter((item) => item.command === executable || item.command.startsWith(`${executable} `))
    .map((item) => ({ ...item, executablePath: executable }))
    .sort((left, right) => left.pid - right.pid);
}

function processIdentityForPid(pid, executablePath = "") {
  const candidate = processTable().find((item) => item.pid === Number(pid));
  if (!candidate) return null;
  if (executablePath && candidate.command !== executablePath && !candidate.command.startsWith(`${executablePath} `)) return null;
  return { ...candidate, executablePath };
}

function agentPathFor(paths) {
  return path.join(paths.installRoot, "QuotaPin.Mac");
}

function runtimePathFor(paths) {
  return path.join(paths.installRoot, "QuotaPin.runtime.cjs");
}

function agentRuntimeIdentity(paths, bundleIdentity) {
  return { nodePath: bundleIdentity.nodePath, runtimePath: runtimePathFor(paths) };
}

function agentIdentityForPid(pid, runtimeIdentity) {
  const identity = processTable().find((item) => item.pid === Number(pid));
  if (!identity) return null;
  const prefix = `${runtimeIdentity.nodePath} ${runtimeIdentity.runtimePath} `;
  if (!identity.command.startsWith(prefix) || !identity.command.includes(` ${AGENT_MODE_ARGUMENT}`)) return null;
  return { ...identity, executablePath: runtimeIdentity.nodePath, runtimePath: runtimeIdentity.runtimePath };
}

async function waitForAgentIdentity(pid, runtimeIdentity, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const identity = agentIdentityForPid(pid, runtimeIdentity);
    if (identity) return identity;
    await sleep(50);
  }
  return null;
}

function agentArguments(args) {
  return [AGENT_MODE_ARGUMENT, ...args];
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

async function waitForNoCodex(bundleIdentity, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (codexRootProcesses(bundleIdentity).length === 0) return true;
    await sleep(200);
  }
  return false;
}

async function waitForRenderer(readyPath, agent, expected, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (agent.exitCode !== null) throw new Error(`QuotaPin Agent exited before attachment with code ${agent.exitCode}`);
    const value = readJson(readyPath);
    if (matchesRendererReceipt(value, { ...expected, agentPid: agent.pid })) return value;
    await sleep(250);
  }
  throw new Error("QuotaPin did not attach to Codex within 30 seconds");
}

function stopAgent(agent) {
  try { agent?.kill("SIGTERM"); } catch {}
}

function guardPaths(installRoot = macosInstallRoot()) {
  const logRoot = path.join(installRoot, "logs");
  return {
    installRoot,
    logRoot,
    guardPath: path.join(logRoot, "macos-guard.json"),
    launchReceiptPath: path.join(logRoot, "macos-launch.json"),
    watcherLogPath: path.join(logRoot, "macos-watcher.log"),
    launcherLogPath: path.join(logRoot, "macos-launcher.log"),
  };
}

function normalizedGuard(value) {
  const state = ["none", "handoff-pending", "successor-observed", "degraded-latched"].includes(value?.state)
    ? value.state
    : "none";
  return { schema: 1, state, ...(value && typeof value === "object" ? value : {}) };
}

function writeGuard(paths, guard) {
  atomicWriteJson(paths.guardPath, { schema: 1, ...guard, writtenAt: new Date().toISOString() });
}

function receiptMatches(receipt, expected = {}) {
  return receipt?.schema === 1
    && receipt?.state === "renderer-attached"
    && String(receipt?.generation ?? "") === String(expected.generation ?? "")
    && Number(receipt?.sourcePid) === Number(expected.sourcePid)
    && String(receipt?.sourceStartedAt ?? "") === String(expected.sourceStartedAt ?? "")
    && Number(receipt?.successorPid) > 0
    && Number(receipt?.agentPid) > 0
    && Number(receipt?.port) > 0;
}

function recoverManagedRuntime(paths, bundleIdentity, roots = null, expected = {}) {
  const receipt = readJson(paths.launchReceiptPath);
  if (!receiptMatches(receipt, receipt)) return null;
  if (!/^[0-9a-f]{32}$/i.test(String(receipt.generation ?? ""))) return null;
  if (expected.generation && receipt.generation !== expected.generation) return null;
  if (Number(expected.successorPid) > 0 && Number(receipt.successorPid) !== Number(expected.successorPid)) return null;
  if (expected.successorStartedAt && String(receipt.successorStartedAt ?? "") !== expected.successorStartedAt) return null;
  const currentRoots = Array.isArray(roots) ? roots : codexRootProcesses(bundleIdentity);
  const successor = currentRoots.find((item) => item.pid === Number(receipt.successorPid));
  if (!successor || successor.startedAt !== String(receipt.successorStartedAt ?? "")) return null;
  const agentPath = agentPathFor(paths);
  const runtimeIdentity = agentRuntimeIdentity(paths, bundleIdentity);
  if (receipt.agentNodePath && receipt.agentNodePath !== runtimeIdentity.nodePath) return null;
  if (receipt.agentRuntimePath && receipt.agentRuntimePath !== runtimeIdentity.runtimePath) return null;
  const agent = agentIdentityForPid(receipt.agentPid, runtimeIdentity);
  const verifiedAgent = agent && agent.startedAt === String(receipt.agentStartedAt ?? "") ? agent : null;
  return { receipt, successor, agent: verifiedAgent, agentPath, runtimeIdentity };
}

async function mainTargetAvailable(port, fetchImpl = globalThis.fetch) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) return false;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${Number(port)}/json/list`, {
      redirect: "error",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const targets = await readBoundedJsonResponse(response, { maximumBytes: 256 * 1024 });
    return Array.isArray(targets)
      && targets.length <= 64
      && targets.some((target) => target && typeof target === "object" && !Array.isArray(target)
        && typeof target.url === "string" && target.url.length <= 4096 && target.url === "app://-/index.html");
  } catch {
    return false;
  }
}

async function resumeManagedAgent(paths, bundleIdentity, recovered) {
  if (recovered?.agent) return "active";
  if (!recovered?.receipt || !recovered?.successor || !recovered?.agentPath) return "failed";
  if (!await mainTargetAvailable(Number(recovered.receipt.port))) return "not-ready";
  if (!fs.existsSync(recovered.agentPath)) return "failed";

  const plan = macosLaunchPlan({
    port: Number(recovered.receipt.port),
    bundleOverride: bundleIdentity.bundlePath,
    env: process.env,
    installRoot: paths.installRoot,
  });
  const logHandle = fs.openSync(paths.launcherLogPath, "a");
  let agent;
  try {
    agent = spawn(recovered.agentPath, agentArguments([
      "--port", String(recovered.receipt.port),
      "--config", path.join(paths.installRoot, "config.json"),
      "--log", paths.launcherLogPath,
      "--attach-generation", recovered.receipt.generation,
    ]), {
      env: { ...process.env, QUOTAPIN_CODEX_COMMAND: plan.commandPath },
      detached: true,
      stdio: ["ignore", logHandle, logHandle],
    });
  } finally {
    fs.closeSync(logHandle);
  }
  const identity = await waitForAgentIdentity(agent.pid, recovered.runtimeIdentity);
  if (!identity) {
    stopAgent(agent);
    return "failed";
  }
  atomicWriteJson(paths.launchReceiptPath, {
    ...recovered.receipt,
    agentPid: agent.pid,
    agentStartedAt: identity.startedAt,
    agentNodePath: recovered.runtimeIdentity.nodePath,
    agentRuntimePath: recovered.runtimeIdentity.runtimePath,
    resumedAt: new Date().toISOString(),
  });
  agent.unref();
  appendLog(paths.watcherLogPath, `agent resumed without reopening Codex successorPid=${recovered.successor.pid} agentPid=${agent.pid} port=${recovered.receipt.port}`);
  return "started";
}

async function launchOnce() {
  const paths = guardPaths();
  const sourcePid = Number(argumentValue("--source-pid"));
  const sourceStartedAt = argumentValue("--source-started-at");
  const generation = argumentValue("--generation");
  if (!Number.isInteger(sourcePid) || sourcePid <= 0 || !sourceStartedAt || !/^[0-9a-f]{32}$/i.test(generation)) {
    throw new Error("A verified source PID, start time, and generation are required");
  }

  const bundlePath = resolveCodexBundle({ env: process.env, override: argumentValue("--codex-app") || undefined });
  const bundleIdentity = inspectOfficialBundle(bundlePath);
  const roots = codexRootProcesses(bundleIdentity);
  const source = roots.length === 1 ? roots[0] : null;
  const expectedSource = { pid: sourcePid, startedAt: sourceStartedAt, executablePath: bundleIdentity.executablePath };
  if (!source || !macProcessIdentityMatches(source, expectedSource)) {
    throw new Error("The authorized Codex source process changed before handoff");
  }
  const guard = normalizedGuard(readJson(paths.guardPath));
  if (guard.state !== "handoff-pending" || guard.generation !== generation
      || Number(guard.sourcePid) !== sourcePid || guard.sourceStartedAt !== sourceStartedAt) {
    throw new Error("The macOS handoff authorization is missing or stale");
  }

  const configPath = path.join(paths.installRoot, "config.json");
  const agentPath = agentPathFor(paths);
  if (!fs.existsSync(agentPath)) throw new Error(`QuotaPin Agent was not found: ${agentPath}`);
  const runtimeIdentity = agentRuntimeIdentity(paths, bundleIdentity);
  if (!fs.existsSync(runtimeIdentity.runtimePath)) throw new Error(`QuotaPin runtime was not found: ${runtimeIdentity.runtimePath}`);
  const port = await allocateLoopbackPort();
  const plan = macosLaunchPlan({ port, bundleOverride: bundlePath, env: process.env, installRoot: paths.installRoot });
  const readyPath = path.join(paths.logRoot, `attach-ready.${generation}.json`);
  fs.mkdirSync(paths.logRoot, { recursive: true });
  fs.rmSync(readyPath, { force: true });

  let agent = null;
  let sourceClosed = false;
  try {
    appendLog(paths.launcherLogPath, `handoff accepted generation=${generation} sourcePid=${sourcePid} budget=1/1`);
    process.kill(sourcePid, "SIGTERM");
    sourceClosed = await waitForNoCodex(bundleIdentity);
    if (!sourceClosed) throw new Error("Codex did not quit within 10 seconds; no force-quit was attempted");

    const logHandle = fs.openSync(paths.launcherLogPath, "a");
    agent = spawn(agentPath, agentArguments([
      "--port", String(port),
      "--config", configPath,
      "--log", paths.launcherLogPath,
      "--attach-generation", generation,
    ]), {
      env: { ...process.env, QUOTAPIN_CODEX_COMMAND: plan.commandPath },
      detached: true,
      stdio: ["ignore", logHandle, logHandle],
    });
    fs.closeSync(logHandle);
    const agentIdentity = await waitForAgentIdentity(agent.pid, runtimeIdentity);
    if (!agentIdentity) throw new Error("The spawned QuotaPin Agent identity could not be verified");

    const opener = spawn("/usr/bin/open", plan.openArguments, { stdio: "ignore" });
    await waitForExit(opener);
    const ready = await waitForRenderer(readyPath, agent, { generation, port });
    const successors = codexRootProcesses(bundleIdentity).filter((item) => item.pid !== sourcePid);
    if (successors.length !== 1) throw new Error("The activated Codex successor could not be verified uniquely");
    const successor = successors[0];
    const launchReceipt = {
      schema: 1,
      state: ready.state,
      version: VERSION,
      bundlePath: plan.bundlePath,
      bundleIdentifier: bundleIdentity.bundleIdentifier,
      teamIdentifier: bundleIdentity.teamIdentifier,
      appVersion: bundleIdentity.appVersion,
      sourcePid,
      sourceStartedAt,
      successorPid: successor.pid,
      successorStartedAt: successor.startedAt,
      agentPid: agent.pid,
      agentStartedAt: agentIdentity.startedAt,
      agentNodePath: runtimeIdentity.nodePath,
      agentRuntimePath: runtimeIdentity.runtimePath,
      port,
      generation,
      attachedAt: ready.writtenAt,
    };
    atomicWriteJson(paths.launchReceiptPath, launchReceipt);
    agent.unref();
    appendLog(paths.launcherLogPath, `renderer attached generation=${generation} successorPid=${successor.pid} agentPid=${agent.pid} port=${port}`);
    console.log(JSON.stringify({ ok: true, state: ready.state, version: VERSION }));
  } catch (error) {
    stopAgent(agent);
    if (sourceClosed && codexRootProcesses(bundleIdentity).length === 0) {
      spawnSync("/usr/bin/open", ["-na", bundlePath], { stdio: "ignore" });
    }
    throw error;
  }
}

async function watch() {
  const paths = guardPaths();
  fs.mkdirSync(paths.logRoot, { recursive: true });
  let bundleIdentity = null;
  let nextDiscoveryAt = 0;
  let discoveryFailures = 0;
  let ignored = new Set();
  let initialized = false;
  let idleSince = 0;
  let agentResumeFailures = 0;
  let nextAgentResumeAt = 0;
  appendLog(paths.watcherLogPath, "watcher started");

  while (true) {
    try {
      if (!bundleIdentity || Date.now() >= nextDiscoveryAt) {
        const bundlePath = resolveCodexBundle({ env: process.env, override: argumentValue("--codex-app") || undefined });
        bundleIdentity = inspectOfficialBundle(bundlePath);
        discoveryFailures = 0;
        nextDiscoveryAt = Date.now() + 60_000;
      }
      const roots = codexRootProcesses(bundleIdentity);
      let guard = normalizedGuard(readJson(paths.guardPath));

      if (!initialized) {
        const recovered = recoverManagedRuntime(paths, bundleIdentity, roots);
        if (recovered) {
          guard = {
            state: "successor-observed",
            generation: recovered.receipt.generation,
            protectedPid: recovered.successor.pid,
            protectedStartedAt: recovered.successor.startedAt,
          };
          writeGuard(paths, guard);
          appendLog(paths.watcherLogPath, `adopted verified runtime successorPid=${recovered.successor.pid}`);
        } else if (process.argv.includes("--ignore-existing")) {
          ignored = new Set(roots.map(macProcessIdentityKey));
          if (ignored.size) appendLog(paths.watcherLogPath, `ignored ${ignored.size} pre-existing Codex process(es)`);
        }
        initialized = true;
      }

      const liveKeys = new Set(roots.map(macProcessIdentityKey));
      ignored = new Set([...ignored].filter((key) => liveKeys.has(key)));
      const candidateFresh = roots.length === 1 && !ignored.has(macProcessIdentityKey(roots[0]));
      if (roots.length === 0) {
        if (!idleSince) idleSince = Date.now();
      } else {
        idleSince = 0;
      }
      const idleSeconds = idleSince ? Math.floor((Date.now() - idleSince) / 1_000) : 0;
      const decision = macAutoAttachDecision({
        guardState: guard.state,
        roots,
        protectedPid: guard.protectedPid,
        candidateFresh,
        idleSeconds,
      });

      if (decision === "adopt" && Date.now() >= nextAgentResumeAt) {
        const recovered = recoverManagedRuntime(paths, bundleIdentity, roots, {
          generation: guard.generation,
          successorPid: guard.protectedPid,
          successorStartedAt: guard.protectedStartedAt,
        });
        const resumeResult = recovered
          ? await resumeManagedAgent(paths, bundleIdentity, recovered)
          : "failed";
        if (["active", "started"].includes(resumeResult)) {
          agentResumeFailures = 0;
          nextAgentResumeAt = Date.now() + POLL_MS;
        } else {
          agentResumeFailures += 1;
          const delay = macAgentResumeDelayMs(agentResumeFailures);
          nextAgentResumeAt = Date.now() + delay;
          appendLog(paths.watcherLogPath, `agent resume waiting result=${resumeResult} retryMs=${delay}`);
        }
      } else if (decision !== "adopt") {
        agentResumeFailures = 0;
        nextAgentResumeAt = 0;
      }

      if (decision === "launch-once") {
        const source = roots[0];
        const generation = randomUUID().replaceAll("-", "");
        guard = {
          state: "handoff-pending",
          generation,
          sourcePid: source.pid,
          sourceStartedAt: source.startedAt,
        };
        writeGuard(paths, guard);
        appendLog(paths.watcherLogPath, `fresh official launch accepted generation=${generation} sourcePid=${source.pid} budget=1/1`);
        const result = spawnSync(agentPathFor(paths), [
          "launch",
          "--codex-app", bundleIdentity.bundlePath,
          "--source-pid", String(source.pid),
          "--source-started-at", source.startedAt,
          "--generation", generation,
        ], { encoding: "utf8", timeout: 50_000 });
        const receipt = readJson(paths.launchReceiptPath);
        const currentRoots = codexRootProcesses(bundleIdentity);
        const successor = receiptMatches(receipt, {
          generation,
          sourcePid: source.pid,
          sourceStartedAt: source.startedAt,
        }) ? currentRoots.find((item) => item.pid === Number(receipt.successorPid)) : null;
        const runtimeIdentity = agentRuntimeIdentity(paths, bundleIdentity);
        const agent = receipt ? agentIdentityForPid(receipt.agentPid, runtimeIdentity) : null;
        if (result.status === 0 && successor && successor.startedAt === receipt.successorStartedAt
            && agent && agent.startedAt === receipt.agentStartedAt) {
          guard = {
            state: "successor-observed",
            generation,
            protectedPid: successor.pid,
            protectedStartedAt: successor.startedAt,
          };
          writeGuard(paths, guard);
          ignored.clear();
          appendLog(paths.watcherLogPath, `successor adopted generation=${generation} successorPid=${successor.pid}; destructive budget exhausted`);
        } else {
          guard = {
            state: "degraded-latched",
            generation,
            sourcePid: source.pid,
            sourceStartedAt: source.startedAt,
            reason: String(result.stderr || result.error?.message || `launcher exit ${result.status}`),
          };
          writeGuard(paths, guard);
          appendLog(paths.watcherLogPath, `handoff latched generation=${generation} reason=${guard.reason.replaceAll("\n", " ")}`);
        }
      } else if (decision === "latch") {
        guard = { ...guard, state: "degraded-latched", reason: "unexpected Codex process transition" };
        writeGuard(paths, guard);
        appendLog(paths.watcherLogPath, "unexpected process transition latched; no retry will run");
      } else if (decision === "rearm") {
        writeGuard(paths, { state: "none" });
        ignored.clear();
        idleSince = 0;
        appendLog(paths.watcherLogPath, "rearmed after Codex remained fully closed for 30 seconds");
      }
      await sleep(POLL_MS);
    } catch (error) {
      bundleIdentity = null;
      discoveryFailures += 1;
      const retryDelay = macDiscoveryRetryDelayMs(discoveryFailures);
      nextDiscoveryAt = Date.now() + retryDelay;
      const reason = String(error?.message ?? error).replaceAll("\n", " ");
      appendLog(paths.watcherLogPath, `runtime rediscovery deferred failures=${discoveryFailures} retryMs=${retryDelay} reason=${reason}`);
      await sleep(retryDelay);
    }
  }
}

async function stopRecordedAgent() {
  const paths = guardPaths();
  const receipt = readJson(paths.launchReceiptPath);
  if (!receipt || Number(receipt.agentPid) <= 0) return;
  const runtimeIdentity = {
    nodePath: String(receipt.agentNodePath ?? ""),
    runtimePath: String(receipt.agentRuntimePath ?? ""),
  };
  if (!runtimeIdentity.nodePath || !runtimeIdentity.runtimePath) {
    throw new Error("Recorded Agent runtime identity is incomplete; refusing to signal it");
  }
  const actual = agentIdentityForPid(receipt.agentPid, runtimeIdentity);
  if (!actual) return;
  if (actual.startedAt !== String(receipt.agentStartedAt ?? "")) {
    throw new Error("Recorded Agent PID is live but its start identity differs; refusing to signal it");
  }
  process.kill(actual.pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!agentIdentityForPid(actual.pid, runtimeIdentity)) return;
    await sleep(100);
  }
  throw new Error("QuotaPin Agent did not exit after SIGTERM; installation was preserved");
}

function printSelfTest() {
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
    oneHandoffBudget: macAutoAttachDecision({ guardState: "none", roots: [{ pid: 1 }], candidateFresh: true }) === "launch-once"
      && macAutoAttachDecision({ guardState: "successor-observed", roots: [{ pid: 2 }], protectedPid: 2 }) === "adopt",
  }));
}

async function main() {
  if (process.argv.includes("--launcher-version")) {
    console.log(VERSION);
    return;
  }
  if (process.argv.includes("--build-origin")) {
    console.log(JSON.stringify({
      schemaVersion: "quotapin-origin/v1",
      product: "QuotaPin macOS Launcher",
      version: VERSION,
      repository: SOURCE_REPOSITORY,
      commit: BUILD_COMMIT,
    }));
    return;
  }
  if (process.argv.includes("--self-test")) {
    printSelfTest();
    return;
  }
  if (process.platform !== "darwin") throw new Error("QuotaPin macOS Launcher runs only on macOS");
  const command = process.argv[2] || "watch";
  if (command === "watch") await watch();
  else if (command === "launch") await launchOnce();
  else if (command === "stop-agent") await stopRecordedAgent();
  else throw new Error(`Unknown QuotaPin macOS command: ${command}`);
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
