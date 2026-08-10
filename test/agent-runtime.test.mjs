import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppServerRuntime, appServerRestartDelayMs, reduceAppServerMessage } from "../src/agent/app-server-runtime.mjs";
import { CdpSession, CdpTargetRuntime, selectMainTargets } from "../src/agent/cdp-runtime.mjs";
import { ConfigRuntime } from "../src/agent/config-runtime.mjs";
import { createLifecycleStateWriter } from "../src/agent/lifecycle-state.mjs";

const jsonResponse = (value) => new Response(JSON.stringify(value));

test("CDP target selection fails closed to the main Codex page and supported target types", () => {
  const selected = selectMainTargets([
    { id: "main", url: "app://-/index.html", type: "page", webSocketDebuggerUrl: "ws://main" },
    { id: "webview", url: "app://-/index.html", type: "webview", webSocketDebuggerUrl: "ws://view" },
    { id: "devtools", url: "app://-/index.html", type: "other", webSocketDebuggerUrl: "ws://other" },
    { id: "foreign", url: "https://example.com", type: "page", webSocketDebuggerUrl: "ws://foreign" },
    { id: "missing-socket", url: "app://-/index.html", type: "page" },
  ]);
  assert.deepEqual(selected.map((target) => target.id), ["main", "webview"]);
});

test("CDP target runtime installs one payload, updates it, and closes stale sessions", async () => {
  let targets = [
    { id: "main", url: "app://-/index.html", type: "page", webSocketDebuggerUrl: "ws://main" },
  ];
  const events = [];
  const sessions = new Map();
  const runtime = new CdpTargetRuntime({
    port: 9222,
    installSource: "single-payload",
    rendererInstanceId: "agent-runtime-fixture",
    getClientState: () => ({ status: "ready" }),
    reloadConfig: () => { events.push("reload"); return false; },
    fetchImpl: async () => jsonResponse(targets),
    createSession: (_url, id) => {
      const session = {
        install: async (source) => events.push(["install", id, source]),
        update: async (state) => events.push(["update", id, state.status, state.delivery]),
        close: () => events.push(["close", id]),
        cleanup: async (rendererInstanceId) => events.push(["cleanup", id, rendererInstanceId]),
      };
      sessions.set(id, session);
      return session;
    },
  });

  await runtime.sync();
  assert.equal(runtime.everConnected, true);
  assert.deepEqual(events.slice(0, 3), [
    ["install", "main", "single-payload"],
    "reload",
    ["update", "main", "ready", { rendererInstanceId: "agent-runtime-fixture", sequence: 1, reason: "attach", createdAt: events[2][3].createdAt }],
  ]);

  await runtime.sync();
  assert.equal(events.filter((event) => Array.isArray(event) && event[0] === "update").length, 1, "an unchanged target poll resent the full client state");

  runtime.broadcast({ status: "older" }, "quota");
  runtime.broadcast({ status: "newer" }, "local-usage");
  await new Promise((resolve) => setImmediate(resolve));
  const delivered = events.filter((event) => Array.isArray(event) && event[0] === "update");
  assert.deepEqual(delivered.map((event) => [event[2], event[3].sequence, event[3].reason]), [
    ["ready", 1, "attach"],
    ["older", 2, "quota"],
    ["newer", 3, "local-usage"],
  ]);

  await runtime.cleanupAll();
  assert.ok(events.some((event) => Array.isArray(event)
    && event[0] === "cleanup"
    && event[2] === "agent-runtime-fixture"));

  targets = [];
  await runtime.sync();
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "close"));
  assert.equal(runtime.firstSession(), null);
});

test("CDP target runtime replaces a disconnected session even when the target id is unchanged", async () => {
  const target = { id: "main", url: "app://-/index.html", type: "page", webSocketDebuggerUrl: "ws://main" };
  const created = [];
  const runtime = new CdpTargetRuntime({
    port: 9222,
    installSource: "single-payload",
    rendererInstanceId: "agent-runtime-reconnect",
    getClientState: () => ({ status: "ready" }),
    fetchImpl: async () => jsonResponse([target]),
    createSession: (_url, id, _configHandler, _updateHandler, onClosed) => {
      let alive = true;
      const session = {
        install: async () => {},
        update: async () => true,
        cleanup: async () => true,
        isAlive: () => alive,
        close: () => { alive = false; },
        disconnect: () => {
          alive = false;
          onClosed?.(session);
        },
      };
      created.push({ id, session });
      return session;
    },
  });

  await runtime.sync();
  assert.equal(created.length, 1);
  created[0].session.disconnect();
  assert.equal(runtime.firstSession(), null, "a closed WebSocket remained registered as the active target session");

  await runtime.sync();
  assert.equal(created.length, 2, "the unchanged target id suppressed a replacement CDP connection");
  assert.equal(runtime.firstSession(), created[1].session);
  runtime.close();
});

