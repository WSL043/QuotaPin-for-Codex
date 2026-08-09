import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCommandStateToolkit } from "../src/renderer/command-state.mjs";
import { createColorStateToolkit } from "../src/renderer/color-state.mjs";
import { createEffectStateToolkit } from "../src/renderer/effect-state.mjs";
import { createGestureStateToolkit } from "../src/renderer/gesture-state.mjs";
import { createI18nToolkit } from "../src/renderer/i18n-state.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";
import { createSettingsStateToolkit } from "../src/renderer/settings-state.mjs";
import { createTimeStateToolkit } from "../src/renderer/time-state.mjs";
import { createCodeConfigStateToolkit } from "../src/renderer/code-config-state.mjs";
import { createProfileUsageStateToolkit } from "../src/renderer/profile-usage-state.mjs";
import { DEFAULT_CONFIG, sanitizeConfig } from "../src/core/config.mjs";
import { formatQuota } from "../src/core/format.mjs";
import { normalizeRateLimits } from "../src/core/model.mjs";
import { loadRendererSource } from "../scripts/check-renderer-source.mjs";

const browserCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    ]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const browserPath = browserCandidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
const canRun = Boolean(browserPath && typeof WebSocket === "function");

const renderer = `globalThis.__quotaPinRendererToolkits = {
  settings: ${createSettingsStateToolkit.toString()},
  layout: ${createLayoutStateToolkit.toString()},
  gesture: ${createGestureStateToolkit.toString()},
  effect: ${createEffectStateToolkit.toString()},
  i18n: ${createI18nToolkit.toString()},
  command: ${createCommandStateToolkit.toString()},
  color: ${createColorStateToolkit.toString()},
  time: ${createTimeStateToolkit.toString()},
  codeConfig: ${createCodeConfigStateToolkit.toString()},
  profileUsage: ${createProfileUsageStateToolkit.toString()}
};\n${loadRendererSource()}`;
const fixtureNow = Date.now();
const fixturePreferences = sanitizeConfig(DEFAULT_CONFIG);
const fixtureView = formatQuota(normalizeRateLimits({
  primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: fixtureNow / 1000 + 4 * 86400 + 8 * 3600 },
}), fixturePreferences, fixtureNow, "en-US");

