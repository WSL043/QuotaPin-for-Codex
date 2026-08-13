const HOUR_MS = 60 * 60 * 1000;
const HISTORY_MS = 24 * HOUR_MS;
const KEEP_MS = 8 * 24 * HOUR_MS;
const PLATEAU_SAMPLE_MS = 15 * 60 * 1000;
const RESET_TOLERANCE_SECONDS = 5 * 60;
const MINIMUM_SPAN_MS = 30 * 60 * 1000;
const MINIMUM_DELTA_PERCENT = 1;
const MAXIMUM_SAMPLES = 192;

const finite = (value) => Number.isFinite(Number(value));
const clampPercent = (value) => Math.max(0, Math.min(100, Number(value)));

function windowKey(windowState = {}) {
  const sourceId = String(windowState.sourceId ?? "codex").trim() || "codex";
  const duration = finite(windowState.windowDurationMins) ? Number(windowState.windowDurationMins) : "limit";
  return `${sourceId}:${duration}`;
}

function cleanSample(value) {
  if (!value || !finite(value.at) || !finite(value.remainingPercent)) return null;
  return {
    at: Math.round(Number(value.at)),
    remainingPercent: Math.round(clampPercent(value.remainingPercent) * 10_000) / 10_000,
  };
}

function cleanRecord(value = {}, now = Date.now()) {
  const sourceId = String(value.sourceId ?? "codex").trim() || "codex";
  const windowDurationMins = finite(value.windowDurationMins) ? Number(value.windowDurationMins) : null;
  const resetsAt = finite(value.resetsAt) ? Number(value.resetsAt) : null;
  const samples = (Array.isArray(value.samples) ? value.samples : [])
    .map(cleanSample)
    .filter(Boolean)
    .filter((sample) => sample.at >= now - KEEP_MS && sample.at <= now + 60_000)
    .sort((left, right) => left.at - right.at)
    .slice(-MAXIMUM_SAMPLES);
  return { sourceId, windowDurationMins, resetsAt, samples };
}

export function createQuotaPaceState(value = {}, now = Date.now()) {
  const source = value && typeof value === "object" ? value : {};
  const records = source.windows && typeof source.windows === "object" ? source.windows : {};
  const windows = {};
  for (const [key, record] of Object.entries(records)) {
    const cleaned = cleanRecord(record, now);
    if (cleaned.samples.length) windows[String(key).slice(0, 120)] = cleaned;
  }
  return { schema: 1, windows };
}

function sameReset(left, right) {
  if (!finite(left) || !finite(right)) return !finite(left) && !finite(right);
  return Math.abs(Number(left) - Number(right)) <= RESET_TOLERANCE_SECONDS;
}

export function observeQuotaPace(previous, usage, now = Date.now()) {
  const state = createQuotaPaceState(previous, now);
  if (usage?.status !== "ready" || !Array.isArray(usage.windows)) return { state, changed: false };
  const observedAt = finite(usage.receivedAt) ? Math.round(Number(usage.receivedAt)) : Math.round(Number(now));
  let changed = false;
  const observedKeys = new Set();
  for (const windowState of usage.windows) {
    if (!finite(windowState?.remainingPercent)) continue;
    const key = windowKey(windowState);
    observedKeys.add(key);
    const remainingPercent = Math.round(clampPercent(windowState.remainingPercent) * 10_000) / 10_000;
    const resetsAt = finite(windowState.resetsAt) ? Number(windowState.resetsAt) : null;
    const current = state.windows[key] ?? {
      sourceId: String(windowState.sourceId ?? "codex"),
      windowDurationMins: finite(windowState.windowDurationMins) ? Number(windowState.windowDurationMins) : null,
      resetsAt,
      samples: [],
    };
    const last = current.samples.at(-1);
    const startsNewEpoch = Boolean(last)
      && (!sameReset(current.resetsAt, resetsAt) || remainingPercent > last.remainingPercent + 0.5);
    if (startsNewEpoch) {
      current.samples = [];
      changed = true;
    }
    current.sourceId = String(windowState.sourceId ?? current.sourceId ?? "codex");
    current.windowDurationMins = finite(windowState.windowDurationMins) ? Number(windowState.windowDurationMins) : null;
    current.resetsAt = resetsAt;
    const latest = current.samples.at(-1);
    const shouldAppend = !latest
      || observedAt > latest.at && (
        Math.abs(remainingPercent - latest.remainingPercent) >= 0.001
        || observedAt - latest.at >= PLATEAU_SAMPLE_MS
      );
    if (shouldAppend) {
      current.samples.push({ at: observedAt, remainingPercent });
      current.samples = current.samples
        .filter((sample) => sample.at >= observedAt - HISTORY_MS)
        .slice(-MAXIMUM_SAMPLES);
      changed = true;
    }
    state.windows[key] = current;
  }
  for (const [key, record] of Object.entries(state.windows)) {
    const last = record.samples.at(-1);
    if (!observedKeys.has(key) && (!last || last.at < now - KEEP_MS)) {
      delete state.windows[key];
      changed = true;
    }
  }
  return { state, changed };
}

