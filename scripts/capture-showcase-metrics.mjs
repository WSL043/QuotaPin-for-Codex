import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
};
const port = Number(valueAfter("--port"));
const output = valueAfter("--output");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/capture-showcase-metrics.mjs --port <port> [--output <json>]");
}

const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
if (!targetsResponse.ok) throw new Error(`CDP returned HTTP ${targetsResponse.status}`);
const targets = await targetsResponse.json();
const target = targets.find((item) => item.url === "app://-/index.html" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Codex main target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const onMessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== id) return;
    socket.removeEventListener("message", onMessage);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  };
  socket.addEventListener("message", onMessage);
  socket.send(JSON.stringify({ id, method, params }));
});

try {
  const expression = `(() => {
    const badge = document.getElementById("quotapin-inline-badge");
    const row = badge?.parentElement;
    if (!row) return null;
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const relative = (node) => {
      const own = rect(node); const host = rect(row);
      return own && host ? { left: own.left - host.left, top: own.top - host.top, rightGap: host.right - own.right, bottomGap: host.bottom - own.bottom, width: own.width, height: own.height } : null;
    };
    const style = (node) => {
      const value = getComputedStyle(node);
      return Object.fromEntries(["fontFamily","fontSize","fontWeight","lineHeight","color","backgroundColor","borderRadius","paddingLeft","paddingRight","letterSpacing"].map((key) => [key, value[key]]));
    };
    const avatar = row.querySelector('[data-quotapin-module="avatar"]') || row.querySelector("img");
    const name = row.querySelector('[data-quotapin-module="name"]');
    const value = badge.querySelector('[data-part="value"]');
    const ancestors = [];
    for (let node = row.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) {
      const box = rect(node); if (box) ancestors.push({ depth, width: box.width, height: box.height, left: box.left, top: box.top });
    }
    return {
      schema: 1,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      row: { rect: rect(row), style: style(row) },
      avatar: { rect: relative(avatar), style: style(avatar) },
      name: { rect: relative(name), style: style(name) },
      value: { rect: relative(value), style: style(value) },
      badgeRightGap: rect(row).right - rect(value).right,
      ancestors,
    };
  })()`;
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true });
  const metrics = evaluated?.result?.value;
  if (!metrics) throw new Error("QuotaPin account row is not visible");
  const serialized = `${JSON.stringify(metrics, null, 2)}\n`;
  if (output) {
    const outputPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
} finally {
  socket.close();
}
