import { activeProfile } from "./config.mjs";

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value))));
const PREVIOUS_DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets {reset} ({countdown})";
const RECENT_DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({reset})";
const DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({date}, {reset})";

function localizedDefaultHover(locale, includeLabel = false) {
  const language = String(locale ?? "").toLowerCase();
  const body = language.startsWith("zh")
    ? "剩余 {remaining}% · {countdown} 后重置（{date}，{reset}）"
    : language.startsWith("ja")
      ? "残り {remaining}% · リセットまで {countdown}（{date}、{reset}）"
      : DEFAULT_HOVER_TEMPLATE;
  if (!includeLabel) return body;
  return language.startsWith("zh") || language.startsWith("ja") ? `{label}：${body}` : `{label}: ${body}`;
}

function waitingTooltip(locale) {
  const language = String(locale ?? "").toLowerCase();
  if (language.startsWith("zh")) return "QuotaPin 正在等待 Codex 返回额度数据";
  if (language.startsWith("ja")) return "QuotaPin は Codex の上限データを待っています";
  return "QuotaPin is waiting for Codex rate-limit data";
}

export function selectWindows(windows, selection = "auto") {
  const available = Array.isArray(windows) ? windows : [];
  if (selection === "shortest") return available.slice(0, 1);
  if (selection === "longest") return available.slice(-1);
  if (selection.startsWith("duration:")) {
    const duration = Number(selection.slice("duration:".length));
    const match = available.find((item) => item.windowDurationMins === duration);
    return match ? [match] : available;
  }
  return available;
}