const fixtureScript = `(() => {
  window.__fixtureNativeMenuDown = 0;
  document.addEventListener("pointerdown", (event) => {
    if (event.target?.id === "account") window.__fixtureNativeMenuDown += 1;
  });
  const params = new URLSearchParams(location.search);
  const preferences = ${JSON.stringify(fixturePreferences)};
  const view = ${JSON.stringify(fixtureView)};
  preferences.locale = params.get("locale") || "en";
  let update = {
    status: "current",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    releases: [
      { version: "1.1.0", prerelease: false },
      { version: "1.0.0", prerelease: false },
      { version: "1.0.0-beta.2", prerelease: true },
      { version: "1.0.0-beta.1", prerelease: true },
      { version: "1.0.0-beta.0", prerelease: true }
    ],
    message: ""
  };
  window.__fixtureUpdateActions = [];
  window.confirm = () => { throw new Error("native confirm must not be used by the update surface"); };
  function activeProfile() {
    return preferences.profiles.find((item) => item.id === preferences.activeProfile) || preferences.profiles[0];
  }
  function syncView() {
    const profile = activeProfile();
    for (const key of ["displayMode", "showValue", "showDot", "showBar", "showLabel", "showCountdown", "showRelative", "showSeconds", "showDate", "showReset", "showTodayTokens", "showLifetimeTokens", "effect", "effectTarget", "effectAt"]) view[key] = profile[key];
    view.profileId = profile.id;
    view.profileName = profile.name;
    view.accountRowMode = preferences.accountRowMode;
    view.layout = { moduleOrder: [...profile.moduleOrder], layoutMode: profile.layoutMode, snapThreshold: profile.snapThreshold, snapTargets: [...profile.snapTargets], moduleAnchors: { ...profile.moduleAnchors }, identity: profile.identity, avatarShape: profile.avatarShape, fontSize: profile.fontSize };
  }
  function publish(extra = {}) {
    window.__quotaPinController.update({ status: "ready", view, preferences, update, ...extra });
  }
  function applyAction(action) {
    if (action.type === "updateProfile") preferences.profiles = preferences.profiles.map((profile) => profile.id === action.id ? { ...profile, ...action.patch, id: profile.id } : profile);
    else if (action.type === "updateLocale") preferences.locale = action.locale;
    else if (action.type === "updatePanelTheme") preferences.panelTheme = action.theme;
    else if (action.type === "updateAccountRowMode") preferences.accountRowMode = action.mode;
    else if (action.type === "updateThresholds") Object.assign(preferences.thresholds, action.patch);
    else if (action.type === "updatePalette") Object.assign(preferences.palette, action.patch);
    else if (action.type === "updateExperiments") Object.assign(preferences.experiments, action.patch);
    else if (action.type === "selectProfile") preferences.activeProfile = action.id;
    else if (action.type === "replaceConfig") Object.assign(preferences, action.config);
    syncView();
  }
  window.quotapinConfigAction = (payload) => {
    const message = JSON.parse(payload);
    applyAction(message.action);
    queueMicrotask(() => publish({ settingsAck: { actionId: message.actionId, ok: true, preferences } }));
  };
  window.quotapinUpdateAction = (payload) => {
    const action = JSON.parse(payload);
    window.__fixtureUpdateActions.push(action);
    if (action.type === "check") update = { ...update, status: "current" };
    if (action.type === "install") update = { ...update, status: "installing", selectedVersion: action.version };
    publish();
  };
  window.__fixtureSetParts = (parts, valueColor = "#ff3366", dotColor = "#ff3366") => {
    view.parts = { ...view.parts, ...parts };
    view.text = view.parts.value;
    view.valueColor = valueColor;
    view.dotColor = dotColor;
    publish();
  };
  window.__fixtureSetLocalUsage = (todayTokens) => publish({
    localTokenUsage: { status: 'ready', todayTokens, receivedAt: Date.now(), complete: true, scannedFiles: 1 }
  });
  window.__fixtureOpen = () => window.__quotaPinController.openEditor();
  syncView();
  publish();
})();`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
html,body{height:100%;margin:0;background:#050505;color:#eee;font:14px system-ui,sans-serif;overflow:hidden}
#sidebar{position:fixed;inset:0 auto 0 0;width:260px;background:#050505}
#account-footer{position:fixed;left:0;bottom:0;width:260px;height:56px}
#account{position:absolute;left:8px;bottom:8px;width:212px;height:40px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-radius:8px;background:#111;color:#ddd;text-align:left}
#account img{width:18px;height:18px;border-radius:50%;object-fit:cover}.name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#native-help{position:absolute;right:8px;bottom:12px;width:32px;height:32px;border:0;background:transparent;color:#888}
</style></head><body><aside id="sidebar"><div id="account-footer"><button id="account" aria-haspopup="menu"><img src="/avatar.png" alt=""><span class="name">Aster</span></button><button id="native-help" aria-label="Help">?</button></div></aside><script src="/renderer.js"></script><script src="/fixture.js"></script></body></html>`;
const avatar = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    const rejectPending = () => {
      const error = new Error("CDP fixture connection closed");
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    };
    socket.addEventListener("close", rejectPending, { once: true });
    socket.addEventListener("error", rejectPending, { once: true });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

let server;
let origin;
let browser;
let client;
let userDataDir;

async function waitFor(predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw lastError ?? new Error("Timed out waiting for isolated panel fixture");
}

function bounded(promise, timeout = 1_500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), timeout);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await bounded(new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    }), 5_000);
  } else {
    try { child.kill("SIGKILL"); } catch {}
  }
  if (child.exitCode === null) {
    await bounded(new Promise((resolve) => child.once("exit", resolve)), 2_000);
  }
}

async function navigate(locale = "en") {
  await client.call("Page.navigate", { url: `${origin}/?locale=${encodeURIComponent(locale)}` });
  await waitFor(() => client.evaluate("document.readyState === 'complete' && Boolean(window.__quotaPinController)"));
}

async function openPanel() {
  await client.evaluate("window.__fixtureOpen(); true");
  await waitFor(() => client.evaluate("Boolean(document.querySelector('#quotapin-profile-editor'))"));
}

before(async () => {
  if (!canRun) return;
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'");
    if (pathname === "/renderer.js") return response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(renderer);
    if (pathname === "/fixture.js") return response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(fixtureScript);
    if (pathname === "/avatar.png") return response.writeHead(200, { "Content-Type": "image/png" }).end(avatar);
    if (pathname === "/favicon.ico") return response.writeHead(204).end();
    return response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-panel-ui-"));
  browser = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const debugPort = await waitFor(() => fs.existsSync(activePortPath) && Number(fs.readFileSync(activePortPath, "utf8").split(/\r?\n/)[0]));
  const target = await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
    return targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  client = new CdpClient(socket);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
});

after(async () => {
  if (!canRun) return;
  try { await bounded(client?.call("Browser.close") ?? Promise.resolve()); } catch {}
  try { client?.socket?.close(); } catch {}
  await bounded(new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  if (browser && browser.exitCode === null) {
    await bounded(
      new Promise((resolve) => browser.once("exit", resolve)),
    );
  }
  if (browser && browser.exitCode === null) {
    await terminateProcessTree(browser);
  }
  browser?.unref?.();
  if (userDataDir && path.resolve(userDataDir).startsWith(path.resolve(os.tmpdir()))) {
    try { await bounded(fs.promises.rm(userDataDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }), 5_000); } catch {}
  }
});

test("all public modes keep one viewport-bounded frame across locales, DPR, and compact sizes", { skip: !canRun }, async () => {
  const cases = [
    { width: 1280, height: 760, dpr: 1, locale: "en", label: "QuotaPin settings modes", view: "Glance" },
    { width: 800, height: 600, dpr: 1.5, locale: "zh-CN", label: "QuotaPin 设置模式", view: "一眼看清" },
    { width: 640, height: 480, dpr: 2, locale: "ja", label: "QuotaPin の設定モード", view: "ひと目" },
    { width: 400, height: 400, dpr: 1, locale: "zh-CN", label: "QuotaPin 设置模式", view: "一眼看清" },
    { width: 320, height: 320, dpr: 2, locale: "ja", label: "QuotaPin の設定モード", view: "ひと目" },
  ];
  for (const item of cases) {
    await client.call("Emulation.setDeviceMetricsOverride", { width: item.width, height: item.height, deviceScaleFactor: item.dpr, mobile: false });
    await navigate(item.locale);
    await openPanel();
    const result = await client.evaluate(`(async () => {
      const panel = document.querySelector('#quotapin-profile-editor');
      const modes = ['quick', 'advanced', 'code'];
      const frames = [];
      for (const mode of modes) {
        document.querySelector('[data-editor-mode="' + mode + '"]').click();
        await new Promise(requestAnimationFrame);
        const rect = panel.getBoundingClientRect();
        const active = panel.querySelector('[data-editor-panel="' + mode + '"]');
        const scrollOwners = [...active.querySelectorAll('*'), active].filter((node) => {
          const style = getComputedStyle(node);
          return ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        }).length;
        frames.push({ mode, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollOwners });
      }
      const selected = [...panel.querySelectorAll('[role="tab"]')].filter((node) => node.getAttribute('aria-selected') === 'true').length;
      const visiblePanels = [...panel.querySelectorAll('[role="tabpanel"]')].filter((node) => getComputedStyle(node).display !== 'none').length;
      const content = panel.querySelector('[data-editor-panel="code"]').parentElement.getBoundingClientRect();
      const footer = panel.querySelector('[data-update-button="true"]').parentElement.getBoundingClientRect();
      return { frames, selected, visiblePanels, dpr: devicePixelRatio, innerWidth, innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, contentBottom: content.bottom, footerTop: footer.top, label: panel.querySelector('[role="tablist"]').getAttribute('aria-label'), view: panel.querySelector('[data-profile-select]').selectedOptions[0].textContent };
    })()`);
    assert.equal(result.label, item.label, `${item.locale} tablist label`);
    assert.equal(result.view, item.view, `${item.locale} built-in view label`);
    assert.equal(result.dpr, item.dpr);
    assert.equal(result.selected, 1);
    assert.equal(result.visiblePanels, 1);
    assert.equal(result.horizontalOverflow, false);
    assert.ok(result.contentBottom <= result.footerTop + 0.5, `${item.width}x${item.height} content overlaps footer`);
    assert.equal(new Set(result.frames.map((frame) => `${frame.left},${frame.top},${frame.width},${frame.height}`)).size, 1);
    for (const frame of result.frames) {
      assert.ok(frame.left >= 0 && frame.top >= 0 && frame.right <= result.innerWidth + 0.5 && frame.bottom <= result.innerHeight + 0.5, `${item.width}x${item.height} ${frame.mode}`);
      assert.ok(frame.scrollOwners <= 1, `${item.width}x${item.height} ${frame.mode} nested scrolling`);
    }
  }
});

test("panel theme is user-controlled, persists across reopen, and does not follow the host page", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  const dark = await client.evaluate(`(() => {
    const panel = document.querySelector('#quotapin-profile-editor');
    const select = panel.querySelector('[aria-label="Panel theme"]');
    const livePreview = panel.querySelector('[data-quick-preview="value"]')?.closest('button');
    return { theme: panel.dataset.theme, selected: select.value, background: getComputedStyle(panel).backgroundColor, color: getComputedStyle(panel).color, colorScheme: getComputedStyle(panel).colorScheme, borderWidth: getComputedStyle(panel).borderTopWidth, shadow: getComputedStyle(panel).boxShadow, previewBackground: getComputedStyle(livePreview).backgroundColor };
  })()`);
  assert.equal(dark.theme, "dark");
  assert.equal(dark.selected, "dark");
  assert.match(dark.background, /24, 24, 27/);
  assert.equal(dark.colorScheme, "dark");
  assert.equal(dark.borderWidth, "0px");
  assert.notEqual(dark.shadow, "none");
  assert.match(dark.previewBackground, /17, 17, 17/);
  const readSelection = () => client.evaluate(`(() => {
    const active = document.querySelector('[data-toggle="Show value"]');
    const inactive = document.querySelector('[data-toggle="Show status dot"]');
    const activeStyle = getComputedStyle(active);
    const inactiveStyle = getComputedStyle(inactive);
    return {
      activeState: active.dataset.moduleSelected,
      inactiveState: inactive.dataset.moduleSelected,
      activeOpacity: activeStyle.opacity,
      inactiveOpacity: inactiveStyle.opacity,
      activeBorder: activeStyle.borderColor,
      inactiveBorder: inactiveStyle.borderColor,
      activeShadow: activeStyle.boxShadow,
      activeSurface: activeStyle.backgroundColor,
      inactiveSurface: inactiveStyle.backgroundColor,
    };
  })()`);
  const assertSelection = (result, surfacePattern) => {
    assert.equal(result.activeState, "true");
    assert.equal(result.inactiveState, "false");
    assert.equal(result.activeOpacity, "1");
    assert.equal(result.inactiveOpacity, "0.42");
    assert.equal(result.activeBorder, "rgba(0, 0, 0, 0)");
    assert.equal(result.inactiveBorder, result.activeBorder);
    assert.equal(result.activeShadow, "none");
    assert.match(result.activeSurface, surfacePattern);
    assert.match(result.inactiveSurface, surfacePattern);
  };
  assertSelection(await readSelection(), /17, 17, 17/);

  await client.evaluate(`(() => {
    const select = document.querySelector('[aria-label="Panel theme"]');
    select.value = 'light';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(() => client.evaluate(`document.querySelector('#quotapin-profile-editor')?.dataset.theme === 'light'`));
  const light = await client.evaluate(`(() => {
    const panel = document.querySelector('#quotapin-profile-editor');
    const select = panel.querySelector('[aria-label="Panel theme"]');
    const quick = panel.querySelector('[data-editor-mode="quick"]');
    const livePreview = panel.querySelector('[data-quick-preview="value"]')?.closest('button');
    return { theme: panel.dataset.theme, selected: select.value, background: getComputedStyle(panel).backgroundColor, color: getComputedStyle(panel).color, tabColor: getComputedStyle(quick).color, colorScheme: getComputedStyle(panel).colorScheme, borderWidth: getComputedStyle(panel).borderTopWidth, shadow: getComputedStyle(panel).boxShadow, previewBackground: getComputedStyle(livePreview).backgroundColor };
  })()`);
  assert.equal(light.theme, "light");
  assert.equal(light.selected, "light");
  assert.match(light.background, /248, 249, 250/);
  assert.equal(light.colorScheme, "light");
  assert.notEqual(light.background, dark.background);
  assert.notEqual(light.color, dark.color);
  assert.equal(light.borderWidth, "0px");
  assert.notEqual(light.shadow, "none");
  assert.notEqual(light.shadow, dark.shadow);
  assert.match(light.previewBackground, /17, 17, 17/);
  assert.notEqual(light.previewBackground, light.background);
  assertSelection(await readSelection(), /17, 17, 17/);

  await client.evaluate(`document.querySelector('#quotapin-profile-editor button[title="Done"]').click()`);
  await client.evaluate(`(() => {
    const row = document.querySelector('#account');
    row.style.background = 'rgb(245, 246, 247)';
    row.style.color = 'rgb(24, 24, 27)';
  })()`);
  await openPanel();
  assert.equal(await client.evaluate(`document.querySelector('#quotapin-profile-editor')?.dataset.theme`), "light");
  assertSelection(await readSelection(), /245, 246, 247/);

  await client.evaluate(`(() => {
    const select = document.querySelector('[aria-label="Panel theme"]');
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(() => client.evaluate(`document.querySelector('#quotapin-profile-editor')?.dataset.theme === 'dark'`));
  assertSelection(await readSelection(), /245, 246, 247/);
});

test("programmatic panel focus never paints a transient outer outline", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const nativeRowBoxShadow = await client.evaluate(`getComputedStyle(document.querySelector('#account')).boxShadow`);
  await openPanel();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const result = await client.evaluate(`(async () => {
    const panel = document.querySelector('#quotapin-profile-editor');
    const row = document.querySelector('#account');
    const initial = {
      panelFocused: document.activeElement === panel,
      panelBorderWidth: getComputedStyle(panel).borderTopWidth,
      panelOutlineStyle: getComputedStyle(panel).outlineStyle,
      panelOutlineWidth: getComputedStyle(panel).outlineWidth,
      panelBoxShadow: getComputedStyle(panel).boxShadow,
      rowBoxShadow: getComputedStyle(row).boxShadow,
    };
    document.querySelector('[data-editor-mode="advanced"]').click();
    await new Promise(requestAnimationFrame);
    return {
      initial,
      advanced: {
        panelOutlineStyle: getComputedStyle(panel).outlineStyle,
        panelOutlineWidth: getComputedStyle(panel).outlineWidth,
        rowBoxShadow: getComputedStyle(row).boxShadow,
      },
    };
  })()`);
  assert.equal(result.initial.panelFocused, true);
  assert.equal(result.initial.panelBorderWidth, "0px", JSON.stringify(result));
  assert.equal(result.initial.panelOutlineStyle, "none", JSON.stringify(result));
  assert.notEqual(result.initial.panelBoxShadow, "none", JSON.stringify(result));
  assert.equal(result.initial.rowBoxShadow, nativeRowBoxShadow, "opening Quick must not draw a transient outline around the whole account row");
  assert.equal(result.advanced.rowBoxShadow, result.initial.rowBoxShadow, "switching between layout tabs must not introduce a whole-row editing outline");
});

test("Customize separates global and view settings and disables inactive alert dependencies", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    document.querySelector('[data-editor-mode="advanced"]').click();
    const global = document.querySelector('[data-settings-scope="global"]');
    const profile = document.querySelector('[data-settings-scope="profile"]');
    const rowMode = document.querySelector('[data-config-key="accountRowMode"]');
    const effect = document.querySelector('[data-config-key="effect"]');
    const target = document.querySelector('[data-config-key="effectTarget"]');
    const level = document.querySelector('[data-config-key="effectAt"]');
    const before = {
      globalContainsRowMode: global?.contains(rowMode) === true,
      profileContainsRowMode: profile?.contains(rowMode) === true,
      rowModeLabel: document.getElementById(rowMode?.getAttribute('aria-labelledby') || '')?.textContent,
      rowModeDescription: document.getElementById(rowMode?.getAttribute('aria-describedby') || '')?.textContent,
      targetDisabled: target?.disabled,
      levelDisabled: level?.disabled,
      targetFieldInactive: target?.closest('label')?.dataset.inactive,
    };
    effect.value = 'pulse';
    effect.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(queueMicrotask);
    return {
      before,
      after: { targetDisabled: target.disabled, levelDisabled: level.disabled },
      headings: [...document.querySelectorAll('[data-settings-scope] [role="heading"]')].map((node) => node.textContent),
    };
  })()`);
  assert.deepEqual(result.before, {
    globalContainsRowMode: true,
    profileContainsRowMode: false,
    rowModeLabel: "Account row mode",
    rowModeDescription: "Applies to every saved view. Beta hides Help and gives short/hold gestures the whole footer.",
    targetDisabled: true,
    levelDisabled: true,
    targetFieldInactive: "true",
  });
  assert.deepEqual(result.after, { targetDisabled: false, levelDisabled: false });
  assert.deepEqual(result.headings, ["Account row", "Current view"]);
});

test("Legacy and Beta switch one reversible account-row and gesture contract", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  await client.evaluate(`document.querySelector('[data-editor-mode="advanced"]').click()`);
  await client.evaluate(`document.querySelector('[data-config-key="accountRowMode"] [data-quick-value="beta"]').click()`);
  await waitFor(() => client.evaluate(`getComputedStyle(document.querySelector('#native-help')).display === 'none'`));
  const betaGeometry = await client.evaluate(`(() => {
    const row=document.querySelector('#account').getBoundingClientRect();
    const footer=document.querySelector('#account-footer').getBoundingClientRect();
    return {rowRight:row.right,footerRight:footer.right,mode:document.querySelector('#account').dataset.quotapinAccountRowMode,surface:document.querySelector('#account-footer').dataset.quotapinGestureSurface};
  })()`);
  assert.equal(betaGeometry.mode, "beta");
  assert.equal(betaGeometry.surface, "true");
  assert.ok(Math.abs(betaGeometry.footerRight - betaGeometry.rowRight - 8) <= .5, JSON.stringify(betaGeometry));

  const betaStableBefore = await client.evaluate(`(() => {
    const row=document.querySelector('#account').getBoundingClientRect();
    return {left:row.left,right:row.right,width:row.width,reconciliations:window.__quotaPinController.inspectLayoutRuntime().reconciliations};
  })()`);
  for (let index = 0; index < 6; index += 1) {
    await client.evaluate(`(() => {
      const row=document.querySelector('#account');
      const help=document.querySelector('#native-help');
      for (const property of ['right','width','maxWidth','minHeight','flex']) row.style[property]='';
      help.style.display='';help.style.pointerEvents='';
    })()`);
    await client.evaluate(`window.__fixtureSetParts({ remaining: ${41 - index} })`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const betaStableAfter = await client.evaluate(`(() => {
    const row=document.querySelector('#account').getBoundingClientRect();
    const help=document.querySelector('#native-help');
    return {left:row.left,right:row.right,width:row.width,reconciliations:window.__quotaPinController.inspectLayoutRuntime().reconciliations,helpDisplay:getComputedStyle(help).display,helpInlineDisplay:help.style.display,rowInlineRight:document.querySelector('#account').style.right,mode:document.querySelector('#account').dataset.quotapinAccountRowMode,surface:document.querySelector('#account-footer').dataset.quotapinGestureSurface};
  })()`);
  assert.deepEqual({ ...betaStableAfter, reconciliations: betaStableBefore.reconciliations }, {
    ...betaStableBefore,
    helpDisplay: "none",
    helpInlineDisplay: "",
    rowInlineRight: "",
    mode: "beta",
    surface: "true",
  }, "Beta must remain stable without fighting host-owned inline styles");
  assert.ok(betaStableAfter.reconciliations - betaStableBefore.reconciliations <= 1, JSON.stringify({ betaStableBefore, betaStableAfter }));

  await client.evaluate(`[...document.querySelectorAll('#quotapin-profile-editor button')].find(button=>button.textContent==='Done').click()`);
  await waitFor(() => client.evaluate(`!document.querySelector('#quotapin-profile-editor')`));
  await client.evaluate(`(() => {
    const footer=document.querySelector('#account-footer');
    const fire=(type,id)=>footer.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,pointerId:id,pointerType:'mouse',isPrimary:true,clientX:258,clientY:590}));
    fire('pointerdown',81);fire('pointerup',81);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const shortResult = await client.evaluate(`({count:window.__fixtureNativeMenuDown,gesture:document.querySelector('#quotapin-inline-badge')?.dataset.quotapinGesture??null,error:document.querySelector('#quotapin-inline-badge')?.dataset.quotapinGestureError??null})`);
  assert.equal(shortResult.count, 1, JSON.stringify(shortResult));

  await client.evaluate(`(() => {
    const footer=document.querySelector('#account-footer');
    footer.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerId:82,pointerType:'mouse',isPrimary:true,clientX:258,clientY:590}));
  })()`);
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('#quotapin-profile-editor'))`), 1200);
  assert.equal(await client.evaluate(`window.__fixtureNativeMenuDown`), 1, "a long hold must not replay the Codex short press");
  await client.evaluate(`document.querySelector('#account-footer').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,buttons:0,pointerId:82,pointerType:'mouse',isPrimary:true,clientX:258,clientY:590}))`);

  await client.evaluate(`document.querySelector('[data-editor-mode="advanced"]').click()`);
  await client.evaluate(`document.querySelector('[data-config-key="accountRowMode"] [data-quick-value="legacy"]').click()`);
  await waitFor(() => client.evaluate(`getComputedStyle(document.querySelector('#native-help')).display !== 'none'`));
  const legacyGeometry = await client.evaluate(`(() => {const row=document.querySelector('#account').getBoundingClientRect();return {right:row.right,mode:document.querySelector('#account').dataset.quotapinAccountRowMode,surface:document.querySelector('#account-footer').dataset.quotapinGestureSurface??null};})()`);
  assert.equal(legacyGeometry.mode, "legacy");
  assert.equal(legacyGeometry.surface, null);
  assert.ok(Math.abs(legacyGeometry.right - 220) <= .5, JSON.stringify(legacyGeometry));
});

