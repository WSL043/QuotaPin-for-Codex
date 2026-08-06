import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadRendererSource } from "../scripts/check-renderer-source.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";

const renderer = loadRendererSource();
const layoutLab = fs.readFileSync(new URL("../tools/layout-lab/serve.mjs", import.meta.url), "utf8");

test("the exact offline renderer payload compiles without a Codex process", () => {
  assert.doesNotThrow(() => new Function(renderer));
});

test("the layout fixture preserves omitted width, scale, and anchor parameters", () => {
  assert.doesNotMatch(layoutLab, /Number\(labParams\.get\("width"\)\)/);
  assert.doesNotMatch(layoutLab, /Number\(labParams\.get\("scale"\)\)/);
  assert.doesNotMatch(layoutLab, /Number\(labParams\.get\("anchor\."\+module\)\)/);
  assert.match(layoutLab, /labWidthRaw===null\?Number\.NaN/);
  assert.match(layoutLab, /raw===null\?Number\.NaN/);
});

test("host discovery and event interception remain fail closed", () => {
  assert.match(renderer, /return candidates\.length === 1 \? candidates\[0\]\.node : null/);
  assert.match(renderer, /isAccountRowGeometry\(rect, viewport\)/);
  assert.match(renderer, /const knownHost = node === observedAccountRow \|\| Boolean\(currentBadge && node\.contains\(currentBadge\)\)/);
  assert.doesNotMatch(renderer, /rect\.right < 340/);
  assert.match(renderer, /accountRow\?\.contains\(target\)/);
  assert.match(renderer, /input,textarea,select,\[contenteditable\]/);
  assert.match(renderer, /restoreIdentity\(findAccountRow\(\) \?\? document\.body\)/);
  assert.match(renderer, /querySelectorAll\("link\[href\]"\)/);
  assert.ok(renderer.includes("app-initial-[^/?]+\\.js"));
});