test("CDP target runtime refuses ownerless renderer delivery", () => {
  assert.throws(() => new CdpTargetRuntime({
    port: 9222,
    installSource: "single-payload",
    getClientState: () => ({ status: "ready" }),
  }), /Renderer instance ID is required/);
});

test("CDP session update and cleanup are owner-scoped", async () => {
  let socket;
  class RuntimeSocket extends EventTarget {
    constructor() {
      super();
      socket = this;
      this.messages = [];
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }

    send(payload) {
      const message = JSON.parse(payload);
      this.messages.push(message);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ id: message.id, result: { result: { value: true } } }),
      })));
    }

    close() {
      this.dispatchEvent(new Event("close"));
    }
  }

  const session = new CdpSession("ws://fixture", "main", null, { WebSocketImpl: RuntimeSocket });
  assert.equal(await session.update({ status: "ready" }), false);
  assert.equal(await session.cleanup(), false);
  assert.equal(socket.messages.length, 0, "an ownerless operation reached CDP");

  const accepted = await session.update({
    status: "ready",
    delivery: { rendererInstanceId: "agent-a", sequence: 1 },
  });
  assert.equal(accepted, true);
  assert.match(socket.messages.at(-1).params.expression, /controller\.instanceId !== "agent-a"/);

  assert.equal(await session.cleanup("agent-a"), true);
  assert.match(socket.messages.at(-1).params.expression, /controller\.instanceId !== "agent-a"/);
  session.close();
});

test("CDP session invalidates a silent socket after a command timeout", async () => {
  class SilentSocket extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }

    send() {}

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }

  const session = new CdpSession("ws://silent", "main", null, { WebSocketImpl: SilentSocket });
  await assert.rejects(session.send("Runtime.enable", {}, 10), /CDP Runtime\.enable timed out/);
  assert.equal(session.isAlive(), false, "a timed-out CDP command left the socket eligible for reuse");
});

function createConfigRuntime(options = {}) {
  const initial = { version: 4, locale: "en", value: 1 };
  return new ConfigRuntime({
    configPath: null,
    loadConfigResult: () => ({ config: initial, status: "ready", readOnly: false }),
    applyConfigAction: (config, action) => ({ ...config, value: action.value }),
    saveConfig: options.saveConfig ?? ((_file, config) => config),
    formatQuota: (_usage, config) => ({ text: String(config.value) }),
    now: () => 123,
  });
}

test("config runtime returns authoritative acknowledgement only after save", () => {
  const runtime = createConfigRuntime();
  const result = runtime.handleAction(JSON.stringify({
    actionId: "action-1",
    action: { type: "set", value: 2 },
  }));
  assert.deepEqual(result, {
    broadcast: true,
    settingsAck: {
      actionId: "action-1",
      ok: true,
      preferences: { version: 4, locale: "en", value: 2 },
    },
  });
  assert.equal(runtime.clientState({ status: "ready" }).view.text, "2");
});

test("config runtime keeps the committed config and returns a structured save error", () => {
  const runtime = createConfigRuntime({
    saveConfig: () => {
      const error = new Error("read only");
      error.code = "QUOTAPIN_CONFIG_READ_ONLY";
      throw error;
    },
  });
  const result = runtime.handleAction(JSON.stringify({
    actionId: "action-2",
    action: { type: "set", value: 9 },
  }));
  assert.equal(result.broadcast, true);
  assert.deepEqual(result.settingsAck, {
    actionId: "action-2",
    ok: false,
    error: {
      code: "QUOTAPIN_CONFIG_READ_ONLY",
      message: "This configuration is read-only because it was created by a newer QuotaPin version.",
    },
  });
  assert.equal(runtime.clientState({ status: "ready" }).view.text, "1");
});

