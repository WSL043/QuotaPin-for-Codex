import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPreviewScenario, buildScenario, createShowcaseServer, normalizePreviewOptions } from "../tools/showcase/serve.mjs";
import { DEFAULT_CONFIG } from "../src/core/config.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";

test("showcase cases use the production quota formatter and module configuration", () => {
  const normal = buildScenario("default");
  assert.equal(normal.view.parts.value, "42%");
  assert.equal(normal.view.showValue, true);
  assert.equal(normal.view.showDot, false);
  assert.equal(normal.view.layout.identity, "show");

  const date = buildScenario("date");
  assert.equal(date.view.parts.date, "Aug 9");
  assert.equal(date.view.showDate, true);

  const dot = buildScenario("dot");
  assert.equal(dot.view.showDot, true);
  assert.equal(dot.view.showValue, false);

  const critical = buildScenario("critical");
  assert.equal(critical.view.parts.value, "1%");
  assert.equal(critical.view.severity, "critical");
  assert.equal(critical.view.parts.seconds, "00:04:59");
});

test("showcase geometry is pinned to sanitized measurements from the compatible Codex build", () => {
  const tokens = JSON.parse(fs.readFileSync(new URL("../tools/showcase/codex-tokens.json", import.meta.url), "utf8"));
  assert.equal(tokens.observedCodexBuild, "26.727.6591.0");
  assert.deepEqual(tokens.account, {
    left: 8,
    bottom: 8.5,
    width: 230,
    height: 29,
    paddingInline: 8,
    borderRadius: 12.5,
    fontFamily: "Geist, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontSize: 14,
    fontWeight: 445,
    lineHeight: 21,
  });
  assert.equal(tokens.value.rightGap, 8);
  assert.equal(tokens.value.lineHeight, 19);
  const footerViewport = { width: tokens.sidebar.width, height: tokens.sidebar.footerHeight };
  const accountRect = {
    left: tokens.account.left,
    right: tokens.account.left + tokens.account.width,
    width: tokens.account.width,
    top: tokens.sidebar.footerHeight - tokens.account.bottom - tokens.account.height,
    bottom: tokens.sidebar.footerHeight - tokens.account.bottom,
    height: tokens.account.height,
  };
  assert.equal(createLayoutStateToolkit().isAccountRowGeometry(accountRect, footerViewport), true);
});