test("live sidebar resizing uses a frame-coalesced layout path without full renderer churn", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 900, height: 640, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  await client.evaluate(`document.querySelector('[data-editor-mode="advanced"]').click()`);
  await client.evaluate(`document.querySelector('[data-config-key="accountRowMode"] [data-quick-value="beta"]').click()`);
  await waitFor(() => client.evaluate(`getComputedStyle(document.querySelector('#native-help')).display === 'none'`));
  await client.evaluate(`[...document.querySelectorAll('#quotapin-profile-editor button')].find(button=>button.textContent==='Done').click()`);
  await waitFor(() => client.evaluate(`!document.querySelector('#quotapin-profile-editor')`));
  const result = await client.evaluate(`(async () => {
    const controller = window.__quotaPinController;
    // Begin from a settled frame. The fixture's initial ResizeObserver event
    // may otherwise be counted before its already-queued rAF callback, making
    // this transaction appear to paint one more frame than events it owns.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = controller.inspectLayoutRuntime();
    const footer = document.querySelector('#account-footer');
    const beforeRowWidth = document.querySelector('#account').getBoundingClientRect().width;
    await new Promise((resolve) => {
      let index = 0;
      const timer = setInterval(() => {
        footer.style.width = (260 + (index % 2 === 0 ? index * 2 : index * 2 + 7)) + 'px';
        index += 1;
        if (index >= 48) {
          clearInterval(timer);
          footer.style.width = '356px';
          resolve();
        }
      }, 4);
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    const after = controller.inspectLayoutRuntime();
    const row = document.querySelector('#account').getBoundingClientRect();
    const visible = [...document.querySelectorAll('[data-quotapin-module]')]
      .filter((node) => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0)
      .map((node) => ({ id: node.dataset.quotapinModule, rect: node.getBoundingClientRect().toJSON(), transition: getComputedStyle(node).transitionDuration }));
    visible.sort((left, right) => left.rect.left - right.rect.left);
    return {
      before,
      after,
      beforeRowWidth,
      row,
      rowWidth: row.width,
      visible,
      contained: visible.every(({ rect }) => rect.left >= row.left - .5 && rect.right <= row.right + .5),
      separated: visible.every(({ rect }, index) => index === 0 || rect.left >= visible[index - 1].rect.right - .5),
    };
  })()`);
  const eventDelta = result.after.resizeEvents - result.before.resizeEvents;
  const frameDelta = result.after.resizeFrames - result.before.resizeFrames;
  const pendingFrameDebt = Math.max(0, result.before.resizeEvents - result.before.resizeFrames);
  assert.ok(eventDelta > 0, JSON.stringify(result));
  assert.ok(frameDelta > 0 && frameDelta <= eventDelta + pendingFrameDebt, JSON.stringify(result));
  assert.ok(result.after.resizeFrames <= result.after.resizeEvents, JSON.stringify(result));
  assert.ok(result.rowWidth > result.beforeRowWidth + 1, JSON.stringify(result));
  assert.ok(result.after.renders - result.before.renders <= 1, JSON.stringify(result));
  assert.equal(result.after.integrityRepairs, result.before.integrityRepairs, JSON.stringify(result));
  assert.equal(result.contained, true, JSON.stringify(result));
  assert.equal(result.separated, true, JSON.stringify(result));
  assert.deepEqual(new Set(result.visible.map(({ transition }) => transition)), new Set(["0s"]));
});

test("unrelated Codex content mutations do not wake the QuotaPin renderer", { skip: !canRun }, async () => {
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const controller = window.__quotaPinController;
    const before = controller.inspectLayoutRuntime();
    const stream = document.createElement('main');
    document.body.appendChild(stream);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const mounted = controller.inspectLayoutRuntime();
    for (let index = 0; index < 120; index += 1) {
      const token = document.createElement('span');
      token.textContent = 'token-' + index;
      stream.appendChild(token);
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
    const after = controller.inspectLayoutRuntime();
    stream.remove();
    return { before, mounted, after };
  })()`);
  assert.equal(result.after.renders, result.mounted.renders, JSON.stringify(result));
  assert.ok(result.after.ignoredUnrelatedMutations > result.before.ignoredUnrelatedMutations, JSON.stringify(result));
});

test("the seconds module ticks through the narrow time path instead of full renders", { skip: !canRun }, async () => {
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const preferences = window.__quotaPinController.preferences;
    const profile = preferences.profiles.find((item) => item.id === preferences.activeProfile) || preferences.profiles[0];
    window.quotapinConfigAction(JSON.stringify({
      actionId: 'targeted-live-seconds',
      action: { type: 'updateProfile', id: profile.id, patch: { showSeconds: true } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const controller = window.__quotaPinController;
    const seconds = document.querySelector('[data-part="seconds"]');
    const before = { runtime: controller.inspectLayoutRuntime(), text: seconds.textContent };
    await new Promise((resolve) => setTimeout(resolve, 1250));
    const after = { runtime: controller.inspectLayoutRuntime(), text: seconds.textContent };
    return { before, after };
  })()`);
  assert.notEqual(result.after.text, result.before.text, JSON.stringify(result));
  assert.equal(result.after.runtime.renders, result.before.runtime.renders, JSON.stringify(result));
  assert.ok(result.after.runtime.liveTimeUpdates > result.before.runtime.liveTimeUpdates, JSON.stringify(result));
  assert.ok(result.after.runtime.liveTimeLayoutPasses > result.before.runtime.liveTimeLayoutPasses, JSON.stringify(result));
  assert.equal(result.after.runtime.integrityRepairs, result.before.runtime.integrityRepairs, JSON.stringify(result));
});

