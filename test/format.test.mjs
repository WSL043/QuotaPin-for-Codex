import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyConfigAction, CURRENT_CONFIG_VERSION, DEFAULT_CONFIG, DEFAULT_MODULE_ANCHORS, LAYOUT_MODULES, MAX_PROFILES, sanitizeConfig } from "../src/core/config.mjs";
import { formatForecastRange, formatLocalizedRemainingTime, formatPacePerHour, formatPreciseRemainingTime, formatQuota, formatRemainingTime, formatResetDate, selectWindows } from "../src/core/format.mjs";
import { mergeRateLimits, normalizeRateLimits } from "../src/core/model.mjs";

const now = Date.UTC(2026, 7, 3, 0, 0, 0);
const weekly = normalizeRateLimits({ primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: now / 1000 + 4 * 86400 + 8 * 3600 } });
const optionalContract = JSON.parse(Buffer.from("eyJzZWN0aW9uIjoiZXhwZXJpbWVudHMiLCJlbmFibGVkIjoib3ZlcmRyaXZlRWdnIiwicGVyc2lzdGVudCI6Im92ZXJkcml2ZUFsd2F5cyIsImVmZmVjdCI6Im92ZXJkcml2ZUVmZmVjdCIsInZhcmlhbnQiOiJtZW51RmlyZSIsImZhbGxiYWNrIjoibWVudUZpcmUifQ==", "base64").toString("utf8"));

function withProfile(patch, input = {}) {
  const config = sanitizeConfig(input);
  return applyConfigAction(config, { type: "updateProfile", id: config.activeProfile, patch });
}

test("the packaged default config matches the runtime defaults", () => {
  const packaged = JSON.parse(fs.readFileSync(new URL("../config.default.json", import.meta.url), "utf8"));
  assert.deepEqual(sanitizeConfig(packaged), sanitizeConfig(DEFAULT_CONFIG));
  assert.equal(packaged.version, CURRENT_CONFIG_VERSION);
  assert.equal(packaged.profiles.every((profile) => profile.showValue === true && profile.showDot === false && profile.showBar === false), true);
  assert.equal(packaged.profiles.every((profile) => !Object.hasOwn(profile, "quotaSource") && !Object.hasOwn(profile, "showSourceLabel")), true);
  assert.deepEqual(packaged.profiles.map((profile) => [profile.showLabel, profile.showCountdown, profile.showRelative, profile.showSeconds, profile.showDate, profile.showReset, profile.showTodayTokens, profile.showLifetimeTokens, profile.showPace, profile.showRunway]), [
    [false, false, false, false, false, false, false, false, false, false],
    [false, true, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, true, false, false, false, false],
  ]);
  assert.equal(packaged.profiles.every((profile) => profile.displayMode === "modules"), true);
  assert.equal(packaged.profiles.every((profile) => profile.moduleOrder.join("|") === LAYOUT_MODULES.join("|")), true);
  assert.equal(packaged.profiles[0].identity, "show");
  assert.equal(packaged.profiles.every((profile) => profile.avatarShape === "native"), true);
  assert.deepEqual({
    showValue: packaged.profiles[0].showValue,
    showDot: packaged.profiles[0].showDot,
    showBar: packaged.profiles[0].showBar,
    showLabel: packaged.profiles[0].showLabel,
    showCountdown: packaged.profiles[0].showCountdown,
    showRelative: packaged.profiles[0].showRelative,
    showSeconds: packaged.profiles[0].showSeconds,
    showDate: packaged.profiles[0].showDate,
    showReset: packaged.profiles[0].showReset,
    showTodayTokens: packaged.profiles[0].showTodayTokens,
    showLifetimeTokens: packaged.profiles[0].showLifetimeTokens,
    showPace: packaged.profiles[0].showPace,
    showRunway: packaged.profiles[0].showRunway,
  }, { showValue: true, showDot: false, showBar: false, showLabel: false, showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: false, showTodayTokens: false, showLifetimeTokens: false, showPace: false, showRunway: false });
  assert.deepEqual(packaged.thresholds, { warning: 30, critical: 10 });
  assert.equal(Object.hasOwn(packaged, "experiments"), false);
  assert.equal(packaged.profiles.every((profile) => !(optionalContract.enabled in profile) && !(optionalContract.persistent in profile)), true);
});

test("a single returned window exposes its actual count without inventing another window", () => {
  const view = formatQuota(weekly, sanitizeConfig(), now, "en-US");
  assert.equal(view.text, "42%");
  assert.equal(view.showValue, true);
  assert.equal(view.showDot, false);
  assert.equal(view.availableWindowCount, 1);
  assert.equal(view.parts.label, weekly.windows[0].label);
  assert.equal(view.parts.value, "42%");
  assert.equal(view.layout.identity, "show");
  assert.equal(view.layout.avatarShape, "native");
});

