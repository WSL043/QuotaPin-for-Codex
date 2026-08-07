import fs from "node:fs";
import path from "node:path";

export const MAX_PROFILES = 8;
export const WINDOW_SELECTIONS = ["auto", "shortest", "longest", "all"];
export const LAYOUT_MODULES = ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"];
export const DEFAULT_MODULE_ORDER = [...LAYOUT_MODULES];
export const LAYOUT_MODES = ["auto", "free"];
export const SNAP_TARGETS = ["edges", "center", "modules"];
export const DISPLAY_MODES = ["modules", "template"];
export const AVATAR_SHAPES = ["native", "rounded", "square"];
const LEGACY_BADGE_POSITIONS = ["right", "afterIdentity", "left", "free"];
export const IDENTITY_MODES = ["show", "hideName", "hideAvatar", "quotaOnly"];
export const VALUE_COLOR_MODES = ["severity", "accent", "muted"];
export const DOT_COLOR_MODES = ["severity", "match", "accent", "muted"];
export const IDENTITY_COLOR_MODES = ["inherit", "severity", "match", "accent", "muted"];
export const EFFECTS = ["none", "pulse", "blink", "rainbow"];
export const EFFECT_TARGETS = ["dot", "value", "both"];
export const EFFECT_LEVELS = ["always", "warning", "critical"];
export const OVERDRIVE_EFFECTS = ["menuFire"];
export const SUPPORTED_LOCALES = ["en", "zh-CN", "ja"];
export const PANEL_THEMES = ["dark", "light"];
export const ACCOUNT_ROW_MODES = ["legacy", "beta"];
export const CURRENT_CONFIG_VERSION = 16;