test("the hidden idea route appears only after discovery and opens the public feature form", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const initial = await client.evaluate(`(() => {
    const link = document.querySelector('[data-arcade-idea="true"]');
    return { hidden: link?.hidden, href: link?.getAttribute('href'), tabIndex: link?.tabIndex, ariaHidden: link?.getAttribute('aria-hidden') };
  })()`);
  assert.deepEqual(initial, { hidden: true, href: null, tabIndex: -1, ariaHidden: "true" });

  await client.evaluate(`(() => {
    const sequence = atob('QXJyb3dVcHxBcnJvd1VwfEFycm93RG93bnxBcnJvd0Rvd258QXJyb3dMZWZ0fEFycm93UmlnaHQ=').split('|');
    for (const key of sequence) document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
  })()`);
  await waitFor(() => client.evaluate(`document.querySelector('[data-arcade-idea="true"]')?.hidden === false`));
  const revealed = await client.evaluate(`(() => {
    const link = document.querySelector('[data-arcade-idea="true"]');
    return { text: link?.textContent, href: link?.getAttribute('href'), target: link?.target, rel: link?.rel, tabIndex: link?.tabIndex, ariaHidden: link?.getAttribute('aria-hidden') };
  })()`);
  assert.equal(revealed.text, "Send an idea");
  assert.equal(revealed.href, "https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml");
  assert.equal(revealed.target, "_blank");
  assert.match(revealed.rel, /noopener/);
  assert.equal(revealed.tabIndex, 0);
  assert.equal(revealed.ariaHidden, null);
});

test("Escape dismisses the active child layer before the panel and restores each trigger", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  let result = await client.evaluate(`(() => {
    const manage = document.querySelector('[data-profile-menu-button="true"]');
    manage.click();
    const item = document.querySelector('[role="menuitem"]:not(:disabled)');
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { panel: Boolean(document.querySelector('#quotapin-profile-editor')), menu: getComputedStyle(document.querySelector('[data-profile-menu="true"]')).display, focus: document.activeElement === manage };
  })()`);
  assert.deepEqual(result, { panel: true, menu: "none", focus: true });

  result = await client.evaluate(`(async () => {
    const trigger = document.querySelector('[data-update-button="true"]');
    trigger.click();
    await new Promise(queueMicrotask);
    const popover = document.querySelector('[data-update-popover="true"]');
    const focusEntered = popover.contains(document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { panel: Boolean(document.querySelector('#quotapin-profile-editor')), popover: getComputedStyle(popover).display, expanded: trigger.getAttribute('aria-expanded'), focusEntered, focusReturned: document.activeElement === trigger };
  })()`);
  assert.deepEqual(result, { panel: true, popover: "none", expanded: "false", focusEntered: true, focusReturned: true });

  await client.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); true`);
  await waitFor(() => client.evaluate("!document.querySelector('#quotapin-profile-editor') && document.activeElement === document.querySelector('#account')"));
});

test("the update surface exposes full versions and explicit update, repair, and rollback confirmation", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const trigger = document.querySelector('[data-update-button="true"]');
    trigger.click();
    await new Promise(queueMicrotask);
    const select = document.querySelector('[aria-label="Release version"]');
    const action = document.querySelector('[data-update-action="true"]');
    const choose = (version) => { select.value = version; select.dispatchEvent(new Event('change', { bubbles: true })); return action.textContent; };
    const labels = [choose('1.1.0'), choose('1.0.0'), choose('1.0.0-beta.2'), choose('1.0.0-beta.1')];
    action.click();
    const confirm = document.querySelector('[data-update-confirm="true"]');
    const confirmAction = document.querySelector('[data-update-confirm-action="true"]');
    const cancel = document.querySelector('[data-update-cancel="true"]');
    const confirmation = { visible: getComputedStyle(confirm).display, text: confirm.textContent, focus: document.activeElement === confirmAction };
    cancel.click();
    const cancelFocus = document.activeElement === action;
    action.click();
    confirmAction.click();
    return { version: trigger.textContent, labels, confirmation, cancelFocus, installAction: window.__fixtureUpdateActions.at(-1) };
  })()`);
  assert.equal(result.version, "Updating to 1.0.0-beta.1");
  assert.deepEqual(result.labels, ["Update", "Repair", "Roll back", "Roll back"]);
  assert.equal(result.confirmation.visible, "grid");
  assert.match(result.confirmation.text, /Roll back.*1\.0\.0.*1\.0\.0-beta\.1/);
  assert.equal(result.confirmation.focus, true);
  assert.equal(result.cancelFocus, true);
  assert.deepEqual(result.installAction, { type: "install", version: "1.0.0-beta.1" });
});

test("the update surface has a visible close action that restores the version trigger", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const trigger = document.querySelector('[data-update-button="true"]');
    trigger.click();
    await new Promise(queueMicrotask);
    const popover = document.querySelector('[data-update-popover="true"]');
    const close = document.querySelector('[data-update-close="true"]');
    const before = {
      title: document.getElementById(popover.getAttribute('aria-labelledby'))?.textContent,
      closeText: close?.textContent,
      display: getComputedStyle(popover).display,
      expanded: trigger.getAttribute('aria-expanded'),
    };
    close.click();
    return {
      before,
      after: { display: getComputedStyle(popover).display, expanded: trigger.getAttribute('aria-expanded'), focus: document.activeElement === trigger },
    };
  })()`);
  assert.deepEqual(result.before, { title: "Updates", closeText: "Close", display: "grid", expanded: "true" });
  assert.deepEqual(result.after, { display: "none", expanded: "false", focus: true });
});

test("a valid Code draft survives tab changes without rebuilding or changing the live row", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const panel = document.querySelector('#quotapin-profile-editor');
    const codeTab = document.querySelector('[data-editor-mode="code"]');
    codeTab.focus();
    codeTab.click();
    const editor = document.querySelector('[data-code-config="json"]');
    const config = JSON.parse(editor.value);
    const profile = config.profiles.find((item) => item.id === config.activeProfile);
    profile.showValue = false;
    editor.value = JSON.stringify(config, null, 2);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    codeTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    await new Promise(requestAnimationFrame);
    const quick = document.querySelector('[data-editor-mode="quick"]');
    const valueToggle = document.querySelector('[data-toggle="Show value"]');
    const liveValue = document.querySelector('#quotapin-inline-badge [data-part="value"]');
    return {
      samePanel: panel === document.querySelector('#quotapin-profile-editor'),
      selected: quick.getAttribute('aria-selected'),
      focused: document.activeElement === quick,
      phase: document.querySelector('[data-settings-status="true"]').textContent,
      codeDirty: codeTab.dataset.dirty,
      codeLabel: codeTab.getAttribute('aria-label'),
      valuePressed: valueToggle.getAttribute('aria-pressed'),
      liveValueVisible: getComputedStyle(liveValue).display !== 'none'
    };
  })()`);
  assert.equal(result.samePanel, true);
  assert.equal(result.selected, "true");
  assert.equal(result.focused, true);
  assert.equal(result.phase, "Code draft not applied");
  assert.equal(result.codeDirty, "true");
  assert.match(result.codeLabel, /not applied/);
  assert.equal(result.valuePressed, "true");
  assert.equal(result.liveValueVisible, true);
});

test("Code locates invalid JSON, formats and discards drafts, then clears dirty state only after apply", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    document.querySelector('[data-editor-mode="code"]').click();
    const editor = document.querySelector('[data-code-config="json"]');
    const apply = document.querySelector('[data-action="apply-json"]');
    const status = document.querySelector('[data-code-status="true"]');
    const liveValue = document.querySelector('#quotapin-inline-badge [data-part="value"]');
    const newline = String.fromCharCode(10);
    const original = JSON.parse(editor.value);
    const profile = original.profiles.find((item) => item.id === original.activeProfile);
    profile.showValue = false;
    editor.value = JSON.stringify(original);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-code-action="format"]').click();
    const formatted = { multiline: editor.value.includes(newline + '  "version"'), status: status.textContent, live: getComputedStyle(liveValue).display !== 'none' };
    editor.value = ['{', '  "version": 11,', '  "profiles": [', '}'].join(newline);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    const invalid = { disabled: apply.disabled, status: status.textContent };
    document.querySelector('[data-code-action="revert"]').click();
    const revertedConfig = JSON.parse(editor.value);
    const revertedProfile = revertedConfig.profiles.find((item) => item.id === revertedConfig.activeProfile);
    const reverted = { value: revertedProfile.showValue, dirty: document.querySelector('[data-editor-mode="code"]').dataset.dirty, live: getComputedStyle(liveValue).display !== 'none' };
    revertedProfile.showValue = false;
    editor.value = JSON.stringify(revertedConfig, null, 2);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    apply.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      formatted,
      invalid,
      reverted,
      applied: { dirty: document.querySelector('[data-editor-mode="code"]').dataset.dirty, status: status.textContent, live: getComputedStyle(liveValue).display !== 'none' }
    };
  })()`);
  assert.deepEqual(result.formatted, { multiline: true, status: "Draft formatted", live: true });
  assert.equal(result.invalid.disabled, true);
  assert.match(result.invalid.status, /^Invalid JSON · 4:1$/);
  assert.deepEqual(result.reverted, { value: true, dirty: "false", live: true });
  assert.deepEqual(result.applied, { dirty: "false", status: "Applied", live: false });
});

test("a Quick action rebases an unapplied Code draft in the visible JSON instead of being overwritten", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const codeTab = document.querySelector('[data-editor-mode="code"]');
    codeTab.click();
    const editor = document.querySelector('[data-code-config="json"]');
    const draft = JSON.parse(editor.value);
    const profile = draft.profiles.find((item) => item.id === draft.activeProfile);
    profile.showValue = false;
    editor.value = JSON.stringify(draft, null, 2);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-editor-mode="quick"]').click();
    document.querySelector('[data-toggle="Show status dot"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    codeTab.click();
    const rebased = JSON.parse(editor.value);
    const rebasedProfile = rebased.profiles.find((item) => item.id === rebased.activeProfile);
    return {
      showValue: rebasedProfile.showValue,
      showDot: rebasedProfile.showDot,
      valueLive: getComputedStyle(document.querySelector('#quotapin-inline-badge [data-part="value"]')).display !== 'none',
      dotLive: getComputedStyle(document.querySelector('#quotapin-inline-badge [data-part="dot"]')).display !== 'none',
      dirty: codeTab.dataset.dirty,
    };
  })()`);
  assert.deepEqual(result, { showValue: false, showDot: true, valueLive: true, dotLive: true, dirty: "true" });
});

