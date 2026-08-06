import fs from "node:fs";
import path from "node:path";
import { assertVerificationPermissions } from "./verify-safety.mjs";

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
};
const port = Number(valueAfter("--port"));
const output = valueAfter("--output");
const requestedRegion = valueAfter("--region") ?? "account";
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !output || !["account", "panel"].includes(requestedRegion)) {
  throw new Error("Usage: node scripts/capture-account-ui.mjs --port <port> --output <png> [--region account|panel] --allow-sensitive-capture");
}
assertVerificationPermissions({ argv, sensitiveCapture: true });

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
  const expression = requestedRegion === "panel"
    ? `(() => { const node = document.getElementById("quotapin-profile-editor"); if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`
    : `(() => { const badge = document.getElementById("quotapin-inline-badge"); const node = badge?.parentElement; if (!node) return null; const r = node.getBoundingClientRect(); const pad = 8; return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: Math.min(innerWidth - Math.max(0, r.left - pad), r.width + pad * 2), height: Math.min(innerHeight - Math.max(0, r.top - pad), r.height + pad * 2), scale: 1 }; })()`;
  const evaluated = await send("Runtime.evaluate", { expression, returnByValue: true });
  const clip = evaluated?.result?.value;
  if (!clip || clip.width <= 0 || clip.height <= 0) throw new Error(`${requestedRegion} region is not visible`);
  const capture = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, capture.data, "base64");
  console.log(JSON.stringify({ ok: true, region: requestedRegion, output: outputPath, clip }));
} finally {
  socket.close();
}
