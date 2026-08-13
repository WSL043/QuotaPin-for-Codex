import fs from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadRendererSource } from "../../scripts/check-renderer-source.mjs";
import { createSettingsStateToolkit } from "../../src/renderer/settings-state.mjs";
import { createLayoutStateToolkit } from "../../src/renderer/layout-state.mjs";
import { createGestureStateToolkit } from "../../src/renderer/gesture-state.mjs";
import { createEffectStateToolkit } from "../../src/renderer/effect-state.mjs";
import { createI18nToolkit } from "../../src/renderer/i18n-state.mjs";
import { createCommandStateToolkit } from "../../src/renderer/command-state.mjs";
import { createColorStateToolkit } from "../../src/renderer/color-state.mjs";
import { createTimeStateToolkit } from "../../src/renderer/time-state.mjs";
import { createCodeConfigStateToolkit } from "../../src/renderer/code-config-state.mjs";
import { createProfileUsageStateToolkit } from "../../src/renderer/profile-usage-state.mjs";
import { DEFAULT_CONFIG, applyConfigAction, sanitizeConfig } from "../../src/core/config.mjs";
import { formatQuota } from "../../src/core/format.mjs";
import { normalizeRateLimits } from "../../src/core/model.mjs";

const tokens = JSON.parse(fs.readFileSync(new URL("./codex-tokens.json", import.meta.url), "utf8"));
const avatar = fs.readFileSync(new URL("../../assets/demo-avatar.png", import.meta.url));
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

const clone = (value) => JSON.parse(JSON.stringify(value));
const serializeForInlineScript = (value) => JSON.stringify(value)
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
const fixtureNow = Date.UTC(2030, 7, 5, 3, 0, 0);
const previewLocales = new Set(["en", "zh-CN", "ja"]);
const previewFrames = new Set(["wide", "compact"]);
const previewContexts = new Set(["focus", "full"]);
const previewAppearances = new Set(["dark", "light"]);
const previewRowModes = new Set(["legacy", "beta"]);
const previewPresets = new Set(["default", "countdown", "signal", "date", "critical"]);
const previewModules = ["value", "dot", "bar", "countdown", "relative", "seconds", "date", "reset"];
const previewOrders = new Set(["native", "quota-first", "identity-last"]);

const readOption = (source, name) => source instanceof URLSearchParams
  ? source.get(name)
  : source && Object.hasOwn(source, name)
    ? source[name]
    : null;

export function normalizePreviewOptions(source = {}) {
  const requestedPreset = String(readOption(source, "preset") ?? readOption(source, "case") ?? "default");
  const preset = previewPresets.has(requestedPreset) ? requestedPreset : "default";
  const requestedRemaining = Number(readOption(source, "remaining"));
  const remaining = Number.isFinite(requestedRemaining)
    ? Math.max(0, Math.min(100, Math.round(requestedRemaining)))
    : preset === "critical" ? 1 : 42;
  const requestedLocale = String(readOption(source, "locale") ?? "en");
  const locale = previewLocales.has(requestedLocale) ? requestedLocale : "en";
  const requestedFrame = String(readOption(source, "frame") ?? "wide");
  const frame = previewFrames.has(requestedFrame) ? requestedFrame : "wide";
  const requestedContext = String(readOption(source, "context") ?? "focus");
  const context = previewContexts.has(requestedContext) ? requestedContext : "focus";
  const requestedAppearance = String(readOption(source, "appearance") ?? "dark");
  const appearance = previewAppearances.has(requestedAppearance) ? requestedAppearance : "dark";
  const requestedRowMode = String(readOption(source, "rowMode") ?? "legacy");
  const rowMode = previewRowModes.has(requestedRowMode) ? requestedRowMode : "legacy";
  const rawModules = readOption(source, "modules");
  const modules = rawModules === null || rawModules === undefined || rawModules === ""
    ? null
    : [...new Set(String(rawModules).split(",").map((item) => item.trim()).filter((item) => previewModules.includes(item)))];
  const requestedOrder = String(readOption(source, "order") ?? "native");
  const order = previewOrders.has(requestedOrder) ? requestedOrder : "native";
  const frozen = String(readOption(source, "frozen") ?? "") === "1";
  return { preset, remaining, locale, frame, context, appearance, rowMode, modules, order, frozen };
}

function localeTag(locale) {
  if (locale === "zh-CN") return "zh-CN";
  if (locale === "ja") return "ja-JP";
  return "en-US";
}

export function buildScenario(name = "default") {
  const config = sanitizeConfig(clone(DEFAULT_CONFIG));
  const profile = config.profiles.find((item) => item.id === config.activeProfile) ?? config.profiles[0];
  config.profiles = [profile];
  config.activeProfile = profile.id;
  Object.assign(profile, {
    identity: "show",
    showValue: true,
    showDot: false,
    showBar: false,
    showLabel: false,
    showCountdown: false,
    showRelative: false,
    showSeconds: false,
    showDate: false,
    showReset: false,
    effect: "none",
  });
  let remaining = 42;
  let resetsAt = Date.UTC(2030, 7, 9, 3, 0, 0) / 1000;
  if (name === "date") profile.showDate = true;
  if (name === "dot") Object.assign(profile, { showValue: false, showDot: true });
  if (name === "critical") {
    remaining = 1;
    profile.showSeconds = true;
    resetsAt = fixtureNow / 1000 + 299;
  }
  if (name === "hero") remaining = 1;
  const usage = normalizeRateLimits({
    primary: { usedPercent: 100 - remaining, windowDurationMins: 10080, resetsAt },
  });
  const view = formatQuota(usage, config, fixtureNow, "en-US");
  if (name === "critical") {
    view.parts.seconds = "00:04:59";
    view.runtimeWindows = [];
  }
  return { config, view };
}

