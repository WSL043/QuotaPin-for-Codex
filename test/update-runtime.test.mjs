import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { compareVersions, MINIMUM_SAFE_VERSION, normalizeReleases, updateDirection, UpdateRuntime } from "../src/agent/update-runtime.mjs";

const DIGEST = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const release = (version, options = {}) => {
  const tag = `v${version}`;
  const packageName = `QuotaPin-${version}.exe`;
  const macPackageName = `QuotaPin-macOS-${version}.dmg`;
  const value = {
    tag_name: tag,
    html_url: `https://github.com/WSL043/QuotaPin-for-Codex/releases/tag/${tag}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? version.includes("-"),
    immutable: Object.hasOwn(options, "immutable") ? options.immutable : true,
    assets: [
      {
        name: packageName,
        browser_download_url: `https://github.com/WSL043/QuotaPin-for-Codex/releases/download/${tag}/${packageName}`,
        digest: DIGEST,
        size: 24_000_000,
      },
      {
        name: macPackageName,
        browser_download_url: `https://github.com/WSL043/QuotaPin-for-Codex/releases/download/${tag}/${macPackageName}`,
        digest: DIGEST,
        size: 42_000_000,
      },
    ],
  };
  if (options.windowsOnly) value.assets = value.assets.slice(0, 1);
  return value;
};

const windowsRuntime = (options) => new UpdateRuntime({ platform: "win32", pathImpl: path.win32, ...options });

test("semantic versions compare stable and prerelease identifiers", () => {
  assert.equal(compareVersions("0.3.0-alpha.25", "0.3.0-alpha.24"), 1);
  assert.equal(compareVersions("0.3.0", "0.3.0-alpha.25"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("bad", "1.0.0"), null);
  assert.equal(updateDirection("0.3.0-alpha.26", "0.3.0-alpha.25"), "update");
  assert.equal(updateDirection("0.3.0-alpha.25", "0.3.0-alpha.25"), "repair");
  assert.equal(updateDirection("0.3.0-alpha.25", "0.3.0-alpha.26"), "rollback");
});

test("release normalization requires the command-install assets and respects stable channels", () => {
  const incomplete = release("0.4.0");
  incomplete.assets.pop();
  const mislabeledPrerelease = { ...release("0.4.0-beta.1"), prerelease: false };
  const mutable = release("0.3.0-alpha.27", { immutable: false });
  const missingImmutable = release("0.3.0-alpha.28");
  delete missingImmutable.immutable;
  const payload = [release("0.3.0-alpha.26"), mutable, missingImmutable, mislabeledPrerelease, release("0.3.0-alpha.24"), release("0.3.0"), release("0.2.9"), incomplete, { ...release("9.0.0"), draft: true }];
  assert.equal(MINIMUM_SAFE_VERSION, "0.3.0-alpha.25");
  assert.deepEqual(normalizeReleases(payload, "0.3.0-alpha.25", MINIMUM_SAFE_VERSION, "darwin").map((item) => item.version), ["0.3.0", "0.3.0-alpha.26"]);
  assert.deepEqual(normalizeReleases(payload, "0.3.0", MINIMUM_SAFE_VERSION, "darwin").map((item) => item.version), ["0.3.0"]);
  assert.deepEqual(normalizeReleases([release("1.0.2", { windowsOnly: true })], "1.0.3", MINIMUM_SAFE_VERSION, "win32").map((item) => item.version), ["1.0.2"]);
  assert.deepEqual(normalizeReleases([release("1.0.2", { windowsOnly: true })], "1.0.3", MINIMUM_SAFE_VERSION, "darwin"), []);
});

test("release normalization rejects missing, renamed, or extra public assets", () => {
  const missing = release("0.3.0-alpha.26");
  missing.assets = [];
  const renamed = release("0.3.0-alpha.26");
  renamed.assets[0].name = "QuotaPin.exe";
  const extra = release("0.3.0-alpha.26");
  extra.assets.push({ name: "internal.zip" });
  for (const [label, candidate] of [["missing", missing], ["renamed", renamed], ["extra", extra]]) {
    assert.deepEqual(normalizeReleases([candidate], "0.3.0-alpha.25", MINIMUM_SAFE_VERSION, "darwin"), [], label);
  }
});

test("release normalization exposes update, repair, and rollback direction", () => {
  const releases = normalizeReleases([
    release("0.3.0-alpha.27"),
    release("0.3.0-alpha.26"),
    release("0.3.0-alpha.25"),
  ], "0.3.0-alpha.26", MINIMUM_SAFE_VERSION, "darwin");
  assert.deepEqual(releases.map(({ version, direction }) => ({ version, direction })), [
    { version: "0.3.0-alpha.27", direction: "update" },
    { version: "0.3.0-alpha.26", direction: "repair" },
    { version: "0.3.0-alpha.25", direction: "rollback" },
  ]);
  const missingImmutable = release("0.3.0-alpha.27");
  delete missingImmutable.immutable;
  assert.deepEqual(normalizeReleases([missingImmutable], "0.3.0-alpha.26", MINIMUM_SAFE_VERSION, "darwin"), [], "missing immutable metadata fails closed");
  for (const immutable of [false, null, "true", 1]) {
    assert.deepEqual(normalizeReleases([release("0.3.0-alpha.27", { immutable })], "0.3.0-alpha.26", MINIMUM_SAFE_VERSION, "darwin"), [], `immutable=${String(immutable)}`);
  }
});

test("update runtime checks without installing and launches only an eligible selected release", async () => {
  const changes = [];
  const launches = [];
  const requests = [];
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => [release("0.3.0-alpha.26"), release("0.3.0-alpha.25"), release("0.3.0-alpha.24")] };
    },
    fsImpl: { existsSync: () => true },
    spawnImpl: (file, args, options) => {
      launches.push({ file, args, options });
      return { unref() {} };
    },
    onChange: (state) => changes.push(state.status),
    autoCheck: false,
  });
  await runtime.check();
  assert.equal(runtime.clientState().status, "available");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(launches.length, 0, "checking must never install automatically");
  assert.equal(runtime.install("0.3.0-alpha.25"), true, "the installed release supports repair");
  assert.equal(runtime.install("0.3.0-alpha.25"), false, "an in-flight update is single-flight");
  assert.equal(runtime.clientState().status, "installing");
  assert.equal(runtime.clientState().selectedDirection, "repair");
  assert.equal(launches.length, 1);
  assert.ok(launches[0].args.includes("Bypass"));
  assert.ok(launches[0].args.includes("0.3.0-alpha.25"));
  assert.equal(runtime.install("0.3.0-alpha.24"), false, "a known-unsafe version never enters the picker");
  assert.equal(runtime.install("9.9.9"), false);
  assert.ok(changes.includes("checking") && changes.includes("available"));
});