export const DEFAULT_MODULE_ANCHORS = Object.freeze({
  avatar: 0.04,
  name: 0.04,
  dot: 0.96,
  value: 0.96,
  todayTokens: 0.96,
  lifetimeTokens: 0.96,
  label: 0.96,
  countdown: 0.96,
  relative: 0.96,
  seconds: 0.96,
  date: 0.96,
  reset: 0.96,
});
const PREVIOUS_DEFAULT_MODULE_ANCHORS = Object.freeze({
  avatar: 0.04, name: 0.18, dot: 0.96, value: 0.96, todayTokens: 0.96, lifetimeTokens: 0.96, label: 0.96,
  countdown: 0.96, relative: 0.96, seconds: 0.96, date: 0.96, reset: 0.96,
});
const VERSION_12_DEFAULT_MODULE_ORDER = ["avatar", "name", "dot", "value", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset"];
const LEGACY_AUTO_MODULE_ORDER = ["avatar", "name", "dot", "value", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset"];
const LEGACY_AUTO_MODULE_ANCHORS = Object.freeze({
  avatar: 0.06, name: 0.29, dot: 0.50, value: 0.59, todayTokens: 0.59, lifetimeTokens: 0.59, label: 0.69,
  countdown: 0.75, relative: 0.96, seconds: 0.83, date: 0.89, reset: 0.95,
});

const configLoadStates = new Map();
const readOnlyConfigPaths = new Set();
const LEGACY_BUILTIN_HOVER_TEMPLATE = "{label}: {remaining}% left · resets {reset} ({countdown})";
const PREVIOUS_BUILTIN_HOVER_TEMPLATE = "{remaining}% left · resets {reset} ({countdown})";
const RECENT_BUILTIN_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({reset})";
const BUILTIN_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({date}, {reset})";

const DEFAULT_PROFILES = [
  {
    id: "glance",
    name: "Glance",
    template: "{remaining}%",
    hoverTemplate: BUILTIN_HOVER_TEMPLATE,
    window: "auto",
    separator: " · ",
    displayMode: "modules",
    showValue: true,
    showDot: false,
    showBar: false,
    showLabel: false,
    showCountdown: false,
    showRelative: false,
    showSeconds: false,
    showDate: false,
    showReset: false,
    showTodayTokens: false,
    showLifetimeTokens: false,
    valueColor: "severity",
    dotColor: "severity",
    identityColor: "inherit",
    moduleOrder: DEFAULT_MODULE_ORDER,
    layoutMode: "auto",
    snapThreshold: 16,
    snapTargets: SNAP_TARGETS,
    moduleAnchors: DEFAULT_MODULE_ANCHORS,
    identity: "show",
    avatarShape: "native",
    fontSize: 14,
    effect: "none",
    effectTarget: "dot",
    effectAt: "critical",
  },
  {
    id: "countdown",
    name: "Countdown",
    template: "{remaining}% · {countdown}",
    hoverTemplate: BUILTIN_HOVER_TEMPLATE,
    window: "auto",
    separator: " · ",
    displayMode: "modules",
    showValue: true,
    showDot: false,
    showBar: false,
    showLabel: false,
    showCountdown: true,
    showRelative: false,
    showSeconds: false,
    showDate: false,
    showReset: false,
    showTodayTokens: false,
    showLifetimeTokens: false,
    valueColor: "severity",
    dotColor: "severity",
    identityColor: "inherit",
    moduleOrder: DEFAULT_MODULE_ORDER,
    layoutMode: "auto",
    snapThreshold: 16,
    snapTargets: SNAP_TARGETS,
    moduleAnchors: DEFAULT_MODULE_ANCHORS,
    identity: "show",
    avatarShape: "native",
    fontSize: 14,
    effect: "none",
    effectTarget: "dot",
    effectAt: "critical",
  },
  {
    id: "reset",
    name: "Reset time",
    template: "{remaining}% · {reset}",
    hoverTemplate: BUILTIN_HOVER_TEMPLATE,
    window: "auto",
    separator: " · ",
    displayMode: "modules",
    showValue: true,
    showDot: false,
    showBar: false,
    showLabel: false,
    showCountdown: false,
    showRelative: false,
    showSeconds: false,
    showDate: false,
    showReset: true,
    showTodayTokens: false,
    showLifetimeTokens: false,
    valueColor: "severity",
    dotColor: "severity",
    identityColor: "inherit",
    moduleOrder: DEFAULT_MODULE_ORDER,
    layoutMode: "auto",
    snapThreshold: 16,
    snapTargets: SNAP_TARGETS,
    moduleAnchors: DEFAULT_MODULE_ANCHORS,
    identity: "show",
    avatarShape: "native",
    fontSize: 14,
    effect: "none",
    effectTarget: "dot",
    effectAt: "critical",
  },
];

export const DEFAULT_CONFIG = Object.freeze({
  version: CURRENT_CONFIG_VERSION,
  locale: "en",
  panelTheme: "dark",
  accountRowMode: "legacy",
  activeProfile: "glance",
  profiles: DEFAULT_PROFILES,
  thresholds: {
    warning: 30,
    critical: 10,
  },
  palette: {
    critical: "#f87171",
    warning: "#fbbf24",
    accent: "#6ee7b7",
  },
  experiments: {
    overdriveEgg: false,
    overdriveAlways: false,
    overdriveEffect: "menuFire",
  },
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value));
const QUOTA_MODULES = ["dot", "value", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset"];
const VERSION_11_LAYOUT_MODULES = ["avatar", "name", "dot", "value", "label", "countdown", "relative", "seconds", "date", "reset"];
const VERSION_9_LAYOUT_MODULES = ["avatar", "name", "dot", "value", "label", "countdown", "seconds", "date", "reset"];
const VERSION_6_LAYOUT_MODULES = ["avatar", "name", "dot", "value", "label", "countdown", "reset"];
const VERSION_7_PREVIEW_LAYOUT_MODULES = ["avatar", "name", "dot", "value", "label", "countdown", "date", "reset"];

function numberInRange(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.round(parsed) : fallback;
}

function cleanText(value, fallback, maximum) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function cleanSnapTargets(value, fallback = SNAP_TARGETS) {
  if (!Array.isArray(value)) return [...fallback];
  const requested = new Set(value.map(String));
  return SNAP_TARGETS.filter((target) => requested.has(target));
}

function cleanHoverTemplate(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  if ([LEGACY_BUILTIN_HOVER_TEMPLATE, PREVIOUS_BUILTIN_HOVER_TEMPLATE, RECENT_BUILTIN_HOVER_TEMPLATE].includes(value)) return BUILTIN_HOVER_TEMPLATE;
  return value.slice(0, 180);
}

function cleanWindow(value, fallback = "auto") {
  return WINDOW_SELECTIONS.includes(value) || /^duration:\d+$/.test(String(value)) ? String(value) : fallback;
}

function cleanColorMode(value, choices, fallback) {
  return choices.includes(value) || isHexColor(value) ? String(value).toLowerCase() : fallback;
}

function cleanId(value, fallback) {
  const id = String(value ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return id || fallback;
}

function legacyModuleOrder(source = {}) {
  if (source.position === "left") return [...QUOTA_MODULES, "avatar", "name"];
  if (source.position === "free") {
    const x = Number(source.freeX);
    if (Number.isFinite(x) && x <= 33) return [...QUOTA_MODULES, "avatar", "name"];
    if (Number.isFinite(x) && x <= 66) return ["avatar", ...QUOTA_MODULES, "name"];
  }
  return ["avatar", "name", ...QUOTA_MODULES];
}

function expandLegacyModuleOrder(value) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length !== 3 || new Set(order).size !== 3 || !["avatar", "name", "quota"].every((module) => order.includes(module))) return null;
  return order.flatMap((module) => module === "quota" ? QUOTA_MODULES : [module]);
}

function expandVersion6ModuleOrder(value) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length !== VERSION_6_LAYOUT_MODULES.length
    || new Set(order).size !== VERSION_6_LAYOUT_MODULES.length
    || !VERSION_6_LAYOUT_MODULES.every((module) => order.includes(module))) return null;
  const expanded = [...order];
  expanded.splice(expanded.indexOf("countdown") + 1, 0, "seconds");
  expanded.splice(expanded.indexOf("reset"), 0, "date");
  expanded.splice(expanded.indexOf("countdown") + 1, 0, "relative");
  return expanded;
}

