import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JSONL_SUFFIX = ".jsonl";
const READ_BLOCK_BYTES = 1024 * 1024;
const MAX_BACKFILL_BYTES = 128 * 1024 * 1024;
const MAX_HEAD_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_INCREMENTAL_BYTES = 128 * 1024 * 1024;
const INCREMENTAL_OVERLAP_BYTES = 64 * 1024;

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function usageVector(value) {
  if (!value || typeof value !== "object") return null;
  return {
    input: nonNegativeInteger(value.input_tokens),
    output: nonNegativeInteger(value.output_tokens),
    cached: Math.max(
      nonNegativeInteger(value.cached_input_tokens),
      nonNegativeInteger(value.cache_read_input_tokens),
    ),
    reasoning: nonNegativeInteger(value.reasoning_output_tokens),
  };
}

function vectorTotal(value) {
  if (!value) return 0;
  // Codex reports cached input as a subset of input. Tokscale follows the same
  // accounting boundary: input + output + reasoning, without adding cache twice.
  return value.input + value.output + value.reasoning;
}

function vectorKey(value) {
  return value ? `${value.input}:${value.output}:${value.cached}:${value.reasoning}` : "none";
}

function vectorRegressed(current, previous) {
  return current.input < previous.input
    || current.output < previous.output
    || current.cached < previous.cached
    || current.reasoning < previous.reasoning;
}

function looksLikeStaleRegression(current, previous, last) {
  const previousTotal = vectorTotal(previous);
  const currentTotal = vectorTotal(current);
  const lastTotal = vectorTotal(last);
  if (previousTotal <= 0 || currentTotal <= 0 || lastTotal <= 0) return false;
  return currentTotal * 100 >= previousTotal * 98
    || currentTotal + lastTotal * 2 >= previousTotal;
}

export function localDayBounds(now = Date.now()) {
  const date = new Date(Number(now));
  if (!Number.isFinite(date.getTime())) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    start,
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
  };
}