test("saved views support percentage, countdown, reset, and arbitrary templates", () => {
  const base = sanitizeConfig();
  assert.deepEqual(base.profiles.map((profile) => profile.name), ["Glance", "Countdown", "Reset time"]);
  assert.equal(base.activeProfile, "glance");
  const countdown = applyConfigAction(base, { type: "selectProfile", id: "countdown" });
  const resetTime = applyConfigAction(base, { type: "selectProfile", id: "reset" });
  const custom = withProfile({ template: "{remaining}% · {countdown}" }, base);
  assert.equal(formatQuota(base, base, now, "en-US").text, "--%");
  assert.equal(formatQuota(weekly, base, now, "en-US").text, "42%");
  assert.equal(formatQuota(weekly, countdown, now, "en-US").text, "42% 4d 8h");
  assert.match(formatQuota(weekly, resetTime, now, "en-US").text, /^42% /);
  assert.equal(formatQuota(weekly, custom, now, "en-US").text, "42% 4d 8h");
  assert.equal(countdown.profiles.find((profile) => profile.id === "countdown")?.displayMode, "modules");
  assert.equal(custom.profiles[0].displayMode, "modules");
});

test("granular module parts assemble one canonical text value without decorative separators", () => {
  const configured = withProfile({
    displayMode: "modules",
    showLabel: true,
    showValue: true,
    showCountdown: true,
    showReset: false,
    moduleOrder: ["avatar", "name", "dot", "label", "value", "countdown", "relative", "seconds", "date", "reset"],
  });
  const view = formatQuota(weekly, configured, now, "en-US");
  assert.equal(view.text, `${view.parts.value} ${view.parts.countdown}`);
  assert.equal(view.showLabel, false);
  assert.deepEqual(Object.keys(view.parts), ["label", "value", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens", "pace", "runway"]);
  assert.equal(view.parts.label, "7d");
  assert.equal(view.parts.value, "42%");
  const ignoredLegacyDecoration = withProfile({ moduleDivider: "custom", dividerText: " / " }, configured);
  assert.equal("moduleDivider" in ignoredLegacyDecoration.profiles[0], false);
  assert.equal("dividerText" in ignoredLegacyDecoration.profiles[0], false);
});

test("an arbitrary edited template switches to template mode without losing its text", () => {
  const config = withProfile({ template: "{label}: {remaining}% / {countdown}" });
  assert.equal(config.profiles[0].displayMode, "template");
  assert.equal(formatQuota(weekly, config, now, "en-US").text, "7d: 42% / 4d 8h");
});

test("legacy version-one settings migrate to an editable view", () => {
  const migrated = sanitizeConfig({
    version: 1,
    display: { preset: "custom", customTemplate: "{remaining}% / {countdown}", showDot: false },
    layout: { position: "left", identity: "quotaOnly" },
    thresholds: { warning: 35, critical: 12 },
  });
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.profiles[0].template, "{remaining}% / {countdown}");
  assert.equal(migrated.profiles[0].displayMode, "template");
  assert.equal(migrated.profiles[0].showDot, false);
  assert.deepEqual(migrated.profiles[0].moduleOrder, ["dot", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset", "avatar", "name"]);
  assert.equal(migrated.profiles[0].identity, "quotaOnly");
  assert.deepEqual(migrated.thresholds, { warning: 35, critical: 12 });
});

test("version-four standard views become modules while arbitrary templates stay templates", () => {
  const legacyProfile = (id, template, moduleOrder) => ({
    id,
    name: id,
    template,
    hoverTemplate: "{remaining}%",
    window: "auto",
    separator: " · ",
    showValue: true,
    showDot: false,
    valueColor: "severity",
    dotColor: "severity",
    identityColor: "inherit",
    moduleOrder,
    identity: "show",
    fontSize: 14,
    effect: "none",
    effectTarget: "dot",
    effectAt: "critical",
  });
  const migrated = sanitizeConfig({
    version: 4,
    activeProfile: "countdown",
    profiles: [
      legacyProfile("glance", "{remaining}%", ["avatar", "name", "quota"]),
      legacyProfile("countdown", "{remaining}% · {countdown}", ["quota", "avatar", "name"]),
      legacyProfile("custom", "{remaining}% / {countdown}", ["avatar", "quota", "name"]),
    ],
  });
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.deepEqual(migrated.profiles.map((profile) => profile.displayMode), ["modules", "modules", "template"]);
  assert.deepEqual(migrated.profiles[1].moduleOrder, ["dot", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset", "avatar", "name"]);
  assert.equal(migrated.profiles[1].showCountdown, true);
  assert.equal(migrated.profiles[2].template, "{remaining}% / {countdown}");
  assert.equal(formatQuota(weekly, { ...migrated, activeProfile: "custom" }, now, "en-US").text, "42% / 4d 8h");
});

test("views can be duplicated, selected, edited, and deleted within a bounded list", () => {
  let config = sanitizeConfig();
  config = applyConfigAction(config, { type: "addProfile", fromId: "glance", id: "red-alert", name: "Red alert" });
  assert.equal(config.activeProfile, "red-alert");
  config = applyConfigAction(config, { type: "updateProfile", id: "red-alert", patch: { template: "{remaining}% left", valueColor: "#ff3366" } });
  assert.equal(config.profiles.find((profile) => profile.id === "red-alert")?.valueColor, "#ff3366");
  while (config.profiles.length < MAX_PROFILES) {
    config = applyConfigAction(config, { type: "addProfile", id: `view-${config.profiles.length}`, name: "More" });
  }
  const capped = applyConfigAction(config, { type: "addProfile", id: "too-many" });
  assert.equal(capped.profiles.length, MAX_PROFILES);
  const deleted = applyConfigAction(capped, { type: "deleteProfile", id: "red-alert" });
  assert.equal(deleted.profiles.some((profile) => profile.id === "red-alert"), false);
});

test("hover, dot, colors, severity, and attention effects are independent", () => {
  const config = withProfile({
    hoverTemplate: "{remaining}% left; reset {reset}",
    dotColor: "#123456",
    valueColor: "severity",
    effect: "blink",
    effectTarget: "both",
    effectAt: "warning",
    identityColor: "match",
  }, { thresholds: { warning: 50, critical: 10 }, palette: { accent: "#00cc88", warning: "#ffaa00", critical: "#ff2244" } });
  const view = formatQuota(weekly, config, now, "en-US");
  assert.equal(view.tooltip.includes("42% left"), true);
  assert.equal(view.severity, "warning");
  assert.equal(view.valueColor, "#ffaa00");
  assert.equal(view.dotColor, "#123456");
  assert.equal(view.identityColor, "#ffaa00");
  assert.equal(view.effect, "blink");
  assert.equal(view.effectTarget, "both");
  assert.equal(view.effectAt, "warning");
  const noHover = formatQuota(weekly, withProfile({ hoverTemplate: "" }, config), now, "en-US");
  assert.equal(noHover.tooltip, "");
});

test("playful effects are opt-in and can run outside warning states", () => {
  const config = withProfile({ effect: "rainbow", effectAt: "always", effectTarget: "value", identityColor: "#6633ff" });
  const view = formatQuota(weekly, config, now, "en-US");
  assert.equal(view.effect, "rainbow");
  assert.equal(view.effectAt, "always");
  assert.equal(view.effectTarget, "value");
  assert.equal(view.identityColor, "#6633ff");
  assert.equal(view[optionalContract.enabled], false);
  assert.equal(view[optionalContract.persistent], false);
  assert.equal(view[optionalContract.effect], optionalContract.fallback);
  const enabledConfig = applyConfigAction(config, { type: "updateExperiments", patch: { [optionalContract.enabled]: true, [optionalContract.persistent]: true, [optionalContract.effect]: optionalContract.variant } });
  const enabled = formatQuota(weekly, enabledConfig, now, "en-US");
  assert.equal(enabled[optionalContract.enabled], true);
  assert.equal(enabled[optionalContract.persistent], true);
  assert.equal(enabled[optionalContract.effect], optionalContract.variant);
  const sanitizedConfig = applyConfigAction(config, { type: "updateExperiments", patch: { [optionalContract.effect]: "not-an-effect" } });
  const sanitized = formatQuota(weekly, sanitizedConfig, now, "en-US");
  assert.equal(sanitized[optionalContract.effect], optionalContract.fallback);
});

test("older optional settings require a fresh explicit opt-in", () => {
  const migrated = sanitizeConfig({
    version: 2,
    activeProfile: "glance",
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], [optionalContract.enabled]: true, [optionalContract.persistent]: true }],
  });
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.equal(migrated[optionalContract.section][optionalContract.enabled], false);
  assert.equal(migrated[optionalContract.section][optionalContract.persistent], false);
  const enabled = applyConfigAction(migrated, { type: "updateExperiments", patch: { [optionalContract.enabled]: true, [optionalContract.persistent]: true } });
  assert.equal(enabled[optionalContract.section][optionalContract.enabled], true);
  assert.equal(enabled[optionalContract.section][optionalContract.persistent], true);
});

test("the numeric value can be hidden independently from account identity", () => {
  for (const identity of ["show", "hideName", "hideAvatar", "quotaOnly"]) {
    const hidden = withProfile({ showValue: false, showDot: true, identity });
    const view = formatQuota(weekly, hidden, now, "en-US");
    assert.equal(view.showValue, false);
    assert.equal(view.showDot, true);
    assert.equal(view.layout.identity, identity);
    assert.equal(view.dotColor, "#6ee7b7");
  }
  const hidden = withProfile({ showValue: false, showDot: true, identity: "hideAvatar" });
  const operable = withProfile({ showValue: false, showDot: false }, hidden);
  const profile = operable.profiles.find((item) => item.id === operable.activeProfile);
  assert.equal(profile.showValue, false);
  assert.equal(profile.showDot, false);
  const invisible = formatQuota(weekly, operable, now, "en-US");
  assert.equal(invisible.showValue, false);
  assert.equal(invisible.showDot, false);
});

test("the quota bar is an explicit schema-ten opt-in with a bounded semantic scope", () => {
  const legacy = sanitizeConfig({
    ...DEFAULT_CONFIG,
    version: 8,
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], showBar: true }],
  });
  assert.equal(legacy.profiles[0].showBar, false);
  const enabled = withProfile({ showBar: true });
  const view = formatQuota(weekly, enabled, now, "en-US");
  assert.equal(view.showBar, true);
  assert.equal(view.remainingPercent, 42);
  assert.equal(view.layout.barScope, "quota");
  assert.equal(withProfile({ showBar: true, barScope: "row" }).profiles[0].barScope, "row");
  assert.equal(withProfile({ showBar: true, barScope: "screen" }).profiles[0].barScope, "quota");
  const migratedRail = sanitizeConfig({
    ...DEFAULT_CONFIG,
    version: 16,
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], showBar: true, barScope: undefined }],
  });
  assert.equal(migratedRail.profiles[0].showBar, true);
  assert.equal(migratedRail.profiles[0].barScope, "quota");
});