function expandVersion7PreviewModuleOrder(value) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length !== VERSION_7_PREVIEW_LAYOUT_MODULES.length
    || new Set(order).size !== VERSION_7_PREVIEW_LAYOUT_MODULES.length
    || !VERSION_7_PREVIEW_LAYOUT_MODULES.every((module) => order.includes(module))) return null;
  const countdownIndex = order.indexOf("countdown");
  const expanded = [...order];
  expanded.splice(countdownIndex + 1, 0, "seconds");
  expanded.splice(expanded.indexOf("countdown") + 1, 0, "relative");
  return expanded;
}

function expandVersion9ModuleOrder(value) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length !== VERSION_9_LAYOUT_MODULES.length
    || new Set(order).size !== VERSION_9_LAYOUT_MODULES.length
    || !VERSION_9_LAYOUT_MODULES.every((module) => order.includes(module))) return null;
  const expanded = [...order];
  expanded.splice(expanded.indexOf("countdown") + 1, 0, "relative");
  return expanded;
}

function expandVersion11ModuleOrder(value) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length !== VERSION_11_LAYOUT_MODULES.length
    || new Set(order).size !== VERSION_11_LAYOUT_MODULES.length
    || !VERSION_11_LAYOUT_MODULES.every((module) => order.includes(module))) return null;
  const expanded = [...order];
  expanded.splice(expanded.indexOf("value") + 1, 0, "todayTokens", "lifetimeTokens");
  return expanded;
}

function withProfileUsageModules(order) {
  return expandVersion11ModuleOrder(order) ?? order;
}

function cleanModuleOrder(value, fallback, legacySource) {
  const order = Array.isArray(value) ? value.map(String) : [];
  if (order.length === LAYOUT_MODULES.length && new Set(order).size === LAYOUT_MODULES.length && LAYOUT_MODULES.every((module) => order.includes(module))) return order;
  const version11Upgraded = expandVersion11ModuleOrder(order);
  if (version11Upgraded) return version11Upgraded;
  const version9Upgraded = expandVersion9ModuleOrder(order);
  if (version9Upgraded) return withProfileUsageModules(version9Upgraded);
  const previewUpgraded = expandVersion7PreviewModuleOrder(order);
  if (previewUpgraded) return withProfileUsageModules(previewUpgraded);
  const upgraded = expandVersion6ModuleOrder(order);
  if (upgraded) return withProfileUsageModules(upgraded);
  const expanded = expandLegacyModuleOrder(order);
  if (expanded) return expanded;
  if (legacySource && LEGACY_BADGE_POSITIONS.includes(legacySource.position)) return legacyModuleOrder(legacySource);
  return expandVersion11ModuleOrder(fallback)
    ?? withProfileUsageModules(expandVersion9ModuleOrder(fallback))
    ?? withProfileUsageModules(expandVersion7PreviewModuleOrder(fallback))
    ?? withProfileUsageModules(expandVersion6ModuleOrder(fallback))
    ?? expandLegacyModuleOrder(fallback)
    ?? (Array.isArray(fallback) ? [...fallback] : [...LAYOUT_MODULES]);
}

function legacyTemplate(display = {}) {
  if (display.preset === "custom") return cleanText(display.customTemplate, "{remaining}%", 120);
  if (display.preset === "countdown") return "{label} {remaining}% · {countdown}";
  if (display.preset === "resetTime") return "{label} {remaining}% · {reset}";
  if (display.preset === "windowPercent") return "{label} {remaining}%";
  return "{remaining}%";
}