export function formatRemainingTime(resetsAt, now = Date.now(), locale = "en") {
  const language = String(locale ?? "").toLowerCase();
  const terminal = language.startsWith("zh")
    ? { unknown: "未知", now: "现在" }
    : language.startsWith("ja")
      ? { unknown: "不明", now: "まもなく" }
      : { unknown: "unknown", now: "now" };
  const milliseconds = Number(resetsAt) * 1000 - now;
  if (!Number.isFinite(milliseconds)) return terminal.unknown;
  if (milliseconds <= 0) return terminal.now;
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatLocalizedRemainingTime(resetsAt, now = Date.now(), locale = "en") {
  const language = String(locale ?? "").toLowerCase();
  const milliseconds = Number(resetsAt) * 1000 - now;
  if (!Number.isFinite(milliseconds)) return language.startsWith("zh") ? "未知" : language.startsWith("ja") ? "不明" : "unknown";
  if (milliseconds <= 0) return language.startsWith("zh") ? "现在" : language.startsWith("ja") ? "まもなく" : "now";
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const values = days ? [[days, "day"], ...(hours ? [[hours, "hour"]] : [])]
    : hours ? [[hours, "hour"], ...(minutes ? [[minutes, "minute"]] : [])]
      : [[minutes, "minute"]];
  if (language.startsWith("zh")) {
    const units = { day: "天", hour: "小时", minute: "分钟" };
    return values.map(([value, unit]) => `${value}${units[unit]}`).join("");
  }
  if (language.startsWith("ja")) {
    const units = { day: "日", hour: "時間", minute: "分" };
    return values.map(([value, unit]) => `${value}${units[unit]}`).join("");
  }
  return values.map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`).join(" ");
}

export function formatPreciseRemainingTime(resetsAt, now = Date.now()) {
  const milliseconds = Number(resetsAt) * 1000 - now;
  if (!Number.isFinite(milliseconds)) return "unknown";
  if (milliseconds <= 0) return "now";
  const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatResetDate(resetsAt, locale) {
  if (!Number.isFinite(Number(resetsAt))) return "unknown";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(Number(resetsAt) * 1000));
}

export function formatResetTime(resetsAt, locale) {
  if (!Number.isFinite(Number(resetsAt))) return "unknown";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(resetsAt) * 1000));
}

function replaceTokens(template, windowState, now, locale) {
  const values = quotaParts(windowState, now, locale);
  return template.replace(/\{(label|remaining|countdown|relative|seconds|date|reset)\}/g, (_, token) => token === "remaining" ? values.remaining : values[token]);
}

function quotaParts(windowState, now, locale) {
  const remaining = String(clampPercent(windowState.remainingPercent));
  return {
    label: windowState.label,
    remaining,
    value: `${remaining}%`,
    // d/h/m is the shared compact module across locales. Only surrounding
    // prose and terminal states are localized.
    countdown: formatRemainingTime(windowState.resetsAt, now, locale),
    relative: formatLocalizedRemainingTime(windowState.resetsAt, now, locale),
    seconds: formatPreciseRemainingTime(windowState.resetsAt, now),
    date: formatResetDate(windowState.resetsAt, locale),
    reset: formatResetTime(windowState.resetsAt, locale),
  };
}

function runtimeWindow(windowState, now, locale) {
  const parts = quotaParts(windowState, now, locale);
  return {
    label: parts.label,
    sourceId: windowState.sourceId ?? "codex",
    sourceLabel: windowState.sourceLabel ?? "Codex",
    sourceShortLabel: windowState.sourceShortLabel ?? windowState.sourceLabel ?? "Codex",
    remaining: parts.remaining,
    value: parts.value,
    countdown: parts.countdown,
    relative: parts.relative,
    resetsAt: Number(windowState.resetsAt),
    date: parts.date,
    reset: parts.reset,
  };
}

function assembleModuleText(parts, profile) {
  const enabled = {
    label: profile.showLabel,
    value: profile.showValue,
    countdown: profile.showCountdown,
    relative: profile.showRelative,
    seconds: profile.showSeconds,
    date: profile.showDate,
    reset: profile.showReset,
    todayTokens: profile.showTodayTokens,
    lifetimeTokens: profile.showLifetimeTokens,
  };
  return profile.moduleOrder
    .filter((module) => enabled[module] === true)
    .map((module) => parts[module])
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" ");
}

function aggregateParts(partSets, separator, options = {}) {
  return {
    label: partSets.map((parts) => parts.label).join(separator),
    value: partSets.map((parts, index) => options.pairLabelsWithValues
      ? `${options.valueLabels?.[index] ?? parts.label} ${parts.value}`.trim()
      : parts.value).join(separator),
    countdown: partSets.map((parts) => parts.countdown).join(separator),
    relative: partSets.map((parts) => parts.relative).join(separator),
    seconds: partSets.map((parts) => parts.seconds).join(separator),
    date: partSets.map((parts) => parts.date).join(separator),
    reset: partSets.map((parts) => parts.reset).join(separator),
    todayTokens: "—",
    lifetimeTokens: "—",
  };
}

function resolveColor(mode, severity, palette, match) {
  if (/^#[0-9a-f]{6}$/i.test(String(mode))) return mode;
  if (mode === "match") return match;
  if (mode === "muted") return "muted";
  if (mode === "accent") return palette.accent;
  if (severity === "critical") return palette.critical;
  if (severity === "warning") return palette.warning;
  return palette.accent;
}

function resolveIdentityColor(mode, severity, palette, valueColor) {
  if (mode === "inherit") return "inherit";
  return resolveColor(mode, severity, palette, valueColor);
}

export function formatQuota(snapshot, config, now = Date.now(), locale) {
  const profile = activeProfile(config);
  const availableWindows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
  const availableWindowCount = availableWindows.length;
  const selected = selectWindows(availableWindows, profile.window);
  if (!selected.length) {
    return {
      text: "--%",
      parts: { label: "", value: "--%", todayTokens: "—", lifetimeTokens: "—", countdown: "--", relative: "--", seconds: "--:--:--", date: "--", reset: "--" },
      runtimeWindows: [],
      tooltipWindows: [],
      renderTemplate: profile.template,
      renderHoverTemplate: profile.hoverTemplate,
      renderSeparator: profile.separator,
      tooltip: waitingTooltip(locale),
      severity: "unavailable",
      profileId: profile.id,
      profileName: profile.name,
      availableWindowCount,
      showValue: profile.showValue,
      showDot: profile.showDot,
      showBar: profile.showBar,
      barScope: profile.barScope,
      remainingPercent: null,
      showLabel: false,
      showCountdown: profile.showCountdown,
      showRelative: profile.showRelative,
      showSeconds: profile.showSeconds,
      showDate: profile.showDate,
      showReset: profile.showReset,
      showTodayTokens: profile.showTodayTokens,
      showLifetimeTokens: profile.showLifetimeTokens,
      displayMode: profile.displayMode,
      valueColor: "muted",
      dotColor: "muted",
      identityColor: "inherit",
      valueColorMode: profile.valueColor,
      dotColorMode: profile.dotColor,
      identityColorMode: profile.identityColor,
      effect: "none",
      effectTarget: profile.effectTarget,
      effectAt: profile.effectAt,
      overdriveEgg: config.experiments?.overdriveEgg === true,
      overdriveAlways: config.experiments?.overdriveAlways === true,
      overdriveEffect: config.experiments?.overdriveEffect ?? "menuFire",
      accountRowMode: config.accountRowMode ?? "legacy",
      layout: {
        moduleOrder: profile.moduleOrder,
        layoutMode: profile.layoutMode,
        snapThreshold: profile.snapThreshold,
        snapTargets: profile.snapTargets,
        moduleAnchors: profile.moduleAnchors,
        identity: profile.identity,
        avatarShape: profile.avatarShape,
        fontSize: profile.fontSize,
        barScope: profile.barScope,
        placement: profile.placement,
      },
    };
  }
  const effectiveShowLabel = availableWindowCount > 1 && profile.showLabel === true;
  const renderProfile = profile.displayMode === "modules" ? { ...profile, showLabel: effectiveShowLabel } : profile;
  const partSets = selected.map((item) => quotaParts(item, now, locale));
  const text = selected.map((item, index) => {
    const rendered = profile.displayMode === "template"
      ? replaceTokens(profile.template, item, now, locale)
      : assembleModuleText(partSets[index], renderProfile);
    return rendered;
  }).join(profile.separator);
  const usesDefaultHover = [DEFAULT_HOVER_TEMPLATE, RECENT_DEFAULT_HOVER_TEMPLATE, PREVIOUS_DEFAULT_HOVER_TEMPLATE].includes(profile.hoverTemplate);
  const hoverTemplate = usesDefaultHover
    ? localizedDefaultHover(locale, true)
    : profile.hoverTemplate;
  const tooltip = hoverTemplate
    ? (usesDefaultHover ? availableWindows : selected).map((item) => replaceTokens(hoverTemplate, usesDefaultHover
      ? { ...item, label: item.displayLabel ?? item.label }
      : item, now, locale)).join("\n")
    : "";
  const lowest = Math.min(...selected.map((item) => Number(item.remainingPercent)).filter(Number.isFinite));
  const severity = lowest <= config.thresholds.critical
    ? "critical"
    : lowest <= config.thresholds.warning
      ? "warning"
      : "normal";
  const valueColor = resolveColor(profile.valueColor, severity, config.palette);
  const dotColor = resolveColor(profile.dotColor, severity, config.palette, valueColor);
  const identityColor = resolveIdentityColor(profile.identityColor, severity, config.palette, valueColor);
  const parts = aggregateParts(partSets, profile.separator);
  return {
    text,
    parts,
    runtimeWindows: selected.map((item, index) => runtimeWindow({ ...item, label: partSets[index].label }, now, locale)),
    tooltipWindows: (usesDefaultHover ? availableWindows : selected).map((item) => runtimeWindow({
      ...item,
      label: usesDefaultHover ? (item.displayLabel ?? item.label) : item.label,
    }, now, locale)),
    renderTemplate: profile.template,
    renderHoverTemplate: hoverTemplate,
    renderSeparator: profile.separator,
    tooltip,
    severity,
    profileId: profile.id,
    profileName: profile.name,
    availableWindowCount,
    showValue: profile.showValue,
    showDot: profile.showDot,
    showBar: profile.showBar,
    barScope: profile.barScope,
    remainingPercent: Math.max(0, Math.min(100, lowest)),
    showLabel: effectiveShowLabel,
    showCountdown: profile.showCountdown,
    showRelative: profile.showRelative,
    showSeconds: profile.showSeconds,
    showDate: profile.showDate,
    showReset: profile.showReset,
    showTodayTokens: profile.showTodayTokens,
    showLifetimeTokens: profile.showLifetimeTokens,
    displayMode: profile.displayMode,
    valueColor,
    dotColor,
    identityColor,
    valueColorMode: profile.valueColor,
    dotColorMode: profile.dotColor,
    identityColorMode: profile.identityColor,
    effect: profile.effect,
    effectTarget: profile.effectTarget,
    effectAt: profile.effectAt,
    overdriveEgg: config.experiments?.overdriveEgg === true,
    overdriveAlways: config.experiments?.overdriveAlways === true,
    overdriveEffect: config.experiments?.overdriveEffect ?? "menuFire",
    accountRowMode: config.accountRowMode ?? "legacy",
    layout: {
      moduleOrder: profile.moduleOrder,
      layoutMode: profile.layoutMode,
      snapThreshold: profile.snapThreshold,
      snapTargets: profile.snapTargets,
      moduleAnchors: profile.moduleAnchors,
      identity: profile.identity,
      avatarShape: profile.avatarShape,
      fontSize: profile.fontSize,
      barScope: profile.barScope,
      placement: profile.placement,
    },
  };
}