test("avatar shape is bounded and older profiles migrate to the native Codex shape", () => {
  for (const avatarShape of ["native", "rounded", "square"]) {
    const configured = withProfile({ avatarShape });
    assert.equal(configured.profiles[0].avatarShape, avatarShape);
    assert.equal(formatQuota(weekly, configured, now, "en-US").layout.avatarShape, avatarShape);
  }
  assert.equal(withProfile({ avatarShape: "triangle" }).profiles[0].avatarShape, "native");
  assert.equal(withProfile({ avatarShape: "circle" }).profiles[0].avatarShape, "native");
  const migrated = sanitizeConfig({
    version: 5,
    activeProfile: "old",
    profiles: [{ id: "old", name: "Old", template: "{remaining}%", identity: "show" }],
  });
  assert.equal(migrated.profiles[0].avatarShape, "native");
});

test("badge size and module order are bounded per saved view", () => {
  const configured = withProfile({ fontSize: 16, moduleOrder: ["quota", "avatar", "name"] });
  const view = formatQuota(weekly, configured, now, "en-US");
  assert.deepEqual(view.layout, {
    moduleOrder: ["dot", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset", "avatar", "name"],
    layoutMode: "auto",
    snapThreshold: 16,
    snapTargets: ["edges", "center", "modules"],
    moduleAnchors: { ...DEFAULT_MODULE_ANCHORS },
    identity: "show",
    avatarShape: "native",
    fontSize: 16,
    barScope: "quota",
    placement: { primary: "account-row", fallback: "account-row", rail: "account-row" },
  });
  const bounded = withProfile({ fontSize: 90, moduleOrder: ["quota", "quota", "name"] }, configured);
  const profile = bounded.profiles.find((item) => item.id === bounded.activeProfile);
  assert.equal(profile.fontSize, 14);
  assert.deepEqual(profile.moduleOrder, LAYOUT_MODULES);
});

test("advanced Code layout controls are bounded without changing saved anchors", () => {
  const custom = withProfile({ snapThreshold: 9, snapTargets: ["modules", "center", "modules"], layoutMode: "free" });
  assert.equal(custom.profiles[0].layoutMode, "free");
  assert.equal(custom.profiles[0].snapThreshold, 9);
  assert.deepEqual(custom.profiles[0].snapTargets, ["center", "modules"]);
  assert.deepEqual(custom.profiles[0].moduleAnchors, DEFAULT_MODULE_ANCHORS);

  const bounded = withProfile({ snapThreshold: 900, snapTargets: ["unknown"] });
  assert.equal(bounded.profiles[0].snapThreshold, 16);
  assert.deepEqual(bounded.profiles[0].snapTargets, []);
});

test("schema-ten profiles gain smart-drag defaults without moving their saved layout", () => {
  const anchors = { ...DEFAULT_MODULE_ANCHORS, value: 0.42, name: 0.21 };
  const previous = {
    ...DEFAULT_CONFIG,
    version: 10,
    profiles: [{
      ...DEFAULT_CONFIG.profiles[0],
      moduleAnchors: anchors,
      snapThreshold: undefined,
      snapTargets: undefined,
    }],
  };
  const migrated = sanitizeConfig(previous);
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.profiles[0].snapThreshold, 16);
  assert.deepEqual(migrated.profiles[0].snapTargets, ["edges", "center", "modules"]);
  assert.deepEqual(migrated.profiles[0].moduleAnchors, anchors);
});