function cleanModuleAnchors(value, fallback = DEFAULT_MODULE_ANCHORS) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_MODULE_ANCHORS;
  return Object.fromEntries(LAYOUT_MODULES.map((module) => {
    const requested = Number(source[module]);
    const inherited = Number(base[module]);
    const anchor = Number.isFinite(requested)
      ? requested
      : Number.isFinite(inherited)
        ? inherited
        : DEFAULT_MODULE_ANCHORS[module];
    return [module, Math.round(Math.max(0, Math.min(1, anchor)) * 10_000) / 10_000];
  }));
}

function sameModuleOrder(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((module, index) => module === right[index]);
}

function sameModuleAnchors(left, right) {
  return LAYOUT_MODULES.every((module) => Math.abs(Number(left?.[module]) - Number(right?.[module])) < 0.0001);
}

function standardModuleTemplate(template) {
  const normalized = String(template ?? "").trim().replace(/\s+/g, " ");
  const standards = new Map([
    ["{remaining}%", { showLabel: false, showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: false }],
    ["{label} {remaining}%", { showLabel: true, showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: false }],
    ["{remaining}% · {countdown}", { showLabel: false, showCountdown: true, showRelative: false, showSeconds: false, showDate: false, showReset: false }],
    ["{label} {remaining}% · {countdown}", { showLabel: true, showCountdown: true, showRelative: false, showSeconds: false, showDate: false, showReset: false }],
    ["{remaining}% · {seconds}", { showLabel: false, showCountdown: false, showRelative: false, showSeconds: true, showDate: false, showReset: false }],
    ["{label} {remaining}% · {seconds}", { showLabel: true, showCountdown: false, showRelative: false, showSeconds: true, showDate: false, showReset: false }],
    ["{remaining}% · {date}", { showLabel: false, showCountdown: false, showRelative: false, showSeconds: false, showDate: true, showReset: false }],
    ["{label} {remaining}% · {date}", { showLabel: true, showCountdown: false, showRelative: false, showSeconds: false, showDate: true, showReset: false }],
    ["{remaining}% · {reset}", { showLabel: false, showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: true }],
    ["{label} {remaining}% · {reset}", { showLabel: true, showCountdown: false, showRelative: false, showSeconds: false, showDate: false, showReset: true }],
  ]);
  return standards.get(normalized) ?? null;
}

function displaySettings(source, base, sourceVersion) {
  const template = cleanText(source.template, base.template ?? "{remaining}%", 120);
  const standard = standardModuleTemplate(template);
  const explicitMode = DISPLAY_MODES.includes(source.displayMode) ? source.displayMode : null;
  const trustExplicitMode = Number(sourceVersion) >= 5;
  const displayMode = trustExplicitMode && explicitMode ? explicitMode : (standard ? "modules" : "template");
  const tokenDefaults = standard ?? {
    showLabel: template.includes("{label}"),
    showCountdown: template.includes("{countdown}"),
    showRelative: template.includes("{relative}"),
    showSeconds: template.includes("{seconds}"),
    showDate: template.includes("{date}"),
    showReset: template.includes("{reset}"),
  };
  return {
    template,
    displayMode,
    showLabel: typeof source.showLabel === "boolean" ? source.showLabel : tokenDefaults.showLabel,
    showCountdown: typeof source.showCountdown === "boolean" ? source.showCountdown : tokenDefaults.showCountdown,
    showRelative: typeof source.showRelative === "boolean" ? source.showRelative : tokenDefaults.showRelative,
    showSeconds: typeof source.showSeconds === "boolean" ? source.showSeconds : tokenDefaults.showSeconds,
    showDate: typeof source.showDate === "boolean" ? source.showDate : tokenDefaults.showDate,
    showReset: typeof source.showReset === "boolean" ? source.showReset : tokenDefaults.showReset,
    showTodayTokens: typeof source.showTodayTokens === "boolean" ? source.showTodayTokens : false,
    showLifetimeTokens: typeof source.showLifetimeTokens === "boolean" ? source.showLifetimeTokens : false,
  };
}