test("showcase query values cannot escape their inline script context", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const payload = "</script><script>globalThis.quotapinPwned=1</script>\u2028";
    for (const route of ["case.html", "verify.html"]) {
      const response = await fetch(`http://127.0.0.1:${port}/${route}?case=${encodeURIComponent(payload)}`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.ok(body.includes("\\u003c/script>\\u003cscript>globalThis.quotapinPwned=1\\u003c/script>\\u2028"), route);
      assert.ok(!body.includes(payload), `${route} reflected executable script-context bytes`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Preview Lab normalizes untrusted controls before they reach the production renderer", () => {
  assert.deepEqual(normalizePreviewOptions({
    preset: "critical",
    remaining: 999,
    locale: "fr",
    frame: "tiny",
    context: "overlay",
    appearance: "sepia",
    modules: "value,seconds,script,value",
  }), {
    preset: "critical",
    remaining: 100,
    locale: "en",
    frame: "wide",
    context: "focus",
    appearance: "dark",
    rowMode: "legacy",
    modules: ["value", "seconds"],
    order: "native",
    frozen: false,
  });
});

test("Preview Lab controls the real formatter instead of a parallel mock", () => {
  const previewNow = Date.UTC(2030, 7, 5, 3, 0, 0);
  const countdown = buildPreviewScenario({ preset: "countdown", remaining: 24, locale: "zh-CN" }, previewNow);
  assert.equal(countdown.config.locale, "zh-CN");
  assert.equal(countdown.view.parts.value, "24%");
  assert.equal(countdown.view.parts.countdown, "4d");
  assert.equal(countdown.view.showCountdown, true);
  assert.match(countdown.view.tooltip, /^剩余 24%\n重置/);
  assert.doesNotMatch(countdown.view.tooltip, /Codex 7d/);

  const custom = buildPreviewScenario({ preset: "default", remaining: 9, modules: "dot,date" }, previewNow);
  assert.equal(custom.view.severity, "critical");
  assert.equal(custom.view.showValue, false);
  assert.equal(custom.view.showDot, true);
  assert.equal(custom.view.showDate, true);
  assert.equal(custom.view.parts.date, "Aug 9");

  const bar = buildPreviewScenario({ preset: "default", remaining: 24, modules: "value,bar" }, previewNow);
  assert.equal(bar.view.showBar, true);
  assert.equal(bar.view.remainingPercent, 24);

  const beta = buildPreviewScenario({ rowMode: "beta" }, previewNow);
  assert.equal(beta.config.accountRowMode, "beta");
  assert.equal(beta.view.accountRowMode, "beta");
});

test("Preview Lab is same-origin, renderer-backed, and has no remote asset dependency", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/preview.html`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /QuotaPin <span>for Codex<\/span>/);
    assert.match(body, /PRODUCTION RENDERER/);
    assert.match(body, /Simulated Codex shell · production QuotaPin row/);
    assert.ok(!/https?:\/\//.test(body), "Preview Lab must not load remote assets");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("documentation showcase routes keep identity, themes, states, and arrangements on the production renderer", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    for (const route of [
      "/docs-focus.html?locale=zh-CN&remaining=6",
      "/states.html?locale=en",
      "/examples.html?locale=zh-CN",
      "/themes.html?locale=ja",
    ]) {
      const response = await fetch(origin + route);
      const body = await response.text();
      assert.equal(response.status, 200, route);
      assert.ok(!/https?:\/\//.test(body), `${route} must stay same-origin`);
    }
    const focus = await (await fetch(`${origin}/docs-focus.html?locale=en&remaining=6`)).text();
    assert.match(focus, /case\.html\?preview=1/);
    assert.match(focus, /QUOTAPIN FOR CODEX/);
    assert.match(focus, /grid-template-columns:1fr 1fr/);
    assert.doesNotMatch(focus, /class="arrow"/, "the product hero must not restore the decorative arrow");
    assert.match(focus, /class="title" aria-hidden="true"><\/div>/, "the product hero must keep the Codex shell text-free");
    const account = await (await fetch(`${origin}/case.html?preview=1&remaining=6&locale=en&appearance=dark&modules=value&order=native`)).text();
    assert.match(account, /BBQ430/);
    assert.match(account, /demo-avatar|avatar\.png/);

    const reordered = buildPreviewScenario({ remaining: 42, modules: "value", order: "quota-first" }, Date.UTC(2030, 7, 5));
    assert.equal(reordered.view.layout.moduleOrder[0], "value");
    assert.equal(reordered.view.layout.moduleOrder.at(-1), "name");

    const frozen = buildPreviewScenario({ preset: "critical", modules: "value,seconds", frozen: "1" }, Date.UTC(2030, 7, 5));
    assert.equal(frozen.view.parts.seconds, "00:04:59");
    assert.deepEqual(frozen.view.runtimeWindows, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("panel fixture uses the production renderer with independent panel and host appearances", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/panel.html?locale=zh-CN&theme=light&appearance=dark`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /<html lang="zh-CN">/);
    assert.match(body, /<script src="\/renderer\.js"><\/script>/);
    assert.match(body, /"locale":"zh-CN"/);
    assert.match(body, /"panelTheme":"light"/);
    assert.match(body, new RegExp(`"currentVersion":"${fs.readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim().replaceAll(".", "\\.")}"`));
    assert.match(body, /background:#050505/);
    assert.match(body, /window\.__quotaPinController\.openEditor\(\)/);
    assert.ok(!/https?:\/\//.test(body), "panel fixture must not load remote assets");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("panel fixture saves through the production configuration reducer", async () => {
  const server = createShowcaseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const origin = `http://127.0.0.1:${port}`;
    const panel = await fetch(`${origin}/panel.html?locale=en&theme=dark`);
    assert.match(panel.headers.get("content-security-policy") ?? "", /connect-src 'self'/);

    const resetAt = Date.now() / 1000 + 86_400;
    const response = await fetch(`${origin}/panel-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: DEFAULT_CONFIG, action: { type: "updatePanelTheme", theme: "light" }, resetAt }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.config.panelTheme, "light");
    assert.equal(result.view.parts.value, "42%");
    assert.ok(Math.abs(result.view.runtimeWindows[0].resetsAt - resetAt) < 0.01, "saving the fixture must not reset its countdown");

    const wrongMethod = await fetch(`${origin}/panel-action`);
    assert.equal(wrongMethod.status, 405);
    const invalid = await fetch(`${origin}/panel-action`, { method: "POST", body: "{" });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
