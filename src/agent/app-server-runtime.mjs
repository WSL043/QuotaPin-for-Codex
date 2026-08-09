import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { mergeRateLimits, normalizeRateLimits } from "../core/model.mjs";

function usageSummary(usage) {
  return (Array.isArray(usage?.windows) ? usage.windows : []).map((windowState) => ({
    minutes: Number.isFinite(Number(windowState.windowDurationMins)) ? Number(windowState.windowDurationMins) : null,
    remaining: Number.isFinite(Number(windowState.remainingPercent)) ? Number(windowState.remainingPercent) : null,
    reset: Number.isFinite(Number(windowState.resetsAt)) ? Number(windowState.resetsAt) : null,
  }));
}

function usageSignature(usage) {
  return JSON.stringify(usageSummary(usage));
}

export function resolveCodexAppServerCommand(options = {}) {
  const configured = (options.env ?? process.env).QUOTAPIN_CODEX_COMMAND;
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const platform = options.platform ?? process.platform;
  if (!configured || !fsImpl.existsSync(configured)) {
    throw new Error("Codex CLI command was not provided by the QuotaPin launcher");
  }
  if (!pathImpl.isAbsolute(configured)) {
    throw new Error("QuotaPin requires an absolute Codex executable path");
  }
  if (platform === "win32" && pathImpl.extname(configured).toLowerCase() !== ".exe") {
    throw new Error("QuotaPin requires the signed Codex executable prepared by Codex Desktop");
  }
  if (platform === "darwin") {
    const normalized = String(configured).replaceAll("\\", "/");
    if (!/\/[^/]+\.app\/Contents\//i.test(normalized)) {
      throw new Error("QuotaPin requires the Codex executable inside the selected application bundle");
    }
    try {
      fsImpl.accessSync(configured, fs.constants.X_OK);
    } catch {
      throw new Error("The Codex executable inside the application bundle is not executable");
    }
  }
  if (platform !== "win32" && platform !== "darwin") {
    throw new Error(`QuotaPin does not support the ${platform} host adapter`);
  }
  return { command: configured, args: ["app-server", "--listen", "stdio://"] };
}

export function reduceAppServerMessage(current, message, options = {}) {
  const normalize = options.normalizeRateLimits ?? normalizeRateLimits;
  const merge = options.mergeRateLimits ?? mergeRateLimits;
  const acceptUsage = (rawRateLimits) => {
    const usage = normalize(rawRateLimits);
    if (usage?.status !== "ready" && current?.usage?.status === "ready") {
      return { state: current, effect: "ignored" };
    }
    return { state: { ...current, rawRateLimits, usage }, effect: "usage" };
  };
  if (message?.id === 1 && message.result) {
    return { state: { ...current, rpcReady: true }, effect: "initialized" };
  }
  if (message?.id && message.result?.rateLimits) {
    return acceptUsage(message.result);
  }
  if (message?.method === "account/rateLimits/updated") {
    if (!message.params?.rateLimits) return { state: current, effect: "refresh" };
    const rawRateLimits = merge(current.rawRateLimits, message.params.rateLimits);
    return acceptUsage(rawRateLimits);
  }
  return { state: current, effect: "ignored" };
}

export class AppServerRuntime {
  constructor(options) {
    this.version = options.version;
    this.commandResolver = options.commandResolver ?? (() => resolveCodexAppServerCommand());
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.normalizeRateLimits = options.normalizeRateLimits ?? normalizeRateLimits;
    this.mergeRateLimits = options.mergeRateLimits ?? mergeRateLimits;
    this.onUsage = options.onUsage ?? (() => {});
    this.writeLifecycleState = options.writeLifecycleState ?? (() => {});
    this.log = options.log ?? (() => {});
    this.selfTest = options.selfTest === true;
    this.child = null;
    this.rpcBuffer = "";
    this.rpcId = 10;
    this.readInFlight = null;
    this.readTimeoutMs = Math.max(1_000, Number(options.readTimeoutMs) || 10_000);
    this.maxConsecutiveReadTimeouts = Math.max(1, Math.min(5, Number(options.maxConsecutiveReadTimeouts) || 2));
    this.consecutiveReadTimeouts = 0;
    this.initializeTimeoutMs = Math.max(1_000, Number(options.initializeTimeoutMs) || 10_000);
    this.initializeTimer = null;
    this.refreshQueued = false;
    this.usageRevision = 0;
    this.usageTrace = [];
    this.restartTimer = null;
    this.restartAttempt = 0;
    this.stopping = false;
    this.state = {
      rpcReady: false,
      rawRateLimits: null,
      usage: { status: "loading", windows: [], receivedAt: Date.now() },
    };
    this.firstUsageSettled = false;
    this.firstUsage = new Promise((resolve, reject) => {
      this.resolveFirstUsage = resolve;
      this.rejectFirstUsage = reject;
    });
  }