function migrateLegacy(input) {
  const display = input?.display ?? {};
  const layout = input?.layout ?? {};
  const first = {
    ...DEFAULT_PROFILES[0],
    id: "glance",
    name: display.preset === "custom" ? "My view" : "Glance",
    template: legacyTemplate(display),
    hoverTemplate: BUILTIN_HOVER_TEMPLATE,
    window: cleanWindow(display.window),
    separator: typeof display.separator === "string" && display.separator.length <= 8 ? display.separator : " · ",
    showDot: display.showDot !== false,
    moduleOrder: cleanModuleOrder(layout.moduleOrder, DEFAULT_PROFILES[0].moduleOrder, layout),
    identity: IDENTITY_MODES.includes(layout.identity) ? layout.identity : "show",
    effect: "pulse",
    effectTarget: "dot",
    effectAt: "critical",
  };
  const profiles = [first];
  for (const candidate of DEFAULT_PROFILES.slice(1)) {
    if (!profiles.some((profile) => profile.template === candidate.template)) profiles.push(clone(candidate));
  }
  return profiles;
}

function sanitizeProfile(input, fallback, index, usedIds, sourceVersion) {
  const source = input && typeof input === "object" ? input : {};
  const base = fallback ?? DEFAULT_PROFILES[0];
  let id = cleanId(source.id, base.id ?? `view-${index + 1}`);
  if (usedIds.has(id)) {
    const root = id;
    let suffix = 2;
    while (usedIds.has(`${root}-${suffix}`)) suffix += 1;
    id = `${root}-${suffix}`;
  }
  usedIds.add(id);
  const showValue = typeof source.showValue === "boolean" ? source.showValue : (base.showValue ?? true);
  const showDot = typeof source.showDot === "boolean" ? source.showDot : (base.showDot ?? true);
  const showBar = Number(sourceVersion) >= 9 && typeof source.showBar === "boolean" ? source.showBar : false;
  const display = displaySettings(source, base, sourceVersion);
  let moduleOrder = cleanModuleOrder(source.moduleOrder, base.moduleOrder, source);
  if (Number(sourceVersion) < 5 && display.displayMode === "modules" && /^\s*\{label\}/.test(display.template)) {
    moduleOrder = moduleOrder.filter((module) => module !== "label");
    moduleOrder.splice(Math.max(0, moduleOrder.indexOf("value")), 0, "label");
  }
  const layoutMode = LAYOUT_MODES.includes(source.layoutMode) ? source.layoutMode : (base.layoutMode ?? "auto");
  const snapThreshold = numberInRange(source.snapThreshold, base.snapThreshold ?? 16, 0, 48);
  const snapTargets = cleanSnapTargets(source.snapTargets, base.snapTargets ?? SNAP_TARGETS);
  let moduleAnchors = cleanModuleAnchors(source.moduleAnchors, base.moduleAnchors);
  // Auto used to ignore anchors and insert one hard-coded identity/quota gap.
  // Migrate only that untouched legacy tuple; custom positions remain intact.
  if (layoutMode === "auto"
    && sameModuleOrder(moduleOrder, LEGACY_AUTO_MODULE_ORDER)
    && sameModuleAnchors(moduleAnchors, LEGACY_AUTO_MODULE_ANCHORS)) {
    moduleOrder = [...DEFAULT_MODULE_ORDER];
    moduleAnchors = { ...DEFAULT_MODULE_ANCHORS };
  }
  // Migrate only the known default tuple that scales the identity gap with a
  // wide sidebar. Custom placements remain exact.
  if (layoutMode === "auto"
    && sameModuleOrder(moduleOrder, DEFAULT_MODULE_ORDER)
    && sameModuleAnchors(moduleAnchors, PREVIOUS_DEFAULT_MODULE_ANCHORS)) {
    moduleAnchors = { ...DEFAULT_MODULE_ANCHORS };
  }
  if (Number(sourceVersion) < 13
    && sameModuleOrder(moduleOrder, VERSION_12_DEFAULT_MODULE_ORDER)
    && sameModuleAnchors(moduleAnchors, DEFAULT_MODULE_ANCHORS)) {
    moduleOrder = [...DEFAULT_MODULE_ORDER];
  }
  return {
    id,
    name: cleanText(source.name, base.name ?? `View ${index + 1}`, 24),
    template: display.template,
    hoverTemplate: cleanHoverTemplate(source.hoverTemplate, base.hoverTemplate ?? ""),
    window: cleanWindow(source.window, base.window ?? "auto"),
    separator: typeof source.separator === "string" && source.separator.length <= 8 ? source.separator : (base.separator ?? " · "),
    displayMode: display.displayMode,
    showValue,
    showDot,
    showBar,
    showLabel: display.showLabel,
    showCountdown: display.showCountdown,
    showRelative: display.showRelative,
    showSeconds: display.showSeconds,
    showDate: display.showDate,
    showReset: display.showReset,
    showTodayTokens: display.showTodayTokens,
    showLifetimeTokens: display.showLifetimeTokens,
    valueColor: cleanColorMode(source.valueColor, VALUE_COLOR_MODES, base.valueColor ?? "severity"),
    dotColor: cleanColorMode(source.dotColor, DOT_COLOR_MODES, base.dotColor ?? "severity"),
    identityColor: cleanColorMode(source.identityColor, IDENTITY_COLOR_MODES, base.identityColor ?? "inherit"),
    moduleOrder,
    layoutMode,
    snapThreshold,
    snapTargets,
    moduleAnchors,
    identity: IDENTITY_MODES.includes(source.identity) ? source.identity : (base.identity ?? "show"),
    avatarShape: AVATAR_SHAPES.includes(source.avatarShape) ? source.avatarShape : (base.avatarShape ?? "native"),
    fontSize: numberInRange(source.fontSize, base.fontSize ?? 14, 9, 18),
    effect: EFFECTS.includes(source.effect) ? source.effect : (base.effect ?? "none"),
    effectTarget: EFFECT_TARGETS.includes(source.effectTarget) ? source.effectTarget : (base.effectTarget ?? "dot"),
    effectAt: EFFECT_LEVELS.includes(source.effectAt) ? source.effectAt : (base.effectAt ?? "critical"),
  };
}

