import fs from "node:fs";
import path from "node:path";
import { assertVerificationPermissions } from "./verify-safety.mjs";

const argv = process.argv.slice(2);
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
const cleanup = process.argv.includes("--cleanup");
const diagnose = process.argv.includes("--diagnose");
const exerciseRender = process.argv.includes("--exercise-render");
const bringToFront = process.argv.includes("--bring-to-front");
const verifyInteractions = process.argv.includes("--verify-interactions");
const openEditor = process.argv.includes("--open-editor");
const inspectComposer = process.argv.includes("--inspect-composer");
const screenshotIndex = process.argv.indexOf("--screenshot");
const screenshotRequested = screenshotIndex >= 0;
const screenshotArgument = screenshotRequested ? process.argv[screenshotIndex + 1] : null;
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/verify-cdp.mjs --port <loopback-port>");
}
if (screenshotRequested && (!screenshotArgument || screenshotArgument.startsWith("--"))) {
  throw new Error("--screenshot requires an output path");
}
assertVerificationPermissions({
  argv,
  liveModes: [
    cleanup && "--cleanup",
    exerciseRender && "--exercise-render",
    bringToFront && "--bring-to-front",
    verifyInteractions && "--verify-interactions",
    openEditor && "--open-editor",
  ].filter(Boolean),
  sensitiveCapture: screenshotRequested || inspectComposer,
});
const screenshotPath = screenshotRequested ? path.resolve(screenshotArgument) : null;

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