test("the former wide-sidebar identity gap migrates without moving custom layouts", () => {
  const previousDefault = {
    avatar: 0.04, name: 0.18, dot: 0.96, value: 0.96, label: 0.96,
    countdown: 0.96, relative: 0.96, seconds: 0.96, date: 0.96, reset: 0.96,
  };
  const migrated = sanitizeConfig({
    ...DEFAULT_CONFIG,
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], moduleAnchors: previousDefault }],
  });
  assert.deepEqual(migrated.profiles[0].moduleAnchors, DEFAULT_MODULE_ANCHORS);

  const custom = sanitizeConfig({
    ...DEFAULT_CONFIG,
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], moduleAnchors: { ...previousDefault, name: 0.19 } }],
  });
  assert.equal(custom.profiles[0].moduleAnchors.name, 0.19);
});

test("legacy continuous placement migrates to the nearest module insertion slot", () => {
  const left = sanitizeConfig({ version: 3, activeProfile: "loose", profiles: [{ id: "loose", name: "Loose", position: "free", freeX: 12 }] });
  const middle = sanitizeConfig({ version: 3, activeProfile: "loose", profiles: [{ id: "loose", name: "Loose", position: "free", freeX: 50 }] });
  const right = sanitizeConfig({ version: 3, activeProfile: "loose", profiles: [{ id: "loose", name: "Loose", position: "free", freeX: 88 }] });
  assert.deepEqual(left.profiles[0].moduleOrder, ["dot", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset", "avatar", "name"]);
  assert.deepEqual(middle.profiles[0].moduleOrder, ["avatar", "dot", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset", "name"]);
  assert.deepEqual(right.profiles[0].moduleOrder, LAYOUT_MODULES);
  const reorderedOrder = ["name", "label", "value", "pace", "runway", "todayTokens", "lifetimeTokens", "dot", "avatar", "countdown", "relative", "seconds", "date", "reset"];
  const reordered = applyConfigAction(right, { type: "updateProfile", id: "loose", patch: { moduleOrder: reorderedOrder } });
  assert.deepEqual(reordered.profiles[0].moduleOrder, reorderedOrder);
});

test("threshold edits preserve critical <= warning", () => {
  let config = sanitizeConfig();
  config = applyConfigAction(config, { type: "updateThresholds", patch: { critical: 60 } });
  assert.deepEqual(config.thresholds, { warning: 60, critical: 60 });
  config = applyConfigAction(config, { type: "updateThresholds", patch: { warning: 15 } });
  assert.deepEqual(config.thresholds, { warning: 15, critical: 15 });
});

test("remaining quota severity runs from critical through warning to normal", () => {
  const input = { thresholds: { critical: 10, warning: 25 } };
  const at = (remainingPercent) => formatQuota({
    status: "ready",
    windows: [{ label: "7d", windowDurationMins: 10080, remainingPercent, resetsAt: now / 1000 + 86400 }],
  }, sanitizeConfig(input), now, "en-US");
  assert.equal(at(1).severity, "critical");
  assert.equal(at(1).valueColor, "#f87171");
  assert.equal(at(20).severity, "warning");
  assert.equal(at(20).valueColor, "#fbbf24");
  assert.equal(at(80).severity, "normal");
  assert.equal(at(80).valueColor, "#6ee7b7");
});

test("language defaults to English and switches only to supported UI locales", () => {
  const base = sanitizeConfig();
  assert.equal(base.locale, "en");
  assert.equal(applyConfigAction(base, { type: "updateLocale", locale: "zh-CN" }).locale, "zh-CN");
  assert.equal(applyConfigAction(base, { type: "updateLocale", locale: "ja" }).locale, "ja");
  assert.equal(applyConfigAction(base, { type: "updateLocale", locale: "klingon" }).locale, "en");
});

test("panel appearance is explicit and independent from host or system appearance", () => {
  const base = sanitizeConfig();
  assert.equal(base.panelTheme, "dark");
  assert.equal(applyConfigAction(base, { type: "updatePanelTheme", theme: "light" }).panelTheme, "light");
  assert.equal(applyConfigAction(base, { type: "updatePanelTheme", theme: "system" }).panelTheme, "dark");
  assert.equal(sanitizeConfig({ ...base, panelTheme: "light" }).panelTheme, "light");
});

test("account-row beta mode is explicit, global, and falls back safely", () => {
  const base = sanitizeConfig();
  assert.equal(base.accountRowMode, "legacy");
  const beta = applyConfigAction(base, { type: "updateAccountRowMode", mode: "beta" });
  assert.equal(beta.accountRowMode, "beta");
  assert.equal(formatQuota(weekly, beta, now, "en-US").accountRowMode, "beta");
  assert.equal(applyConfigAction(beta, { type: "updateAccountRowMode", mode: "future" }).accountRowMode, "legacy");
});

test("retired quota-fire settings migrate to the sidebar fire", () => {
  for (const overdriveEffect of ["quotaFire", "random", "menuFire", "unknown"]) {
    const migrated = sanitizeConfig({
      ...DEFAULT_CONFIG,
      experiments: { overdriveEgg: true, overdriveAlways: true, overdriveEffect },
    });
    assert.equal(migrated.experiments.overdriveEffect, "menuFire", overdriveEffect);
  }
});

test("built-in hover text follows the selected language without rewriting custom text", () => {
  const base = sanitizeConfig();
  const english = formatQuota(weekly, base, now, "en-US").tooltip;
  assert.equal(english.startsWith("42% remaining\nReset in 4d 8h"), true);
  assert.doesNotMatch(english, /Codex|7d:/);
  assert.equal(english.includes(formatResetDate(weekly.windows[0].resetsAt, "en-US")), true);
  assert.match(formatQuota(weekly, base, now, "zh-CN").tooltip, /^剩余 42%\n重置 4d 8h/);
  assert.match(formatQuota(weekly, base, now, "ja-JP").tooltip, /^残り 42%\nリセットまで 4d 8h/);

  const migrated = sanitizeConfig({
    version: 5,
    activeProfile: "old",
    profiles: [{
      id: "old",
      name: "Old",
      template: "{remaining}%",
      hoverTemplate: "{label}: {remaining}% left · resets {reset} ({countdown})",
    }],
  });
  assert.equal(migrated.profiles[0].hoverTemplate, "{remaining}% left · resets in {countdown} ({date}, {reset})");

  const custom = withProfile({ hoverTemplate: "custom {label}: {remaining}%" }, base);
  assert.equal(formatQuota(weekly, custom, now, "zh-CN").tooltip, `custom ${weekly.windows[0].label}: 42%`);
});

test("extra quota buckets never enter the ordinary quota view or change its geometry contract", () => {
  const response = {
    rateLimits: { limitId: "codex", primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: now / 1000 + 4 * 86400 + 8 * 3600 } },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", limitName: null, primary: { usedPercent: 58, windowDurationMins: 10080, resetsAt: now / 1000 + 4 * 86400 + 8 * 3600 } },
      codex_bengalfox: { limitId: "codex_bengalfox", limitName: "GPT-5.3-Codex-Spark", primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: now / 1000 + 5 * 86400 } },
    },
  };
  const usage = normalizeRateLimits(response);
  assert.deepEqual(usage.buckets.map(({ id, shortLabel }) => [id, shortLabel]), [["codex", "Codex"]]);
  assert.equal(usage.windows.length, 1);

  const defaultView = formatQuota(usage, sanitizeConfig(), now, "en-US");
  assert.equal(defaultView.text, "42%");
  assert.match(defaultView.tooltip, /^42% remaining/m);
  assert.doesNotMatch(defaultView.tooltip, /Codex 7d/);
  assert.doesNotMatch(defaultView.tooltip, /Spark/i);

  const merged = mergeRateLimits(response, { limitId: "codex_bengalfox", primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: now / 1000 + 5 * 86400 } });
  assert.equal(merged.rateLimitsByLimitId.codex.primary.usedPercent, 58);
  assert.equal(merged.rateLimitsByLimitId.codex_bengalfox.primary.usedPercent, 10);
  assert.deepEqual(normalizeRateLimits(merged).windows, usage.windows);

  const withoutExtra = normalizeRateLimits({ rateLimits: response.rateLimits, rateLimitsByLimitId: { codex: response.rateLimitsByLimitId.codex } });
  assert.deepEqual(withoutExtra.windows, usage.windows);

  const migrated = sanitizeConfig({
    version: 14,
    activeProfile: "glance",
    profiles: [{ ...DEFAULT_CONFIG.profiles[0], quotaSource: "limit:codex_bengalfox", showSourceLabel: false }],
  });
  assert.equal(Object.hasOwn(migrated.profiles[0], "quotaSource"), false);
  assert.equal(Object.hasOwn(migrated.profiles[0], "showSourceLabel"), false);
});