  getUsage() {
    return this.state.usage;
  }

  getDiagnostics() {
    return {
      usageRevision: this.usageRevision,
      usageTrace: this.usageTrace.map((entry) => ({ ...entry })),
      rpcReady: this.state.rpcReady,
      appServerPid: Number(this.child?.pid) || null,
      readInFlightId: this.readInFlight?.id ?? null,
      consecutiveReadTimeouts: this.consecutiveReadTimeouts,
    };
  }

  waitForFirstUsage() {
    return this.firstUsage;
  }

  completeFirstUsage(usage) {
    if (this.firstUsageSettled) return;
    this.firstUsageSettled = true;
    this.resolveFirstUsage(usage);
  }

  failFirstUsage(reason) {
    if (!this.selfTest || this.firstUsageSettled) return;
    this.firstUsageSettled = true;
    this.rejectFirstUsage(new Error(reason));
  }

  markStartupFailure(reason) {
    this.clearInitializationTimer();
    this.state = {
      ...this.state,
      rpcReady: false,
      usage: { status: "error", windows: [], receivedAt: Date.now() },
    };
    this.onUsage(this.state.usage);
    this.log(reason);
    this.failFirstUsage(reason);
    this.scheduleRestart(reason);
  }

  rpcSend(message) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  refresh() {
    if (!this.state.rpcReady) return;
    if (this.readInFlight) {
      this.refreshQueued = true;
      return;
    }
    const id = this.rpcId++;
    const timeout = setTimeout(() => {
      this.handleReadTimeout(id);
    }, this.readTimeoutMs);
    timeout.unref?.();
    this.readInFlight = { id, usageRevision: this.usageRevision, timeout };
    this.rpcSend({ id, method: "account/rateLimits/read", params: null });
  }

  handleReadTimeout(id) {
    if (this.readInFlight?.id !== id) return false;
    this.clearReadInFlight();
    this.consecutiveReadTimeouts += 1;
    const reason = `app-server consecutive rate-limit read timeouts ${this.consecutiveReadTimeouts}/${this.maxConsecutiveReadTimeouts}`;
    this.log(`${reason} id=${id}`);
    this.writeLifecycleState("degraded", reason);
    if (this.consecutiveReadTimeouts >= this.maxConsecutiveReadTimeouts) {
      this.retireChild(reason);
      return true;
    }
    this.flushQueuedRefresh(true);
    return false;
  }

  clearInitializationTimer() {
    clearTimeout(this.initializeTimer);
    this.initializeTimer = null;
  }

  handleInitializationTimeout(child) {
    if (child !== this.child || this.state.rpcReady) return false;
    const reason = "app-server initialization timed out";
    this.clearInitializationTimer();
    this.retireChild(reason);
    return true;
  }

  clearReadInFlight() {
    if (!this.readInFlight) return null;
    const completed = this.readInFlight;
    clearTimeout(completed.timeout);
    this.readInFlight = null;
    return completed;
  }

  flushQueuedRefresh(force = false) {
    if (!force && !this.refreshQueued) return;
    this.refreshQueued = false;
    this.refresh();
  }

  scheduleRestart(reason) {
    if (this.stopping || this.selfTest || this.restartTimer) return;
    if (this.restartAttempt >= 5) {
      this.writeLifecycleState("degraded", `${reason}; retries exhausted`);
      this.log("app-server restart budget exhausted");
      return;
    }
    const delay = Math.min(15_000, 1000 * (2 ** this.restartAttempt));
    this.restartAttempt += 1;
    this.writeLifecycleState("degraded", `${reason}; retry ${this.restartAttempt}/5`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delay);
    this.restartTimer.unref?.();
  }

