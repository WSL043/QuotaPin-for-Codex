import { assertVerificationPermissions } from "./verify-safety.mjs";

const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/verify-panel.mjs --port <loopback-port> --allow-live-input");
}
assertVerificationPermissions({ argv: process.argv.slice(2), liveModes: ["panel and configuration mutation"] });

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
const targets = response.ok ? await response.json() : [];
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

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Renderer evaluation failed");
  return result.result.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const measure = () => evaluate(`(() => {
  const panel = document.getElementById("quotapin-profile-editor");
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  const scrollOwners = [...panel.querySelectorAll("*")].filter((node) => {
    const style = getComputedStyle(node);
    return style.display !== "none" && ["auto", "scroll"].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
  }).map((node) => node.dataset.section || node.dataset.codeConfig || node.tagName);
  return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), bottom: Math.round(innerHeight - rect.bottom), scrollOwners };
})()`);
const click = (selector) => evaluate(`(() => {
  const node = document.querySelector(${JSON.stringify(`#quotapin-profile-editor ${selector}`)});
  node?.click();
  return Boolean(node);
})()`);

function stableStringify(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
  };
  return JSON.stringify(normalize(value));
}

const configSnapshotJson = await evaluate("JSON.stringify(window.__quotaPinController?.preferences ?? null)");
if (!configSnapshotJson || configSnapshotJson === "null") throw new Error("QuotaPin configuration was not available for a safe verification snapshot");
const expectedConfigSignature = stableStringify(JSON.parse(configSnapshotJson));
let result;
let verificationError = null;

try {
await evaluate("window.__quotaPinController?.closeEditor?.(); window.__quotaPinController?.openEditor?.(); true");
await wait(120);
result = { quick: await measure() };
Object.assign(result, await evaluate(`(() => {
  const panel = document.getElementById("quotapin-profile-editor");
  if (!panel) return { error: "editor missing" };
  const arcadeEntry = panel.querySelector('[data-secret-entry="arcade"]');
  const egg = panel.querySelector('[data-config-key="overdriveEgg"]');
  const secretEffects = [...panel.querySelectorAll('[data-arcade-effect]')];
  const secretAlways = panel.querySelector('[data-config-key="overdriveAlways"]');
  const secretPlay = panel.querySelector('[data-action="preview-egg"]');
  const secretIdea = panel.querySelector('[data-arcade-idea="true"]');
  const rowModules = [...(document.getElementById("quotapin-inline-badge")?.parentElement?.querySelectorAll('[data-quotapin-module]') ?? [])];
  const layoutModeStart = panel.querySelector('[data-quick-value="auto"]');
  return {
    directManipulationFound: panel.dataset.rowEditing === "true" && document.getElementById("quotapin-inline-badge")?.parentElement?.dataset.quotapinEditing === "true",
    draggableModules: rowModules.map((node) => node.dataset.quotapinModule),
    fakePreviewAbsent: !panel.querySelector('[data-direct-manipulation="badge"]'),
    liveLayoutHintFound: Boolean(panel.querySelector('[data-layout-live-hint="true"]')),
    profileMenuFound: Boolean(panel.querySelector('[data-profile-menu="true"]')),
    quickValueToggleFound: Boolean(panel.querySelector('[data-toggle="Show value"]')),
    quickDotToggleFound: Boolean(panel.querySelector('[data-toggle="Show status dot"]')),
    quickLabelToggleFound: Boolean(panel.querySelector('[data-toggle="Show window label"]')),
    quickCountdownToggleFound: Boolean(panel.querySelector('[data-toggle="Show countdown"]')),
    quickSecondsToggleFound: Boolean(panel.querySelector('[data-toggle="Show seconds"]')),
    quickDateToggleFound: Boolean(panel.querySelector('[data-toggle="Show reset date"]')),
    quickResetToggleFound: Boolean(panel.querySelector('[data-toggle="Show reset time"]')),
    quickAvatarToggleFound: Boolean(panel.querySelector('[data-toggle="Avatar"]')),
    quickNameToggleFound: Boolean(panel.querySelector('[data-toggle="Name"]')),
    layoutModeValues: [...(layoutModeStart?.parentElement?.querySelectorAll('[data-quick-value]') ?? [])].map((node) => node.dataset.quickValue),
    quickHasNoTuneControls: !panel.querySelector('[data-editor-panel="quick"] [data-config-key="effect"], [data-editor-panel="quick"] [data-config-key="warning"], [data-editor-panel="quick"] [data-palette-key]'),
    dividerSurfaceAbsent: !panel.querySelector('[data-divider-for], [data-config-key="moduleDivider"], [data-config-key="dividerText"]'),
    topLevelModes: [...panel.querySelectorAll('[role="tablist"] [data-editor-mode]')].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.dataset.editorMode),
    arcadeInitiallyHidden: Boolean(arcadeEntry && getComputedStyle(arcadeEntry).display === "none"),
    secretCopyInitiallyBlank: arcadeEntry?.textContent === "" && egg?.getAttribute("aria-label") === "" && secretEffects.every((button) => button.textContent === "") && secretAlways?.getAttribute("aria-label") === "" && secretPlay?.textContent === "" && secretIdea?.hidden === true && !secretIdea?.getAttribute("href"),
    secretPageBuilt: secretEffects.length === 3 && Boolean(secretAlways && secretPlay && secretIdea && panel.querySelector('[data-arcade-status="true"]')),
    overdriveEggFound: Boolean(egg),
    overdriveEggHidden: Boolean(egg && getComputedStyle(egg.closest('[data-secret-control="overdriveEgg"]')).display === "none"),
    overdriveEggChecked: egg?.checked ?? null,
    projectLinkFound: panel.querySelector('[data-project-link="github"]')?.getAttribute("href") === "https://github.com/WSL043/QuotaPin-for-Codex",
    languageOptions: [...(panel.querySelector('select[aria-label="Language"]')?.options ?? [])].map((option) => option.value),
  };
})()`));
const dragResult = await evaluate(`(() => {
  const panel = document.getElementById("quotapin-profile-editor");
  const badge = document.getElementById("quotapin-inline-badge");
  const row = badge?.parentElement;
  const profileId = panel?.querySelector('select[data-profile-select="true"]')?.value;
  const dragged = row?.querySelector('[data-quotapin-module="value"]');
  if (!row || !badge || !dragged || !profileId) return { worked: false };
  const currentProfile = window.__quotaPinController?.preferences?.profiles?.find?.((item) => item.id === profileId);
  const original = { moduleOrder: [...(currentProfile?.moduleOrder ?? ["avatar", "name", "dot", "value", "label", "countdown", "relative", "seconds", "date", "reset"])] };
  const rr = row.getBoundingClientRect();
  const br = dragged.getBoundingClientRect();
  const grabX = br.width / 2;
  const grabY = br.height / 2;
  const beforeAvatarLeft = row.querySelector('[data-quotapin-module="avatar"]')?.getBoundingClientRect().left ?? null;
  const event = (type, clientX, clientY, buttons) => dragged.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 91, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX, clientY }));
  event("pointerdown", br.left + grabX, br.top + grabY, 1);
  event("pointermove", rr.left + 2 + grabX, br.top + grabY, 1);
  const pushedAvatar = row.querySelector('[data-quotapin-module="avatar"]');
  const afterAvatarLeft = pushedAvatar?.getBoundingClientRect().left ?? null;
  const pushAnimationObserved = beforeAvatarLeft != null && afterAvatarLeft != null
    && Math.abs(afterAvatarLeft - beforeAvatarLeft) > .5
    && String(pushedAvatar?.style.transition ?? "").includes("left");
  event("pointerup", rr.left + 2 + grabX, br.top + grabY, 0);
  window.__quotapinDragAudit = { profileId, original };
  return { worked: true, original, pushAnimationObserved };
})()`);
await wait(260);
const persistedDrag = await evaluate(`(() => {
  const audit = window.__quotapinDragAudit;
  const badge = document.getElementById("quotapin-inline-badge");
  if (!audit || !badge) return { worked: false };
  const profile = window.__quotaPinController?.preferences?.profiles?.find?.((item) => item.id === audit.profileId);
  const row = badge.parentElement;
  const modules = [...row.querySelectorAll('[data-quotapin-module]')].filter((node) => {
    const rect = node.getBoundingClientRect();
    return getComputedStyle(node).display !== "none" && rect.width > 0 && rect.height > 0;
  });
  const centers = modules.map((node) => { const rect = node.getBoundingClientRect(); return rect.top + rect.height / 2; });
  const aligned = centers.length > 0 && Math.max(...centers) - Math.min(...centers) < 1;
  const name = row.querySelector('[data-quotapin-module="name"]');
  const ellipsisReady = getComputedStyle(name).textOverflow === "ellipsis" && getComputedStyle(name).minWidth === "0px";
  const worked = profile?.moduleOrder?.[0] === "value" && aligned && ellipsisReady;
  delete window.__quotapinDragAudit;
  return { worked, moduleOrder: profile?.moduleOrder ?? null, aligned, ellipsisReady };
})()`);
result.directManipulationWorked = dragResult.worked && dragResult.pushAnimationObserved && persistedDrag.worked;
result.directManipulation = { ...dragResult, persisted: persistedDrag };
await wait(120);

result.advancedFound = await click('[data-editor-mode="advanced"]');
await wait(40);
result.advanced = await measure();
Object.assign(result, await evaluate(`(() => {
  const panel = document.getElementById("quotapin-profile-editor");
  return {
    nameEditable: Boolean(panel?.querySelector('input[maxlength="24"]')),
    advancedDuplicatesAbsent: !panel?.querySelector('[data-editor-panel="advanced"] :is([data-toggle="Show value"], [data-toggle="Show status dot"], [data-toggle="Avatar"], [data-toggle="Name"])'),
    nameColorFound: Boolean(panel?.querySelector('[data-config-key="identityColor"]')),
    precisionControlsFound: Boolean(panel?.querySelector('[data-config-key="fontSize"] input[type="range"]')) && !panel?.querySelector('[data-config-key="offsetX"],[data-config-key="offsetY"],[data-config-key="position"]'),
    moduleOrderFound: panel?.querySelectorAll('[data-editor-panel="quick"] [data-layout-module]').length === 10,
    dividerControlAbsent: !panel?.querySelector('[data-editor-panel="quick"] [data-config-key="moduleDivider"], [data-editor-panel="quick"] [data-config-key="dividerText"]'),
    visibleModuleControlCount: panel?.querySelectorAll('[data-editor-panel="quick"] [data-toggle^="Show "]').length ?? 0,
    paletteOrder: [...(panel?.querySelectorAll('[data-palette-key]') ?? [])].map((item) => item.dataset.paletteKey),
    paletteLabels: [...(panel?.querySelectorAll('[data-palette-key] > span') ?? [])].map((item) => item.textContent?.trim()),
    effectOptions: [...(panel?.querySelector('select[data-config-key="effect"]')?.options ?? [])].map((option) => option.value),
    effectAtOptions: [...(panel?.querySelector('select[data-config-key="effectAt"]')?.options ?? [])].map((option) => option.value),
  };
})()`));

result.codeFound = await click('[data-editor-mode="code"]');
await wait(40);
result.code = await measure();
Object.assign(result, await evaluate(`(() => {
  const panel = document.getElementById("quotapin-profile-editor");
  const editor = panel?.querySelector('textarea[data-code-config="json"]');
  return {
    resetViewFound: Boolean(panel?.querySelector('[data-action="reset-profile"]')),
    codePresetCount: panel?.querySelectorAll('[data-code-preset]').length ?? 0,
    codeJsonFound: Boolean(editor),
    codeApplyFound: Boolean(panel?.querySelector('[data-action="apply-json"]')),
    codeHidesSecrets: Boolean(editor && !editor.value.includes("overdriveEgg") && !editor.value.includes("overdriveAlways") && !editor.value.includes("overdriveEffect")),
  };
})()`));

} catch (error) {
  verificationError = error;
} finally {
  try {
    const restoreDispatched = await evaluate(`(() => {
      window.__quotaPinController?.closeEditor?.();
      if (typeof globalThis.quotapinConfigAction !== "function") return false;
      globalThis.quotapinConfigAction(JSON.stringify({ type: "replaceConfig", config: JSON.parse(${JSON.stringify(configSnapshotJson)}) }));
      return true;
    })()`);
    if (!restoreDispatched) throw new Error("QuotaPin configuration restore binding was unavailable");

    let restored = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await wait(80);
      const currentJson = await evaluate("JSON.stringify(window.__quotaPinController?.preferences ?? null)");
      if (currentJson && currentJson !== "null" && stableStringify(JSON.parse(currentJson)) === expectedConfigSignature) {
        restored = true;
        break;
      }
    }
    if (!restored) throw new Error("QuotaPin configuration did not return to its pre-verification snapshot");
  } catch (error) {
    verificationError = verificationError
      ? new AggregateError([verificationError, error], "Panel verification failed and its configuration snapshot could not be restored")
      : error;
  } finally {
    socket.close();
  }
}

if (verificationError) throw verificationError;

console.log(JSON.stringify(result));
const sizes = [result.quick, result.advanced, result.code].map((item) => `${item?.width}x${item?.height}@${item?.left},${item?.bottom}`);
if (new Set(sizes).size !== 1 || !result.advancedFound || !result.codeFound || !result.nameEditable) process.exit(1);
if (![result.directManipulationFound, result.fakePreviewAbsent, result.liveLayoutHintFound, result.profileMenuFound, result.quickValueToggleFound, result.quickDotToggleFound, result.quickLabelToggleFound, result.quickCountdownToggleFound, result.quickSecondsToggleFound, result.quickDateToggleFound, result.quickResetToggleFound, result.quickAvatarToggleFound, result.quickNameToggleFound, result.quickHasNoTuneControls, result.dividerSurfaceAbsent, result.advancedDuplicatesAbsent, result.nameColorFound, result.precisionControlsFound, result.moduleOrderFound, result.dividerControlAbsent, result.resetViewFound, result.projectLinkFound, result.arcadeInitiallyHidden, result.secretCopyInitiallyBlank, result.secretPageBuilt, result.codeJsonFound, result.codeApplyFound, result.codeHidesSecrets, result.overdriveEggFound, result.overdriveEggHidden].every(Boolean)) process.exit(1);
if (result.topLevelModes?.join(",") !== "quick,advanced,code") process.exit(1);
if (result.draggableModules?.join(",") !== "avatar,name,dot,value,label,countdown,relative,seconds,date,reset") process.exit(1);
if (result.layoutModeValues?.join(",") !== "auto,free") process.exit(1);
if (result.visibleModuleControlCount !== 5) process.exit(1);
if ([result.quick, result.advanced, result.code].some((item) => (item?.scrollOwners?.length ?? 0) > 1)) process.exit(1);
if (result.codePresetCount !== 3) process.exit(1);
if (result.quick?.left !== 8 || result.quick?.bottom !== 56) process.exit(1);
if (result.effectOptions?.join(",") !== "none,pulse,blink,rainbow" || result.effectAtOptions?.join(",") !== "always,warning,critical") process.exit(1);
if (result.paletteOrder?.join(",") !== "critical,warning,accent" || result.paletteLabels?.some((label) => !label)) process.exit(1);
if (result.languageOptions?.join(",") !== "en,zh-CN,ja") process.exit(1);
process.exit(0);