test("formatted views expose the number of windows returned independently of selection", () => {
  const windows = [
    { label: "brief", windowDurationMins: 180, remainingPercent: 70, resetsAt: now / 1000 + 1800 },
    { label: "cycle", windowDurationMins: 9000, remainingPercent: 40, resetsAt: now / 1000 + 86400 },
  ];
  const shortest = withProfile({ window: "shortest" });
  const view = formatQuota({ status: "ready", windows }, shortest, now, "en-US");
  assert.equal(view.availableWindowCount, 2);
  assert.equal(view.parts.label, "brief");
  assert.equal(view.tooltip.startsWith("brief\n70% remaining"), true);
  assert.equal(formatQuota({ status: "loading", windows: [] }, shortest, now, "en-US").availableWindowCount, 0);
});

test("window selection uses returned durations without named-window assumptions", () => {
  const windows = [
    { label: "brief", windowDurationMins: 180 },
    { label: "cycle", windowDurationMins: 9000 },
  ];
  assert.equal(selectWindows(windows, "shortest")[0].label, "brief");
  assert.equal(selectWindows(windows, "longest")[0].label, "cycle");
  assert.equal(selectWindows(windows, "duration:9000")[0].label, "cycle");
});

test("remaining-time formatter uses compact decision-friendly units", () => {
  assert.equal(formatRemainingTime(now / 1000 + 3900, now), "1h 5m");
  assert.equal(formatRemainingTime(now / 1000 + 3599, now), "59m 59s");
  assert.equal(formatRemainingTime(now / 1000 + 59, now), "59s");
  assert.equal(formatRemainingTime(now / 1000 + 3900, now, "zh-CN"), "1h 5m");
  assert.equal(formatRemainingTime(now / 1000 + 3900, now, "ja-JP"), "1h 5m");
  assert.equal(formatRemainingTime(now / 1000 - 1, now), "now");
  assert.equal(formatRemainingTime(now / 1000 - 1, now, "zh-CN"), "现在");
  assert.equal(formatRemainingTime(now / 1000 - 1, now, "ja-JP"), "まもなく");
});