test("App Server message reducer separates initialization, refresh, and usage updates", () => {
  const initial = { rpcReady: false, rawRateLimits: { old: true }, usage: { status: "loading" } };
  const initialized = reduceAppServerMessage(initial, { id: 1, result: {} });
  assert.equal(initialized.effect, "initialized");
  assert.equal(initialized.state.rpcReady, true);

  const refresh = reduceAppServerMessage(initial, { method: "account/rateLimits/updated", params: {} });
  assert.equal(refresh.effect, "refresh");

  const usage = reduceAppServerMessage(initial, {
    method: "account/rateLimits/updated",
    params: { rateLimits: { next: true } },
  }, {
    mergeRateLimits: (previous, next) => ({ ...previous, ...next }),
    normalizeRateLimits: (raw) => ({ status: "ready", raw }),
  });
  assert.equal(usage.effect, "usage");
  assert.deepEqual(usage.state.rawRateLimits, { old: true, next: true });
  assert.equal(usage.state.usage.status, "ready");
});

test("a transient full refresh without the ordinary quota preserves the last ready view", () => {
  const previousUsage = { status: "ready", windows: [{ remainingPercent: 42 }] };
  const initial = { rpcReady: true, rawRateLimits: { rateLimits: { limitId: "codex" } }, usage: previousUsage };
  const result = reduceAppServerMessage(initial, {
    id: 12,
    result: { rateLimits: { limitId: "codex_bengalfox" }, rateLimitsByLimitId: {} },
  });
  assert.equal(result.effect, "ignored");
  assert.equal(result.state, initial);
  assert.equal(result.state.usage, previousUsage);
});

test("App Server serializes reads and rejects a response made stale by a newer notification", () => {
  const writes = [];
  const usages = [];
  const logs = [];
  const runtime = new AppServerRuntime({
    version: "test",
    readTimeoutMs: 60_000,
    mergeRateLimits: (_previous, update) => ({ marker: update.marker }),
    normalizeRateLimits: (raw) => ({ status: "ready", marker: raw.marker ?? raw.rateLimits?.marker }),
    onUsage: (usage) => usages.push(usage.marker),
    log: (message) => logs.push(message),
  });
  runtime.child = {
    stdin: {
      writable: true,
      write: (line) => writes.push(JSON.parse(line)),
      end: () => {},
    },
    kill: () => {},
  };
  runtime.state = { ...runtime.state, rpcReady: true };

  runtime.refresh();
  runtime.refresh();
  assert.deepEqual(writes.map((message) => message.id), [10], "overlapping reads were not coalesced");

  runtime.handleMessage({
    method: "account/rateLimits/updated",
    params: { rateLimits: { marker: "notification-new" } },
  });
  runtime.handleMessage({ id: 10, result: { rateLimits: { marker: "response-old" } } });

  assert.deepEqual(usages, ["notification-new"]);
  assert.equal(runtime.getUsage().marker, "notification-new");
  assert.deepEqual(writes.map((message) => message.id), [10, 11], "a clean read was not issued after rejecting stale data");

  runtime.handleMessage({ id: 11, result: { rateLimits: { marker: "response-current" } } });
  assert.deepEqual(usages, ["notification-new", "response-current"]);
  assert.equal(runtime.getDiagnostics().usageTrace.length, 0, "marker-only fixtures must not invent quota windows");
  assert.ok(logs.some((message) => message.includes("ignored stale rate-limit response id=10")));
  runtime.stop();
});

test("App Server retires an unresponsive child after consecutive rate-limit read timeouts", () => {
  const writes = [];
  const logs = [];
  let ended = 0;
  const runtime = new AppServerRuntime({
    version: "test",
    readTimeoutMs: 60_000,
    maxConsecutiveReadTimeouts: 2,
    log: (message) => logs.push(message),
  });
  const child = {
    stdin: {
      writable: true,
      write: (line) => writes.push(JSON.parse(line)),
      end: () => { ended += 1; },
    },
    kill: () => {},
  };
  runtime.child = child;
  runtime.state = { ...runtime.state, rpcReady: true };

  runtime.refresh();
  runtime.handleReadTimeout(10);
  assert.equal(runtime.child, child, "one transient timeout should not immediately discard the process");
  assert.deepEqual(writes.map((message) => message.id), [10, 11]);

  runtime.handleReadTimeout(11);
  assert.equal(runtime.child, null, "the unresponsive process remained the active App Server");
  assert.equal(runtime.getUsage().status, "error", "stale quota remained marked ready during process recovery");
  assert.equal(ended, 1);
  assert.ok(logs.some((message) => message.includes("consecutive rate-limit read timeouts")));
  runtime.stop();
});

test("App Server recovery stays bounded but never becomes permanently exhausted", () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, attempt) => appServerRestartDelayMs(attempt)),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000, 60_000],
  );
  const runtime = new AppServerRuntime({ version: "test" });
  runtime.restartAttempt = 12;
  runtime.scheduleRestart("still unavailable");
  assert.ok(runtime.restartTimer, "a long outage permanently exhausted App Server recovery");
  assert.equal(runtime.restartAttempt, 13);
  runtime.stop();
});