if (bringToFront) {
  await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 99) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve();
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id: 99, method: "Page.bringToFront", params: {} }));
  });
}
if (verifyInteractions || openEditor) {
  await sendCdp(93, "Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sendCdp(94, "Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

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
      awaitPromise: true,
      expression: `(async () => {
        let renderError = null;
        const captureError = (event) => { renderError = event.message; };
        if (${JSON.stringify(exerciseRender)}) {
          window.addEventListener("error", captureError);
          const delivery = window.__quotaPinController?.inspectDeliveryRuntime?.();
          window.__quotaPinController?.update({
            status: "ready",
            view: { text: "42%", parts: { value: "42%", label: "7d", countdown: "4d 8h", relative: "4 days 8 hours", seconds: "104:00:00", date: "Aug 8", reset: "Mon 12:30" }, runtimeWindows: [], tooltip: "QuotaPin render test", severity: "normal", profileId: "glance", displayMode: "modules", showValue: true, showDot: true, showBar: false, remainingPercent: 42, showLabel: true, showCountdown: true, showRelative: true, showSeconds: true, showDate: true, showReset: true, valueColor: "#6ee7b7", dotColor: "#6ee7b7", effect: "none", effectTarget: "dot", effectAt: "critical", layout: { moduleOrder: ["avatar", "name", "dot", "value", "label", "countdown", "relative", "seconds", "date", "reset"], layoutMode: "auto", moduleAnchors: { avatar: .06, name: .29, dot: .5, value: .59, label: .69, countdown: .75, relative: .79, seconds: .83, date: .89, reset: .95 }, identity: "show", avatarShape: "native", fontSize: 14 } },
            preferences: window.__quotaPinController?.preferences ?? null,
            delivery: { rendererInstanceId: window.__quotaPinController?.instanceId ?? null, sequence: Math.max(0, Number(delivery?.highestSequence) || 0) + 1, reason: "verification", createdAt: Date.now() },
          });
          await new Promise((resolve) => setTimeout(resolve, 250));
          window.removeEventListener("error", captureError);
        }
        let badge = document.getElementById("quotapin-inline-badge");
        let shortClickOpenedCodexMenu = null;
        let shortClickOpenedQuotaPin = null;
        let longPressOpenedQuotaPin = null;
        let longPressSuppressedCodexMenu = null;
        let editorProfileCount = 0;
        let editorControlCount = 0;
        const codexMenuOpen = () => {
          const hostRect = badge?.parentElement?.getBoundingClientRect();
          if (!hostRect) return false;
          return [...document.querySelectorAll('[role="menu"]')].some((node) => {
            const value = node.getBoundingClientRect();
            return value.width > 0 && value.height > 0 && value.left < hostRect.right + 40 && value.bottom >= hostRect.top - 24;
          });
        };
        if (${JSON.stringify(openEditor || verifyInteractions)} && codexMenuOpen()) {
          badge?.parentElement?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }));
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        if (${JSON.stringify(openEditor || verifyInteractions)}) document.getElementById("quotapin-profile-editor")?.remove();
        if (${JSON.stringify(openEditor)} && badge) {
          window.__quotaPinController?.openEditor?.();
          await new Promise((resolve) => setTimeout(resolve, 120));
          const editor = document.getElementById("quotapin-profile-editor");
          longPressOpenedQuotaPin = Boolean(editor);
          longPressSuppressedCodexMenu = !codexMenuOpen();
          editorProfileCount = editor?.querySelector('select:not([aria-label="Language"])')?.options?.length ?? 0;
          editorControlCount = editor?.querySelectorAll('input,select,button').length ?? 0;
        }
        if (${JSON.stringify(verifyInteractions)} && badge) {
          badge.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 7 }));
          await new Promise((resolve) => setTimeout(resolve, 540));
          badge.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 7 }));
          badge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
          await new Promise((resolve) => setTimeout(resolve, 120));
          const editor = document.getElementById("quotapin-profile-editor");
          longPressOpenedQuotaPin = Boolean(editor);
          longPressSuppressedCodexMenu = !codexMenuOpen();
          editorProfileCount = editor?.querySelector('select')?.options?.length ?? 0;
          editorControlCount = editor?.querySelectorAll('input,select,button').length ?? 0;
        }
        if (${JSON.stringify(verifyInteractions)} && badge) {
          document.getElementById("quotapin-profile-editor")?.remove();
          badge.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse" }));
          badge.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, pointerId: 5, pointerType: "mouse" }));
          badge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
          await new Promise((resolve) => setTimeout(resolve, 180));
          shortClickOpenedCodexMenu = codexMenuOpen();
          shortClickOpenedQuotaPin = Boolean(document.getElementById("quotapin-profile-editor"));
        }
        const hostMenuDiagnostics = [...document.querySelectorAll('[role="menu"]')].map((node) => {
          const value = node.getBoundingClientRect();
          return { left: Math.round(value.left), top: Math.round(value.top), width: Math.round(value.width), height: Math.round(value.height), textLength: node.textContent?.trim().length ?? 0 };
        }).filter((item) => item.width > 0 && item.height > 0);
        const parentRect = badge?.parentElement?.getBoundingClientRect();
        const badgeDisplay = badge ? getComputedStyle(badge).display : null;
        const badgePartRects = badge
          ? [...badge.querySelectorAll('[data-part]')].map((node) => {
              const value = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              let glyphWidth = 0;
              try {
                const range = document.createRange();
                range.selectNodeContents(node);
                glyphWidth = range.getBoundingClientRect().width;
                range.detach?.();
              } catch {}
              return { part: node.dataset.part, left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, glyphWidth, widthExcess: Math.max(0, value.width - glyphWidth), height: value.height, display: style.display };
            }).filter((item) => item.display !== "none" && item.width > 0 && item.height > 0)
          : [];
        const accountCandidates = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
          .map((node) => {
            const value = node.getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
          })
          .filter((value) => value.width > 0 && value.height > 0 && value.bottom > window.innerHeight - 80);
        const nativeQuotaMatches = [
          '[data-testid*="usage-limit" i]',
          '[data-testid*="rate-limit" i]',
          '[aria-label*="remaining usage" i]',
          '[aria-label*="rate limit" i]'
        ].reduce((count, selector) => count + document.querySelectorAll(selector).length, 0);
        const accountRowChildren = badge?.parentElement
          ? [...badge.parentElement.children].map((node) => {
              const value = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return {
                tag: node.tagName,
                badge: node === badge,
                childTags: [...node.children].map((child) => child.tagName),
                textLength: node === badge ? null : (node.textContent?.trim().length ?? 0),
                left: Math.round(value.left * 10) / 10,
                top: Math.round(value.top * 10) / 10,
                right: Math.round(value.right * 10) / 10,
                bottom: Math.round(value.bottom * 10) / 10,
                width: Math.round(value.width * 10) / 10,
                height: Math.round(value.height * 10) / 10,
                display: style.display,
                inlineDisplay: node.style.display,
                quotaPinHidden: node.dataset.quotapinHidden === "true",
                color: style.color,
                inlineColor: node.style.color,
                quotaPinColorized: node.dataset.quotapinColorized === "true",
                visibility: style.visibility,
                opacity: style.opacity,
                position: style.position,
                order: style.order,
                flex: style.flex,
                minWidth: style.minWidth,
                maxWidth: style.maxWidth,
                overflow: style.overflow,
                textOverflow: style.textOverflow,
                whiteSpace: style.whiteSpace,
                alignSelf: style.alignSelf,
                transform: style.transform,
                marginInlineStart: style.marginInlineStart,
              };
            })
          : [];
        const inspectedComposerControls = ${JSON.stringify(inspectComposer)}
          ? [...document.querySelectorAll('button,[role="button"],[aria-pressed]')].map((node) => {
              const value = node.getBoundingClientRect();
              return {
                text: node.textContent?.trim().replace(/\s+/g, " ").slice(0, 64) ?? "",
                ariaLabel: node.getAttribute("aria-label")?.slice(0, 64) ?? "",
                title: node.getAttribute("title")?.slice(0, 64) ?? "",
                pressed: node.getAttribute("aria-pressed"),
                state: node.getAttribute("data-state"),
                fragments: /sol|codex|spark/i.test(node.textContent ?? "")
                  ? [...node.querySelectorAll("*")].filter((child) => child.children.length === 0 && child.textContent?.trim()).map((child) => {
                      const childRect = child.getBoundingClientRect();
                      const childStyle = getComputedStyle(child);
                      return {
                        text: child.textContent.trim().replace(/\s+/g, " ").slice(0, 48),
                        ariaHidden: child.getAttribute("aria-hidden"),
                        display: childStyle.display,
                        visibility: childStyle.visibility,
                        opacity: childStyle.opacity,
                        width: Math.round(childRect.width),
                        height: Math.round(childRect.height),
                      };
                    }).slice(0, 12)
                  : [],
                left: Math.round(value.left),
                top: Math.round(value.top),
                width: Math.round(value.width),
                height: Math.round(value.height),
              };
            }).filter((item) => item.width > 0 && item.height > 0 && item.top > innerHeight - 150 && item.left > 250).slice(0, 24)
          : [];
        return {
          controllerVersion: window.__quotaPinController?.version ?? null,
          controllerInstanceId: window.__quotaPinController?.instanceId ?? null,
          deliveryRuntime: window.__quotaPinController?.inspectDeliveryRuntime?.() ?? null,
          layoutRuntime: window.__quotaPinController?.inspectLayoutRuntime?.() ?? null,
          badgePresent: Boolean(badge),
          badgeTextPattern: badge?.textContent?.trim().replace(/\\d+/g, "#") ?? null,
          parentTag: badge?.parentElement?.tagName ?? null,
          parentHasMenuPopup: badge?.parentElement?.getAttribute("aria-haspopup") === "menu",
          badgeDisplay,
          badgePartCount: badgePartRects.length,
          badgeParts: badgePartRects,
          badgeInsideParent: Boolean(parentRect && badgeDisplay === "contents" && badgePartRects.length > 0 && badgePartRects.every((part) => part.left >= parentRect.left - .5 && part.right <= parentRect.right + .5 && part.top >= parentRect.top - .5 && part.bottom <= parentRect.bottom + .5)),
          badgeRightGap: badgePartRects.length && parentRect ? Math.round((parentRect.right - Math.max(...badgePartRects.map((part) => part.right))) * 10) / 10 : null,
          parentWidth: parentRect ? Math.round(parentRect.width * 10) / 10 : null,
          accountCandidates,
          nativeQuotaMatches,
          renderError,
          shortClickOpenedCodexMenu,
          shortClickOpenedQuotaPin,
          longPressOpenedQuotaPin,
          longPressSuppressedCodexMenu,
          editorProfileCount,
          editorControlCount,
          hostMenuDiagnostics,
          accountRowChildren,
          composerControls: inspectedComposerControls,
        };
      })()`,
    },
  }));
});
if (screenshotPath) {
  const screenshot = await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 3) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result.data);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id: 3, method: "Page.captureScreenshot", params: { format: "png", fromSurface: true, captureBeyondViewport: false } }));
  });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, screenshot, "base64");
  result.screenshotPath = screenshotPath;
}

async function sendCdp(id, method, params = {}) {
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

if (verifyInteractions || openEditor) {
  await sendCdp(97, "Runtime.evaluate", { expression: `(() => {
    document.getElementById("quotapin-profile-editor")?.remove();
    const badge = document.getElementById("quotapin-inline-badge");
    const host = badge?.parentElement;
    const hostRect = host?.getBoundingClientRect();
    const menuOpen = hostRect && [...document.querySelectorAll('[role="menu"]')].some((node) => {
      const value = node.getBoundingClientRect();
      return value.width > 0 && value.height > 0 && value.left < hostRect.right + 40 && value.bottom >= hostRect.top - 24;
    });
    if (menuOpen) host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerType: "mouse", isPrimary: true }));
  })()` });
}
if (cleanup) {
  await new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 2) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve();
    });
    socket.send(JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: { expression: "window.__quotaPinController?.cleanup?.()" },
    }));
  });
}
socket.close();

console.log(JSON.stringify(result));
if (!diagnose && (!result?.badgePresent || !result?.parentHasMenuPopup || !result?.badgeInsideParent)) process.exit(1);