test("compact time is universal while the optional worded module follows the locale", () => {
  const reset = now / 1000 + 4 * 86400 + 8 * 3600;
  assert.equal(formatRemainingTime(reset, now, "en-US"), "4d 8h");
  assert.equal(formatRemainingTime(reset, now, "zh-CN"), "4d 8h");
  assert.equal(formatRemainingTime(reset, now, "ja-JP"), "4d 8h");
  assert.equal(formatLocalizedRemainingTime(reset, now, "en-US"), "4 days 8 hours");
  assert.equal(formatLocalizedRemainingTime(reset, now, "zh-CN"), "4天8小时");
  assert.equal(formatLocalizedRemainingTime(reset, now, "ja-JP"), "4日8時間");

  const localized = withProfile({ showCountdown: true, showRelative: true });
  const chinese = formatQuota(weekly, localized, now, "zh-CN");
  assert.equal(chinese.parts.countdown, "4d 8h");
  assert.equal(chinese.parts.relative, "4天8小时");
  assert.equal(chinese.showRelative, true);
});

test("seconds and reset-date formatters keep distinct jobs", () => {
  assert.equal(formatPreciseRemainingTime(now / 1000 + 3900, now), "01:05:00");
  assert.equal(formatPreciseRemainingTime(now / 1000 + 1, now), "00:00:01");
  assert.equal(formatPreciseRemainingTime(now / 1000 + 4 * 86400 + 8 * 3600, now), "104:00:00");
  assert.equal(formatPreciseRemainingTime(now / 1000 - 1, now), "now");
  assert.equal(formatPreciseRemainingTime("bad", now), "unknown");
  assert.equal(formatResetDate(now / 1000, "en-US"), "Aug 3");
  assert.match(formatResetDate(now / 1000, "zh-CN"), /8月3日/);
  assert.match(formatResetDate(now / 1000, "ja-JP"), /8月3日/);
});