test("macOS update runtime selects the universal asset and the installed bash updater", async () => {
  const launches = [];
  const root = "/Users/Test/Library/Application Support/QuotaPin";
  const runtime = new UpdateRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    platform: "darwin",
    pathImpl: path.posix,
    autoCheck: false,
    fsImpl: { existsSync: (value) => value === `${root}/update.sh` },
    fetchImpl: async () => ({ ok: true, json: async () => [release("0.3.0-alpha.26")] }),
    spawnImpl: (file, args, options) => {
      launches.push({ file, args, options });
      return { unref() {} };
    },
  });
  await runtime.check(true);
  assert.equal(runtime.install("0.3.0-alpha.26"), true);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].file, "/bin/bash");
  assert.deepEqual(launches[0].args, [`${root}/update.sh`, "--version", "0.3.0-alpha.26", "--write-result"]);
  assert.equal(launches[0].options.windowsHide, false);
});

test("a running macOS Agent recognizes an update staged for the next normal Codex launch", () => {
  const root = "/Users/Test/Library/Application Support/QuotaPin";
  const resultPath = `${root}/logs/update-result.json`;
  const removed = [];
  const runtime = new UpdateRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    platform: "darwin",
    pathImpl: path.posix,
    autoCheck: false,
    now: () => 1_000_000,
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === resultPath) return JSON.stringify({
          schema: 1,
          status: "degraded",
          version: "0.3.0-alpha.26",
          fromVersion: "0.3.0-alpha.25",
          writtenAt: new Date(999_000).toISOString(),
        });
        throw new Error("missing");
      },
      unlinkSync(filePath) { removed.push(filePath); },
    },
  });
  assert.equal(runtime.clientState().status, "available");
  assert.match(runtime.clientState().message, /next Codex launch/i);
  assert.deepEqual(removed, [resultPath]);
});

test("a recent terminal update result survives Agent replacement", () => {
  const resultPath = "C:\\Users\\Test\\AppData\\Local\\QuotaPin\\logs\\update-result.json";
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    autoCheck: false,
    now: () => 1_000_000,
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === resultPath) return JSON.stringify({ schema: 1, status: "succeeded", version: "0.3.0-alpha.25", writtenAt: new Date(999_000).toISOString() });
        throw new Error("missing");
      },
    },
  });
  assert.equal(runtime.clientState().status, "current");
  assert.equal(runtime.clientState().message, "QuotaPin updated successfully.");
  assert.deepEqual(runtime.clientState().lastOperation, {
    direction: "repair",
    fromVersion: null,
    toVersion: "0.3.0-alpha.25",
    result: "succeeded",
  });
});