test("Quick module previews repaint from the same live row after quota updates", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    window.__fixtureSetParts({ value: '9%', countdown: '2h', relative: '2 hours', seconds: '02:00:00', date: 'Aug 9', reset: 'Sun 02:15 AM' });
    await new Promise(requestAnimationFrame);
    const modules = ['value', 'todayTokens', 'lifetimeTokens', 'countdown', 'relative', 'seconds', 'date', 'reset'];
    const parity = Object.fromEntries(modules.map((module) => {
      const live = document.querySelector('#quotapin-inline-badge [data-part="' + module + '"]');
      const preview = document.querySelector('[data-quick-preview="' + module + '"]');
      return [module, { live: live.textContent, preview: preview.textContent, liveColor: getComputedStyle(live).color, previewColor: getComputedStyle(preview).color }];
    }));
    const liveDot = document.querySelector('#quotapin-inline-badge [data-part="dot"]');
    const previewDot = document.querySelector('[data-quick-preview="dot"]');
    const liveAvatar = document.querySelector('#account img');
    const previewAvatar = document.querySelector('[data-quick-preview="avatar"]');
    const valueToggle = document.querySelector('[data-toggle="Show value"]');
    const barToggle = document.querySelector('[data-toggle="Show quota bar"]');
    const liveBar = document.querySelector('#quotapin-inline-badge [data-part="bar"]');
    const liveBarFill = liveBar.querySelector('[data-part="bar-fill"]');
    const previewBar = document.querySelector('[data-quick-preview="bar"]');
    const previewBarFill = previewBar.querySelector('[data-quick-preview="bar-fill"]');
    return {
      parity,
      dot: [getComputedStyle(liveDot).backgroundColor, getComputedStyle(previewDot).backgroundColor],
      avatarRadius: [getComputedStyle(liveAvatar).borderRadius, getComputedStyle(previewAvatar).borderRadius],
      bar: {
        surface: [valueToggle.dataset.previewSurface, barToggle.dataset.previewSurface],
        toggleBackground: [getComputedStyle(valueToggle).backgroundColor, getComputedStyle(barToggle).backgroundColor],
        track: [getComputedStyle(liveBar).backgroundColor, getComputedStyle(previewBar).backgroundColor],
        fill: [getComputedStyle(liveBarFill).backgroundColor, getComputedStyle(previewBarFill).backgroundColor],
      },
    };
  })()`);
  for (const [module, values] of Object.entries(result.parity)) {
    assert.equal(values.preview, values.live, module);
    assert.equal(values.previewColor, values.liveColor, `${module} color`);
  }
  assert.deepEqual(result.dot[0], result.dot[1]);
  assert.deepEqual(result.avatarRadius[0], result.avatarRadius[1]);
  assert.deepEqual(result.bar.surface[0], result.bar.surface[1]);
  assert.deepEqual(result.bar.toggleBackground[0], result.bar.toggleBackground[1]);
  assert.deepEqual(result.bar.track[0], result.bar.track[1]);
  assert.deepEqual(result.bar.fill[0], result.bar.fill[1]);
});

test("repeated usage refreshes measure current glyphs instead of recycling a stale module box", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
    [...document.querySelectorAll('[data-toggle]')].find((node) => node.dataset.toggle === "Show today's tokens").click();
    await pause();
    const measure = () => {
      const node = document.querySelector('#quotapin-inline-badge [data-part="todayTokens"]');
      const range = document.createRange();
      range.selectNodeContents(node);
      const glyph = range.getBoundingClientRect().width;
      range.detach?.();
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, glyph, text: node.textContent, title: node.title, badgeTitle: node.closest('#quotapin-inline-badge').title };
    };
    window.__fixtureSetLocalUsage(9_900_000);
    await pause();
    const before = measure();
    window.__fixtureSetLocalUsage(10_000_000);
    await pause();
    const changed = measure();
    const repeated = [];
    for (let index = 0; index < 4; index += 1) {
      window.__fixtureSetLocalUsage(10_000_000);
      await pause();
      repeated.push(measure());
    }
    return { before, changed, repeated };
  })()`);
  for (const sample of [result.before, result.changed, ...result.repeated]) {
    assert.ok(Math.abs(sample.width - sample.glyph) < 0.75, JSON.stringify(sample));
  }
  assert.notEqual(result.before.text, result.changed.text);
  assert.match(result.before.title, /Tokens processed on this device today: 9,900,000/);
  assert.match(result.changed.title, /Tokens processed on this device today: 10,000,000/);
  assert.match(result.changed.badgeTitle, /Lifetime tokens: —/);
  assert.ok(result.repeated.every((sample) => Math.abs(sample.left - result.changed.left) < 0.25));
  assert.ok(result.repeated.every((sample) => Math.abs(sample.right - result.changed.right) < 0.25));
});

test("a narrow row commits value and countdown as one non-overlapping layout transaction", { skip: !canRun }, async () => {
  await navigate("zh-CN");
  const result = await client.evaluate(`(async () => {
    const row = document.getElementById('account');
    row.style.width = '185px';
    const profile = window.__quotaPinController.preferences.profiles.find((item) => item.id === window.__quotaPinController.preferences.activeProfile);
    const overlaps = [];
    const sample = (phase) => {
      const modules = ['avatar', 'name', 'value', 'countdown'].map((id) => {
        const node = document.querySelector('[data-quotapin-module="' + id + '"]');
        const rect = node?.getBoundingClientRect();
        return { id, left: rect?.left ?? 0, right: rect?.right ?? 0, width: rect?.width ?? 0, text: node?.textContent ?? '' };
      });
      const ordered = [...modules].sort((left, right) => left.left - right.left);
      const collisions = ordered.slice(1).filter((item, index) => item.left < ordered[index].right - .5);
      if (collisions.length) overlaps.push({ phase, modules, collisions: collisions.map((item) => item.id) });
      return modules;
    };
    const observer = new MutationObserver(() => sample('mutation'));
    observer.observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    window.quotapinConfigAction(JSON.stringify({
      actionId: 'narrow-transaction',
      action: { type: 'updateProfile', id: profile.id, patch: {
        showValue: true, showDot: false, showBar: false, showLabel: false,
        showCountdown: true, showRelative: false, showSeconds: false, showDate: false, showReset: false,
        showTodayTokens: false, showLifetimeTokens: false, identity: 'show', layoutMode: 'auto',
        moduleOrder: ['avatar', 'name', 'label', 'dot', 'relative', 'seconds', 'date', 'reset', 'todayTokens', 'lifetimeTokens', 'value', 'countdown'],
        moduleAnchors: { avatar: .025, name: .1438, value: .9122, label: .96, dot: .96, countdown: .8679, relative: .96, seconds: .96, date: .96, reset: .96, todayTokens: .96, lifetimeTokens: .96 },
      } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const settled = sample('settled');
    observer.disconnect();
    const transitionOverlaps = [...overlaps];
    const value = document.querySelector('[data-quotapin-module="value"]');
    const countdown = document.querySelector('[data-quotapin-module="countdown"]');
    value.style.left = countdown.style.left;
    const corrupted = ['avatar', 'name', 'value', 'countdown'].map((id) => {
      const node = document.querySelector('[data-quotapin-module="' + id + '"]');
      const rect = node?.getBoundingClientRect();
      return { id, left: rect?.left ?? 0, right: rect?.right ?? 0, width: rect?.width ?? 0, text: node?.textContent ?? '' };
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const repaired = sample('repaired');
    const runtime = window.__quotaPinController.inspectLayoutRuntime();
    return { settled, corrupted, repaired, transitionOverlaps, runtime };
  })()`);
  const byId = (sample, id) => sample.find((item) => item.id === id);
  assert.ok(byId(result.settled, "value").right <= byId(result.settled, "countdown").left + .5, JSON.stringify(result));
  assert.ok(byId(result.corrupted, "value").right > byId(result.corrupted, "countdown").left + .5, JSON.stringify(result));
  assert.ok(byId(result.repaired, "value").right <= byId(result.repaired, "countdown").left + .5, JSON.stringify(result));
  assert.deepEqual(result.transitionOverlaps, [], JSON.stringify(result));
  assert.ok(result.runtime.reconciliations >= 2, JSON.stringify(result.runtime));
});