function weightedSlope(samples) {
  const firstAt = samples[0].at;
  const lastAt = samples.at(-1).at;
  const firstRemaining = samples[0].remainingPercent;
  const weighted = samples.map((sample) => {
    const x = (sample.at - firstAt) / HOUR_MS;
    const y = firstRemaining - sample.remainingPercent;
    // Recent official observations carry more weight without discarding the
    // longer account-wide history. This is intentionally independent math;
    // no prompt, token, model, or price data enters the estimate.
    const weight = Math.exp((sample.at - lastAt) / (6 * HOUR_MS));
    return { x, y, weight };
  });
  const totalWeight = weighted.reduce((sum, point) => sum + point.weight, 0);
  const meanX = weighted.reduce((sum, point) => sum + point.x * point.weight, 0) / totalWeight;
  const meanY = weighted.reduce((sum, point) => sum + point.y * point.weight, 0) / totalWeight;
  const numerator = weighted.reduce((sum, point) => sum + point.weight * (point.x - meanX) * (point.y - meanY), 0);
  const denominator = weighted.reduce((sum, point) => sum + point.weight * (point.x - meanX) ** 2, 0);
  return denominator > 0 ? numerator / denominator : 0;
}

function confidenceFor(samples, spanMs, deltaPercent) {
  const distinct = new Set(samples.map((sample) => sample.remainingPercent)).size;
  if (spanMs >= 6 * HOUR_MS && deltaPercent >= 5 && distinct >= 6) return "high";
  if (spanMs >= 2 * HOUR_MS && deltaPercent >= 2 && distinct >= 4) return "medium";
  return "low";
}

export function estimateQuotaPace(previous, usage, now = Date.now()) {
  const state = createQuotaPaceState(previous, now);
  const windows = usage?.status === "ready" && Array.isArray(usage.windows) ? usage.windows : [];
  return windows.map((windowState) => {
    const key = windowKey(windowState);
    const record = state.windows[key];
    const base = {
      id: String(windowState.id ?? key),
      sourceId: String(windowState.sourceId ?? "codex"),
      windowDurationMins: finite(windowState.windowDurationMins) ? Number(windowState.windowDurationMins) : null,
      resetsAt: finite(windowState.resetsAt) ? Number(windowState.resetsAt) : null,
      status: "calibrating",
      pacePerHour: null,
      runwaySeconds: null,
      survivesReset: false,
      confidence: "low",
      sampleCount: 0,
      observedSpanMs: 0,
      consumedPercent: 0,
    };
    if (!record || !sameReset(record.resetsAt, windowState.resetsAt)) return base;
    const samples = record.samples
      .filter((sample) => sample.at >= now - HISTORY_MS && sample.at <= now + 60_000)
      .sort((left, right) => left.at - right.at);
    if (!samples.length) return base;
    const spanMs = samples.at(-1).at - samples[0].at;
    const consumedPercent = Math.max(0, samples[0].remainingPercent - samples.at(-1).remainingPercent);
    const summary = { ...base, sampleCount: samples.length, observedSpanMs: spanMs, consumedPercent };
    if (samples.length < 3 || spanMs < MINIMUM_SPAN_MS || consumedPercent < MINIMUM_DELTA_PERCENT) return summary;
    const pacePerHour = weightedSlope(samples);
    if (!Number.isFinite(pacePerHour) || pacePerHour < 0.02) return { ...summary, status: "idle" };
    const remaining = clampPercent(windowState.remainingPercent);
    const runwaySeconds = remaining / pacePerHour * 3600;
    const resetSeconds = finite(windowState.resetsAt) ? Number(windowState.resetsAt) - Number(now) / 1000 : null;
    return {
      ...summary,
      status: "ready",
      pacePerHour,
      runwaySeconds,
      survivesReset: Number.isFinite(resetSeconds) && resetSeconds > 0 && runwaySeconds >= resetSeconds,
      confidence: confidenceFor(samples, spanMs, consumedPercent),
    };
  });
}