test("a restored rollback is observable and a failed terminal result still schedules future checks", () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const resultPath = `${root}\\logs\\update-result.json`;
  const scheduled = [];
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    now: () => 1_000_000,
    cacheMs: 4321,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === resultPath) return JSON.stringify({
          schema: 1,
          status: "rolled-back",
          version: "0.3.0-alpha.26",
          fromVersion: "0.3.0-alpha.25",
          direction: "update",
          writtenAt: new Date(999_000).toISOString(),
        });
        throw new Error("missing");
      },
    },
  });
  assert.equal(runtime.clientState().status, "error");
  assert.equal(runtime.clientState().lastOperation.result, "rolled-back");
  assert.equal(runtime.clientState().lastOperation.direction, "update");
  assert.deepEqual(scheduled.map((item) => item.delay), [4321]);
});

test("a failed restored result does not permanently stop periodic discovery", () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const resultPath = `${root}\\logs\\update-result.json`;
  const scheduled = [];
  windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    now: () => 1_000_000,
    cacheMs: 7654,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === resultPath) return JSON.stringify({ schema: 1, status: "failed", version: "0.3.0-alpha.26", writtenAt: new Date(999_000).toISOString() });
        throw new Error("missing");
      },
    },
  });
  assert.deepEqual(scheduled.map((item) => item.delay), [7654]);
});

test("a restored update remains single-flight until its terminal result arrives", async () => {
  const resultPath = "C:\\Users\\Test\\AppData\\Local\\QuotaPin\\logs\\update-result.json";
  const scheduled = [];
  let fetches = 0;
  let result = { schema: 1, status: "started", version: "0.3.0-alpha.25", writtenAt: new Date(999_000).toISOString() };
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    now: () => 1_000_000,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === resultPath && result) return JSON.stringify(result);
        throw new Error("missing");
      },
      unlinkSync(filePath) {
        if (filePath === resultPath) result = null;
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => [release("0.3.0-alpha.26")] };
    },
  });
  assert.equal(runtime.clientState().status, "installing");
  assert.deepEqual(scheduled.map((item) => item.delay), [250]);
  await runtime.check(true);
  assert.equal(fetches, 0);
  assert.equal(runtime.clientState().status, "installing");

  result = { schema: 1, status: "succeeded", version: "0.3.0-alpha.25", writtenAt: new Date(1_000_000).toISOString() };
  scheduled[0].callback();
  assert.equal(runtime.clientState().status, "current");
  assert.equal(result, null, "the one-time terminal result is consumed");
  assert.deepEqual(scheduled.map((item) => item.delay), [250, 24 * 60 * 60 * 1000]);
});

test("a stable Agent filters prereleases restored from its current cache", () => {
  const cachePath = "C:\\Users\\Test\\AppData\\Local\\QuotaPin\\logs\\update-cache.json";
  const launches = [];
  const runtime = windowsRuntime({
    currentVersion: "0.3.0",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    autoCheck: false,
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === cachePath) return JSON.stringify({ schema: 2, currentVersion: "0.3.0", checkedAt: 100, releases: [{ version: "0.3.0-alpha.26" }, { version: "0.3.0" }] });
        throw new Error("missing");
      },
      existsSync: () => true,
    },
    spawnImpl: (...args) => {
      launches.push(args);
      return { unref() {} };
    },
  });
  assert.deepEqual(runtime.clientState().releases.map((item) => item.version), ["0.3.0"]);
  assert.equal(runtime.install("0.3.0-alpha.26"), false);
  assert.equal(launches.length, 0);
});

test("cache and successful terminal state from another installed version are discarded", () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const cachePath = `${root}\\logs\\update-cache.json`;
  const resultPath = `${root}\\logs\\update-result.json`;
  const removed = [];
  const scheduled = [];
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    autoCheckDelayMs: 5000,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === cachePath) return JSON.stringify({ schema: 2, currentVersion: "0.3.0-alpha.24", checkedAt: 900_000, releases: [{ version: "0.3.0-alpha.26" }] });
        if (filePath === resultPath) return JSON.stringify({ schema: 1, status: "succeeded", version: "0.3.0-alpha.24", writtenAt: new Date(999_000).toISOString() });
        throw new Error("missing");
      },
      unlinkSync(filePath) { removed.push(filePath); },
    },
    now: () => 1_000_000,
  });
  assert.deepEqual(runtime.clientState().releases, []);
  assert.equal(runtime.clientState().status, "idle");
  assert.deepEqual(removed, [resultPath]);
  assert.deepEqual(scheduled.map((item) => item.delay), [5000]);
});

test("automatic update discovery schedules one bounded check and never installs", async () => {
  const scheduled = [];
  let checks = 0;
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    autoCheckDelayMs: 5000,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: { readFileSync() { throw new Error("missing"); } },
    fetchImpl: async () => {
      checks += 1;
      return { ok: true, json: async () => [release("0.3.0-alpha.26")] };
    },
    spawnImpl: () => { throw new Error("automatic check must not spawn"); },
  });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 5000);
  scheduled[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(runtime.clientState().status, "available");
  assert.deepEqual(scheduled.map((item) => item.delay), [5000, 24 * 60 * 60 * 1000]);
});