  retireChild(reason) {
    const child = this.child;
    if (!child) {
      this.markStartupFailure(reason);
      return;
    }
    this.handleFailure(child, reason);
    try { child.stdin?.end(); } catch {}
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {}
    }, 300);
    killTimer.unref?.();
  }

  handleFailure(child, reason) {
    if (child !== this.child) return;
    this.child = null;
    this.clearInitializationTimer();
    this.clearReadInFlight();
    this.refreshQueued = false;
    this.consecutiveReadTimeouts = 0;
    this.state = {
      ...this.state,
      rpcReady: false,
      usage: { status: "error", windows: [], receivedAt: Date.now() },
    };
    this.onUsage(this.state.usage);
    this.log(reason);
    this.failFirstUsage(reason);
    this.scheduleRestart(reason);
  }

  handleMessage(message) {
    const isRateLimitUpdate = message?.method === "account/rateLimits/updated";
    const hasRateLimitUpdate = isRateLimitUpdate && Boolean(message.params?.rateLimits);
    if (hasRateLimitUpdate) {
      // Notifications are newer than every read already in flight. Remember
      // that causal boundary before reducing the message so a late full read
      // cannot temporarily replace the newer value and make the badge flash.
      this.usageRevision += 1;
      if (this.readInFlight) this.refreshQueued = true;
    }

    const isReadResponse = Boolean(message?.id && message.result?.rateLimits);
    if (isReadResponse) {
      const activeRead = this.readInFlight;
      if (!activeRead || Number(message.id) !== activeRead.id) {
        this.log(`ignored unordered rate-limit response id=${message.id}`);
        return;
      }
      this.clearReadInFlight();
      this.consecutiveReadTimeouts = 0;
      if (activeRead.usageRevision !== this.usageRevision) {
        this.log(`ignored stale rate-limit response id=${message.id}`);
        this.flushQueuedRefresh(true);
        return;
      }
    }

    const previousUsage = this.state.usage;
    const result = reduceAppServerMessage(this.state, message, {
      normalizeRateLimits: this.normalizeRateLimits,
      mergeRateLimits: this.mergeRateLimits,
    });
    this.state = result.state;
    if (result.effect === "initialized") {
      this.clearInitializationTimer();
      this.rpcSend({ method: "initialized", params: null });
      this.refresh();
      this.log("app-server initialized");
      return;
    }
    if (result.effect === "refresh") {
      this.refresh();
      return;
    }
    if (result.effect !== "usage") {
      if (isReadResponse) this.flushQueuedRefresh();
      return;
    }
    if (usageSignature(previousUsage) !== usageSignature(this.state.usage)) {
      const entry = {
        at: Date.now(),
        source: isReadResponse ? "read" : hasRateLimitUpdate ? "notification" : "unknown",
        id: isReadResponse ? Number(message.id) : null,
        windows: usageSummary(this.state.usage),
      };
      this.usageTrace.push(entry);
      if (this.usageTrace.length > 24) this.usageTrace.splice(0, this.usageTrace.length - 24);
      this.log(`quota transition source=${entry.source} id=${entry.id ?? "-"} windows=${JSON.stringify(entry.windows)}`);
    }
    if (this.state.usage.status === "ready") {
      this.restartAttempt = 0;
      this.writeLifecycleState("quota-ready");
    }
    this.onUsage(this.state.usage);
    this.completeFirstUsage(this.state.usage);
    if (isReadResponse) this.flushQueuedRefresh();
  }

  handleStdout(chunk) {
    this.rpcBuffer += chunk;
    for (;;) {
      const newline = this.rpcBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.rpcBuffer.slice(0, newline).trim();
      this.rpcBuffer = this.rpcBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        this.log("ignored malformed app-server message");
      }
    }
  }

  start() {
    if (this.stopping || this.child) return;
    this.rpcBuffer = "";
    this.clearReadInFlight();
    this.refreshQueued = false;
    this.usageRevision = 0;
    this.consecutiveReadTimeouts = 0;
    this.clearInitializationTimer();
    this.state = { ...this.state, rpcReady: false };
    let invocation;
    try {
      invocation = this.commandResolver();
    } catch (error) {
      this.markStartupFailure(`app-server command unavailable code=${error?.code ?? error?.name ?? "Error"}: ${error?.message ?? "unknown"}`);
      return;
    }
    let child;
    try {
      child = this.spawnImpl(invocation.command, invocation.args, {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch (error) {
      this.markStartupFailure(`app-server spawn failed code=${error?.code ?? error?.name ?? "Error"}`);
      return;
    }
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.on("error", (error) => {
      this.handleFailure(child, `app-server error code=${error.code ?? "unknown"}`);
    });
    child.on("exit", (code) => {
      this.handleFailure(child, `app-server exited code=${code ?? "unknown"}`);
    });
    this.initializeTimer = setTimeout(() => this.handleInitializationTimeout(child), this.initializeTimeoutMs);
    this.initializeTimer.unref?.();
    this.rpcSend({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "quotapin", title: "QuotaPin", version: this.version } },
    });
  }

  stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.clearInitializationTimer();
    this.clearReadInFlight();
    this.refreshQueued = false;
    const child = this.child;
    this.child = null;
    child?.stdin?.end();
    setTimeout(() => child?.kill(), 300).unref();
  }
}
