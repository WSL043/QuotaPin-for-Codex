import { loadRendererSource } from "./check-renderer-source.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";

const renderer = loadRendererSource();
const layoutToolkit = createLayoutStateToolkit();

// Compile the exact source sent through CDP. This catches syntax errors hidden
// inside the outer module's template literal without executing host DOM code.
new Function(renderer);
if (renderer.includes("prefers-reduced-motion")) {
  throw new Error("QuotaPin motion must not inherit the host or OS reduced-motion preference");
}
for (const animation of ["quotapin-pulse", "quotapin-blink", "quotapin-rainbow-value", "quotapin-rainbow-dot"]) {
  if (!renderer.includes(animation)) throw new Error(`Missing injected animation: ${animation}`);
}
for (const removedEffect of ["startled", "launch"]) {
  if (renderer.includes(`\"${removedEffect}\"`) || renderer.includes(`quotapin-egg-${removedEffect}`)) {
      throw new Error(`Removed optional effect is still shipped: ${removedEffect}`);
  }
}
if (!renderer.includes('querySelectorAll("*")')) {
  throw new Error("Fast-mode detection must accept SVG or HTML structural markers");
}
if (renderer.includes('querySelectorAll("span").find((node) => String(node.className).includes("ModelPickerTriggerInlineFastIcon"))')) {
  throw new Error("Fast-mode detection must not assume the live glyph is a span");
}
if (!renderer.includes('accountRowMode() === "beta" ? findAccountSurface(accountRow) : accountRow')
  || !renderer.includes('return candidates.length === 1 ? candidates[0] : null')) {
  throw new Error("Pointer interception must remain scoped to one proven account button or Beta footer");
}
if (!renderer.includes("input,textarea,select,[contenteditable]")) {
  throw new Error("Hidden keyboard handling must ignore editable task controls");
}
for (const removedLayoutControl of ['data-config-key="position"', 'data-config-key="offsetX"', 'data-config-key="offsetY"']) {
  if (renderer.includes(removedLayoutControl)) throw new Error(`Removed layout control is still shipped: ${removedLayoutControl}`);
}
for (const requiredLayoutBehavior of [
  "moduleOrder",
  "moduleAnchors",
  "solveFreeLayout",
  "snapMagneticCenter",
  "quotapinPositionedLayout",
  'badge.style.display = options.primaryRemote === true ? "none" : "contents"',
  'textOverflow = "ellipsis"',
  'alignItems = "center"',
]) {
  if (!renderer.includes(requiredLayoutBehavior)) throw new Error(`Missing module layout behavior: ${requiredLayoutBehavior}`);
}
for (const placementBehavior of [
  'dataset.quotapinPlacementSurface = "primary"',
  'dataset.quotapinPlacementSurface = "rail"',
  'dataset.placementMap = "true"',
  'resolvePlacementContext',
]) {
  if (!renderer.includes(placementBehavior)) throw new Error(`Missing semantic placement behavior: ${placementBehavior}`);
}
if (layoutToolkit.modules.join(",") !== "avatar,name,value,pace,runway,label,dot,countdown,relative,seconds,date,reset,todayTokens,lifetimeTokens") {
  throw new Error("The canonical renderer layout module list is incomplete");
}
if (!renderer.includes('contentBody.append(quickGrid, visualGrid, codeGrid, arcadeWrap)')) {
  throw new Error("Quick, Customize, Code, and the hidden mode must be attached as sibling panels");
}
for (const topLevelMode of ['tabButton("Quick"', 'tabButton("Customize"', 'tabButton("Code"']) {
  if (!renderer.includes(topLevelMode)) throw new Error(`Missing top-level settings mode: ${topLevelMode}`);
}
if (renderer.includes('tabButton("Visual"') || renderer.includes('editorSection')) {
  throw new Error("Customize must not contain a nested Visual/Code tab layer");
}
for (const removedSection of ['makeSection("look")', 'makeSection("motion")', 'makeSection("content")']) {
  if (renderer.includes(removedSection)) throw new Error(`Removed Customize section is still shipped: ${removedSection}`);
}
if (renderer.includes('quickModule("Color"') || renderer.includes('quickModule("Motion"')) {
  throw new Error("Quick must compose and position modules; exact visual tuning belongs to Customize");
}
for (const granularControl of [
  'toggleChip("Show value"',
  'toggleChip("Show burn pace"',
  'toggleChip("Show estimated runway"',
  'toggleChip("Show status dot"',
  'toggleChip("Show window label"',
  'toggleChip("Show compact countdown"',
  'toggleChip("Show local countdown"',
  'toggleChip("Show seconds"',
  'toggleChip("Show reset date"',
  'toggleChip("Show reset time"',
  'toggleChip("Show today\'s tokens"',
  'toggleChip("Show lifetime tokens"',
  'toggleChip("Avatar"',
  'toggleChip("Name"',
]) {
  if (!renderer.includes(granularControl)) throw new Error(`Missing granular UI control: ${granularControl}`);
}
for (const removedLayoutChoice of ['{ value: "auto", label: "Auto" }', '{ value: "free", label: "Free" }']) {
  if (renderer.includes(removedLayoutChoice)) throw new Error(`Quick still exposes a redundant layout choice: ${removedLayoutChoice}`);
}
for (const codeControl of ['dataset.codeConfig = "json"', 'dataset.codeAction = "format"', 'dataset.codeAction = "revert"']) {
  if (!renderer.includes(codeControl)) throw new Error(`Missing Code configuration control: ${codeControl}`);
}
for (const removedDividerSurface of ["moduleDivider", "dividerText", "Dot divider", "Custom divider"]) {
  if (renderer.includes(removedDividerSurface)) throw new Error(`Removed divider surface is still shipped: ${removedDividerSurface}`);
}
console.log("Injected renderer syntax: OK");