export function buildPreviewScenario(source = {}, now = Date.now()) {
  const options = normalizePreviewOptions(source);
  const config = sanitizeConfig(clone(DEFAULT_CONFIG));
  const profile = config.profiles.find((item) => item.id === config.activeProfile) ?? config.profiles[0];
  config.locale = options.locale;
  config.accountRowMode = options.rowMode;
  config.profiles = [profile];
  config.activeProfile = profile.id;
  Object.assign(profile, {
    identity: "show",
    showValue: true,
    showDot: false,
    showBar: false,
    showLabel: false,
    showCountdown: false,
    showRelative: false,
    showSeconds: false,
    showDate: false,
    showReset: false,
    effect: "none",
    avatarShape: "native",
  });
  if (options.preset === "countdown") profile.showCountdown = true;
  if (options.preset === "signal") Object.assign(profile, { showValue: false, showDot: true });
  if (options.preset === "date") profile.showDate = true;
  if (options.preset === "critical") profile.showSeconds = true;
  if (options.modules) {
    for (const module of previewModules) profile[`show${module[0].toUpperCase()}${module.slice(1)}`] = options.modules.includes(module);
  }
  if (options.order === "quota-first") {
    profile.moduleOrder = ["value", "dot", "label", "countdown", "relative", "seconds", "date", "reset", "avatar", "name"];
    profile.moduleAnchors = { avatar: .82, name: .95, dot: .22, value: .04, label: .32, countdown: .43, relative: .51, seconds: .60, date: .69, reset: .77 };
  } else if (options.order === "identity-last") {
    profile.moduleOrder = ["dot", "value", "label", "countdown", "relative", "seconds", "date", "reset", "name", "avatar"];
    profile.moduleAnchors = { avatar: .96, name: .78, dot: .04, value: .18, label: .28, countdown: .39, relative: .47, seconds: .56, date: .65, reset: .72 };
  }
  const resetsAt = options.preset === "critical"
    ? now / 1000 + 299
    : now / 1000 + 4 * 86_400;
  const usage = normalizeRateLimits({
    primary: { usedPercent: 100 - options.remaining, windowDurationMins: 10080, resetsAt },
  });
  const view = formatQuota(usage, config, now, localeTag(options.locale));
  if (options.frozen && options.preset === "critical") {
    view.parts.seconds = "00:04:59";
    view.runtimeWindows = [];
  }
  return { config, view, options };
}

const accountCss = `
html,body{margin:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;overflow:hidden;background:#060606;color:#ededed}
*{box-sizing:border-box}
#account{position:absolute;left:${tokens.account.left}px;bottom:${tokens.account.bottom}px;width:${tokens.account.width}px;height:${tokens.account.height}px;margin:0;padding:0 ${tokens.account.paddingInline}px;border:0;border-radius:${tokens.account.borderRadius}px;background:transparent;color:#ededed;font-family:${tokens.account.fontFamily};font-size:${tokens.account.fontSize}px;font-weight:${tokens.account.fontWeight};line-height:${tokens.account.lineHeight}px;text-align:left;white-space:nowrap;overflow:hidden}
#account img{position:absolute;left:${tokens.avatar.left}px;top:${tokens.avatar.top}px;width:${tokens.avatar.width}px;height:${tokens.avatar.height}px;border-radius:${tokens.avatar.borderRadius}px;object-fit:cover;background:#090c0b}
#account .name{position:absolute;left:${tokens.name.left}px;top:${tokens.name.top}px;height:${tokens.name.height}px;line-height:${tokens.account.lineHeight}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.help{position:absolute;right:8px;bottom:7px;width:32px;height:32px;border:0;background:transparent;color:#7d7d7d;font:500 13px ${tokens.account.fontFamily}}
`;

function accountPage(scenarioName, previewSource = null) {
  const preview = previewSource ? buildPreviewScenario(previewSource) : null;
  const { config, view } = preview ?? buildScenario(scenarioName);
  const locale = preview?.options.locale ?? "en";
  const appearance = preview?.options.appearance ?? "dark";
  const name = "BBQ430";
  return `<!doctype html><html data-appearance="${appearance}"><head><meta charset="utf-8"><meta name="viewport" content="width=${tokens.sidebar.width},initial-scale=1"><style>${accountCss}
html[data-appearance="light"],html[data-appearance="light"] body{--text-tertiary:rgba(31,35,40,.62);background:#f5f6f7;color:#1f2328}html[data-appearance="light"] #account{color:#1f2328}html[data-appearance="light"] .help{color:#70757b}
</style></head><body>
<button id="account" aria-haspopup="menu"><img src="/avatar.png" alt=""><span class="name">${name}</span></button>
<button class="help" aria-label="Help">?</button>
<script src="/renderer.js"></script><script>
const showcaseConfig=${JSON.stringify(config)}; const showcaseView=${JSON.stringify(view)};
window.quotapinConfigAction=()=>{};
window.__quotaPinController.update({status:"ready",view:showcaseView,preferences:showcaseConfig});
requestAnimationFrame(()=>requestAnimationFrame(()=>{
  const badge=document.getElementById("quotapin-inline-badge");
  const visible=badge?[...badge.querySelectorAll("[data-quotapin-module]")].filter(node=>getComputedStyle(node).display!=="none").map(node=>node.dataset.quotapinModule+":"+(node.textContent??"")).join("|"):"";
  document.documentElement.dataset.ready=badge?"true":"false";
  if(window.parent!==window) window.parent.postMessage({
    type:"quotapin-showcase-ready",
    scenario:${serializeForInlineScript(scenarioName)},
    badge:Boolean(badge),
    text:badge?.textContent??"",
    visible,
    aria:badge?.getAttribute("aria-label")??""
  },location.origin);
}));
</script></body></html>`;
}

const labCopy = {
  en: { file: "File", edit: "Edit", view: "View", help: "Help", build: "What should we build?", project: "Choose project", prompt: "Do anything", access: "Full access", nav: ["New chat", "Pull requests", "Sites", "Scheduled", "Plugins"], cards: ["Explore and understand code", "Build a new feature", "Review and suggest changes"], projects: "Projects", recents: "Recents", active: "Make quota visible", recent: "Polish the release" },
  "zh-CN": { file: "文件", edit: "编辑", view: "视图", help: "帮助", build: "我们该构建什么？", project: "选择项目", prompt: "做点什么", access: "完全访问", nav: ["新对话", "拉取请求", "站点", "已安排", "插件"], cards: ["探索并理解代码", "构建新功能、应用或工具", "审查代码并提出修改建议"], projects: "项目", recents: "最近", active: "让额度抬头可见", recent: "打磨发布版本" },
  ja: { file: "ファイル", edit: "編集", view: "表示", help: "ヘルプ", build: "何を作りましょうか？", project: "プロジェクトを選択", prompt: "何でもどうぞ", access: "フルアクセス", nav: ["新しいチャット", "プルリクエスト", "サイト", "スケジュール", "プラグイン"], cards: ["コードを調べて理解する", "新しい機能、アプリ、ツールを作る", "コードをレビューして変更を提案する"], projects: "プロジェクト", recents: "最近の項目", active: "使用量を見える場所へ", recent: "リリースを仕上げる" },
};