export function tokenEventFromLine(line, scopeId = "unknown") {
  if (typeof line !== "string" || !/^\{"timestamp":"[^"]+","type":"event_msg","payload":\{"type":"token_count"[,}]/.test(line)) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  if (entry?.type !== "event_msg" || entry?.payload?.type !== "token_count") return null;
  const timestamp = Date.parse(entry.timestamp);
  const info = entry.payload.info;
  const last = usageVector(info?.last_token_usage);
  const total = usageVector(info?.total_token_usage);
  if (!Number.isFinite(timestamp) || (!last && !total)) return null;
  return { timestamp, scopeId, last, total };
}

export function aggregateTokenEvents(events, seed = {}) {
  const seen = seed.seen ?? new Set();
  const previousByScope = seed.previousByScope ?? new Map();
  let addedTokens = 0;
  let acceptedEvents = 0;
  const ordered = [...(Array.isArray(events) ? events : [])].sort((left, right) => left.timestamp - right.timestamp);
  for (const event of ordered) {
    const last = event?.last;
    const total = event?.total;
    const increment = vectorTotal(last ?? total);
    if (!Number.isSafeInteger(increment) || increment <= 0) continue;
    const scopeId = String(event.scopeId || "unknown");
    const dedupKey = total
      ? `${scopeId}:total:${vectorKey(total)}`
      : `${scopeId}:event:${event.timestamp}:${vectorKey(last)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const previous = previousByScope.get(scopeId);
    if (total && previous) {
      if (vectorKey(total) === vectorKey(previous)) continue;
      if (vectorRegressed(total, previous) && looksLikeStaleRegression(total, previous, last ?? total)) continue;
    }
    if (total) previousByScope.set(scopeId, total);
    addedTokens += increment;
    acceptedEvents += 1;
  }
  return { addedTokens, acceptedEvents, seen, previousByScope };
}

function walkJsonl(root, fsImpl = fs, pathImpl = path, limit = 5000) {
  if (!root || !fsImpl.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length && files.length < limit) {
    const directory = pending.pop();
    let entries;
    try { entries = fsImpl.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const candidate = pathImpl.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(JSONL_SUFFIX)) files.push(candidate);
    }
  }
  return files;
}

function discoverTodayFiles(codexHome, bounds, fsImpl = fs, pathImpl = path) {
  const roots = [pathImpl.join(codexHome, "sessions"), pathImpl.join(codexHome, "archived_sessions")];
  return roots.flatMap((root) => walkJsonl(root, fsImpl, pathImpl))
    .filter((filePath) => {
      try { return fsImpl.statSync(filePath).mtimeMs >= bounds.start; } catch { return false; }
    });
}

function readHeadIdentity(filePath, fsImpl = fs) {
  let descriptor;
  try {
    const size = fsImpl.statSync(filePath).size;
    descriptor = fsImpl.openSync(filePath, "r");
    const length = Math.min(size, READ_BLOCK_BYTES);
    const buffer = Buffer.alloc(length);
    fsImpl.readSync(descriptor, buffer, 0, length, 0);
    for (const line of buffer.toString("utf8").split("\n")) {
      if (!/^\{"timestamp":"[^"]+","type":"session_meta","payload":\{/.test(line)) continue;
      // Session metadata can contain unrelated context. Extract only UUID-like
      // identity fields instead of deserializing the full payload.
      const sessionId = line.match(/"payload":\{"id":"([0-9a-f-]{16,64})"/i)?.[1];
      const forkedFromId = line.match(/"forked_from_id":"([0-9a-f-]{16,64})"/i)?.[1] ?? null;
      return {
        sessionId: sessionId ?? path.basename(filePath, path.extname(filePath)),
        forkedFromId,
      };
    }
  } catch {}
  finally { if (descriptor !== undefined) try { fsImpl.closeSync(descriptor); } catch {} }
  return { sessionId: path.basename(filePath, path.extname(filePath)), forkedFromId: null };
}

function readFirstTurnTimestamp(filePath, fsImpl = fs, maximumBytes = MAX_HEAD_BYTES) {
  let descriptor;
  try {
    const size = fsImpl.statSync(filePath).size;
    descriptor = fsImpl.openSync(filePath, "r");
    let position = 0;
    let carry = "";
    while (position < size && position < maximumBytes) {
      const length = Math.min(READ_BLOCK_BYTES, size - position, maximumBytes - position);
      const buffer = Buffer.alloc(length);
      fsImpl.readSync(descriptor, buffer, 0, length, position);
      position += length;
      carry += buffer.toString("utf8");
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      if (carry.length > MAX_LINE_BYTES) carry = "";
      for (const line of lines) {
        const match = line.match(/^\{"timestamp":"([^"]+)","type":"turn_context","payload":\{/);
        if (!match) continue;
        const timestamp = Date.parse(match[1]);
        if (Number.isFinite(timestamp)) return { timestamp, complete: true };
      }
    }
    return { timestamp: null, complete: position >= size };
  } catch {
    return { timestamp: null, complete: false };
  } finally { if (descriptor !== undefined) try { fsImpl.closeSync(descriptor); } catch {} }
}

function scanTailEvents(filePath, bounds, scopeId, fsImpl = fs, maximumBytes = MAX_BACKFILL_BYTES) {
  const eventsNewestFirst = [];
  let descriptor;
  let boundaryReached = false;
  let reachedStart = false;
  let truncated = false;
  try {
    const size = fsImpl.statSync(filePath).size;
    descriptor = fsImpl.openSync(filePath, "r");
    let position = size;
    let bytesRead = 0;
    let carry = Buffer.alloc(0);
    let discardingOversizedLine = false;
    while (position > 0 && bytesRead < maximumBytes && !boundaryReached) {
      const length = Math.min(READ_BLOCK_BYTES, position, maximumBytes - bytesRead);
      position -= length;
      bytesRead += length;
      const block = Buffer.alloc(length);
      fsImpl.readSync(descriptor, block, 0, length, position);

      let combined;
      if (discardingOversizedLine) {
        const newline = block.lastIndexOf(10);
        if (newline < 0) continue;
        combined = block.subarray(0, newline);
        discardingOversizedLine = false;
      } else {
        combined = carry.length ? Buffer.concat([block, carry]) : block;
      }

      const newlineIndexes = [];
      for (let index = 0; index < combined.length; index += 1) if (combined[index] === 10) newlineIndexes.push(index);
      if (!newlineIndexes.length) {
        if (combined.length > MAX_LINE_BYTES) {
          carry = Buffer.alloc(0);
          discardingOversizedLine = true;
        } else carry = combined;
        continue;
      }

      const firstNewline = newlineIndexes[0];
      carry = combined.subarray(0, firstNewline);
      let end = combined.length;
      for (let index = newlineIndexes.length - 1; index >= 0; index -= 1) {
        const start = newlineIndexes[index] + 1;
        if (end > start && end - start <= MAX_LINE_BYTES) {
          const event = tokenEventFromLine(combined.subarray(start, end).toString("utf8").trimEnd(), scopeId);
          if (event) {
            if (event.timestamp < bounds.start) {
              boundaryReached = true;
              break;
            }
            if (event.timestamp < bounds.end) eventsNewestFirst.push(event);
          }
        }
        end = newlineIndexes[index];
      }
    }
    reachedStart = position === 0;
    if (reachedStart && carry.length && carry.length <= MAX_LINE_BYTES && !boundaryReached) {
      const event = tokenEventFromLine(carry.toString("utf8").trimEnd(), scopeId);
      if (event) {
        if (event.timestamp < bounds.start) boundaryReached = true;
        else if (event.timestamp < bounds.end) eventsNewestFirst.push(event);
      }
    }
    truncated = !reachedStart && !boundaryReached;
    return { events: eventsNewestFirst.reverse(), complete: reachedStart || boundaryReached, truncated, size };
  } catch {
    return { events: [], complete: false, truncated: true, size: 0 };
  } finally { if (descriptor !== undefined) try { fsImpl.closeSync(descriptor); } catch {} }
}

function scanAppendedEvents(filePath, previousSize, bounds, scopeId, fsImpl = fs, maximumBytes = MAX_INCREMENTAL_BYTES) {
  const events = [];
  let descriptor;
  try {
    const size = fsImpl.statSync(filePath).size;
    const start = Math.max(0, Math.min(size, previousSize) - INCREMENTAL_OVERLAP_BYTES);
    const end = Math.min(size, start + maximumBytes);
    descriptor = fsImpl.openSync(filePath, "r");
    let position = start;
    let carry = Buffer.alloc(0);
    // The overlap intentionally begins inside already-seen data. Discard its
    // first partial line; subsequent complete events are safe to deduplicate.
    let discardingOversizedLine = start > 0;
    while (position < end) {
      const length = Math.min(READ_BLOCK_BYTES, end - position);
      const block = Buffer.alloc(length);
      fsImpl.readSync(descriptor, block, 0, length, position);
      position += length;
      let combined = carry.length ? Buffer.concat([carry, block]) : block;
      carry = Buffer.alloc(0);
      if (discardingOversizedLine) {
        const newline = combined.indexOf(10);
        if (newline < 0) continue;
        combined = combined.subarray(newline + 1);
        discardingOversizedLine = false;
      }
      let lineStart = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 10) continue;
        const lengthOfLine = index - lineStart;
        if (lengthOfLine > 0 && lengthOfLine <= MAX_LINE_BYTES) {
          const event = tokenEventFromLine(combined.subarray(lineStart, index).toString("utf8").trimEnd(), scopeId);
          if (event && event.timestamp >= bounds.start && event.timestamp < bounds.end) events.push(event);
        }
        lineStart = index + 1;
      }
      carry = combined.subarray(lineStart);
      if (carry.length > MAX_LINE_BYTES) {
        carry = Buffer.alloc(0);
        discardingOversizedLine = true;
      }
    }
    return { events, complete: end >= size, size };
  } catch {
    return { events: [], complete: false, size: 0 };
  } finally { if (descriptor !== undefined) try { fsImpl.closeSync(descriptor); } catch {} }
}

export function scanLocalTodayUsage(options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const bounds = localDayBounds(options.now ?? Date.now());
  if (!bounds) return { status: "unavailable", todayTokens: null, receivedAt: Date.now(), complete: false, scannedFiles: 0 };
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? pathImpl.join(os.homedir(), ".codex");
  const candidates = discoverTodayFiles(codexHome, bounds, fsImpl, pathImpl);
  const fileStates = new Map();
  const events = [];
  let complete = true;
  for (const filePath of candidates) {
    const identity = readHeadIdentity(filePath, fsImpl);
    const scopeId = identity.forkedFromId ?? identity.sessionId;
    const scanned = scanTailEvents(filePath, bounds, scopeId, fsImpl, options.maximumBytes ?? MAX_BACKFILL_BYTES);
    let ownTurnTimestamp = null;
    if (identity.forkedFromId) {
      const ownTurn = readFirstTurnTimestamp(filePath, fsImpl, options.maximumHeadBytes ?? MAX_HEAD_BYTES);
      ownTurnTimestamp = ownTurn.timestamp;
      if (!ownTurn.complete && ownTurnTimestamp === null) complete = false;
    }
    const accepted = identity.forkedFromId
      ? scanned.events.filter((event) => ownTurnTimestamp !== null && event.timestamp > ownTurnTimestamp)
      : scanned.events;
    events.push(...accepted);
    complete &&= scanned.complete;
    fileStates.set(filePath, { size: scanned.size, identity, ownTurnTimestamp });
  }
  const aggregated = aggregateTokenEvents(events);
  const receivedAt = Number(options.now ?? Date.now());
  return {
    status: complete ? "ready" : "partial",
    todayTokens: aggregated.addedTokens,
    receivedAt,
    complete,
    scannedFiles: candidates.length,
    acceptedEvents: aggregated.acceptedEvents,
    fileStates,
    seen: aggregated.seen,
    previousByScope: aggregated.previousByScope,
    dayKey: bounds.key,
  };
}

function scanIncrementalTodayUsage(previous, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const now = Number(options.now ?? Date.now());
  const bounds = localDayBounds(now);
  if (!bounds || previous?.dayKey !== bounds.key || !(previous?.fileStates instanceof Map)) {
    return scanLocalTodayUsage({ ...options, now });
  }
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? pathImpl.join(os.homedir(), ".codex");
  const candidates = discoverTodayFiles(codexHome, bounds, fsImpl, pathImpl);
  const nextFileStates = new Map(previous.fileStates);
  const events = [];
  let complete = previous.complete === true;
  let rebuild = false;
  for (const filePath of candidates) {
    let size;
    try { size = fsImpl.statSync(filePath).size; } catch { continue; }
    const known = previous.fileStates.get(filePath);
    if (known && size === known.size) continue;
    if (known && size < known.size) {
      rebuild = true;
      break;
    }
    const identity = known?.identity ?? readHeadIdentity(filePath, fsImpl);
    const scopeId = identity.forkedFromId ?? identity.sessionId;
    const ownTurn = identity.forkedFromId && known?.ownTurnTimestamp === null
      ? readFirstTurnTimestamp(filePath, fsImpl, options.maximumHeadBytes ?? MAX_HEAD_BYTES)
      : { timestamp: known?.ownTurnTimestamp ?? null, complete: true };
    const ownTurnTimestamp = ownTurn.timestamp;
    if (!ownTurn.complete && ownTurnTimestamp === null) complete = false;
    const scanned = known
      ? scanAppendedEvents(filePath, known.size, bounds, scopeId, fsImpl, options.maximumIncrementalBytes ?? MAX_INCREMENTAL_BYTES)
      : scanTailEvents(filePath, bounds, scopeId, fsImpl, options.maximumBytes ?? MAX_BACKFILL_BYTES);
    const accepted = identity.forkedFromId
      ? scanned.events.filter((event) => ownTurnTimestamp !== null && event.timestamp > ownTurnTimestamp)
      : scanned.events;
    events.push(...accepted);
    complete &&= scanned.complete;
    nextFileStates.set(filePath, { size, identity, ownTurnTimestamp });
  }
  if (rebuild) return scanLocalTodayUsage({ ...options, now });
  const aggregated = aggregateTokenEvents(events, {
    seen: previous.seen instanceof Set ? previous.seen : new Set(),
    previousByScope: previous.previousByScope instanceof Map ? previous.previousByScope : new Map(),
  });
  return {
    ...previous,
    status: complete ? "ready" : "partial",
    todayTokens: nonNegativeInteger(previous.todayTokens) + aggregated.addedTokens,
    receivedAt: now,
    complete,
    scannedFiles: candidates.length,
    acceptedEvents: nonNegativeInteger(previous.acceptedEvents) + aggregated.acceptedEvents,
    fileStates: nextFileStates,
    seen: aggregated.seen,
    previousByScope: aggregated.previousByScope,
  };
}

export class LocalTokenUsageRuntime {
  constructor(options = {}) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.onChange = options.onChange ?? (() => {});
    this.intervalMs = options.intervalMs ?? 10_000;
    this.timer = null;
    this.refreshing = false;
    this.state = { status: "loading", todayTokens: null, receivedAt: 0, complete: false, scannedFiles: 0 };
    this.lastPublishedSignature = null;
  }

  getState() {
    const { fileStates, seen, previousByScope, ...publicState } = this.state;
    return publicState;
  }

  publishIfChanged() {
    const state = this.getState();
    const signature = JSON.stringify({
      status: state.status,
      todayTokens: state.todayTokens,
      complete: state.complete === true,
      scannedFiles: state.scannedFiles,
      acceptedEvents: state.acceptedEvents,
      dayKey: state.dayKey,
    });
    if (signature === this.lastPublishedSignature) return false;
    this.lastPublishedSignature = signature;
    this.onChange(state);
    return true;
  }

  refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    setImmediate(() => {
      try {
        const timestamp = this.now();
        const next = this.state?.dayKey
          ? scanIncrementalTodayUsage(this.state, { ...this.options, now: timestamp })
          : scanLocalTodayUsage({ ...this.options, now: timestamp });
        this.state = next;
      } catch {
        this.state = { status: "unavailable", todayTokens: null, receivedAt: this.now(), complete: false, scannedFiles: 0 };
      } finally {
        this.refreshing = false;
        this.publishIfChanged();
      }
    });
  }

  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