export function sanitizeConfig(input = {}) {
  const sourceVersion = Number(input?.version);
  const legacy = input?.version === 1 || (!Array.isArray(input?.profiles) && input?.display);
  const trustHiddenSettings = sourceVersion >= 3 && sourceVersion <= CURRENT_CONFIG_VERSION;
  const rawProfiles = legacy
    ? migrateLegacy(input)
    : Array.isArray(input?.profiles) && input.profiles.length
      ? input.profiles.slice(0, MAX_PROFILES)
      : clone(DEFAULT_PROFILES);
  const usedIds = new Set();
  const profiles = rawProfiles.map((profile, index) => sanitizeProfile(profile, DEFAULT_PROFILES[index] ?? DEFAULT_PROFILES[0], index, usedIds, sourceVersion));
  const requestedActive = String(input?.activeProfile ?? profiles[0].id);
  const activeProfile = profiles.some((profile) => profile.id === requestedActive) ? requestedActive : profiles[0].id;
  const legacyExperimentProfile = rawProfiles.find((profile) => String(profile?.id) === requestedActive) ?? rawProfiles[0] ?? {};
  const experimentSource = trustHiddenSettings
    ? (input?.experiments && typeof input.experiments === "object" ? input.experiments : legacyExperimentProfile)
    : {};
  const thresholds = input?.thresholds ?? {};
  const critical = numberInRange(thresholds.critical, legacy ? 20 : DEFAULT_CONFIG.thresholds.critical, 0, 100);
  const warningFallback = Math.max(critical, legacy ? 40 : DEFAULT_CONFIG.thresholds.warning);
  const warning = numberInRange(thresholds.warning, warningFallback, critical, 100);
  const palette = input?.palette ?? {};
  return {
    version: CURRENT_CONFIG_VERSION,
    locale: SUPPORTED_LOCALES.includes(input?.locale) ? input.locale : DEFAULT_CONFIG.locale,
    panelTheme: PANEL_THEMES.includes(input?.panelTheme) ? input.panelTheme : DEFAULT_CONFIG.panelTheme,
    accountRowMode: ACCOUNT_ROW_MODES.includes(input?.accountRowMode) ? input.accountRowMode : DEFAULT_CONFIG.accountRowMode,
    activeProfile,
    profiles,
    thresholds: { warning, critical },
    palette: {
      critical: isHexColor(palette.critical) ? palette.critical.toLowerCase() : DEFAULT_CONFIG.palette.critical,
      warning: isHexColor(palette.warning) ? palette.warning.toLowerCase() : DEFAULT_CONFIG.palette.warning,
      accent: isHexColor(palette.accent) ? palette.accent.toLowerCase() : DEFAULT_CONFIG.palette.accent,
    },
    experiments: {
      overdriveEgg: experimentSource.overdriveEgg === true,
      overdriveAlways: experimentSource.overdriveAlways === true,
      // Retired and unknown values converge on the supported visual so older
      // saved settings continue to render without a dead selection.
      overdriveEffect: OVERDRIVE_EFFECTS.includes(experimentSource.overdriveEffect) ? experimentSource.overdriveEffect : "menuFire",
    },
  };
}