test("Quick module selection uses tonal hierarchy without persistent outlines", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(() => {
    const selected = document.querySelector('[data-toggle="Show value"]');
    const idle = document.querySelector('[data-toggle="Show status dot"]');
    const selectedStyle = getComputedStyle(selected);
    const idleStyle = getComputedStyle(idle);
    return {
      selected: {
        pressed: selected.getAttribute('aria-pressed'),
        opacity: Number(selectedStyle.opacity),
        top: selectedStyle.borderTopWidth,
        right: selectedStyle.borderRightWidth,
        bottom: selectedStyle.borderBottomWidth,
        left: selectedStyle.borderLeftWidth,
        borderColor: selectedStyle.borderTopColor,
        shadow: selectedStyle.boxShadow,
        filter: selectedStyle.filter,
      },
      idle: {
        pressed: idle.getAttribute('aria-pressed'),
        opacity: Number(idleStyle.opacity),
        borderColor: idleStyle.borderTopColor,
        shadow: idleStyle.boxShadow,
        filter: idleStyle.filter,
      },
    };
  })()`);
  assert.equal(result.selected.pressed, "true");
  assert.equal(result.idle.pressed, "false");
  assert.ok(result.selected.opacity - result.idle.opacity >= 0.5);
  assert.deepEqual([result.selected.top, result.selected.right, result.selected.bottom, result.selected.left], ["1px", "1px", "1px", "1px"]);
  assert.equal(result.selected.borderColor, "rgba(0, 0, 0, 0)");
  assert.equal(result.idle.borderColor, result.selected.borderColor);
  assert.equal(result.selected.shadow, "none");
  assert.equal(result.idle.shadow, "none");
  assert.equal(result.selected.filter, "none");
  assert.equal(result.idle.filter, "none");
});

test("compact and localized countdown modules remain independent in localized Quick UI", { skip: !canRun }, async () => {
  await navigate("zh-CN");
  await client.evaluate(`window.__fixtureSetParts({ countdown: '4d 8h', relative: '4天8小时' })`);
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
    const compact = document.querySelector('[data-toggle="Show compact countdown"]');
    const local = document.querySelector('[data-toggle="Show local countdown"]');
    const before = {
      compactPressed: compact.getAttribute('aria-pressed'),
      localPressed: local.getAttribute('aria-pressed'),
      compactPreview: compact.textContent,
      localPreview: local.textContent,
    };
    compact.click();
    await pause();
    local.click();
    await pause();
    const compactLive = document.querySelector('#quotapin-inline-badge [data-part="countdown"]');
    const localLive = document.querySelector('#quotapin-inline-badge [data-part="relative"]');
    return {
      before,
      compactPressed: compact.getAttribute('aria-pressed'),
      localPressed: local.getAttribute('aria-pressed'),
      compactLive: compactLive.textContent,
      localLive: localLive.textContent,
      compactVisible: getComputedStyle(compactLive).display !== 'none',
      localVisible: getComputedStyle(localLive).display !== 'none',
      compactModule: compact.dataset.layoutModule,
      localModule: local.dataset.layoutModule,
    };
  })()`);
  assert.deepEqual(result.before, {
    compactPressed: "false",
    localPressed: "false",
    compactPreview: "4d 8h",
    localPreview: "4天8小时",
  });
  assert.equal(result.compactPressed, "true");
  assert.equal(result.localPressed, "true");
  assert.equal(result.compactLive, "4d 8h");
  assert.equal(result.localLive, "4天8小时");
  assert.equal(result.compactVisible, true);
  assert.equal(result.localVisible, true);
  assert.equal(result.compactModule, "countdown");
  assert.equal(result.localModule, "relative");
});

test("Quick has no quota-source selector", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  assert.equal(await client.evaluate(`Boolean(document.querySelector('[data-module-group="quota-source"]'))`), false);
});

test("the optional quota bar is saved separately and paints inside the real account row", { skip: !canRun }, async () => {
  await navigate("en");
  await openPanel();
  const result = await client.evaluate(`(async () => {
    const button = document.querySelector('[data-toggle="Show quota bar"]');
    const bar = document.querySelector('#quotapin-inline-badge [data-part="bar"]');
    const fill = bar.querySelector('[data-part="bar-fill"]');
    const row = document.getElementById('account');
    const before = { pressed: button.getAttribute('aria-pressed'), display: getComputedStyle(bar).display, row: row.getBoundingClientRect().toJSON() };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterRect = bar.getBoundingClientRect();
    const valueRect = document.querySelector('[data-quotapin-module="value"]').getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      before,
      after: {
        pressed: button.getAttribute('aria-pressed'),
        display: getComputedStyle(bar).display,
        width: getComputedStyle(fill).width,
        contained: afterRect.left >= rowRect.left && afterRect.right <= rowRect.right && afterRect.bottom <= rowRect.bottom,
        followsQuota: Math.abs(afterRect.left - valueRect.left) <= .5 && Math.abs(afterRect.right - valueRect.right) <= .5,
        scope: bar.dataset.quotapinBarScope,
        row: rowRect.toJSON(),
      },
    };
  })()`);
  assert.equal(result.before.pressed, "false");
  assert.equal(result.before.display, "none");
  assert.equal(result.after.pressed, "true");
  assert.equal(result.after.display, "block");
  assert.notEqual(result.after.width, "0px");
  assert.equal(result.after.contained, true);
  assert.equal(result.after.followsQuota, true);
  assert.equal(result.after.scope, "quota");
  assert.deepEqual(result.after.row, result.before.row, "the bar must not resize the account row");
});

test("free layout keeps its physical composition during a live sidebar resize", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    window.quotapinConfigAction(JSON.stringify({
      actionId: 'responsive-free-layout',
      action: {
        type: 'updateProfile',
        id: 'glance',
        patch: {
          layoutMode: 'free', identity: 'hideName', showValue: false, showDot: false, showBar: true,
          showDate: true, showReset: true,
          moduleOrder: ['avatar', 'date', 'name', 'dot', 'label', 'countdown', 'relative', 'seconds', 'value', 'todayTokens', 'lifetimeTokens', 'reset'],
          moduleAnchors: { avatar: .0536, name: .04, dot: .96, value: .6607, todayTokens: .96, lifetimeTokens: .96, label: .96, countdown: .96, relative: .96, seconds: .96, date: .2976, reset: .8125 },
        },
      },
    }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    const row = document.querySelector('#account');
    const ids = ['avatar', 'date', 'reset'];
    const node = (id) => document.querySelector('[data-quotapin-module="' + id + '"]');
    const centers = () => Object.fromEntries(ids.map((id) => {
      const rect = node(id).getBoundingClientRect();
      return [id, rect.left + rect.width / 2];
    }));
    const before = centers();
    row.style.width = '408px';
    await new Promise((resolve) => setTimeout(resolve, 260));
    const after = centers();
    const bar = document.querySelector('#quotapin-inline-badge [data-part="bar"]');
    const barRect = bar.getBoundingClientRect();
    const dateRect = node('date').getBoundingClientRect();
    const resetRect = node('reset').getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      drift: Object.fromEntries(ids.map((id) => [id, Math.abs(after[id] - before[id])])),
      transitionDurations: ids.map((id) => getComputedStyle(node(id)).transitionDuration),
      barInsets: { left: barRect.left - rowRect.left, right: rowRect.right - barRect.right },
      quotaRail: {
        left: Math.abs(barRect.left - Math.min(dateRect.left, resetRect.left)),
        right: Math.abs(barRect.right - Math.max(dateRect.right, resetRect.right)),
        scope: bar.dataset.quotapinBarScope,
      },
    };
  })()`);
  assert.ok(Object.values(result.drift).every((value) => value <= 1), JSON.stringify(result.drift));
  assert.deepEqual(new Set(result.transitionDurations), new Set(["0s"]));
  assert.ok(result.barInsets.left > 8, JSON.stringify(result.barInsets));
  assert.ok(result.quotaRail.left <= .5, JSON.stringify(result.quotaRail));
  assert.ok(result.quotaRail.right <= .5, JSON.stringify(result.quotaRail));
  assert.equal(result.quotaRail.scope, "quota");
});

test("high-frequency stale client states cannot flash disabled modules", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const currentPreferences = copy(window.__quotaPinController.preferences);
    const stalePreferences = copy(currentPreferences);
    const currentProfile = currentPreferences.profiles.find((profile) => profile.id === currentPreferences.activeProfile);
    const staleProfile = stalePreferences.profiles.find((profile) => profile.id === stalePreferences.activeProfile);
    Object.assign(currentProfile, {
      showValue: true, showDot: false, showBar: false, showLabel: false,
      showCountdown: false, showRelative: false, showSeconds: false,
      showDate: false, showReset: false, showTodayTokens: false, showLifetimeTokens: false,
    });
    Object.assign(staleProfile, {
      showValue: true, showDot: true, showBar: true, showLabel: true,
      showCountdown: true, showRelative: true, showSeconds: true,
      showDate: true, showReset: true, showTodayTokens: true, showLifetimeTokens: true,
    });
    const baseView = ${JSON.stringify(fixtureView)};
    const currentView = {
      ...copy(baseView), text: '58%', remainingPercent: 58, runtimeWindows: [], tooltipWindows: [],
      parts: { ...copy(baseView.parts), value: '58%' },
      showValue: true, showDot: false, showBar: false, showLabel: false,
      showCountdown: false, showRelative: false, showSeconds: false,
      showDate: false, showReset: false, showTodayTokens: false, showLifetimeTokens: false,
    };
    const staleView = {
      ...copy(baseView), text: '63%', remainingPercent: 63, runtimeWindows: [], tooltipWindows: [],
      parts: {
        ...copy(baseView.parts), value: '63%', label: '7d', countdown: '3d 4h', relative: '3 days 4 hours',
        seconds: '76:00:00', date: 'Aug 9', reset: 'Sun 07:55 PM', todayTokens: '3.5M', lifetimeTokens: '44B',
      },
      showValue: true, showDot: true, showBar: true, showLabel: true,
      showCountdown: true, showRelative: true, showSeconds: true,
      showDate: true, showReset: true, showTodayTokens: true, showLifetimeTokens: true,
    };
    const state = (view, preferences, sequence, reason) => ({
      status: 'ready', view, preferences, update: {},
      delivery: { rendererInstanceId: window.__quotaPinController.instanceId, sequence, reason, createdAt: Date.now() },
    });
    let sequence = 10_000;
    window.__quotaPinController.update(state(currentView, currentPreferences, sequence, 'current'));
    const disabled = ['dot', 'bar', 'label', 'countdown', 'relative', 'seconds', 'date', 'reset', 'todayTokens', 'lifetimeTokens'];
    const flashes = [];
    const sample = (iteration, phase) => {
      const value = document.querySelector('[data-quotapin-module="value"]')?.textContent?.trim();
      const visible = disabled.filter((module) => {
        const node = module === 'bar'
          ? document.querySelector('#quotapin-inline-badge [data-part="bar"]')
          : document.querySelector('[data-quotapin-module="' + module + '"]');
        return node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0;
      });
      if (value !== '58%' || visible.length) flashes.push({ iteration, phase, value, visible });
    };
    for (let index = 0; index < 240; index += 1) {
      sequence += 2;
      window.__quotaPinController.update(state(currentView, currentPreferences, sequence, 'current-' + index));
      queueMicrotask(() => window.__quotaPinController.update(state(staleView, stalePreferences, sequence - 1, 'stale-' + index)));
      await Promise.resolve();
      sample(index, 'microtask');
      if (index % 4 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        sample(index, 'frame');
      }
    }
    sequence += 1;
    window.__quotaPinController.update(state(staleView, stalePreferences, sequence, 'detector-control'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const detectorControl = {
      value: document.querySelector('[data-quotapin-module="value"]')?.textContent?.trim(),
      visible: disabled.filter((module) => {
        const node = module === 'bar'
          ? document.querySelector('#quotapin-inline-badge [data-part="bar"]')
          : document.querySelector('[data-quotapin-module="' + module + '"]');
        return node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0;
      }),
    };
    sequence += 1;
    window.__quotaPinController.update(state(currentView, currentPreferences, sequence, 'restore-current'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const delivery = window.__quotaPinController.inspectDeliveryRuntime();
    return { flashes, detectorControl, delivery, value: document.querySelector('[data-quotapin-module="value"]')?.textContent?.trim() };
  })()`);
  assert.deepEqual(result.flashes, []);
  assert.equal(result.detectorControl.value, "63%", "the simulator must detect a legitimately accepted stale-looking value");
  assert.ok(result.detectorControl.visible.includes("date"), JSON.stringify(result.detectorControl));
  assert.equal(result.value, "58%");
  assert.equal(result.delivery.rejected, 240);
  assert.ok(result.delivery.accepted >= 243, JSON.stringify(result.delivery));
  assert.equal(result.delivery.highestSequence, 10_482);
  assert.ok(result.delivery.trace.every((entry) => entry.accepted || entry.cause === "stale-sequence"));
});

