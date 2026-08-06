export function createTimeStateToolkit() {
  const clampUnit = (value) => value === 60_000 ? 60_000 : 1_000;

  function remainingParts(resetsAt, now = Date.now()) {
    const milliseconds = Number(resetsAt) * 1000 - Number(now);
    if (!Number.isFinite(milliseconds)) return { terminal: "unknown", values: [] };
    if (milliseconds <= 0) return { terminal: "now", values: [] };
    const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const values = days ? [[days, "day"], ...(hours ? [[hours, "hour"]] : [])]
      : hours ? [[hours, "hour"], ...(minutes ? [[minutes, "minute"]] : [])]
        : [[minutes, "minute"]];
    return { terminal: "", values };
  }

  function localizedTerminal(terminal, locale) {
    const language = String(locale ?? "").toLowerCase();
    if (language.startsWith("zh")) return terminal === "unknown" ? "未知" : "现在";
    if (language.startsWith("ja")) return terminal === "unknown" ? "不明" : "まもなく";
    return terminal;
  }

  function formatRemainingTime(resetsAt, now = Date.now(), locale = "en") {
    const remaining = remainingParts(resetsAt, now);
    if (remaining.terminal) return localizedTerminal(remaining.terminal, locale);
    const units = { day: "d", hour: "h", minute: "m" };
    return remaining.values.map(([value, unit]) => `${value}${units[unit]}`).join(" ");
  }

  function formatLocalizedRemainingTime(resetsAt, now = Date.now(), locale = "en") {
    const remaining = remainingParts(resetsAt, now);
    if (remaining.terminal) return localizedTerminal(remaining.terminal, locale);
    const language = String(locale ?? "").toLowerCase();
    if (language.startsWith("zh")) {
      const units = { day: "天", hour: "小时", minute: "分钟" };
      return remaining.values.map(([value, unit]) => `${value}${units[unit]}`).join("");
    }
    if (language.startsWith("ja")) {
      const units = { day: "日", hour: "時間", minute: "分" };
      return remaining.values.map(([value, unit]) => `${value}${units[unit]}`).join("");
    }
    return remaining.values.map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`).join(" ");
  }

  function formatPreciseRemainingTime(resetsAt, now = Date.now()) {
    const milliseconds = Number(resetsAt) * 1000 - Number(now);
    if (!Number.isFinite(milliseconds)) return "unknown";
    if (milliseconds <= 0) return "now";
    const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function liveRefreshUnit(view = {}) {
    const template = view.displayMode === "template" ? String(view.renderTemplate ?? "") : "";
    const hover = String(view.renderHoverTemplate ?? "");
    if (view.showSeconds === true || template.includes("{seconds}") || hover.includes("{seconds}")) return 1_000;
    if (view.showCountdown === true || view.showRelative === true
      || template.includes("{countdown}") || template.includes("{relative}")
      || hover.includes("{countdown}") || hover.includes("{relative}")) return 60_000;
    return null;
  }

  function nextBoundaryDelay(runtimeWindows = [], now = Date.now(), requestedUnit = 1_000, epsilonMs = 12) {
    const unit = clampUnit(Number(requestedUnit));
    const current = Number(now);
    if (!Number.isFinite(current)) return null;
    const delays = (Array.isArray(runtimeWindows) ? runtimeWindows : [])
      .map((windowState) => Number(windowState?.resetsAt) * 1000 - current)
      .filter((remaining) => Number.isFinite(remaining) && remaining > 0)
      .map((remaining) => {
        const bucket = Math.max(1, Math.ceil(remaining / unit));
        return remaining - (bucket - 1) * unit + Math.max(0, Number(epsilonMs) || 0);
      });
    if (!delays.length) return null;
    return Math.max(16, Math.min(unit + Math.max(0, Number(epsilonMs) || 0), Math.min(...delays)));
  }

  return { formatRemainingTime, formatLocalizedRemainingTime, formatPreciseRemainingTime, liveRefreshUnit, nextBoundaryDelay };
}