export function activeProfile(config) {
  const safe = sanitizeConfig(config);
  return safe.profiles.find((profile) => profile.id === safe.activeProfile) ?? safe.profiles[0];
}

export function applyConfigAction(config, action = {}) {
  const current = sanitizeConfig(config);
  if (!action || typeof action !== "object") return current;
  if (action.type === "selectProfile") {
    return sanitizeConfig({ ...current, activeProfile: action.id });
  }
  if (action.type === "updateLocale") {
    return sanitizeConfig({ ...current, locale: action.locale });
  }
  if (action.type === "updatePanelTheme") {
    return sanitizeConfig({ ...current, panelTheme: action.theme });
  }
  if (action.type === "updateAccountRowMode") {
    return sanitizeConfig({ ...current, accountRowMode: action.mode });
  }
  if (action.type === "updateProfile") {
    const patch = action.patch && typeof action.patch === "object" ? { ...action.patch } : {};
    if (Object.hasOwn(patch, "template") && !Object.hasOwn(patch, "displayMode")) {
      const standard = standardModuleTemplate(patch.template);
      patch.displayMode = standard ? "modules" : "template";
      if (standard) {
        if (!Object.hasOwn(patch, "showLabel")) patch.showLabel = standard.showLabel;
        if (!Object.hasOwn(patch, "showCountdown")) patch.showCountdown = standard.showCountdown;
        if (!Object.hasOwn(patch, "showRelative")) patch.showRelative = standard.showRelative;
        if (!Object.hasOwn(patch, "showSeconds")) patch.showSeconds = standard.showSeconds;
        if (!Object.hasOwn(patch, "showDate")) patch.showDate = standard.showDate;
        if (!Object.hasOwn(patch, "showReset")) patch.showReset = standard.showReset;
      }
    }
    return sanitizeConfig({
      ...current,
      profiles: current.profiles.map((profile) => profile.id === action.id ? { ...profile, ...patch, id: profile.id } : profile),
    });
  }
  if (action.type === "resetProfile") {
    return sanitizeConfig({
      ...current,
      profiles: current.profiles.map((profile) => {
        if (profile.id !== action.id) return profile;
        const factory = DEFAULT_PROFILES.find((candidate) => candidate.id === profile.id) ?? DEFAULT_PROFILES[0];
        return { ...clone(factory), id: profile.id, name: factory.id === profile.id ? factory.name : profile.name };
      }),
    });
  }
  if (action.type === "replaceConfig") {
    return sanitizeConfig(action.config);
  }
  if (action.type === "addProfile" && current.profiles.length < MAX_PROFILES) {
    const source = current.profiles.find((profile) => profile.id === action.fromId) ?? activeProfile(current);
    const id = cleanId(action.id, `view-${current.profiles.length + 1}`);
    const added = { ...source, id, name: cleanText(action.name, `View ${current.profiles.length + 1}`, 24) };
    return sanitizeConfig({ ...current, activeProfile: id, profiles: [...current.profiles, added] });
  }
  if (action.type === "deleteProfile" && current.profiles.length > 1) {
    const index = current.profiles.findIndex((profile) => profile.id === action.id);
    if (index < 0) return current;
    const profiles = current.profiles.filter((profile) => profile.id !== action.id);
    const activeProfileId = current.activeProfile === action.id ? profiles[Math.max(0, index - 1)].id : current.activeProfile;
    return sanitizeConfig({ ...current, activeProfile: activeProfileId, profiles });
  }
  if (action.type === "updateThresholds") {
    const patch = action.patch ?? {};
    let critical = numberInRange(patch.critical, current.thresholds.critical, 0, 100);
    let warning = numberInRange(patch.warning, current.thresholds.warning, 0, 100);
    if (Object.hasOwn(patch, "critical") && critical > warning) warning = critical;
    if (Object.hasOwn(patch, "warning") && warning < critical) critical = warning;
    return sanitizeConfig({ ...current, thresholds: { warning, critical } });
  }
  if (action.type === "updatePalette") {
    return sanitizeConfig({ ...current, palette: { ...current.palette, ...(action.patch ?? {}) } });
  }
  if (action.type === "updateExperiments") {
    return sanitizeConfig({ ...current, experiments: { ...current.experiments, ...(action.patch ?? {}) } });
  }
  return current;
}