test("manual refresh bypasses an otherwise fresh release cache", async () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const cachePath = `${root}\\logs\\update-cache.json`;
  let fetches = 0;
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    autoCheck: false,
    now: () => 1_000_000,
    cacheMs: 10_000,
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === cachePath) return JSON.stringify({ schema: 2, currentVersion: "0.3.0-alpha.25", checkedAt: 999_500, releases: [{ version: "0.3.0-alpha.25" }] });
        throw new Error("missing");
      },
    },
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, json: async () => [release("0.3.0-alpha.26")] };
    },
  });
  await runtime.check(false);
  assert.equal(fetches, 0);
  assert.equal(runtime.handleAction(JSON.stringify({ type: "refresh" })), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  assert.equal(runtime.clientState().status, "available");
});

test("an install cannot race an in-flight release check", async () => {
  let releaseFetch;
  const launched = [];
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    autoCheck: false,
    fsImpl: { existsSync: () => true },
    fetchImpl: () => new Promise((resolve) => { releaseFetch = resolve; }),
    spawnImpl: (...args) => {
      launched.push(args);
      return { unref() {} };
    },
  });
  const checking = runtime.check(true);
  assert.equal(runtime.clientState().status, "checking");
  assert.equal(runtime.install("0.3.0-alpha.25"), false);
  assert.equal(launched.length, 0);
  releaseFetch({ ok: true, json: async () => [release("0.3.0-alpha.25")] });
  await checking;
  assert.equal(runtime.clientState().status, "current");
});

test("an asynchronous spawn error leaves installing immediately", async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: "C:\\Users\\Test\\AppData\\Local\\QuotaPin",
    autoCheck: false,
    fsImpl: { existsSync: () => true },
    fetchImpl: async () => ({ ok: true, json: async () => [release("0.3.0-alpha.26")] }),
    spawnImpl: () => child,
  });
  await runtime.check(true);
  assert.equal(runtime.install("0.3.0-alpha.26"), true);
  child.emit("error", Object.assign(new Error("missing executable"), { code: "ENOENT" }));
  assert.equal(runtime.clientState().status, "error");
  assert.match(runtime.clientState().message, /could not start/i);
});

test("an updater early exit consumes its matching started receipt", async () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const resultPath = `${root}\\logs\\update-result.json`;
  const child = new EventEmitter();
  child.unref = () => {};
  let result = null;
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    autoCheck: false,
    now: () => 1_000_000,
    fsImpl: {
      existsSync: () => true,
      readFileSync(filePath) {
        if (filePath === resultPath && result) return JSON.stringify(result);
        throw new Error("missing");
      },
      unlinkSync(filePath) {
        if (filePath === resultPath) result = null;
      },
    },
    fetchImpl: async () => ({ ok: true, json: async () => [release("0.3.0-alpha.25")] }),
    spawnImpl: () => child,
  });
  await runtime.check(true);
  assert.equal(runtime.install("0.3.0-alpha.25"), true);
  result = { schema: 1, status: "started", version: "0.3.0-alpha.25", writtenAt: new Date(1_000_000).toISOString() };
  child.emit("exit", 1);
  assert.equal(runtime.clientState().status, "error");
  assert.equal(result, null);
});

test("future update results and caches never suppress a fresh check", () => {
  const root = "C:\\Users\\Test\\AppData\\Local\\QuotaPin";
  const cachePath = `${root}\\logs\\update-cache.json`;
  const resultPath = `${root}\\logs\\update-result.json`;
  const scheduled = [];
  const now = 1_000_000;
  const future = new Date(now + 6 * 60 * 1000).toISOString();
  const runtime = windowsRuntime({
    currentVersion: "0.3.0-alpha.25",
    installRoot: root,
    now: () => now,
    autoCheckDelayMs: 1234,
    setTimeoutImpl(callback, delay) {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
    fsImpl: {
      readFileSync(filePath) {
        if (filePath === cachePath) return JSON.stringify({ schema: 2, currentVersion: "0.3.0-alpha.25", checkedAt: now + 6 * 60 * 1000, releases: [{ version: "0.3.0-alpha.26" }] });
        if (filePath === resultPath) return JSON.stringify({ schema: 1, status: "started", version: "0.3.0-alpha.25", writtenAt: future });
        throw new Error("missing");
      },
    },
  });
  assert.equal(runtime.clientState().status, "idle");
  assert.deepEqual(runtime.clientState().releases, []);
  assert.deepEqual(scheduled.map((item) => item.delay), [1234]);
});