function previewQuery(options) {
  const query = new URLSearchParams({
    preview: "1",
    preset: options.preset,
    remaining: String(options.remaining),
    locale: options.locale,
    appearance: options.appearance,
    rowMode: options.rowMode,
    order: options.order,
  });
  if (options.modules) query.set("modules", options.modules.join(","));
  if (options.frozen) query.set("frozen", "1");
  return query.toString();
}

function labWindowPage(source) {
  const options = normalizePreviewOptions(source);
  const copy = labCopy[options.locale];
  const accountRoute = `/case.html?${previewQuery(options)}`;
  const frameWidth = options.frame === "compact" ? 690 : 900;
  const focused = options.context === "focus";
  const light = options.appearance === "light";
  const shell = light ? { page: "#e9eaec", window: "#f7f7f8", sidebar: "#f1f2f3", main: "#fafafa", line: "#d8dade", text: "#202124", soft: "#60656b", active: "#e5e7e9", composer: "#ffffff" } : { page: "#0b0c0d", window: "#050505", sidebar: "#070707", main: "#050505", line: "#242424", text: "#ededed", soft: "#8d8d8d", active: "#181818", composer: "#111" };
  return `<!doctype html><html lang="${options.locale}" data-appearance="${options.appearance}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${shell.page};color:${shell.text};font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.stage{position:relative;display:grid;place-items:center;width:100%;height:100%;padding:28px}.window{position:relative;width:${focused ? tokens.sidebar.width : frameWidth}px;height:${focused ? 430 : 540}px;overflow:hidden;border:1px solid ${shell.line};border-radius:15px;background:${shell.window};box-shadow:0 24px 70px rgba(0,0,0,${light ? ".20" : ".46"})}.titlebar{height:36px;border-bottom:1px solid ${shell.line};display:flex;align-items:center;padding:0 15px;color:${shell.soft};font-size:13px;gap:21px}.brand{font-weight:650;color:${shell.text};margin:1px 0 8px}.sidebar{position:absolute;left:0;top:36px;bottom:0;width:${tokens.sidebar.width}px;border-right:${focused ? 0 : 1}px solid ${shell.line};background:${shell.sidebar}}.nav{padding:13px 16px 58px;color:${shell.soft};font-size:14px;line-height:31px}.nav-label{margin-top:13px;color:${shell.soft};opacity:.68;font-size:12px;line-height:23px}.nav-item{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav-item.active{height:31px;margin:4px -8px;padding:0 8px;border-radius:8px;background:${shell.active};color:${shell.text}}.footer{position:absolute;left:0;right:0;bottom:0;height:${tokens.sidebar.footerHeight}px;border-top:1px solid ${shell.line};background:${shell.sidebar}}.account-frame{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}.main{position:absolute;left:${tokens.sidebar.width}px;right:0;top:36px;bottom:0;background:${shell.main}}.main-head{height:44px;border-bottom:1px solid ${shell.line}}.home{height:calc(100% - 44px);display:grid;align-content:center;justify-items:center;padding:30px}.home h1{margin:0 0 34px;font-size:25px;font-weight:560;letter-spacing:-.025em}.cards{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;width:min(100%,590px)}.card{min-height:102px;padding:18px;border:1px solid ${shell.line};border-radius:14px;color:${shell.text};font-size:13px;line-height:1.4}.composer{position:absolute;left:8%;right:8%;bottom:30px;height:92px;padding:14px;border:1px solid ${shell.line};border-radius:17px;background:${shell.composer};color:${shell.soft};font-size:13px}.composer-top{height:36px}.composer-foot{display:flex;justify-content:space-between;color:${shell.soft}}.scale-note{position:absolute;right:24px;bottom:18px;color:${shell.soft};font-size:11px;letter-spacing:.04em}.stage.focus .window{transform:scale(1.13)}
</style></head><body><div class="stage ${focused ? "focus" : "full"}"><div class="window">
<div class="titlebar"><span>□</span><span>←</span><span>→</span><span>${copy.file}</span><span>${copy.edit}</span><span>${copy.view}</span><span>${copy.help}</span></div>
<aside class="sidebar"><div class="nav"><div class="brand">Codex</div>${copy.nav.map((item) => `<div class="nav-item">${item}</div>`).join("")}<div class="nav-label">${copy.projects}</div><div class="nav-item">QuotaPin Lab</div><div class="nav-label">${copy.recents}</div><div class="nav-item active">${copy.active}</div><div class="nav-item">${copy.recent}</div></div><div class="footer"><iframe class="account-frame" src="${accountRoute}" title="QuotaPin production account row"></iframe></div></aside>
${focused ? "" : `<main class="main"><div class="main-head"></div><div class="home"><h1>${copy.build}</h1><div class="cards">${copy.cards.map((item) => `<div class="card">${item}</div>`).join("")}</div><div class="composer"><div class="composer-top">${copy.prompt}</div><div class="composer-foot"><span>+</span><span>${copy.access}</span></div></div></div></main>`}
</div><div class="scale-note">${focused ? "Focused view · 1.13×" : "Full context · 1:1"}</div></div></body></html>`;
}

