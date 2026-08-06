import { assertVerificationPermissions } from "./verify-safety.mjs";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/verify-layout.mjs --port <loopback-port> --allow-live-input");
}
assertVerificationPermissions({ argv: process.argv.slice(2), liveModes: ["layout mutation"] });

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
const targets = response.ok ? await response.json() : [];
const target = targets.find((item) => item.url === "app://-/index.html" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Codex main target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const result = await new Promise((resolve, reject) => {
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      returnByValue: true,
      expression: "window.__quotaPinController?.verifyLayoutMatrix?.() ?? []",
    },
  }));
});
socket.close();

console.log(JSON.stringify(result));
if (result.length !== 12 || !result.every((item) => item.passed === true)) process.exit(1);
