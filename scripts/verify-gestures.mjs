import { assertVerificationPermissions } from "./verify-safety.mjs";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/verify-gestures.mjs --port <loopback-port> --allow-live-input");
}
assertVerificationPermissions({ argv: process.argv.slice(2), liveModes: ["gesture input"] });

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}`);
const targets = await response.json();
const target = targets.find((item) => item.url === "app://-/index.html" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Codex main target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
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
}
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}
async function pressEscape() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await wait(120);
}
async function resetUi() {
  await evaluate("window.__quotaPinController?.closeEditor?.()");
  await pressEscape();
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
}
async function state() {
  return evaluate(`(() => {
    const badge = document.getElementById("quotapin-inline-badge");
    const rect = badge?.getBoundingClientRect();
    const hostRect = badge?.parentElement?.getBoundingClientRect();
    const hostMenuOpen = Boolean(hostRect && [...document.querySelectorAll('[role="menu"]')].some((node) => {
      const value = node.getBoundingClientRect();
      return value.width > 0 && value.height > 0 && value.left < hostRect.right + 40 && value.bottom >= hostRect.top - 24;
    }));
    const editor = document.getElementById("quotapin-profile-editor");
    const language = editor?.querySelector('select[aria-label="Language"]');
    return {
      badge: Boolean(badge),
      gesture: badge?.dataset.quotapinGesture ?? null,
      gestureError: badge?.dataset.quotapinGestureError ?? null,
      center: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      accountPoint: hostRect ? { x: hostRect.left + Math.min(22, hostRect.width / 4), y: hostRect.top + hostRect.height / 2 } : null,
      badgeHeight: rect?.height ?? null,
      hostHeight: hostRect?.height ?? null,
      viewport: { width: innerWidth, height: innerHeight },
      hostMenuOpen,
      editorOpen: Boolean(editor),
      language: language?.value ?? null,
      languageOptions: language ? [...language.options].map((option) => option.value) : [],
    };
  })()`);
}

await resetUi();
let initial = await state();
if (!initial.badge || !initial.center || !initial.accountPoint) throw new Error("QuotaPin account trigger was not found");

await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(160);
let longPress = await state();
if (!longPress.editorOpen) {
  await resetUi();
  await wait(250);
  initial = await state();
  await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
  await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
  await wait(1100);
  await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
  await wait(160);
  longPress = await state();
}

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(80);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(160);
const shortPress = await state();

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const beforeShortClose = await state();
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(80);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const shortClose = await state();

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const beforeBadgeShortClose = await state();
await mouse("mouseMoved", beforeBadgeShortClose.center.x, beforeBadgeShortClose.center.y);
await mouse("mousePressed", beforeBadgeShortClose.center.x, beforeBadgeShortClose.center.y);
await wait(80);
await mouse("mouseReleased", beforeBadgeShortClose.center.x, beforeBadgeShortClose.center.y);
await wait(120);
const badgeShortClose = await state();

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const beforeLongClose = await state();
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const longClose = await state();

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
const beforeBadgeLongClose = await state();
await mouse("mouseMoved", beforeBadgeLongClose.center.x, beforeBadgeLongClose.center.y);
await mouse("mousePressed", beforeBadgeLongClose.center.x, beforeBadgeLongClose.center.y);
await wait(1100);
await mouse("mouseReleased", beforeBadgeLongClose.center.x, beforeBadgeLongClose.center.y);
await wait(120);
const badgeLongClose = await state();

await resetUi();
initial = await state();
await mouse("mouseMoved", initial.accountPoint.x, initial.accountPoint.y);
await mouse("mousePressed", initial.accountPoint.x, initial.accountPoint.y);
await wait(1100);
await mouse("mouseReleased", initial.accountPoint.x, initial.accountPoint.y);
await wait(120);
await mouse("mouseMoved", Math.max(500, initial.viewport.width * 0.7), 120);
await mouse("mousePressed", Math.max(500, initial.viewport.width * 0.7), 120);
await mouse("mouseReleased", Math.max(500, initial.viewport.width * 0.7), 120);
await wait(120);
const outsideClick = await state();
await resetUi();
socket.close();

const result = {
  longPressOpensQuotaPin: longPress.editorOpen,
  longPressSuppressesCodex: !longPress.hostMenuOpen,
  shortPressOpensCodex: shortPress.hostMenuOpen,
  shortPressSuppressesQuotaPin: !shortPress.editorOpen,
  shortPressClosesOpenQuotaPin: beforeShortClose.editorOpen && !shortClose.editorOpen,
  shortCloseSuppressesCodex: !shortClose.hostMenuOpen,
  stationaryBadgeShortClosesOpenQuotaPin: beforeBadgeShortClose.editorOpen && !badgeShortClose.editorOpen,
  stationaryBadgeShortSuppressesCodex: !badgeShortClose.hostMenuOpen,
  longPressClosesOpenQuotaPin: beforeLongClose.editorOpen && !longClose.editorOpen,
  longCloseSuppressesCodex: !longClose.hostMenuOpen,
  stationaryBadgeHoldClosesOpenQuotaPin: beforeBadgeLongClose.editorOpen && !badgeLongClose.editorOpen,
  stationaryBadgeHoldSuppressesCodex: !badgeLongClose.hostMenuOpen,
  outsideClickClosesEditor: !outsideClick.editorOpen,
  expandedHitTarget: initial.badgeHeight >= initial.hostHeight - 2,
  wholeAccountRowIsTrigger: longPress.editorOpen && shortPress.hostMenuOpen,
  activeLanguage: longPress.language,
  languageOptions: longPress.languageOptions,
  longGesture: longPress.gesture,
  longGestureError: longPress.gestureError,
  shortGesture: shortPress.gesture,
};
console.log(JSON.stringify(result));
if (!Object.entries(result).filter(([key]) => !["activeLanguage", "languageOptions", "longGesture", "longGestureError", "shortGesture"].includes(key)).every(([, value]) => value === true)) process.exit(1);
if (!result.languageOptions.includes(result.activeLanguage) || result.languageOptions.join(",") !== "en,zh-CN,ja") process.exit(1);