function docsFocusPage(source) {
  const options = normalizePreviewOptions(source);
  const message = options.locale === "zh-CN"
    ? { line: "剩余额度，<br>已经在这。" }
    : options.locale === "ja"
      ? { line: "残量は、<br>もうここに。" }
      : { line: "Remaining.<br>Already visible." };
  const light = options.appearance === "light";
  const shell = light
    ? { page: "#eceef0", sidebar: "#f6f7f8", line: "#d6d9dd", text: "#202124", soft: "#6b7076", active: "#e8eaed" }
    : { page: "#090a0b", sidebar: "#070707", line: "#242424", text: "#ededed", soft: "#8d8d8d", active: "#181818" };
  const accountRoute = `/case.html?${previewQuery(options)}`;
  return `<!doctype html><html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${shell.page};color:${shell.text};font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.stage{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:72px;width:100%;height:100%;padding:34px 96px}.copy{justify-self:end;width:360px}.kicker{color:#6ee7b7;font-size:12px;font-weight:720;letter-spacing:.15em}.copy h1{margin:12px 0 0;font-size:44px;line-height:1.08;font-weight:630;letter-spacing:-.045em}.sidebar{position:relative;justify-self:start;width:${tokens.sidebar.width}px;height:430px;overflow:hidden;border:1px solid ${shell.line};border-radius:15px;background:${shell.sidebar};box-shadow:0 24px 70px rgba(0,0,0,${light ? ".16" : ".44"})}.title{height:49px;padding:19px 16px 0}.title::before{content:"";display:block;width:48px;height:7px;border-radius:999px;background:${shell.text};opacity:.58}.nav{padding:7px 16px}.bar{height:7px;margin:17px 0;border-radius:999px;background:${shell.soft};opacity:.42}.bar.short{width:44%}.bar.medium{width:62%}.bar.long{width:78%}.rule{height:1px;margin:26px 0;background:${shell.line}}.active{height:31px;margin:0 -8px;padding:0 8px;border-radius:8px;background:${shell.active};display:flex;align-items:center}.active::before{content:"";width:54%;height:7px;border-radius:999px;background:${shell.text};opacity:.58}.footer{position:absolute;left:0;right:0;bottom:0;height:${tokens.sidebar.footerHeight}px;border-top:1px solid ${shell.line};background:${shell.sidebar}}iframe{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}
  </style></head><body><main class="stage"><section class="copy"><div class="kicker">QUOTAPIN FOR CODEX</div><h1>${message.line}</h1></section><section class="sidebar"><div class="title" aria-hidden="true"></div><div class="nav"><div class="bar medium"></div><div class="bar long"></div><div class="bar short"></div><div class="rule"></div><div class="bar medium"></div><div class="active"></div><div class="bar long"></div></div><div class="footer"><iframe src="${accountRoute}" title="QuotaPin production account row"></iframe></div></section></main></body></html>`;
}