test("App Server clears the timeout streak after a successful read", () => {
  const writes = [];
  const runtime = new AppServerRuntime({
    version: "test",
    readTimeoutMs: 60_000,
    maxConsecutiveReadTimeouts: 2,
    normalizeRateLimits: () => ({ status: "ready", windows: [] }),
  });
  const child = {
    stdin: {
      writable: true,
      write: (line) => writes.push(JSON.parse(line)),
      end: () => {},
    },
    kill: () => {},
  };
  runtime.child = child;
  runtime.state = { ...runtime.state, rpcReady: true };

  runtime.refresh();
  runtime.handleReadTimeout(10);
  runtime.handleMessage({ id: 11, result: { rateLimits: { marker: "recovered" } } });
  assert.equal(runtime.getDiagnostics().consecutiveReadTimeouts, 0);

  runtime.refresh();
  runtime.handleReadTimeout(12);
  assert.equal(runtime.child, child, "two non-consecutive timeouts incorrectly retired a healthy process");
  assert.equal(runtime.getDiagnostics().consecutiveReadTimeouts, 1);
  runtime.stop();
});

test("App Server retires a child that never completes initialization", () => {
  const logs = [];
  let ended = 0;
  const runtime = new AppServerRuntime({
    version: "test",
    log: (message) => logs.push(message),
  });
  const child = {
    stdin: { writable: true, write: () => {}, end: () => { ended += 1; } },
    kill: () => {},
  };
  runtime.child = child;

  runtime.handleInitializationTimeout(child);
  assert.equal(runtime.child, null, "a spawned but uninitialized process remained active forever");
  assert.equal(runtime.getUsage().status, "error");
  assert.equal(ended, 1);
  assert.ok(logs.some((message) => message.includes("initialization timed out")));
  runtime.stop();
});

test("App Server clears its initialization watchdog only after the handshake succeeds", () => {
  const writes = [];
  const childHandlers = {};
  const stdoutHandlers = {};
  const child = {
    stdin: {
      writable: true,
      write: (line) => writes.push(JSON.parse(line)),
      end: () => {},
    },
    stdout: {
      setEncoding: () => {},
      on: (name, handler) => { stdoutHandlers[name] = handler; },
    },
    on: (name, handler) => { childHandlers[name] = handler; },
    kill: () => {},
  };
  const runtime = new AppServerRuntime({
    version: "test",
    initializeTimeoutMs: 60_000,
    commandResolver: () => ({ command: "fixture", args: [] }),
    spawnImpl: () => child,
  });

  runtime.start();
  assert.equal(writes[0]?.method, "initialize");
  assert.ok(runtime.initializeTimer, "the spawned child had no initialization liveness deadline");
  runtime.handleMessage({ id: 1, result: {} });
  assert.equal(runtime.initializeTimer, null, "a successful handshake left a stale initialization timer");
  assert.equal(runtime.state.rpcReady, true);
  assert.equal(writes.at(-1)?.method, "account/rateLimits/read");
  assert.equal(typeof stdoutHandlers.data, "function");
  assert.equal(typeof childHandlers.exit, "function");
  runtime.stop();
});

test("App Server self-test fails immediately when its runtime command is unavailable", async () => {
  const states = [];
  const runtime = new AppServerRuntime({
    version: "test",
    selfTest: true,
    commandResolver: () => { throw new Error("missing signed runtime"); },
    onUsage: (usage) => states.push(usage.status),
  });
  runtime.start();
  await assert.rejects(runtime.waitForFirstUsage(), /missing signed runtime/);
  assert.deepEqual(states, ["error"]);
  assert.equal(runtime.getUsage().status, "error");
  runtime.stop();
});

test("lifecycle writer preserves launcher attempt and current Codex pid atomically", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  const logs = path.join(root, "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "runtime.json"), JSON.stringify({ codexPid: 42 }));
  fs.writeFileSync(path.join(logs, "lifecycle.json"), JSON.stringify({ attempt: 3 }));

  const write = createLifecycleStateWriter({ configPath, port: 9222, pid: 77 });
  write("degraded", "x".repeat(200));
  const state = JSON.parse(fs.readFileSync(path.join(logs, "lifecycle.json"), "utf8"));
  assert.equal(state.state, "degraded");
  assert.equal(state.agentPid, 77);
  assert.equal(state.codexPid, 42);
  assert.equal(state.attempt, 3);
  assert.equal(state.reason.length, 160);
});