test("the panel keeps a minimal keyboard-accessible dialog contract", () => {
  assert.match(renderer, /setAttribute\("role", "dialog"\)/);
  assert.match(renderer, /setAttribute\("aria-modal", "false"\)/);
  assert.match(renderer, /:focus-visible\{outline:/);
  assert.match(renderer, /data-quotapin-module/);
  assert.match(renderer, /justifyContent: "center"/);
  assert.match(renderer, /textOverflow = "ellipsis"/);
  assert.match(renderer, /modeTabs\.setAttribute\("aria-label", t\("QuotaPin settings modes"\)\)/);
});

test("layered dismissal keeps child menus keyboard-modal without trapping the whole panel", () => {
  assert.match(renderer, /dismissPanelLayer = \(\) => closeUpdateLayer\(true\) \|\| closeProfileMenu\(true\)/);
  assert.match(renderer, /if \(event\.key === "Escape" && panel\)/);
  assert.match(renderer, /if \(!dismissPanelLayer\(\)\) closePanel\(\)/);
  assert.match(renderer, /event\.stopImmediatePropagation\(\)/);
  assert.match(renderer, /document\.activeElement !== document\.body/);
});

test("the update surface uses complete versions, explicit intents, and inline confirmation", () => {
  assert.match(renderer, /versionButton\.textContent = "v" \+ current/);
  assert.match(renderer, /updateIntent\(current, selected\)/);
  assert.match(renderer, /updateConfirm\.dataset\.updateConfirm = "true"/);
  assert.match(renderer, /versionButton\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(renderer, /updateConfirmAction\.focus\(\{ preventScroll: true \}\)/);
  const updateSource = renderer.match(/const versionButton = document\.createElement\("button"\)[\s\S]*?footer\.append\(projectLink, hint, versionButton\)/)?.[0] ?? "";
  assert.doesNotMatch(updateSource, /\bconfirm\(/);
});

test("the account row exposes twelve independently ordered modules", () => {
  assert.deepEqual(createLayoutStateToolkit().modules, ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"]);
  assert.match(renderer, /badge\.style\.display = "contents"/);
  assert.match(renderer, /\["dot", "value", "todayTokens", "lifetimeTokens", "label", "countdown", "relative", "seconds", "date", "reset"\]\.map/);
  assert.match(renderer, /solveFreeLayout/);
  assert.match(renderer, /moduleAnchors/);
  assert.match(renderer, /getComputedStyle\(row\)\.position === "static"/);
  assert.doesNotMatch(renderer, /moduleDivider|dividerText/);
});

test("the easter egg renderer exposes sidebar fire only", () => {
  assert.doesNotMatch(renderer, /quotaFire|quotapin-egg-heat|startPixelFire\(quotaTarget/);
  assert.doesNotMatch(renderer, /mailto:|ou\.shirin@bluesea\.me/);
  assert.match(renderer, /startPixelFire\(sidebarTarget, persistent\)/);
  assert.match(renderer, /sourceRepository \+ "\/issues\/new\?template=feature\.yml"/);
});

test("automatic dragging preserves neighbour intent while free dragging preserves settled coordinates", () => {
  assert.match(renderer, /if \(Number\.isFinite\(rangeWidth\) && rangeWidth > 0\) return Math\.max\(1, rangeWidth\)/);
  assert.match(renderer, /const measuredNaturalWidth = textLayoutModules\.has\(module\)\s*\? Math\.min\(naturalInlineWidth\(node\), maximumNameWidth\)/);
  assert.doesNotMatch(renderer, /const measuredNaturalWidth = module === "name"/);
  assert.match(renderer, /baseAnchors: magnetic\s*\? cleanModuleAnchors\(profile\.moduleAnchors\)\s*: measureModuleAnchors\(row, badge, anchors\)/);
  assert.match(renderer, /const settledAnchors = cleanModuleAnchors[\s\S]*?if \(magnetic\) \{[\s\S]*?anchors\[completed\.module\] = settledAnchors\[completed\.module\];[\s\S]*?\} else \{[\s\S]*?anchors = settledAnchors;/);
  assert.match(renderer, /anchors = \{ \.\.\.drag\.baseAnchors, \[drag\.module\]:/);
  assert.match(renderer, /frozenMeasurements: drag\.frozenMeasurements/);
  assert.match(renderer, /stableMagneticNeighbours\(drag\.frozenRects, drag\.resolvedRects, drag\.module, 1\)/);
  assert.match(renderer, /orderForPointer\(order, drag\.module, desiredCenter, drag\.frozenRects\)/);
  assert.match(renderer, /activeLayoutDrag\?\.row\?\.isConnected && activeLayoutDrag\?\.node\?\.isConnected/);
  assert.match(renderer, /lostpointercapture/);
  assert.match(renderer, /endLayoutDrag\(\)/);
  assert.match(renderer, /function viewWithOptimisticLayout/);
  assert.match(renderer, /afterRenderCallbacks\.push\(afterRender\)/);
  assert.match(renderer, /schedule\(\(\) => setLayoutEditing\(isLayoutEditingMode\(\)\)\)/);
});

test("editing never restores stale visibility and remains available in Quick and Customize", () => {
  assert.match(renderer, /return mode === "quick" \|\| mode === "advanced"/);
  assert.match(renderer, /setLayoutEditing\(isLayoutEditingMode\(mode\)\)/);
  assert.doesNotMatch(renderer, /opacity: modules\[module\]\.style\.opacity/);
  assert.doesNotMatch(renderer, /display: modules\[module\]\.style\.display/);
  assert.doesNotMatch(renderer, /"zIndex", "opacity", "display", "boxShadow"/);
});

test("only queued settings, never an unapplied Code draft, reach the live row", () => {
  assert.match(renderer, /function viewWithOptimisticLayout[\s\S]*?getRenderableSettings\(settingsState\)/);
  const sendActionSource = renderer.match(/function sendAction\(action, options = \{\}\) \{[\s\S]*?\n  \}\n\n  function acceptSettingsAck/)?.[0] ?? "";
  assert.match(sendActionSource, /queueSettingsAction\(settingsState, action\)/);
  assert.doesNotMatch(sendActionSource, /settingsState\.dirty|type: "replaceConfig"/);
});

test("custom hover templates stay in Code instead of crowding the visual editor", () => {
  assert.doesNotMatch(renderer, /field\(t\("Hover text"\)/);
  assert.match(renderer, /hoverTemplate: "\{remaining\}% left/);
  assert.match(renderer, /JSON\.stringify\(editorPreferences/);
});

test("a replaced account host rebinds the open panel and resize observation", () => {
  assert.match(renderer, /new ResizeObserver\(handleAccountResize\)/);
  assert.match(renderer, /captureResponsiveFreeLayout/);
  assert.match(renderer, /schedule\(undefined, true\)/);
  assert.match(renderer, /captureAccountBinding/);
  assert.match(renderer, /sameAccountBinding/);
  assert.match(renderer, /queuePanelRebind/);
  assert.match(renderer, /openEditor\(currentBadge, true\)/);
  assert.match(renderer, /panel\.dataset\.availableWindowCount/);
  assert.doesNotMatch(renderer, /dataset\.quotapinRebinding/);
});

test("background refreshes cannot reflow an unchanged account layout", () => {
  assert.doesNotMatch(renderer, /setInterval\(schedule,\s*30_000\)/);
  assert.match(renderer, /function layoutInputSignature/);
  assert.match(renderer, /function reconcileModuleLayout/);
  assert.match(renderer, /sameAccountBinding\(lastLayoutBinding, nextBinding\)[\s\S]*?nextSignature === lastLayoutSignature[\s\S]*?committedLayoutMatches\(lastLayoutPlan, row, badge\)/);
  assert.match(renderer, /immediateRenderQueued[\s\S]*?queueMicrotask/);
  assert.match(renderer, /inspectLayoutRuntime\(\)/);
});

test("renderer delivery is monotonic and same-version replacement is instance-aware", () => {
  assert.match(renderer, /const instanceId = "__QUOTAPIN_RENDERER_INSTANCE_ID__"/);
  assert.match(renderer, /previous\?\.version === version && previous\?\.instanceId === instanceId/);
  assert.match(renderer, /const acceptDeliveredState =/);
  assert.match(renderer, /sequence <= deliveryRuntime\.highestSequence/);
  assert.match(renderer, /if \(!acceptDeliveredState\(nextState\)\) return false/);
  assert.match(renderer, /inspectDeliveryRuntime\(\)/);
  assert.match(renderer, /window\.__quotaPinController === controller/);
});

test("panel rebuilds keep a connected focus target", () => {
  assert.match(renderer, /panelReturnFocus instanceof HTMLElement && panelReturnFocus\.isConnected/);
});

test("missing or replaced identity nodes degrade without blocking quota rendering", () => {
  assert.match(renderer, /const availableModules = layoutModules\.filter/);
  assert.doesNotMatch(renderer, /if \(!parts\.avatar \|\| !parts\.name\) return parts/);
  assert.match(renderer, /if \(parts\.name\) \{/);
  assert.match(renderer, /if \(parts\.avatar\) \{/);
  assert.match(renderer, /function enableLiveRowEditing[\s\S]*?const availableModules = layoutModules\.filter/);
  assert.match(renderer, /const original = new Map\(visibleModules\.map/);
});

test("native avatar styling is restorable and custom masks remain explicit", () => {
  assert.match(renderer, /avatarShape === "rounded" \? "6px"/);
  assert.match(renderer, /avatarShape === "square" \? "0px"/);
  assert.match(renderer, /moduleStyleSnapshots\.get\(parts\.avatar\)\?\.borderRadius \?\? ""/);
  assert.match(renderer, /: nativeAvatarRadius/);
  assert.match(renderer, /node\.style\.overflow = moduleOverflow/);
  assert.doesNotMatch(renderer, /avatarShape === "circle"/);
});

test("crowded layouts are reported instead of silently treating one-pixel modules as healthy", () => {
  assert.match(renderer, /data-layout-capacity/);
  assert.match(renderer, /quotapinCrowdedModules/);
  assert.match(renderer, /compressedModules/);
});

test("an explicitly visible identity repairs stale hidden inline styles before measurement", () => {
  assert.match(renderer, /hiddenDirectNameCandidates/);
  assert.match(renderer, /data-quotapin-shown/);
  assert.match(renderer, /function showIdentityPart/);
  assert.ok(
    renderer.indexOf('showIdentityPart(parts.name)') < renderer.indexOf('naturalInlineWidth(parts.name)'),
    "the name must be visible before its intrinsic width is measured",
  );
});

test("Quick, Customize, and Code keep one coherent settings chain without duplicate navigation", () => {
  assert.match(renderer, /contentBody\.append\(quickGrid, visualGrid, codeGrid, arcadeWrap\)/);
  assert.match(renderer, /tabButton\("Quick"/);
  assert.match(renderer, /tabButton\("Customize"/);
  assert.match(renderer, /tabButton\("Code"/);
  assert.doesNotMatch(renderer, /editorSection/);
  assert.doesNotMatch(renderer, /tabButton\("Visual"/);
  assert.doesNotMatch(renderer, /makeSection\("(?:content|look|motion)"\)/);
  for (const toggle of ["Avatar", "Name", "Show status dot", "Show quota bar", "Show value", "Show window label", "Show compact countdown", "Show local countdown", "Show seconds", "Show reset date", "Show reset time"]) {
    assert.ok(renderer.includes(`toggleChip("${toggle}"`), `missing Quick toggle: ${toggle}`);
  }
  assert.doesNotMatch(renderer, /value: "auto", label: "Auto"/);
  assert.doesNotMatch(renderer, /value: "free", label: "Free"/);
  assert.doesNotMatch(renderer, /Drop anywhere · Aligns near edges or modules/);
  assert.doesNotMatch(renderer, /quickCompositionBody\.append\(layoutActions\)/);
  assert.match(renderer, /dockModuleAnchors\(requestedAnchors\)/);
  assert.doesNotMatch(renderer, /quickModule\("Color"/);
  assert.doesNotMatch(renderer, /quickModule\("Motion"/);
  assert.match(renderer, /rangeField\("fontSize", "Badge size"/);
  assert.match(renderer, /\["effect", "Attention"\]/);
  assert.match(renderer, /\["effectAt", "Start at"\]/);
  assert.doesNotMatch(renderer, /if \(settingsState\.dirty\) \{\s*openEditor\(badge, true\)/);
  assert.match(renderer, /codeMode\.dataset\.dirty = String\(dirty\)/);
  assert.match(renderer, /formatJsonDraft\(jsonEditor\.value\)/);
  assert.match(renderer, /discardSettingsDraft\(settingsState\)/);
  assert.match(renderer, /diffJsonPaths\(submitted, canonical/);
  assert.match(renderer, /paintQuickPreview = \(\) =>/);
  assert.match(renderer, /paintQuickPreview\?\.\(\)/);
});

test("every settings mode keeps one stable bounded panel height", () => {
  assert.match(renderer, /syncPanelGeometry = \(\) =>/);
  assert.match(renderer, /panelGeometry\(window\.innerWidth, window\.innerHeight\)/);
  assert.match(renderer, /panel\.style\.height = geometry\.height \+ "px"/);
  assert.match(renderer, /panel\.style\.maxHeight = geometry\.height \+ "px"/);
  assert.doesNotMatch(renderer, /const compact = mode === "quick" \|\| mode === "arcade"/);
  assert.doesNotMatch(renderer, /syncPanelModeSize[\s\S]{0,400}panel\.style\.height/);
  assert.match(renderer, /contentBody\.style\.flex = "1 1 auto"/);
  assert.match(renderer, /quickGrid\.style\.height = "100%"/);
  assert.match(renderer, /quickGrid\.style\.overflowY = "auto"/);
  assert.match(renderer, /quickGrid\.style\.overflowX = "hidden"/);
  assert.match(renderer, /arcadeWrap\.style\.height = "100%"/);
  assert.match(renderer, /arcadeWrap\.style\.overflowY = "auto"/);
  assert.match(renderer, /arcadeWrap\.style\.overflowX = "hidden"/);
  assert.match(renderer, /const visualGrid = makeModePanel\("advanced"\)/);
  assert.match(renderer, /const codeGrid = makeModePanel\("code", false\)/);
});