function statusSheetPage(source) {
  const locale = previewLocales.has(String(source.get("locale"))) ? String(source.get("locale")) : "en";
  const title = locale === "zh-CN" ? "一个数字，三档提醒" : locale === "ja" ? "ひとつの数字、3段階の合図" : "One number. Three levels.";
  const labels = locale === "zh-CN"
    ? ["正常 · 高于 30%", "提醒 · 11–30%", "危险 · 10% 及以下"]
    : locale === "ja"
      ? ["通常 · 30% より上", "注意 · 11–30%", "危険 · 10% 以下"]
      : ["Normal · above 30%", "Warning · 11–30%", "Critical · 10% or less"];
  const cases = [
    { remaining: 68, appearance: "dark", modules: "value,bar", order: "native" },
    { remaining: 24, appearance: "dark", modules: "value,bar", order: "native" },
    { remaining: 6, appearance: "dark", modules: "value,bar", order: "native" },
  ];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,initial-scale=1"><style>
html,body{margin:0;width:1080px;height:330px;overflow:hidden;background:#070809;color:#eef0f2;font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.wrap{padding:34px 40px}.title{margin:0 0 24px;font-size:28px;font-weight:620;letter-spacing:-.035em}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{height:124px;padding:17px;border:1px solid #25282c;border-radius:15px;background:#0d0f11}.label{margin-bottom:14px;color:#a5a9ae;font-size:12px;font-weight:580}.dock{position:relative;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;overflow:hidden}.dock iframe{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}
  </style></head><body><main class="wrap"><h1 class="title">${title}</h1><section class="grid">${cases.map((item, index) => { const options = normalizePreviewOptions({ ...item, locale }); return `<article class="card"><div class="label">${labels[index]}</div><div class="dock"><iframe src="/case.html?${previewQuery(options)}" title="${labels[index]}"></iframe></div></article>`; }).join("")}</section></main></body></html>`;
}

function exampleSheetPage(source) {
  const locale = previewLocales.has(String(source.get("locale"))) ? String(source.get("locale")) : "en";
  const title = locale === "zh-CN" ? "同一行，按你的习惯来" : locale === "ja" ? "同じ一行を、好きな形で" : "One row. Your way.";
  const labels = locale === "zh-CN"
    ? ["刚装好 · 只加百分比", "剩余天数", "秒级倒计时", "只看状态圆点", "额度放前面", "身份放后面"]
    : locale === "ja"
      ? ["初期状態 · 数字だけ追加", "残り日数", "秒単位カウントダウン", "ステータスドットだけ", "残量を先に", "アカウントを後ろに"]
      : ["Fresh install · percentage only", "Time left", "Second-by-second", "Status dot only", "Quota first", "Identity last"];
  const cases = [
    { remaining: 42, modules: "value", order: "native" },
    { remaining: 42, modules: "value,countdown", order: "native" },
    { preset: "critical", remaining: 8, modules: "value,seconds", order: "native", frozen: "1" },
    { remaining: 42, modules: "dot", order: "native" },
    { remaining: 42, modules: "value,countdown", order: "quota-first" },
    { remaining: 42, modules: "value", order: "identity-last" },
  ];
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,initial-scale=1"><style>
html,body{margin:0;width:1080px;height:420px;overflow:hidden;background:#070809;color:#eef0f2;font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.wrap{padding:28px 40px}.title{margin:0 0 18px;font-size:28px;font-weight:620;letter-spacing:-.035em}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{height:143px;padding:16px 18px;border:1px solid #25282c;border-radius:15px;background:#0d0f11}.label{height:29px;color:#aeb2b7;font-size:12px;font-weight:590}.dock{position:relative;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;overflow:hidden}.dock iframe{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}
  </style></head><body><main class="wrap"><h1 class="title">${title}</h1><section class="grid">${cases.map((item, index) => { const options = normalizePreviewOptions({ ...item, locale, appearance: "dark" }); return `<article class="card"><div class="label">${labels[index]}</div><div class="dock"><iframe src="/case.html?${previewQuery(options)}" title="${labels[index]}"></iframe></div></article>`; }).join("")}</section></main></body></html>`;
}

function themePairPage(source) {
  const locale = previewLocales.has(String(source.get("locale"))) ? String(source.get("locale")) : "en";
  const copy = labCopy[locale];
  const title = locale === "zh-CN" ? "一行额度，两种脾气" : locale === "ja" ? "同じ一行、ふたつの顔" : "One row. Two moods.";
  const darkLabel = locale === "zh-CN" ? "暗色" : locale === "ja" ? "ダーク" : "Dark";
  const lightLabel = locale === "zh-CN" ? "亮色" : locale === "ja" ? "ライト" : "Light";
  const frame = (appearance, label) => {
    const options = normalizePreviewOptions({ locale, appearance, remaining: 42, modules: "value,countdown" });
    return `<article class="${appearance}"><div class="label">${label}</div><section class="mini"><div class="mini-title">Codex</div><div class="mini-nav"><div>${copy.nav[0]}</div><div>${copy.nav[1]}</div><div>${copy.nav[2]}</div><div class="mini-muted">${copy.projects}</div><div>QuotaPin</div><div class="mini-muted">${copy.recents}</div><div class="mini-active">${copy.active}</div></div><div class="mini-footer"><iframe src="/case.html?${previewQuery(options)}" title="${label}"></iframe></div></section></article>`;
  };
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=980,initial-scale=1"><style>
html,body{margin:0;width:980px;height:560px;overflow:hidden;background:#08090a;color:#eef0f2;font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.wrap{padding:30px 38px}.eyebrow{color:#6ee7b7;font-size:11px;font-weight:700;letter-spacing:.16em}.title{margin:8px 0 20px;font-size:27px;font-weight:620;letter-spacing:-.035em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid article{position:relative;display:grid;place-items:center;height:440px;overflow:hidden;border:1px solid #282b2f;border-radius:16px}.grid article.dark{background:#0d0f11}.grid article.light{background:#e9ecef}.label{position:absolute;z-index:2;left:16px;top:14px;padding:6px 9px;border-radius:999px;background:rgba(8,9,10,.74);color:#d8dbde;font-size:11px;font-weight:650;backdrop-filter:blur(10px)}.mini{position:relative;width:${tokens.sidebar.width}px;height:350px;overflow:hidden;border:1px solid var(--line);border-radius:13px;background:var(--surface);color:var(--text);box-shadow:0 18px 45px rgba(0,0,0,.22)}.dark .mini{--surface:#070707;--text:#ededed;--soft:#8d8d8d;--line:#242424;--active:#181818}.light .mini{--surface:#f6f7f8;--text:#202124;--soft:#6b7076;--line:#d6d9dd;--active:#e8eaed}.mini-title{height:42px;padding:15px 16px 0;font-size:14px;font-weight:650}.mini-nav{padding:3px 16px;color:var(--soft);font-size:13px;line-height:29px}.mini-muted{margin-top:8px;opacity:.65;font-size:11px;line-height:21px}.mini-active{height:29px;margin:3px -8px;padding:0 8px;border-radius:8px;background:var(--active);color:var(--text)}.mini-footer{position:absolute;left:0;right:0;bottom:0;height:${tokens.sidebar.footerHeight}px;border-top:1px solid var(--line)}iframe{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}
</style></head><body><main class="wrap"><div class="eyebrow">QUOTAPIN · PRODUCTION RENDERER</div><h1 class="title">${title}</h1><section class="grid">${frame("dark", darkLabel)}${frame("light", lightLabel)}</section></main></body></html>`;
}

function previewLabPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:dark;font-family:${tokens.account.fontFamily};background:#08090a;color:#f1f2f3}*{box-sizing:border-box}html,body{margin:0;min-width:980px;width:100%;height:100%;min-height:700px;overflow:hidden;background:#08090a}button,input{font:inherit}.lab{display:grid;grid-template-rows:64px 1fr;height:100%}.topbar{display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid #202226;background:#0b0c0e}.topbar img{width:28px;height:28px;border-radius:9px}.title{font-size:15px;font-weight:650;letter-spacing:-.01em}.title span{color:#747980;font-weight:520}.renderer-state{margin-left:auto;padding:6px 9px;border:1px solid #244739;border-radius:999px;color:#77e6b1;background:#0e1b16;font-size:10px;font-weight:650;letter-spacing:.11em}.content{display:grid;grid-template-columns:318px minmax(0,1fr);min-height:0}.controls{padding:18px 22px;border-right:1px solid #202226;background:#0b0c0e;overflow:auto;scrollbar-gutter:stable}.eyebrow{margin-bottom:5px;color:#71767d;font-size:10px;font-weight:650;letter-spacing:.15em;text-transform:uppercase}.intro{margin:0 0 16px;color:#a8abb0;font-size:13px;line-height:1.45}.group{padding:11px 0;border-top:1px solid #202226}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.label{color:#d7d9dc;font-size:12px;font-weight:580}.value{color:#77e6b1;font-variant-numeric:tabular-nums;font-size:12px;font-weight:650}.segmented{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin-top:7px;padding:3px;border:1px solid #292c30;border-radius:10px;background:#070809}.segmented button,.preset,.module{min-height:30px;border:0;border-radius:7px;background:transparent;color:#858a91;font-size:11px;cursor:pointer}.segmented button:hover,.preset:hover,.module:hover{color:#e8e9eb;background:#15171a}.segmented button[aria-pressed="true"],.preset[aria-pressed="true"],.module[aria-pressed="true"]{color:#e9fff4;background:#173126;box-shadow:inset 0 0 0 1px #2d6d53}.range{width:100%;margin:9px 0 0;accent-color:#6ee7b7}.preset-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.preset{border:1px solid #292c30;background:#0d0f11}.module-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:7px}.module{min-height:28px;border:1px solid #292c30;background:#0d0f11}.stage{min-width:0;padding:22px;background:radial-gradient(circle at 50% 40%,#17191d 0,#0e1012 58%,#0b0c0e 100%)}.stage-card{display:grid;grid-template-rows:46px 1fr;height:100%;overflow:hidden;border:1px solid #272a2e;border-radius:18px;background:#0e1012;box-shadow:0 24px 70px rgba(0,0,0,.32)}.stage-head{display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid #24272b;color:#d9dbde;font-size:12px}.stage-head span:last-child{margin-left:auto;color:#71767d;font-size:10px;letter-spacing:.04em}.preview{width:100%;height:100%;border:0;background:#0b0c0d}button:focus-visible,input:focus-visible{outline:2px solid #7cecb8;outline-offset:2px}@media(max-width:1100px){.content{grid-template-columns:286px}.controls{padding-inline:17px}.stage{padding:16px}}
</style></head><body><div class="lab"><header class="topbar"><img src="/avatar.png" alt=""><div class="title">QuotaPin <span>for Codex</span></div><div class="renderer-state">PRODUCTION RENDERER</div></header><div class="content"><aside class="controls"><div class="eyebrow">Preview Lab</div><p class="intro">Try the account row before touching your Codex setup.</p>
<section class="group"><div class="label">Context</div><div class="segmented" data-control="context"><button data-value="focus" aria-pressed="true">Focus</button><button data-value="full" aria-pressed="false">Full app</button></div></section>
<section class="group"><div class="label">Frame</div><div class="segmented" data-control="frame"><button data-value="wide" aria-pressed="true">Wide</button><button data-value="compact" aria-pressed="false">Compact</button></div></section>
<section class="group"><div class="label">Language</div><div class="segmented" data-control="locale"><button data-value="en" aria-pressed="true">EN</button><button data-value="zh-CN" aria-pressed="false">中文</button><button data-value="ja" aria-pressed="false">日本語</button></div></section>
<section class="group"><div class="label">Appearance</div><div class="segmented" data-control="appearance"><button data-value="dark" aria-pressed="true">Dark</button><button data-value="light" aria-pressed="false">Light</button></div></section>
<section class="group"><div class="row"><span class="label">Quota remaining</span><output class="value" id="remainingOutput">42%</output></div><input class="range" id="remaining" type="range" min="0" max="100" value="42" aria-label="Quota remaining"></section>
<section class="group"><div class="label">Starting points</div><div class="preset-grid" data-control="preset"><button class="preset" data-value="default" aria-pressed="true">Glance</button><button class="preset" data-value="countdown" aria-pressed="false">Countdown</button><button class="preset" data-value="signal" aria-pressed="false">Signal</button><button class="preset" data-value="critical" aria-pressed="false">Critical</button></div></section>
<section class="group"><div class="label">Modules</div><div class="module-grid" id="modules"><button class="module" data-value="value" aria-pressed="true">42%</button><button class="module" data-value="dot" aria-pressed="false">Dot</button><button class="module" data-value="countdown" aria-pressed="false">4d</button><button class="module" data-value="seconds" aria-pressed="false">00:04</button><button class="module" data-value="date" aria-pressed="false">Aug 9</button><button class="module" data-value="reset" aria-pressed="false">11:00 AM</button></div></section>
</aside><main class="stage"><section class="stage-card"><div class="stage-head"><strong>Live preview</strong><span>Simulated Codex shell · production QuotaPin row</span></div><iframe class="preview" id="preview" title="QuotaPin Preview Lab"></iframe></section></main></div></div><script>
const state={context:"focus",frame:"wide",locale:"en",appearance:"dark",remaining:42,preset:"default",modules:new Set(["value"])};
const preview=document.getElementById("preview"),remaining=document.getElementById("remaining"),remainingOutput=document.getElementById("remainingOutput");
const syncPressed=(control,value)=>document.querySelectorAll('[data-control="'+control+'"] [data-value]').forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.value===value)));
const syncModules=()=>document.querySelectorAll('#modules [data-value]').forEach(button=>button.setAttribute("aria-pressed",String(state.modules.has(button.dataset.value))));
let timer=0; const render=()=>{clearTimeout(timer);timer=setTimeout(()=>{const query=new URLSearchParams({context:state.context,frame:state.frame,locale:state.locale,appearance:state.appearance,remaining:String(state.remaining),preset:state.preset,modules:[...state.modules].join(",")});preview.src="/lab-window.html?"+query;remainingOutput.value=state.remaining+"%";},45)};
document.querySelectorAll('[data-control] [data-value]').forEach(button=>button.addEventListener("click",()=>{const control=button.closest('[data-control]').dataset.control;state[control]=button.dataset.value;syncPressed(control,state[control]);if(control==="preset"){const modules={default:["value"],countdown:["value","countdown"],signal:["dot"],critical:["value","seconds"]};state.modules=new Set(modules[state.preset]??["value"]);if(state.preset==="critical"){state.remaining=8;remaining.value="8";}syncModules();}render();}));
document.querySelectorAll('#modules [data-value]').forEach(button=>button.addEventListener("click",()=>{const module=button.dataset.value;if(state.modules.has(module))state.modules.delete(module);else state.modules.add(module);syncModules();render();}));
remaining.addEventListener("input",()=>{state.remaining=Number(remaining.value);render();});render();
</script></body></html>`;
}

function panelFixturePage(source) {
  const locale = previewLocales.has(String(source.get("locale"))) ? String(source.get("locale")) : "en";
  const panelTheme = previewAppearances.has(String(source.get("theme"))) ? String(source.get("theme")) : "dark";
  const hostAppearance = previewAppearances.has(String(source.get("appearance"))) ? String(source.get("appearance")) : panelTheme;
  const requestedUpdateState = String(source.get("update") ?? "current");
  const updateState = new Set(["current", "available", "checking", "installing", "error"]).has(requestedUpdateState)
    ? requestedUpdateState : "current";
  const requestedUpdatePhase = String(source.get("phase") ?? "downloading");
  const updatePhase = new Set(["preparing", "downloading", "verifying", "installing", "reconnecting"]).has(requestedUpdatePhase)
    ? requestedUpdatePhase : "downloading";
  const config = sanitizeConfig({ ...clone(DEFAULT_CONFIG), locale, panelTheme });
  const now = Date.now();
  const fixtureResetAt = now / 1000 + 4 * 86_400;
  const usage = normalizeRateLimits({
    primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: fixtureResetAt },
  });
  const view = formatQuota(usage, config, now, localeTag(locale));
  const lightHost = hostAppearance === "light";
  const page = lightHost ? { bg: "#eef0f2", surface: "#f8f9fa", line: "#d8dade", text: "#1f2328", soft: "#60656b" } : { bg: "#050505", surface: "#080808", line: "#242424", text: "#ededed", soft: "#8d8d8d" };
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${page.bg};color:${page.text};font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.shell{position:relative;width:100%;height:100%;background:${page.surface}}.top{height:36px;border-bottom:1px solid ${page.line};display:flex;align-items:center;gap:22px;padding:0 16px;color:${page.soft};font-size:13px}.top-mark{width:68px;height:6px;border-radius:999px;background:${page.soft};opacity:.42}.rail{position:absolute;left:0;top:36px;bottom:0;width:${tokens.sidebar.width}px;border-right:1px solid ${page.line}}.ghost{padding:18px;color:${page.soft};font-size:13px;line-height:31px}.ghost strong{display:block;color:${page.text};margin-bottom:8px}.account{position:absolute;left:8px;bottom:8px;width:${tokens.account.width}px;height:${tokens.account.height}px;border:0;border-radius:${tokens.account.borderRadius}px;background:transparent;color:${page.text};font:600 ${tokens.account.fontSize}px/${tokens.account.lineHeight}px ${tokens.account.fontFamily};text-align:left}.account img{width:${tokens.avatar.width}px;height:${tokens.avatar.height}px;margin-right:8px;border-radius:${tokens.avatar.borderRadius}px;vertical-align:middle}.canvas{position:absolute;left:${tokens.sidebar.width}px;right:0;top:36px;bottom:0;background:${page.bg}}.canvas::before{content:"";position:absolute;left:10%;right:10%;bottom:52px;height:92px;border:1px solid ${page.line};border-radius:17px;background:${page.surface}}
  </style></head><body><div class="shell"><header class="top"><span>□</span><span>←</span><span>→</span><span class="top-mark" aria-hidden="true"></span></header><aside class="rail"><div class="ghost"><strong>Codex</strong><div>New chat</div><div>Pull requests</div><div>Projects</div></div><button id="account" class="account" aria-haspopup="menu"><img src="/avatar.png" alt=""><span>BBQ430</span></button></aside><main class="canvas"></main></div><script src="/renderer.js"></script><script>
  let fixtureConfig=${serializeForInlineScript(config)};let fixtureView=${serializeForInlineScript(view)};let fixtureQueue=Promise.resolve();const fixtureResetAt=${serializeForInlineScript(fixtureResetAt)};
  const fixtureUpdate=${serializeForInlineScript({
    status: updateState,
    currentVersion: "1.1.0",
    latestVersion: updateState === "available" || updateState === "installing" ? "1.2.1" : "1.1.2",
    releases: updateState === "available" || updateState === "installing"
      ? [{ version: "1.2.1", direction: "update" }, { version: "1.1.2", direction: "repair" }]
      : [{ version: "1.1.0", direction: "repair" }],
    message: updateState === "error" ? "QuotaPin could not check for updates." : "",
    checkError: updateState === "error",
    lastCheckedAt: updateState === "error" || updateState === "available" || updateState === "current" ? now - 5 * 60_000 : 0,
    selectedVersion: updateState === "installing" ? "1.2.1" : null,
    phase: updateState === "installing" ? updatePhase : null,
  })};
  const publishFixture=(settingsAck=null)=>window.__quotaPinController.update({status:"ready",view:fixtureView,preferences:fixtureConfig,update:fixtureUpdate,settingsAck});
  window.quotapinConfigAction=(payload)=>{
    let message;
    try{message=JSON.parse(payload);}catch{return;}
    fixtureQueue=fixtureQueue.then(async()=>{
      try{
        const response=await fetch("/panel-action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({config:fixtureConfig,action:message.action,resetAt:fixtureResetAt})});
        const result=await response.json();
        if(!response.ok||result.ok!==true)throw new Error(result.error||"Preview settings could not be saved.");
        fixtureConfig=result.config;fixtureView=result.view;
        publishFixture({actionId:message.actionId,ok:true,preferences:fixtureConfig});
      }catch(error){
        publishFixture({actionId:message.actionId,ok:false,error:{code:"preview_save_failed",message:String(error?.message||error)}});
      }
    });
  };
  window.quotapinUpdateAction=()=>{};
  publishFixture();
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.__quotaPinController.openEditor()));
  </script></body></html>`;
}

function readJsonBody(request, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Request body is not valid JSON.")); }
    });
    request.on("error", reject);
  });
}

function panelActionResult(payload) {
  const config = applyConfigAction(payload?.config, payload?.action);
  const now = Date.now();
  const requestedResetAt = Number(payload?.resetAt);
  const resetAt = Number.isFinite(requestedResetAt) && requestedResetAt > now / 1000
    ? requestedResetAt
    : now / 1000 + 4 * 86_400;
  const usage = normalizeRateLimits({
    primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: resetAt },
  });
  return { ok: true, config, view: formatQuota(usage, config, now, localeTag(config.locale)) };
}

function verifyPage(scenarioName) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#050505}iframe{width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}</style></head><body>
<iframe id="case" src="/case.html?case=${encodeURIComponent(scenarioName)}" title="QuotaPin renderer verification"></iframe><output id="result"></output>
<script>
const result=document.getElementById("result"),frame=document.getElementById("case");
const record=(payload)=>{result.dataset.badge=String(payload.badge);result.dataset.scenario=${serializeForInlineScript(scenarioName)};result.dataset.text=payload.text;result.dataset.visible=payload.visible;result.dataset.aria=payload.aria;result.textContent="verified";};
const probe=()=>{try{const document=frame.contentDocument,badge=document?.getElementById("quotapin-inline-badge");if(badge){const visible=[...badge.querySelectorAll("[data-quotapin-module]")].filter(node=>frame.contentWindow.getComputedStyle(node).display!=="none").map(node=>node.dataset.quotapinModule+":"+(node.textContent??"")).join("|");record({badge:true,text:badge.textContent??"",visible,aria:badge.getAttribute("aria-label")??""});}}catch{}};
frame.addEventListener("load",probe);setInterval(probe,25);
addEventListener("message",event=>{if(event.origin===location.origin&&event.data?.type==="quotapin-showcase-ready")record(event.data);});
</script>
</body></html>`;
}