test("a new Agent owner rejects a retired Agent's higher-sequence global delivery", { skip: !canRun }, async () => {
  await navigate("en");
  const retiredAgent = await client.evaluate(`(() => {
    const controller = window.__quotaPinController;
    const preferences = JSON.parse(JSON.stringify(controller.preferences));
    const view = ${JSON.stringify(fixtureView)};
    const accepted = controller.update({
      status: 'ready', view, preferences, update: {},
      delivery: {
        rendererInstanceId: controller.instanceId,
        sequence: 50_000,
        reason: 'agent-a-current',
        createdAt: Date.now(),
      },
    });
    window.__retiredQuotaPinControllerForTest = controller;
    window.__replacementFocusEvents = 0;
    document.getElementById('account').addEventListener('focus', () => { window.__replacementFocusEvents += 1; });
    return { instanceId: controller.instanceId, accepted };
  })()`);
  assert.equal(retiredAgent.accepted, true);
  await openPanel();
  const replacementSource = renderer.replaceAll("__QUOTAPIN_RENDERER_INSTANCE_ID__", "fixture-agent-replacement");
  await client.call("Runtime.evaluate", { expression: replacementSource, awaitPromise: true });
  const staleResult = await client.evaluate(`(async () => {
    const controller = window.__quotaPinController;
    const preferences = JSON.parse(JSON.stringify(window.__retiredQuotaPinControllerForTest.preferences));
    const currentView = ${JSON.stringify(fixtureView)};
    const staleView = {
      ...currentView,
      text: '63%',
      parts: { ...currentView.parts, value: '63%', todayTokens: 'Today 0' },
      showValue: true, showDot: true, showBar: true, showTodayTokens: true,
      showLifetimeTokens: true, showLabel: true, showCountdown: true,
      showRelative: true, showSeconds: true, showDate: true, showReset: true,
    };
    const currentAccepted = controller.update({
      status: 'ready', view: currentView, preferences, update: {},
      delivery: {
        rendererInstanceId: controller.instanceId,
        sequence: 1,
        reason: 'agent-b-current',
        createdAt: Date.now(),
      },
    });
    await Promise.resolve();
    const baselineValue = document.querySelector('[data-part="value"]').textContent;
    const retiredDelivery = {
      status: 'ready', view: staleView, preferences, update: {},
      delivery: {
        rendererInstanceId: ${JSON.stringify(retiredAgent.instanceId)},
        sequence: 50_001,
        reason: 'agent-a-retired',
        createdAt: Date.now(),
      },
    };
    // This is the production CdpSession.update ownership gate: Agent A reads
    // the global controller after B has replaced it, but may only call its own.
    const productionPathAccepted = controller.instanceId === retiredDelivery.delivery.rendererInstanceId
      ? controller.update(retiredDelivery) === true
      : false;
    // The renderer repeats the owner check so a delayed or bypassed delivery
    // still cannot use Agent A's higher sequence to seize B's state.
    const rendererPathAccepted = window.__quotaPinController.update(retiredDelivery);
    const retiredControllerAccepted = window.__retiredQuotaPinControllerForTest.update(retiredDelivery);
    const badge = document.getElementById('quotapin-inline-badge');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);
    controller.__sameInstanceMarker = 'preserve-me';
    return {
      currentAccepted,
      productionPathAccepted,
      rendererPathAccepted,
      retiredControllerAccepted,
      baselineValue,
      value: badge.querySelector('[data-part="value"]').textContent,
      todayDisplay: getComputedStyle(badge.querySelector('[data-part="todayTokens"]')).display,
      barDisplay: getComputedStyle(badge.querySelector('[data-part="bar"]')).display,
      repairs: window.__quotaPinController.inspectLayoutRuntime().integrityRepairs,
      delivery: window.__quotaPinController.inspectDeliveryRuntime(),
      retiredLifecycle: window.__retiredQuotaPinControllerForTest.inspectLifecycleRuntime(),
      focusEvents: window.__replacementFocusEvents,
      instanceId: controller.instanceId,
      badges: document.querySelectorAll('#quotapin-inline-badge').length,
    };
  })()`);
  assert.equal(staleResult.currentAccepted, true);
  assert.equal(staleResult.productionPathAccepted, false);
  assert.equal(staleResult.rendererPathAccepted, false);
  assert.equal(staleResult.retiredControllerAccepted, false);
  assert.equal(staleResult.value, staleResult.baselineValue);
  assert.equal(staleResult.todayDisplay, "none");
  assert.equal(staleResult.barDisplay, "none");
  assert.equal(staleResult.repairs, 0, JSON.stringify(staleResult));
  assert.equal(staleResult.delivery.highestSequence, 1);
  assert.ok(staleResult.delivery.trace.some((entry) => entry.cause === "foreign-renderer-instance"), JSON.stringify(staleResult));
  assert.deepEqual(staleResult.retiredLifecycle, {
    active: false,
    disposed: true,
    ownedTimeouts: 0,
    settingsTimeouts: 0,
    framePending: false,
    resizeFramePending: false,
    resizeSettlePending: false,
    liveTimeTimer: false,
    profileUsageTimer: false,
    profileUsageRequest: false,
    profileUsageCancel: false,
    holdTimer: false,
  });
  assert.equal(staleResult.focusEvents, 0, "retired cleanup re-focused the Codex account row");
  assert.equal(staleResult.instanceId, "fixture-agent-replacement");
  assert.equal(staleResult.badges, 1);

  await client.call("Runtime.evaluate", { expression: replacementSource, awaitPromise: true });
  const repeated = await client.evaluate(`({
    marker: window.__quotaPinController.__sameInstanceMarker,
    badges: document.querySelectorAll('#quotapin-inline-badge').length,
  })`);
  assert.deepEqual(repeated, { marker: "preserve-me", badges: 1 });
});

test("the active renderer repairs external quota-module DOM drift", { skip: !canRun }, async () => {
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const controller = window.__quotaPinController;
    const badge = document.getElementById('quotapin-inline-badge');
    const baselineValue = badge.querySelector('[data-part="value"]').textContent;
    const before = controller.inspectLayoutRuntime().integrityRepairs;
    badge.querySelector('[data-part="value"]').textContent = 'external-write';
    badge.querySelector('[data-part="todayTokens"]').style.display = 'inline-flex';
    badge.querySelector('[data-part="bar"]').style.display = 'block';
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);
    return {
      baselineValue,
      value: badge.querySelector('[data-part="value"]').textContent,
      todayDisplay: getComputedStyle(badge.querySelector('[data-part="todayTokens"]')).display,
      barDisplay: getComputedStyle(badge.querySelector('[data-part="bar"]')).display,
      before,
      after: controller.inspectLayoutRuntime().integrityRepairs,
    };
  })()`);
  assert.equal(result.value, result.baselineValue);
  assert.equal(result.todayDisplay, "none");
  assert.equal(result.barDisplay, "none");
  assert.ok(result.after > result.before, JSON.stringify(result));
});

test("smart layout repairs legacy fractional anchors and stays docked through resize and quota refresh", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    window.quotapinConfigAction(JSON.stringify({
      actionId: 'stable-smart-layout',
      action: {
        type: 'updateProfile',
        id: 'glance',
        patch: {
          layoutMode: 'auto', identity: 'show', showValue: true, showDot: false,
          showTodayTokens: false, showLifetimeTokens: false, showLabel: false,
          showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: false,
          moduleOrder: ['avatar', 'name', 'label', 'dot', 'countdown', 'relative', 'seconds', 'date', 'reset', 'todayTokens', 'lifetimeTokens', 'value'],
          moduleAnchors: { avatar: .3964, name: .3082, value: .9034, dot: .96, label: .96, countdown: .96, relative: .96, seconds: .96, date: .96, reset: .96, todayTokens: .96, lifetimeTokens: .96 },
        },
      },
    }));
    await pause(220);
    const row = document.querySelector('#account');
    const node = (id) => document.querySelector('[data-quotapin-module="' + id + '"]');
    const sample = () => {
      const rowRect = row.getBoundingClientRect();
      const avatar = node('avatar').getBoundingClientRect();
      const name = node('name').getBoundingClientRect();
      const value = node('value').getBoundingClientRect();
      return {
        leftInset: avatar.left - rowRect.left,
        identityGap: name.left - avatar.right,
        rightInset: rowRect.right - value.right,
        centers: [avatar, name, value].map((rect) => rect.left + rect.width / 2),
        transitions: ['avatar', 'name', 'value'].map((id) => getComputedStyle(node(id)).transitionDuration),
      };
    };
    const narrow = sample();
    row.style.width = '408px';
    await pause(220);
    const wide = sample();
    const refreshed = [];
    for (const value of ['66%', '67%', '66%', '67%']) {
      window.__fixtureSetParts({ value });
      await pause();
      refreshed.push(sample());
    }
    return { narrow, wide, refreshed };
  })()`);
  for (const sample of [result.narrow, result.wide, ...result.refreshed]) {
    assert.ok(sample.leftInset <= 12, JSON.stringify(sample));
    assert.ok(sample.identityGap >= 0 && sample.identityGap <= 8, JSON.stringify(sample));
    assert.ok(sample.rightInset <= 12, JSON.stringify(sample));
    assert.deepEqual(new Set(sample.transitions), new Set(["0s"]));
  }
  const baseline = result.refreshed[0];
  for (const sample of result.refreshed.slice(1)) {
    assert.ok(Math.abs(sample.centers[0] - baseline.centers[0]) < .25, JSON.stringify(sample));
    assert.ok(Math.abs(sample.centers[1] - baseline.centers[1]) < .25, JSON.stringify(sample));
    assert.ok(Math.abs(sample.rightInset - baseline.rightInset) < .25, JSON.stringify(sample));
  }
});

