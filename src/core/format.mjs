import { activeProfile } from "./config.mjs";

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value))));
const PREVIOUS_DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets {reset} ({countdown})";
const RECENT_DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({reset})";
const DEFAULT_HOVER_TEMPLATE = "{remaining}% left · resets in {countdown} ({date}, {reset})";

function localizedDefaultHover(locale, includeLabel = false) {
  const language = String(locale ?? "").toLowerCase();
  const body = language.startsWith("zh")
    ? "剩余 {remaining}%\n重置 {countdown} · {date} {reset}"
    : language.startsWith("ja")
      ? "残り {remaining}%\nリセットまで {countdown} · {date} {reset}"
      : "{remaining}% remaining\nReset in {countdown} · {date} {reset}";
  if (!includeLabel) return body;
  return `{label}\n${body}`;
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
  return formatDuration(milliseconds / 1000, locale);
}

export function formatLocalizedRemainingTime(resetsAt, now = Date.now(), locale = "en") {
  const language = String(locale ?? "").toLowerCase();
  const milliseconds = Number(resetsAt) * 1000 - now;
  if (!Number.isFinite(milliseconds)) return language.startsWith("zh") ? "未知" : language.startsWith("ja") ? "不明" : "unknown";
  if (milliseconds <= 0) return language.startsWith("zh") ? "现在" : language.startsWith("ja") ? "まもなく" : "now";
  return formatDuration(milliseconds / 1000, locale, true);
}