function normalizedConfigPath(configPath) {
  return configPath ? path.resolve(configPath) : "";
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function setConfigLoadState(configPath, state) {
  const key = normalizedConfigPath(configPath);
  if (key) configLoadStates.set(key, Object.freeze({ ...state }));
  return state;
}

export class ConfigReadOnlyError extends Error {
  constructor(configPath, reason = "unsupported-version") {
    super(`QuotaPin configuration is read-only (${reason}): ${configPath}`);
    this.name = "ConfigReadOnlyError";
    this.code = "QUOTAPIN_CONFIG_READ_ONLY";
    this.configPath = configPath;
    this.reason = reason;
  }
}

export function getConfigLoadState(configPath) {
  return configLoadStates.get(normalizedConfigPath(configPath)) ?? Object.freeze({ status: "unknown" });
}

export function loadConfigResult(configPath) {
  const key = normalizedConfigPath(configPath);
  if (!key || !fs.existsSync(key)) {
    if (key) readOnlyConfigPaths.delete(key);
    const state = setConfigLoadState(key, { status: "missing", readOnly: false });
    return { config: sanitizeConfig(), ...state };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(key, "utf8"));
  } catch (error) {
    const corruptPath = `${key}.corrupt-${timestampForFile()}`;
    try {
      fs.renameSync(key, corruptPath);
      readOnlyConfigPaths.delete(key);
      const state = setConfigLoadState(key, {
        status: "recovered-corrupt",
        readOnly: false,
        backupPath: corruptPath,
        message: String(error?.message ?? error),
      });
      return { config: sanitizeConfig(), ...state };
    } catch (preserveError) {
      readOnlyConfigPaths.add(key);
      const state = setConfigLoadState(key, {
        status: "corrupt-read-only",
        readOnly: true,
        message: String(error?.message ?? error),
        preserveError: String(preserveError?.message ?? preserveError),
      });
      return { config: sanitizeConfig(), ...state };
    }
  }

  const sourceVersion = Number(raw?.version);
  if (Number.isFinite(sourceVersion) && sourceVersion > CURRENT_CONFIG_VERSION) {
    readOnlyConfigPaths.add(key);
    const state = setConfigLoadState(key, {
      status: "future-version",
      readOnly: true,
      sourceVersion,
      supportedVersion: CURRENT_CONFIG_VERSION,
    });
    return { config: sanitizeConfig(raw), ...state };
  }

  readOnlyConfigPaths.delete(key);
  const config = sanitizeConfig(raw);
  if (!Number.isFinite(sourceVersion) || sourceVersion < CURRENT_CONFIG_VERSION) {
    try {
      saveConfig(key, config);
      const previousPath = `${key}.previous`;
      const state = setConfigLoadState(key, {
        status: "migrated",
        readOnly: false,
        sourceVersion: Number.isFinite(sourceVersion) ? sourceVersion : null,
        supportedVersion: CURRENT_CONFIG_VERSION,
        previousPath: fs.existsSync(previousPath) ? previousPath : null,
      });
      return { config, ...state };
    } catch (error) {
      const state = setConfigLoadState(key, {
        status: "migration-pending",
        readOnly: false,
        sourceVersion: Number.isFinite(sourceVersion) ? sourceVersion : null,
        supportedVersion: CURRENT_CONFIG_VERSION,
        message: String(error?.message ?? error),
      });
      return { config, ...state };
    }
  }
  const state = setConfigLoadState(key, { status: "ready", readOnly: false, sourceVersion: Number.isFinite(sourceVersion) ? sourceVersion : null });
  return { config, ...state };
}

export function loadConfig(configPath) {
  return loadConfigResult(configPath).config;
}

export function saveConfig(configPath, config, options = {}) {
  if (!configPath) return sanitizeConfig(config);
  const key = normalizedConfigPath(configPath);
  if (readOnlyConfigPaths.has(key) && options.allowReadOnlyOverwrite !== true) {
    const state = getConfigLoadState(key);
    throw new ConfigReadOnlyError(key, state.status);
  }
  const safe = sanitizeConfig(config);
  fs.mkdirSync(path.dirname(key), { recursive: true });
  const temporary = `${key}.${process.pid}.${Date.now()}.tmp`;
  const previous = `${key}.previous`;
  fs.writeFileSync(temporary, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  const handle = fs.openSync(temporary, "r+");
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    if (fs.existsSync(key)) fs.copyFileSync(key, previous);
    fs.renameSync(temporary, key);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  readOnlyConfigPaths.delete(key);
  setConfigLoadState(key, { status: "ready", readOnly: false, sourceVersion: CURRENT_CONFIG_VERSION, previousPath: fs.existsSync(previous) ? previous : null });
  return safe;
}