const shellCss = `
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050505;color:#ededed;font-family:${tokens.account.fontFamily}}
*{box-sizing:border-box}.shell{position:relative;width:100%;height:100%;background:#050505}.titlebar{height:36px;border-bottom:1px solid #242424;display:flex;align-items:center;padding:0 16px;color:#8d8d8d;font-size:14px;gap:24px}.brand{font-weight:650;color:#ededed;margin-right:14px}.sidebar{position:absolute;left:0;top:36px;bottom:0;width:${tokens.sidebar.width}px;border-right:1px solid #242424;background:#070707}.nav{padding:10px 16px 58px;color:#a6a6a6;font-size:14px;line-height:32px}.nav .active{height:32px;margin:6px -8px;padding:0 8px;border-radius:8px;background:#181818;color:#ededed}.section{margin-top:16px;color:#5f5f5f;font-size:12px;line-height:24px}.item{color:#9d9d9d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.footer{position:absolute;left:0;right:0;bottom:0;height:${tokens.sidebar.footerHeight}px;border-top:1px solid #202020;background:#060606}.account-frame{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}.main{position:absolute;left:${tokens.sidebar.width}px;right:0;top:36px;bottom:0}.main-head{height:45px;border-bottom:1px solid #242424;display:flex;align-items:center;padding:0 18px;font-size:14px;color:#d8d8d8}.canvas{position:absolute;inset:45px 0 0;padding:44px 11%;color:#a7a7a7}.canvas h2{margin:0 0 22px;color:#ededed;font-size:22px;font-weight:570}.prompt{height:84px;border:1px solid #262626;border-radius:14px;background:#111;padding:18px;color:#737373}.work{margin-top:30px;border-top:1px solid #202020}.work div{height:58px;border-bottom:1px solid #202020;display:flex;align-items:center;justify-content:space-between}.work small{color:#595959}.caption{position:absolute;right:32px;bottom:24px;color:#4a4a4a;font-size:12px;letter-spacing:.02em}
`;

function heroPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${tokens.viewport.width},initial-scale=1"><style>${shellCss}</style></head><body><div class="shell">
<div class="titlebar"><span>□</span><span>←</span><span>→</span><span>File</span><span>Edit</span><span>View</span><span>Help</span></div>
<aside class="sidebar"><div class="nav"><div class="brand">Codex</div><div class="item">New task</div><div class="item">Pull requests</div><div class="item">Projects</div><div class="section">PROJECTS</div><div class="item">Small Tools</div><div class="item">Weekend Build</div><div class="section">RECENT</div><div class="active">Make quota visible</div><div class="item">Polish the release</div><div class="item">Write one more test</div></div><div class="footer"><iframe class="account-frame" src="/case.html?case=hero" title="QuotaPin account row"></iframe></div></aside>
<main class="main"><div class="main-head">Make quota visible</div><div class="canvas"><h2>What should we build?</h2><div class="prompt">Ask Codex anything…</div><div class="work"><div><span>Inspect the project</span><small>read the code</small></div><div><span>Implement a feature</span><small>keep it small</small></div><div><span>Run the checks</span><small>then run them again</small></div></div><div class="caption">Rendered from QuotaPin's production formatter and layout engine</div></div></main>
</div></body></html>`;
}

function showcasePage() {
  const cases = [
    ["default", "DEFAULT"], ["date", "DATE"], ["dot", "DOT ONLY"], ["critical", "DEADLINE"],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=780,initial-scale=1"><style>
html,body{margin:0;width:780px;height:420px;overflow:hidden;background:#050505;color:#ededed;font-family:${tokens.account.fontFamily}}*{box-sizing:border-box}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:28px}.card{height:174px;border:1px solid #242424;border-radius:14px;background:#090909;padding:22px}.label{font-size:11px;letter-spacing:.14em;color:#666;margin-bottom:34px}.dock{width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;background:#060606;position:relative}.dock iframe{position:absolute;inset:0;width:${tokens.sidebar.width}px;height:${tokens.sidebar.footerHeight}px;border:0}
</style></head><body><div class="grid">${cases.map(([name, label]) => `<section class="card"><div class="label">${label}</div><div class="dock"><iframe src="/case.html?case=${name}" title="${label}"></iframe></div></section>`).join("")}</div></body></html>`;
}

