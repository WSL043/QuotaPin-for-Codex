import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppServerRuntime, reduceAppServerMessage } from "../src/agent/app-server-runtime.mjs";
import { CdpTargetRuntime, selectMainTargets } from "../src/agent/cdp-runtime.mjs";
import { ConfigRuntime } from "../src/agent/config-runtime.mjs";
import { createLifecycleStateWriter } from "../src/agent/lifecycle-state.mjs";

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
    fetchImpl: async () => ({ ok: true, json: async () => targets }),
    createSession: (_url, id) => {
      const session = {
        install: async (source) => events.push(["install", id, source]),
        update: async (state) => events.push(["update", id, state.status, state.delivery]),
        close: () => events.push(["close", id]),
        cleanup: async () => {},
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

  targets = [];
  await runtime.sync();
  assert.ok(events.some((event) => Array.isArray(event) && event[0] === "close"));
  assert.equal(runtime.firstSession(), null);
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
