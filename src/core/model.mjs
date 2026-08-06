export function durationLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "limit";
  if (value % 1440 === 0) return `${value / 1440}d`;
  if (value % 60 === 0) return `${value / 60}h`;
  return `${value}m`;
}

function cleanLimitId(value, fallback = "codex") {
  const id = String(value ?? "").trim();
  return id || fallback;
}

export function normalizeWindow(windowState, source = {}) {
  if (!windowState || !Number.isFinite(Number(windowState.usedPercent))) return null;
  const duration = Number(windowState.windowDurationMins);
  const windowId = Number.isFinite(duration) ? `duration:${duration}` : "limit";
  const sourceId = cleanLimitId(source.id);
  const sourceLabel = String(source.name ?? "").trim() || "Codex";
  const label = durationLabel(duration);
  return {
    id: `limit:${sourceId}:${windowId}`,
    label,
    displayLabel: `${sourceLabel} ${label}`.trim(),
    sourceId,
    sourceLabel,
    sourceShortLabel: sourceLabel,
    windowDurationMins: Number.isFinite(duration) ? duration : null,
    remainingPercent: Math.max(0, Math.min(100, 100 - Number(windowState.usedPercent))),
    resetsAt: Number.isFinite(Number(windowState.resetsAt)) ? Number(windowState.resetsAt) : null,
  };
}

function normalizeBucket(snapshot, fallbackId) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const id = cleanLimitId(snapshot.limitId, fallbackId);
  const label = String(snapshot.limitName ?? "").trim() || "Codex";
  const windows = [snapshot.primary, snapshot.secondary]
    .map((windowState) => normalizeWindow(windowState, { id, name: snapshot.limitName }))
    .filter(Boolean)
    .sort((left, right) => (left.windowDurationMins ?? Infinity) - (right.windowDurationMins ?? Infinity));
  return { id, label, shortLabel: label, windows };
}

function generalRateLimits(response) {
  const direct = response?.rateLimits && typeof response.rateLimits === "object" ? response.rateLimits : null;
  const directId = String(direct?.limitId ?? "codex").toLowerCase();
  if (direct && directId === "codex") return direct;
  const mapped = response?.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === "object"
    ? response.rateLimitsByLimitId.codex
    : null;
  if (mapped && typeof mapped === "object") return mapped;
  const rootId = String(response?.limitId ?? "codex").toLowerCase();
  if ((response?.primary || response?.secondary) && rootId === "codex") return response;
  return null;
}

export function normalizeRateLimits(payload) {
  const response = payload && typeof payload === "object" ? payload : {};
  const general = normalizeBucket(generalRateLimits(response), "codex");
  const windows = general?.windows?.map((windowState) => ({
    ...windowState,
    id: windowState.id.replace(/^limit:[^:]+:/, "limit:codex:"),
    sourceId: "codex",
    sourceLabel: "Codex",
    sourceShortLabel: "Codex",
    displayLabel: `Codex ${windowState.label}`,
  })) ?? [];
  const buckets = windows.length ? [{ id: "codex", label: "Codex", shortLabel: "Codex", windows }] : [];
  return {
    source: "codex-app-server",
    status: windows.length ? "ready" : "unavailable",
    buckets,
    windows,
    receivedAt: Date.now(),
  };
}

export function mergeRateLimits(previous, update) {
  if (!update || typeof update !== "object") return previous;
  const updateSnapshot = update.rateLimits ?? update;
  const wrapper = previous && typeof previous === "object"
    && (Object.hasOwn(previous, "rateLimits") || Object.hasOwn(previous, "rateLimitsByLimitId"));
  if (!wrapper) return { ...(previous ?? {}), ...updateSnapshot };

  const id = cleanLimitId(updateSnapshot.limitId, previous.rateLimits?.limitId ?? "codex");
  const existingById = previous.rateLimitsByLimitId && typeof previous.rateLimitsByLimitId === "object"
    ? previous.rateLimitsByLimitId
    : {};
  const existing = existingById[id]
    ?? (previous.rateLimits?.limitId === id ? previous.rateLimits : null)
    ?? {};
  const available = Object.fromEntries(Object.entries(updateSnapshot).filter(([, value]) => value !== null && value !== undefined));
  const merged = { ...existing, ...available, limitId: id };
  const nextById = { ...existingById, [id]: merged };
  const legacyId = cleanLimitId(previous.rateLimits?.limitId, "codex");
  const legacy = id === legacyId ? { ...previous.rateLimits, ...available, limitId: id } : previous.rateLimits;
  return { ...previous, rateLimits: legacy, rateLimitsByLimitId: nextById };
}