export function createShowcaseServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    response.setHeader("Cache-Control", "no-store");
    const connectSource = url.pathname === "/panel.html" ? "'self'" : "'none'";
    response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-src 'self'; connect-src ${connectSource}`);
    if (url.pathname === "/panel-action") {
      if (request.method !== "POST") {
        response.writeHead(405, { Allow: "POST" }).end(); return;
      }
      readJsonBody(request).then((payload) => {
        const body = JSON.stringify(panelActionResult(payload));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(body);
      }).catch((error) => {
        if (response.headersSent) { response.destroy(error); return; }
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      });
      return;
    }
    if (url.pathname === "/renderer.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(renderer); return;
    }
    if (url.pathname === "/avatar.png") {
      response.writeHead(200, { "Content-Type": "image/png", "Content-Length": avatar.length }).end(avatar); return;
    }
    if (url.pathname === "/case.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(accountPage(url.searchParams.get("case") ?? "default", url.searchParams.get("preview") === "1" ? url.searchParams : null)); return;
    }
    if (url.pathname === "/verify.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(verifyPage(url.searchParams.get("case") ?? "default")); return;
    }
    if (url.pathname === "/hero.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(heroPage()); return;
    }
    if (url.pathname === "/showcase.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(showcasePage()); return;
    }
    if (url.pathname === "/preview.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(previewLabPage()); return;
    }
    if (url.pathname === "/panel.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(panelFixturePage(url.searchParams)); return;
    }
    if (url.pathname === "/lab-window.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(labWindowPage(url.searchParams)); return;
    }
    if (url.pathname === "/docs-focus.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(docsFocusPage(url.searchParams)); return;
    }
    if (url.pathname === "/states.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(statusSheetPage(url.searchParams)); return;
    }
    if (url.pathname === "/examples.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(exampleSheetPage(url.searchParams)); return;
    }
    if (url.pathname === "/themes.html") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(themePairPage(url.searchParams)); return;
    }
    if (url.pathname === "/tokens.json") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(tokens)); return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end(); return;
    }
    response.writeHead(404).end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestedPort = Number(process.argv[2]) || 4188;
  createShowcaseServer().listen(requestedPort, "127.0.0.1", () => {
    console.log(`QuotaPin showcase renderer http://127.0.0.1:${requestedPort}/hero.html`);
  });
}