function durationValues(seconds) {
  const totalSeconds = Math.max(1, Math.ceil(Number(seconds)));
  if (!Number.isFinite(totalSeconds)) return [];
  if (totalSeconds >= 86_400) {
    const totalHours = Math.ceil(totalSeconds / 3_600);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return [[days, "day"], ...(hours ? [[hours, "hour"]] : [])];
  }
  if (totalSeconds >= 3_600) {
    const totalMinutes = Math.ceil(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return [[hours, "hour"], ...(minutes ? [[minutes, "minute"]] : [])];
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes) return [[minutes, "minute"], ...(remainingSeconds ? [[remainingSeconds, "second"]] : [])];
  return [[remainingSeconds || 1, "second"]];
}

export function formatDuration(seconds, locale = "en", localized = false) {
  const values = durationValues(seconds);
  if (!values.length) return "—";
  if (!localized) {
    const units = { day: "d", hour: "h", minute: "m", second: "s" };
    return values.map(([value, unit]) => `${value}${units[unit]}`).join(" ");
  }
  const language = String(locale ?? "").toLowerCase();
  if (language.startsWith("zh")) {
    const units = { day: "天", hour: "小时", minute: "分钟", second: "秒" };
    return values.map(([value, unit]) => `${value}${units[unit]}`).join("");
  }
  if (language.startsWith("ja")) {
    const units = { day: "日", hour: "時間", minute: "分", second: "秒" };
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

export function formatPacePerHour(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return "—";
  if (rate < 0.02) return "0%/h";
  const digits = rate < 10 ? 1 : 0;
  return `${rate.toFixed(digits).replace(/\.0$/, "")}%/h`;
}

function formatForecastDuration(seconds, locale, localized = false) {
  return formatDuration(seconds, locale, localized);
}

export function formatForecastRange(lowSeconds, highSeconds, locale = "en", localized = false, reachesReset = false) {
  const low = Number(lowSeconds);
  const high = Number(highSeconds);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return "—";
  const lowText = formatForecastDuration(low, locale, localized);
  const highText = formatForecastDuration(high, locale, localized);
  if (lowText === highText) return reachesReset ? `≥${highText}` : highText;
  return `${lowText}–${reachesReset ? "≥" : ""}${highText}`;
}

function forecastDisplay(windowState, estimate, now, locale) {
  if (estimate?.status !== "ready") {
    return { text: estimate?.status === "calibrating" ? "…" : "—", range: false, pointSeconds: null, lowSeconds: null, highSeconds: null };
  }
  const resetSeconds = Number(windowState.resetsAt) - now / 1000;
  const pointSeconds = estimate.survivesReset && Number.isFinite(resetSeconds)
    ? Math.max(60, resetSeconds)
    : Number(estimate.runwaySeconds);
  const lowSeconds = Number(estimate.runwayLowSeconds);
  const highSeconds = Number(estimate.runwayHighSeconds);
  const meaningfulRange = Number.isFinite(lowSeconds) && Number.isFinite(highSeconds)
    && lowSeconds > 0 && highSeconds >= lowSeconds
    && highSeconds - lowSeconds >= 3600
    && highSeconds / lowSeconds >= 1.25;
  return {
    text: `${estimate.survivesReset ? "≥" : "≈"}${formatForecastDuration(pointSeconds, locale)}`,
    // The account row is a glance surface. Keep one stable point estimate
    // inline and reserve model disagreement for the complete hover copy.
    range: meaningfulRange,
    pointSeconds,
    lowSeconds: meaningfulRange ? lowSeconds : pointSeconds,
    highSeconds: meaningfulRange ? highSeconds : pointSeconds,
  };
}

function replaceTokens(template, windowState, now, locale, estimate = null) {
  const values = quotaParts(windowState, now, locale, estimate);
  return template.replace(/\{(label|remaining|countdown|relative|seconds|date|reset|pace|runway)\}/g, (_, token) => token === "remaining" ? values.remaining : values[token]);
}

function quotaParts(windowState, now, locale, estimate = null) {
  const remaining = String(clampPercent(windowState.remainingPercent));
  const forecast = forecastDisplay(windowState, estimate, now, locale);
  const currentPace = estimate?.currentPacePerHour !== null && estimate?.currentPacePerHour !== undefined
    && Number.isFinite(Number(estimate.currentPacePerHour))
    ? estimate.currentPacePerHour
    : estimate?.pacePerHour;
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
    pace: formatPacePerHour(currentPace),
    runway: forecast.text,
  };
}

function runtimeWindow(windowState, now, locale, estimate = null) {
  const parts = quotaParts(windowState, now, locale, estimate);
  const forecast = forecastDisplay(windowState, estimate, now, locale);
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
    pace: parts.pace,
    runway: parts.runway,
    runwayPrefix: estimate?.status === "ready" ? (estimate.survivesReset ? "≥" : "≈") : "",
    runwayEndsAt: Number.isFinite(forecast.pointSeconds) ? now / 1000 + forecast.pointSeconds : null,
    runwayRange: forecast.range,
    runwayLowEndsAt: forecast.range && Number.isFinite(forecast.lowSeconds) ? now / 1000 + forecast.lowSeconds : null,
    runwayHighEndsAt: forecast.range && Number.isFinite(forecast.highSeconds) ? now / 1000 + forecast.highSeconds : null,
    runwayHighPrefix: forecast.range && estimate?.rangeSurvivesReset === true ? "≥" : "",
    forecastTooltip: localizedForecastTooltip(estimate, locale, now),
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
    pace: profile.showPace,
    runway: profile.showRunway,
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
    pace: partSets.map((parts) => parts.pace).join(separator),
    runway: partSets.map((parts) => parts.runway).join(separator),
  };
}

function paceEstimateFor(windowState, paceWindows) {
  const available = Array.isArray(paceWindows) ? paceWindows : [];
  return available.find((estimate) => estimate.id === windowState.id)
    ?? available.find((estimate) => estimate.sourceId === (windowState.sourceId ?? "codex")
      && Number(estimate.windowDurationMins) === Number(windowState.windowDurationMins))
    ?? null;
}

function localizedForecastTooltip(estimate, locale, now) {
  if (estimate?.status !== "ready") return "";
  const currentPace = estimate.currentPacePerHour !== null && estimate.currentPacePerHour !== undefined
    && Number.isFinite(Number(estimate.currentPacePerHour))
    ? estimate.currentPacePerHour
    : estimate.pacePerHour;
  const pace = formatPacePerHour(currentPace);
  const language = String(locale ?? "").toLowerCase();
  const runwaySeconds = estimate.survivesReset && Number.isFinite(Number(estimate.resetsAt))
    ? Math.max(60, Number(estimate.resetsAt) - now / 1000)
    : Number(estimate.runwaySeconds);
  const runway = `${estimate.survivesReset ? "≥" : "≈"}${formatForecastDuration(runwaySeconds, locale, true)}`;
  if (language.startsWith("zh")) return `速度 ${pace} · 预计 ${runway}`;
  if (language.startsWith("ja")) return `ペース ${pace} · 目安 ${runway}`;
  return `Pace ${pace} · Runway ${runway}`;
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
  const paceWindows = Array.isArray(snapshot?.quotaPace?.windows) ? snapshot.quotaPace.windows : [];
  const availableWindowCount = availableWindows.length;
  const selected = selectWindows(availableWindows, profile.window);
  if (!selected.length) {
    return {
      text: "--%",
      parts: { label: "", value: "--%", pace: "…", runway: "…", todayTokens: "—", lifetimeTokens: "—", countdown: "--", relative: "--", seconds: "--:--:--", date: "--", reset: "--" },
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
      showPace: profile.showPace,
      showRunway: profile.showRunway,
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
  const partSets = selected.map((item) => quotaParts(item, now, locale, paceEstimateFor(item, paceWindows)));
  const text = selected.map((item, index) => {
    const rendered = profile.displayMode === "template"
      ? replaceTokens(profile.template, item, now, locale, paceEstimateFor(item, paceWindows))
      : assembleModuleText(partSets[index], renderProfile);
    return rendered;
  }).join(profile.separator);
  const usesDefaultHover = [DEFAULT_HOVER_TEMPLATE, RECENT_DEFAULT_HOVER_TEMPLATE, PREVIOUS_DEFAULT_HOVER_TEMPLATE].includes(profile.hoverTemplate);
  const hoverTemplate = usesDefaultHover
    ? localizedDefaultHover(locale, availableWindows.length > 1)
    : profile.hoverTemplate;
  const tooltip = hoverTemplate
    ? (usesDefaultHover ? availableWindows : selected).map((item) => {
      const displayItem = usesDefaultHover ? { ...item, label: item.label } : item;
      const estimate = paceEstimateFor(item, paceWindows);
      const main = replaceTokens(hoverTemplate, displayItem, now, locale, estimate);
      const forecast = usesDefaultHover ? localizedForecastTooltip(estimate, locale, now) : "";
      return [main, forecast].filter(Boolean).join("\n");
    }).join(usesDefaultHover ? "\n\n" : "\n")
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
    runtimeWindows: selected.map((item, index) => runtimeWindow({ ...item, label: partSets[index].label }, now, locale, paceEstimateFor(item, paceWindows))),
    tooltipWindows: (usesDefaultHover ? availableWindows : selected).map((item) => runtimeWindow({
      ...item,
      label: item.label,
    }, now, locale, paceEstimateFor(item, paceWindows))),
    renderTemplate: profile.template,
    renderHoverTemplate: hoverTemplate,
    renderForecastTooltip: usesDefaultHover,
    renderHoverSeparator: usesDefaultHover ? "\n\n" : "\n",
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
    showPace: profile.showPace,
    showRunway: profile.showRunway,
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
