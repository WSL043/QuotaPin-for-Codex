const portIndex = process.argv.indexOf("--port");
const durationIndex = process.argv.indexOf("--duration-ms");
const intervalIndex = process.argv.indexOf("--interval-ms");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
const durationMs = Number(durationIndex >= 0 ? process.argv[durationIndex + 1] : 35_000);
const intervalMs = Number(intervalIndex >= 0 ? process.argv[intervalIndex + 1] : 20);
const summaryOnly = process.argv.includes("--summary-only");

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/trace-live-modules.mjs --port <loopback-port> [--duration-ms 35000] [--interval-ms 20]");
}

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
const targets = await response.json();
const target = targets.find((item) => item.url === "app://-/index.html" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Codex main target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let messageId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result?.result?.value);
});

const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({
    id,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true },
  }));
});

const startedAt = Date.now();
let samples = 0;
let lastSignature = null;
const changes = [];

while (Date.now() - startedAt < durationMs) {
  const snapshot = await evaluate(`(() => {
    const badge = document.getElementById("quotapin-inline-badge");
    const row = badge?.parentElement ?? null;
    const delivery = window.__quotaPinController?.inspectDeliveryRuntime?.() ?? null;
    const layout = window.__quotaPinController?.inspectLayoutRuntime?.() ?? null;
    const parts = badge ? [...badge.querySelectorAll("[data-part]")].map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        part: node.dataset.part,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
      };
    }) : [];
    const modules = row ? [...row.querySelectorAll("[data-quotapin-module]")].map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        module: node.dataset.quotapinModule,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
      };
    }) : [];
    return {
      at: performance.now(),
      sequence: delivery?.highestSequence ?? null,
      reason: delivery?.lastReason ?? null,
      expectedVisible: delivery?.trace?.filter((entry) => entry.accepted).at(-1)?.visible ?? [],
      renders: layout?.renders ?? null,
      reconciliations: layout?.reconciliations ?? null,
      integrityRepairs: layout?.integrityRepairs ?? null,
      badgeDisplay: badge ? getComputedStyle(badge).display : null,
      parts,
      modules,
    };
  })()`);
  samples += 1;
  const visible = snapshot.parts.filter((part) => part.display !== "none" && part.visibility !== "hidden" && part.opacity !== "0" && part.width > 0 && part.height > 0);
  const signature = JSON.stringify({
    sequence: snapshot.sequence,
    reason: snapshot.reason,
    renders: snapshot.renders,
    reconciliations: snapshot.reconciliations,
    badgeDisplay: snapshot.badgeDisplay,
    parts: snapshot.parts,
  });
  const expectedVisible = new Set(snapshot.expectedVisible);
  const unexpected = visible.filter((part) => part.part !== "bar-fill" && !expectedVisible.has(part.part));
  const positioned = snapshot.modules
    .filter((module) => module.display !== "none" && module.visibility !== "hidden" && module.opacity !== "0" && module.width > 0 && module.height > 0)
    .sort((left, right) => left.left - right.left || left.right - right.right);
  const overlaps = positioned.slice(1).flatMap((module, index) => module.left < positioned[index].right - .5
    ? [[positioned[index].module, module.module]]
    : []);
  if (signature !== lastSignature || unexpected.length > 0 || overlaps.length > 0) {
    changes.push({ elapsedMs: Date.now() - startedAt, unexpected: unexpected.map((part) => part.part), overlaps, ...snapshot });
    lastSignature = signature;
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

socket.close();
const unexpectedChanges = changes.filter((entry) => entry.unexpected.length > 0);
const overlapChanges = changes.filter((entry) => entry.overlaps.length > 0);
const repairChanges = changes.filter((entry, index) => index > 0 && entry.integrityRepairs !== changes[index - 1].integrityRepairs);
const final = changes.at(-1) ?? null;
const compactChange = (entry) => entry ? {
  elapsedMs: entry.elapsedMs,
  sequence: entry.sequence,
  reason: entry.reason,
  renders: entry.renders,
  reconciliations: entry.reconciliations,
  integrityRepairs: entry.integrityRepairs,
  unexpected: entry.unexpected,
  overlaps: entry.overlaps,
  visibleModules: entry.modules
    .filter((module) => module.display !== "none" && module.visibility !== "hidden" && module.opacity !== "0" && module.width > 0 && module.height > 0)
    .map(({ module, left, right, width }) => ({ module, left, right, width })),
} : null;
console.log(JSON.stringify(summaryOnly
  ? {
      durationMs: Date.now() - startedAt,
      intervalMs,
      samples,
      changeCount: changes.length,
      unexpectedChangeCount: unexpectedChanges.length,
      overlapChangeCount: overlapChanges.length,
      repairChangeCount: repairChanges.length,
      unexpectedChanges: unexpectedChanges.map(compactChange),
      overlapChanges: overlapChanges.map(compactChange),
      repairChanges: repairChanges.map(compactChange),
      final: compactChange(final),
    }
  : { durationMs: Date.now() - startedAt, intervalMs, samples, changes }, null, 2));