test("localized time, date, and seconds are independent modules and Code tokens", () => {
  const modules = withProfile({ showCountdown: true, showRelative: true, showSeconds: true, showDate: true });
  const moduleView = formatQuota(weekly, modules, now, "en-US");
  assert.equal(moduleView.parts.countdown, "4d 8h");
  assert.equal(moduleView.parts.relative, "4 days 8 hours");
  assert.equal(moduleView.parts.seconds, "104:00:00");
  assert.match(moduleView.parts.date, /Aug/);
  const code = withProfile({ template: "{remaining}% | {countdown} | {relative} | {seconds} | {date}" });
  assert.match(formatQuota(weekly, code, now, "en-US").text, /^42% \| 4d 8h \| 4 days 8 hours \| 104:00:00 \| Aug/);
});

test("account-wide pace and runway remain optional modules backed by official quota history", () => {
  const config = withProfile({
    showPace: true,
    showRunway: true,
    moduleOrder: ["avatar", "name", "value", "pace", "runway", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"],
  });
  const reset = now / 1000 + 4 * 86400;
  const snapshot = {
    status: "ready",
    windows: [{ id: "codex:10080", sourceId: "codex", label: "7d", displayLabel: "Weekly", windowDurationMins: 10080, remainingPercent: 70, resetsAt: reset }],
    quotaPace: { windows: [{ id: "codex:10080", sourceId: "codex", windowDurationMins: 10080, resetsAt: reset, status: "ready", pacePerHour: 2, runwaySeconds: 35 * 3600, survivesReset: false }] },
  };
  const view = formatQuota(snapshot, config, now, "zh-CN");
  assert.equal(view.text, "70% 2%/h ≈1d 11h");
  assert.equal(view.parts.pace, "2%/h");
  assert.equal(view.parts.runway, "≈1d 11h");
  assert.match(view.tooltip, /速度 2%\/h · 预计 ≈1天11小时/);

  const code = withProfile({ template: "{remaining}% {pace} {runway}" }, config);
  assert.equal(formatQuota(snapshot, code, now, "en-US").text, "70% 2%/h ≈1d 11h");

  const shortSnapshot = {
    ...snapshot,
    quotaPace: { windows: [{ ...snapshot.quotaPace.windows[0], runwaySeconds: 35 * 60 + 9 }] },
  };
  const shortView = formatQuota(shortSnapshot, config, now, "zh-CN");
  assert.equal(shortView.parts.runway, "≈35m 9s");
  assert.equal(shortView.runtimeWindows[0].runwayPrefix, "≈");
  assert.equal(shortView.runtimeWindows[0].runwayEndsAt, now / 1000 + 35 * 60 + 9);
});

test("forecast v2 keeps one compact runway inline and one direct forecast line in hover", () => {
  const config = withProfile({ showPace: true, showRunway: true });
  const reset = now / 1000 + 5 * 86400;
  const snapshot = {
    status: "ready",
    windows: [{ id: "codex:10080", sourceId: "codex", label: "7d", displayLabel: "Weekly", windowDurationMins: 10080, remainingPercent: 67, resetsAt: reset }],
    quotaPace: { windows: [{
      id: "codex:10080", sourceId: "codex", windowDurationMins: 10080, resetsAt: reset,
      status: "ready", forecastVersion: 2, regime: "accelerating", confidence: "low",
      pacePerHour: .92, currentPacePerHour: 2.36, slowPacePerHour: 1.09,
      runwaySeconds: 73 * 3600, runwayLowSeconds: 28 * 3600, runwayHighSeconds: 61 * 3600,
      survivesReset: false, rangeSurvivesReset: false,
    }] },
  };
  const view = formatQuota(snapshot, config, now, "zh-CN");

  assert.equal(view.parts.pace, "2.4%/h");
  assert.equal(view.parts.runway, "≈3d 1h");
  assert.equal(view.runtimeWindows[0].runwayRange, true);
  assert.equal(view.runtimeWindows[0].runwayEndsAt, now / 1000 + 73 * 3600);
  assert.equal(view.runtimeWindows[0].runwayLowEndsAt, now / 1000 + 28 * 3600);
  assert.equal(view.runtimeWindows[0].runwayHighEndsAt, now / 1000 + 61 * 3600);
  assert.match(view.tooltip, /速度 2.4%\/h · 预计 ≈3天1小时/);
  assert.doesNotMatch(view.tooltip, /基线|用量正在|1天4小时–2天13小时/);
  assert.equal(view.renderForecastTooltip, true);
  assert.equal(formatForecastRange(28 * 3600, 61 * 3600, "en-US"), "1d 4h–2d 13h");
  assert.equal(formatPacePerHour(0), "0%/h");
});

test("schema-eighteen layouts gain forecast modules without restoring retired side placements", () => {
  const oldOrder = ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"];
  const migrated = sanitizeConfig({
    ...DEFAULT_CONFIG,
    version: 18,
    profiles: [{
      ...DEFAULT_CONFIG.profiles[0],
      moduleOrder: oldOrder,
      placement: { primary: "workspace-bottom-start", fallback: "account-row", rail: "account-row" },
    }],
  });
  assert.deepEqual(migrated.profiles[0].moduleOrder, ["avatar", "name", "value", "pace", "runway", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"]);
  assert.deepEqual(migrated.profiles[0].placement, { primary: "account-row", fallback: "account-row", rail: "account-row" });
  assert.equal(migrated.profiles[0].showPace, false);
  assert.equal(migrated.profiles[0].showRunway, false);
});

test("schema-nine layouts gain the localized module without moving existing modules", () => {
  const oldOrder = ["value", "avatar", "seconds", "name", "countdown", "date", "dot", "reset", "label"];
  const migrated = sanitizeConfig({
    version: 9,
    activeProfile: "old",
    profiles: [{
      ...DEFAULT_CONFIG.profiles[0],
      id: "old",
      moduleOrder: oldOrder,
      moduleAnchors: { avatar: .11, name: .22, dot: .33, value: .44, label: .55, countdown: .66, seconds: .77, date: .88, reset: .99 },
    }],
  });
  const profile = migrated.profiles[0];
  assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
  assert.deepEqual(profile.moduleOrder, ["value", "pace", "runway", "todayTokens", "lifetimeTokens", "avatar", "seconds", "name", "countdown", "relative", "date", "dot", "reset", "label"]);
  assert.equal(profile.showRelative, false);
  assert.equal(profile.moduleAnchors.relative, DEFAULT_MODULE_ANCHORS.relative);
  assert.deepEqual(oldOrder, profile.moduleOrder.filter((module) => !["relative", "todayTokens", "lifetimeTokens", "pace", "runway"].includes(module)));
});

test("version-six module layouts gain new modules without losing their order", () => {
  const migrated = sanitizeConfig({
    version: 6,
    activeProfile: "old",
    profiles: [{
      ...DEFAULT_CONFIG.profiles[0],
      id: "old",
      moduleOrder: ["value", "avatar", "name", "dot", "label", "reset", "countdown"],
      moduleAnchors: { avatar: 0.1, name: 0.2, dot: 0.3, value: 0.4, label: 0.5, countdown: 0.6, reset: 0.7 },
    }],
  });
  const profile = migrated.profiles[0];
  assert.deepEqual(profile.moduleOrder, ["value", "pace", "runway", "todayTokens", "lifetimeTokens", "avatar", "name", "dot", "label", "date", "reset", "countdown", "relative", "seconds"]);
  assert.equal(profile.showSeconds, false);
  assert.equal(profile.showDate, false);
  assert.equal(profile.moduleAnchors.value, 0.4);
  assert.equal(profile.moduleAnchors.countdown, 0.6);
});

test("advanced configuration can replace a sanitized document and reset one view", () => {
  const replaced = applyConfigAction(DEFAULT_CONFIG, {
    type: "replaceConfig",
    config: {
      ...DEFAULT_CONFIG,
      activeProfile: "glance",
      profiles: [{ ...DEFAULT_CONFIG.profiles[0], template: "{remaining}% / {countdown}", warning: "ignored" }],
      thresholds: { warning: 22, critical: 9 },
    },
  });
  assert.equal(replaced.profiles[0].template, "{remaining}% / {countdown}");
  assert.deepEqual(replaced.thresholds, { warning: 22, critical: 9 });
  assert.equal("warning" in replaced.profiles[0], false);

  const reset = applyConfigAction(replaced, { type: "resetProfile", id: "glance" });
  assert.equal(reset.profiles[0].template, DEFAULT_CONFIG.profiles[0].template);
  assert.deepEqual(reset.thresholds, replaced.thresholds);
});