test("identical controller refreshes update state without repainting module geometry", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
    const value = document.querySelector('[data-quotapin-module="value"]').textContent;
    const before = window.__quotaPinController.inspectLayoutRuntime();
    for (let index = 0; index < 4; index += 1) {
      window.__fixtureSetParts({ value });
      await pause();
    }
    const unchanged = window.__quotaPinController.inspectLayoutRuntime();
    const preferences = window.__quotaPinController.preferences;
    const profile = preferences.profiles.find((item) => item.id === preferences.activeProfile) || preferences.profiles[0];
    window.quotapinConfigAction(JSON.stringify({
      actionId: 'layout-signature-change',
      action: { type: 'updateProfile', id: profile.id, patch: { fontSize: Number(profile.fontSize) + 1 } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    const changed = window.__quotaPinController.inspectLayoutRuntime();
    return { before, unchanged, changed };
  })()`);
  assert.ok(result.unchanged.renders >= result.before.renders + 4, JSON.stringify(result));
  assert.equal(result.unchanged.reconciliations, result.before.reconciliations, JSON.stringify(result));
  assert.ok(result.unchanged.skippedReconciliations >= result.before.skippedReconciliations + 4, JSON.stringify(result));
  assert.equal(result.changed.reconciliations, result.unchanged.reconciliations + 1, JSON.stringify(result));
});

test("real Chromium pointer input paints the dragged module and displaced neighbours before release", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  await waitFor(() => client.evaluate(`document.querySelector('#quotapin-profile-editor')?.dataset.rowEditing === 'true'`));
  const before = await client.evaluate(`(() => {
    const rect = (id) => document.querySelector('[data-quotapin-module="' + id + '"]').getBoundingClientRect().toJSON();
    return { avatar: rect('avatar'), name: rect('name'), value: rect('value') };
  })()`);
  const startX = before.value.left + before.value.width / 2;
  const startY = before.value.top + before.value.height / 2;
  const destinationX = before.name.left + before.name.width / 2;
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    const x = startX + (destinationX - startX) * step / 8;
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: startY, button: "left", buttons: 1 });
  }
  await new Promise((resolve) => setTimeout(resolve, 48));
  const during = await client.evaluate(`(() => {
    const rect = (id) => document.querySelector('[data-quotapin-module="' + id + '"]').getBoundingClientRect().toJSON();
    const duration = (id) => getComputedStyle(document.querySelector('[data-quotapin-module="' + id + '"]')).transitionDuration;
    const row = document.querySelector('#account');
    return {
      avatar: rect('avatar'), name: rect('name'), value: rect('value'),
      transitions: { avatar: duration('avatar'), name: duration('name'), value: duration('value') },
      dragging: row.dataset.quotapinLayoutDragging === 'true',
    };
  })()`);
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: destinationX, y: startY, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(during.dragging, true, JSON.stringify({ before, during }));
  assert.ok(Math.abs(during.value.left - before.value.left) > 4, JSON.stringify({ before, during }));
  assert.ok(
    Math.abs(during.avatar.left - before.avatar.left) > 1 || Math.abs(during.name.left - before.name.left) > 1,
    JSON.stringify({ before, during }),
  );
  assert.equal(during.transitions.value, "0s", "the grabbed module must track the pointer directly");
  assert.ok(
    [during.transitions.avatar, during.transitions.name].some((duration) => duration === "0.084s"),
    `displaced neighbours lost their short spring: ${JSON.stringify(during.transitions)}`,
  );
});

test("dragging keeps the Composition card fixed and displaced modules on the current pointer solution", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 440, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  await openPanel();
  await waitFor(() => client.evaluate(`document.querySelector('#quotapin-profile-editor')?.dataset.rowEditing === 'true'`));
  const result = await client.evaluate(`(async () => {
    const panel = document.querySelector('#quotapin-profile-editor');
    const group = panel.querySelector('[data-module-group="composition"]');
    const card = group.closest('section');
    const bar = panel.querySelector('[data-toggle="Show quota bar"]');
    const row = document.getElementById('account');
    const value = document.querySelector('[data-quotapin-module="value"]');
    const heights = [];
    const draggedLags = [];
    const neighbourTransitions = new Set();
    const displacedMagnetTargets = [];
    const panelOrderChangesDuringDrag = [];
    const panelOrdersAfterDrop = [];
    const settledRows = [];
    let displacedBeforeMove = new Set();
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const centerOf = (module) => {
      const rect = document.querySelector('[data-quotapin-module="' + module + '"]').getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    const panelOrder = () => [...group.children].map((node) => node.dataset.layoutModule).filter(Boolean).join('|');
    const sample = (frozenCenters = {}) => {
      const rowRect = row.getBoundingClientRect();
      heights.push(card.getBoundingClientRect().height);
      for (const module of ['avatar', 'name']) {
        const node = document.querySelector('[data-quotapin-module="' + module + '"]');
        neighbourTransitions.add(getComputedStyle(node).transitionDuration);
      }
      const draggedActual = value.getBoundingClientRect().left - rowRect.left;
      const draggedTarget = Number.parseFloat(value.style.left) || 0;
      draggedLags.push(Math.abs(draggedActual - draggedTarget));
      const magnetTarget = row.dataset.quotapinMagnetTarget || '';
      const neighbour = magnetTarget.match(/^(?:before|after):(.+)$/)?.[1];
      if (neighbour && displacedBeforeMove.has(neighbour)) {
        displacedMagnetTargets.push(magnetTarget);
      }
      displacedBeforeMove = new Set(Object.entries(frozenCenters)
        .filter(([module, center]) => Number.isFinite(center) && Math.abs(centerOf(module) - center) > 1)
        .map(([module]) => module));
    };
    const dispatch = (type, x, y) => value.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 71, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y,
    }));
    sample();
    for (const destination of [30, 212]) {
      const startRect = value.getBoundingClientRect();
      const start = { x: startRect.left + startRect.width / 2, y: startRect.top + startRect.height / 2 };
      const frozenCenters = Object.fromEntries(['avatar', 'name', 'value'].map((module) => [module, centerOf(module)]));
      displacedBeforeMove = new Set();
      const panelOrderAtPointerDown = panelOrder();
      dispatch('pointerdown', start.x, start.y);
      for (let step = 0; step <= 15; step += 1) {
        const eased = 1 - Math.pow(1 - step / 15, 3);
        dispatch('pointermove', start.x + (destination - start.x) * eased, start.y);
        if (panelOrder() !== panelOrderAtPointerDown) panelOrderChangesDuringDrag.push(panelOrder());
        sample(frozenCenters);
        await pause(20);
      }
      dispatch('pointerup', destination, start.y);
      await pause(180);
      panelOrdersAfterDrop.push({ before: panelOrderAtPointerDown, after: panelOrder() });
      const rowRect = row.getBoundingClientRect();
      const avatarRect = document.querySelector('[data-quotapin-module="avatar"]').getBoundingClientRect();
      const nameRect = document.querySelector('[data-quotapin-module="name"]').getBoundingClientRect();
      settledRows.push({
        destination,
        leftInset: Math.max(4, Number.parseFloat(getComputedStyle(row).paddingLeft) || 0),
        avatarLeft: avatarRect.left - rowRect.left,
        avatarRight: avatarRect.right - rowRect.left,
        nameLeft: nameRect.left - rowRect.left,
      });
      sample();
    }
    return {
      heightRange: Math.max(...heights) - Math.min(...heights),
      maxDraggedLag: Math.max(...draggedLags),
      neighbourTransitions: [...neighbourTransitions],
      displacedMagnetTargets,
      panelOrderChangesDuringDrag,
      panelOrdersAfterDrop,
      settledRows,
      barGroup: bar.parentElement?.dataset.moduleGroup ?? '',
      barInsideInlineGroup: group.contains(bar),
    };
  })()`);
  assert.ok(result.heightRange <= 0.5, `Composition card changed height by ${result.heightRange}px during drag`);
  assert.ok(result.maxDraggedLag <= 0.5, `the grabbed module trailed the pointer solution by ${result.maxDraggedLag}px`);
  assert.ok(result.neighbourTransitions.includes("0.084s"), `no displaced neighbour spring was observed: ${JSON.stringify(result.neighbourTransitions)}`);
  assert.deepEqual(result.displacedMagnetTargets, [], "a displaced neighbour became a moving magnetic target");
  assert.deepEqual(result.panelOrderChangesDuringDrag, [], "the panel module palette reordered while the pointer was still down");
  assert.ok(result.panelOrdersAfterDrop.every(({ before, after }) => before === after), "the visibility palette moved after a layout drop");
  assert.ok(Math.abs(result.settledRows[1].avatarLeft - result.settledRows[1].leftInset) <= 0.5, `identity stayed ${result.settledRows[1].avatarLeft - result.settledRows[1].leftInset}px away from the freed left edge after a right drop`);
  assert.ok(Math.abs(result.settledRows[1].nameLeft - result.settledRows[1].avatarRight - 6) <= 0.5, "avatar and name lost their canonical gap after the right edge was freed");
  assert.equal(result.barGroup, "status");
  assert.equal(result.barInsideInlineGroup, true);
});

test("retired quota-fire requests use sidebar fire without touching quota modules", { skip: !canRun }, async () => {
  await client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
  await navigate("en");
  const result = await client.evaluate(`(async () => {
    const value = document.querySelector('#quotapin-inline-badge [data-part="value"]');
    const currentValue = value.textContent;
    window.__fixtureSetParts({ value: currentValue });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const row = document.querySelector('#account');
    const before = { width: value.getBoundingClientRect().width, rowWidth: row.getBoundingClientRect().width, styleWidth: value.style.width, className: value.className };
    const actual = window.__quotaPinController.previewEasterEgg('quotaFire');
    await new Promise((resolve) => setTimeout(resolve, 240));
    const sidebarFire = document.querySelector('aside [data-quotapin-fire="sidebar"]');
    const after = { width: value.getBoundingClientRect().width, rowWidth: row.getBoundingClientRect().width, styleWidth: value.style.width, className: value.className, fireTarget: value.dataset.quotapinFireTarget ?? '' };
    window.__quotaPinController.stopEasterEgg();
    return { actual, sidebarFire: Boolean(sidebarFire), before, after };
  })()`);
  assert.equal(result.actual, "menuFire");
  assert.equal(result.sidebarFire, true);
  assert.ok(Number.isFinite(result.before.width) && result.before.width > 0);
  assert.ok(Math.abs(result.after.width - result.before.width) < 0.01);
  assert.equal(result.after.styleWidth, result.before.styleWidth);
  assert.equal(result.after.rowWidth, result.before.rowWidth);
  assert.equal(result.after.className, result.before.className);
  assert.equal(result.after.fireTarget, "");
});
