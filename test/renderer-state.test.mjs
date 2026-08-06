import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsStateToolkit } from "../src/renderer/settings-state.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";
import { createGestureStateToolkit } from "../src/renderer/gesture-state.mjs";
import { createEffectStateToolkit } from "../src/renderer/effect-state.mjs";
import { createI18nToolkit } from "../src/renderer/i18n-state.mjs";
import { createCommandStateToolkit } from "../src/renderer/command-state.mjs";
import { createColorStateToolkit } from "../src/renderer/color-state.mjs";

const moduleOrder = ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"];
const moduleWidths = { avatar: 18, name: 55, dot: 7, value: 34, todayTokens: 48, lifetimeTokens: 48, label: 22, countdown: 44, relative: 58, seconds: 66, date: 42, reset: 58 };
const moduleMinimumWidths = { avatar: 18, name: 24, dot: 7, value: 26, todayTokens: 42, lifetimeTokens: 42, label: 14, countdown: 28, relative: 36, seconds: 38, date: 28, reset: 34 };
const moduleShrinkPriorities = { name: 0, label: 10, countdown: 11, relative: 12, seconds: 13, date: 14, reset: 15, todayTokens: 16, lifetimeTokens: 17, value: 20, avatar: 100, dot: 100 };
const optionalContract = JSON.parse(Buffer.from("eyJzZWN0aW9uIjoiZXhwZXJpbWVudHMiLCJlbmFibGVkIjoib3ZlcmRyaXZlRWdnIiwicGVyc2lzdGVudCI6Im92ZXJkcml2ZUFsd2F5cyIsImVmZmVjdCI6Im92ZXJkcml2ZUVmZmVjdCIsInZhcmlhbnQiOiJtZW51RmlyZSIsImZhbGxiYWNrIjoicmFuZG9tIn0=", "base64").toString("utf8"));

function orderForMagneticTarget(toolkit, order, module, snap, rects = {}) {
  const target = String(snap?.target ?? "");
  if (target === "left") return toolkit.moveModule(order, module, 0);
  if (target === "right") return toolkit.moveModule(order, module, toolkit.modules.length);
  if (target.startsWith("before:") || target.startsWith("after:")) {
    const [side, neighbour] = target.split(":", 2);
    const withoutDragged = toolkit.cleanModuleOrder(order).filter((candidate) => candidate !== module);
    const neighbourIndex = withoutDragged.indexOf(neighbour);
    if (neighbourIndex >= 0) return toolkit.moveModule(order, module, neighbourIndex + (side === "after" ? 1 : 0));
  }
  return toolkit.orderForPointer(order, module, snap?.center, rects);
}

const preferences = {
  version: 7,
  locale: "en",
  activeProfile: "glance",
  profiles: [{ id: "glance", name: "Glance", showValue: true, moduleOrder }],
  thresholds: { warning: 30, critical: 10 },
  palette: { accent: "#6ee7b7" },
  [optionalContract.section]: { [optionalContract.enabled]: false, [optionalContract.persistent]: false, [optionalContract.effect]: optionalContract.fallback },
};

test("settings draft replays later actions after an out-of-order acknowledgement", () => {
  const toolkit = createSettingsStateToolkit();
  let state = toolkit.createSettingsState(preferences);
  const first = toolkit.queueSettingsAction(state, { type: "updateProfile", id: "glance", patch: { showValue: false } }, 100);
  state = first.state;
  const second = toolkit.queueSettingsAction(state, { type: "updateLocale", locale: "ja" }, 101);
  state = second.state;
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);
  assert.equal(toolkit.getSettingsDraft(state).locale, "ja");

  state = toolkit.reduceSettingsAck(state, { actionId: first.actionId, ok: true, preferences: { ...preferences, profiles: [{ ...preferences.profiles[0], showValue: false }] } });
  assert.equal(state.phase, "saving");
  assert.equal(toolkit.getSettingsDraft(state).locale, "ja");
  state = toolkit.reduceSettingsAck(state, { actionId: second.actionId, ok: true, preferences: { ...state.committed, locale: "ja" } });
  assert.equal(state.phase, "saved");
  assert.equal(toolkit.getSettingsDraft(state).locale, "ja");
});

test("failed settings action rolls back only that action with a structured error", () => {
  const toolkit = createSettingsStateToolkit();
  const queued = toolkit.queueSettingsAction(toolkit.createSettingsState(preferences), { type: "updateLocale", locale: "ja" }, 100);
  const state = toolkit.reduceSettingsAck(queued.state, { actionId: queued.actionId, ok: false, error: { code: "save_failed", message: "No write" } });
  assert.equal(state.phase, "error");
  assert.equal(state.error.code, "save_failed");
  assert.equal(toolkit.getSettingsDraft(state).locale, "en");
});

test("a later acknowledgement wins when settings acknowledgements arrive in reverse order", () => {
  const toolkit = createSettingsStateToolkit();
  let state = toolkit.createSettingsState(preferences);
  const first = toolkit.queueSettingsAction(state, { type: "updateProfile", id: "glance", patch: { showValue: false } }, 100);
  state = first.state;
  const second = toolkit.queueSettingsAction(state, { type: "updateLocale", locale: "ja" }, 101);
  state = second.state;
  const finalPreferences = { ...preferences, locale: "ja", profiles: [{ ...preferences.profiles[0], showValue: false }] };
  state = toolkit.reduceSettingsAck(state, { actionId: second.actionId, ok: true, preferences: finalPreferences });
  state = toolkit.reduceSettingsAck(state, {
    actionId: first.actionId,
    ok: true,
    preferences: { ...preferences, profiles: [{ ...preferences.profiles[0], showValue: false }] },
  });
  assert.equal(toolkit.getSettingsDraft(state).locale, "ja");
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);
  assert.equal(state.lastAck.stale, true);
});

test("a late authoritative refresh clears a timeout error", () => {
  const toolkit = createSettingsStateToolkit();
  const queued = toolkit.queueSettingsAction(toolkit.createSettingsState(preferences), { type: "updateLocale", locale: "ja" }, 100);
  let state = toolkit.reduceSettingsAck(queued.state, { actionId: queued.actionId, ok: false, error: { code: "host_timeout", message: "Timed out" } });
  assert.equal(state.phase, "error");
  state = toolkit.syncSettingsPreferences(state, { ...preferences, locale: "ja" });
  assert.equal(state.phase, "saved");
  assert.equal(state.error, null);
  assert.equal(toolkit.getSettingsDraft(state).locale, "ja");
});

test("a reattached settings host clears a transient failure even when config is unchanged", () => {
  const toolkit = createSettingsStateToolkit();
  const queued = toolkit.queueSettingsAction(toolkit.createSettingsState(preferences), { type: "updateLocale", locale: "ja" }, 100);
  let state = toolkit.reduceSettingsAck(queued.state, {
    actionId: queued.actionId,
    ok: false,
    error: { code: "host_unavailable", message: "Host unavailable" },
  });
  assert.equal(state.phase, "error");
  state = toolkit.syncSettingsPreferences(state, preferences);
  assert.equal(state.phase, "saved");
  assert.equal(state.error, null);
});

test("a staged JSON draft survives host refresh until it is queued", () => {
  const toolkit = createSettingsStateToolkit();
  let state = toolkit.createSettingsState(preferences);
  state = toolkit.stageSettingsDraft(state, { ...preferences, locale: "zh-CN" });
  state = toolkit.syncSettingsPreferences(state, preferences);
  assert.equal(state.phase, "dirty");
  assert.equal(toolkit.getSettingsDraft(state).locale, "zh-CN");
});

test("discarding a Code draft keeps queued Quick actions but drops staged JSON", () => {
  const toolkit = createSettingsStateToolkit();
  let state = toolkit.stageSettingsDraft(toolkit.createSettingsState(preferences), { ...preferences, locale: "zh-CN" });
  state = toolkit.queueSettingsAction(state, { type: "updateProfile", id: "glance", patch: { showValue: false } }, 101).state;
  state = toolkit.discardSettingsDraft(state);
  assert.equal(state.dirty, false);
  assert.equal(state.stagedDraft, null);
  assert.equal(state.phase, "saving");
  assert.equal(toolkit.getSettingsDraft(state).locale, "en");
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);
});

test("an unapplied Code draft never changes the rendered account row", () => {
  const toolkit = createSettingsStateToolkit();
  const staged = { ...preferences, profiles: [{ ...preferences.profiles[0], showValue: false }] };
  let state = toolkit.stageSettingsDraft(toolkit.createSettingsState(preferences), staged);
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);
  assert.equal(toolkit.getRenderableSettings(state).profiles[0].showValue, true);

  state = toolkit.queueSettingsAction(state, { type: "updateLocale", locale: "ja" }, 102).state;
  assert.equal(toolkit.getRenderableSettings(state).locale, "ja");
  assert.equal(toolkit.getRenderableSettings(state).profiles[0].showValue, true);
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);

  state = toolkit.queueSettingsAction(toolkit.createSettingsState(preferences), { type: "replaceConfig", config: staged }, 103).state;
  assert.equal(toolkit.getRenderableSettings(state).profiles[0].showValue, false);
});

test("Quick actions and acknowledgements preserve and rebase an unapplied Code draft", () => {
  const toolkit = createSettingsStateToolkit();
  const staged = { ...preferences, locale: "zh-CN" };
  let state = toolkit.stageSettingsDraft(toolkit.createSettingsState(preferences), staged);
  const quick = toolkit.queueSettingsAction(state, { type: "updateProfile", id: "glance", patch: { showValue: false } }, 104);
  state = toolkit.reduceSettingsAck(quick.state, {
    actionId: quick.actionId,
    ok: true,
    preferences: { ...preferences, profiles: [{ ...preferences.profiles[0], showValue: false }] },
  });
  assert.equal(state.phase, "dirty");
  assert.equal(toolkit.getSettingsDraft(state).locale, "zh-CN");
  assert.equal(toolkit.getSettingsDraft(state).profiles[0].showValue, false);
  assert.equal(toolkit.getRenderableSettings(state).locale, "en");
  assert.equal(toolkit.getRenderableSettings(state).profiles[0].showValue, false);

  const failed = toolkit.queueSettingsAction(state, { type: "updateLocale", locale: "ja" }, 105);
  state = toolkit.reduceSettingsAck(failed.state, { actionId: failed.actionId, ok: false, error: { code: "save_failed" } });
  assert.equal(state.phase, "error");
  assert.equal(toolkit.getSettingsDraft(state).locale, "zh-CN");
  assert.equal(toolkit.getRenderableSettings(state).locale, "en");

  const applied = toolkit.queueSettingsAction(state, { type: "replaceConfig", config: toolkit.getSettingsDraft(state) }, 106);
  state = toolkit.reduceSettingsAck(applied.state, { actionId: applied.actionId, ok: true, preferences: toolkit.getSettingsDraft(state) });
  assert.equal(state.dirty, false);
  assert.equal(state.stagedDraft, null);
  assert.equal(toolkit.getRenderableSettings(state).locale, "zh-CN");
});

test("optional runtime state is global rather than duplicated per view", () => {
  const toolkit = createSettingsStateToolkit();
  const state = toolkit.queueSettingsAction(
    toolkit.createSettingsState(preferences),
    { type: "updateExperiments", patch: { [optionalContract.enabled]: true, [optionalContract.effect]: optionalContract.variant } },
    102,
  ).state;
  const draft = toolkit.getSettingsDraft(state);
  assert.equal(draft[optionalContract.section][optionalContract.enabled], true);
  assert.equal(draft[optionalContract.section][optionalContract.effect], optionalContract.variant);
  assert.equal(optionalContract.enabled in draft.profiles[0], false);
});

test("layout state gives insertion and keyboard movement one canonical order", () => {
  const toolkit = createLayoutStateToolkit();
  const rects = Object.fromEntries(moduleOrder.map((module, index) => [module, { left: index * 20, width: 16 }]));
  assert.deepEqual(toolkit.modules, moduleOrder);
  assert.deepEqual(toolkit.orderForPointer(moduleOrder, "reset", 0, rects), ["reset", "avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "todayTokens", "lifetimeTokens"]);
  assert.deepEqual(toolkit.moveModuleByKey(moduleOrder, "value", "left"), ["avatar", "value", "name", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"]);
});

test("smart layout reduces arbitrary fractions to stable left, center, and right docks", () => {
  const toolkit = createLayoutStateToolkit();
  const docked = toolkit.dockModuleAnchors({
    avatar: 0.04,
    name: 0.3964,
    value: 0.51,
    dot: 0.8125,
  });
  assert.equal(docked.avatar, 0);
  assert.equal(docked.name, 0);
  assert.equal(docked.value, 0.5);
  assert.equal(docked.dot, 1);
});

test("account-row geometry accepts a resized sidebar without accepting the help button or content controls", () => {
  const toolkit = createLayoutStateToolkit();
  const viewport = { width: 1280, height: 760 };
  assert.equal(toolkit.isAccountRowGeometry({ left: 8, right: 224, width: 216, top: 701, bottom: 731, height: 30 }, viewport), true);
  assert.equal(toolkit.isAccountRowGeometry({ left: 8, right: 520, width: 512, top: 701, bottom: 731, height: 30 }, viewport), true);
  assert.equal(toolkit.isAccountRowGeometry({ left: 8, right: 472, width: 464, top: 441, bottom: 471, height: 30 }, { width: 512, height: 500 }), true);
  assert.equal(toolkit.isAccountRowGeometry({ left: 528, right: 560, width: 32, top: 700, bottom: 732, height: 32 }, viewport), false);
  assert.equal(toolkit.isAccountRowGeometry({ left: 8, right: 1270, width: 1262, top: 701, bottom: 731, height: 30 }, viewport), true);
  assert.equal(toolkit.isAccountRowGeometry({ left: 8, right: 1290, width: 1282, top: 701, bottom: 731, height: 30 }, viewport), false);
});

test("positioned avatar modules keep their native mask while text modules remain ellipsizable", () => {
  const toolkit = createLayoutStateToolkit();
  assert.equal(toolkit.positionedModuleOverflow("avatar"), "hidden");
  assert.equal(toolkit.positionedModuleOverflow("name"), "hidden");
  assert.equal(toolkit.positionedModuleOverflow("value"), "hidden");
  assert.equal(toolkit.positionedModuleOverflow("dot"), "visible");
});

test("panel geometry stays inside the viewport at desktop and compact heights", () => {
  const toolkit = createLayoutStateToolkit();
  assert.deepEqual(toolkit.panelGeometry(1280, 760), { left: 8, bottom: 56, width: 376, height: 480 });
  assert.deepEqual(toolkit.panelGeometry(400, 400), { left: 8, bottom: 56, width: 376, height: 336 });
  assert.deepEqual(toolkit.panelGeometry(320, 320), { left: 8, bottom: 56, width: 304, height: 256 });
  assert.deepEqual(toolkit.panelGeometry(280, 180), { left: 8, bottom: 20, width: 264, height: 152 });
  for (const [width, height] of [[1280, 760], [400, 400], [320, 320], [280, 180], [14, 70]]) {
    const geometry = toolkit.panelGeometry(width, height);
    assert.ok(geometry.left >= 0 && geometry.bottom >= 0 && geometry.width >= 0 && geometry.height >= 0);
    assert.ok(geometry.left + geometry.width <= width);
    assert.ok(geometry.bottom + geometry.height <= height);
  }
});

test("free layout keeps every module inside an extremely narrow account row", () => {
  const toolkit = createLayoutStateToolkit();
  const widths = { avatar: 18, name: 120, dot: 6, value: 34, label: 22, countdown: 42, seconds: 64, date: 42, reset: 58 };
  const solved = toolkit.solveFreeLayout(moduleOrder.map((id, index) => ({
    id,
    width: widths[id],
    minWidth: id === "avatar" || id === "dot" ? widths[id] : 24,
    shrinkPriority: id === "name" ? 0 : 20 + index,
    desiredCenter: 10 + index * 14,
  })), { left: 0, right: 140 }, { gap: 6 });
  assert.equal(solved.overflow, 0);
  assert.ok(solved.compressedModules.length > 0, "an impossible composition must report its visual compression");
  assert.ok(Object.values(solved.positions).every((position) => position.left >= -0.01 && position.left + position.width <= 140.01));
});

test("automatic layout offers edge, center, and adjacent magnetic targets without a hard-coded group gap", () => {
  const toolkit = createLayoutStateToolkit();
  const bounds = { left: 0, right: 200 };
  assert.deepEqual(toolkit.snapMagneticCenter(7, 20, bounds), { center: 10, snapped: true, target: "left" });
  assert.deepEqual(toolkit.snapMagneticCenter(103, 20, bounds), { center: 100, snapped: true, target: "center" });
  assert.deepEqual(toolkit.snapMagneticCenter(193, 20, bounds), { center: 190, snapped: true, target: "right" });
  assert.deepEqual(
    toolkit.snapMagneticCenter(72, 20, bounds, [{ id: "name", left: 40, right: 60 }]),
    { center: 76, snapped: true, target: "after:name" },
  );
  assert.deepEqual(toolkit.snapMagneticCenter(130, 20, bounds), { center: 130, snapped: false, target: null });
});

test("Code layout controls can tune magnetic distance and target families", () => {
  const toolkit = createLayoutStateToolkit();
  const bounds = { left: 0, right: 200 };
  const neighbours = [{ id: "name", left: 40, right: 60 }];
  assert.equal(toolkit.snapMagneticCenter(103, 20, bounds, neighbours, { targets: ["center"] }).target, "center");
  assert.equal(toolkit.snapMagneticCenter(12, 20, bounds, neighbours, { targets: ["center"] }).target, null);
  assert.equal(toolkit.snapMagneticCenter(72, 20, bounds, neighbours, { targets: ["modules"] }).target, "after:name");
  assert.equal(toolkit.snapMagneticCenter(103, 20, bounds, neighbours, { targets: [] }).target, null);
  assert.equal(toolkit.snapMagneticCenter(110, 20, bounds, [], { threshold: 9 }).target, null);
  assert.equal(toolkit.snapMagneticCenter(110, 20, bounds, [], { threshold: 10 }).target, "center");
});

test("only stable neighbours attract the active drag while displaced neighbours yield to a side", () => {
  const toolkit = createLayoutStateToolkit();
  const frozen = {
    avatar: { left: 6, right: 24, width: 18 },
    name: { left: 30, right: 90, width: 60 },
    value: { left: 180, right: 214, width: 34 },
  };
  const resolved = {
    avatar: { left: 6, right: 24, width: 18 },
    name: { left: 126, right: 186, width: 60 },
    value: { left: 82, right: 116, width: 34 },
  };
  assert.deepEqual(
    toolkit.stableMagneticNeighbours(frozen, resolved, "value"),
    [{ id: "avatar", left: 6, right: 24, width: 18 }],
  );
  assert.deepEqual(
    toolkit.stableMagneticNeighbours(frozen, frozen, "value").map((item) => item.id),
    ["avatar", "name"],
  );
  assert.equal(toolkit.snapMagneticCenter(100, 34, { left: 0, right: 220 }, [], { threshold: 16 }).target, "center");
});

test("magnetic edge and neighbour insertions survive width clamping in the final solver", () => {
  const toolkit = createLayoutStateToolkit();
  const bounds = { left: 0, right: 132 };

  let order = ["avatar", "name", ...toolkit.modules.filter((id) => id !== "avatar" && id !== "name")];
  const beforeAvatar = toolkit.snapMagneticCenter(24, 55, bounds, [{ id: "avatar", left: 0, right: 18 }]);
  assert.equal(beforeAvatar.target, "left");
  order = toolkit.moveModule(order, "name", 0);
  let solved = toolkit.solveFreeLayout(order.filter((id) => ["avatar", "name"].includes(id)).map((id) => ({
    id,
    width: id === "name" ? 55 : 18,
    desiredCenter: id === "name" ? beforeAvatar.center : 9,
  })), bounds, { gap: 6, pinnedId: "name", preserveOrder: true });
  assert.deepEqual(solved.order, ["name", "avatar"]);
  assert.ok(solved.positions.name.left + solved.positions.name.width <= solved.positions.avatar.left + 0.01);

  order = toolkit.moveModule(toolkit.modules, "value", 0);
  solved = toolkit.solveFreeLayout(order.filter((id) => ["avatar", "name", "value"].includes(id)).map((id) => ({
    id,
    width: id === "name" ? 55 : id === "avatar" ? 18 : 34,
    minWidth: id === "name" ? 24 : undefined,
    shrinkPriority: id === "name" ? 0 : 100,
    desiredCenter: id === "value" ? 17 : id === "avatar" ? 9 : 54,
  })), bounds, { gap: 6, pinnedId: "value", preserveOrder: true });
  assert.deepEqual(solved.order, ["value", "avatar", "name"]);
  assert.ok(solved.positions.value.center <= solved.positions.avatar.center);
});

test("every module shares every edge and neighbour magnetic target", () => {
  const toolkit = createLayoutStateToolkit();
  for (const rowWidth of [216, 360, 413, 512]) {
    const bounds = { left: 0, right: rowWidth };
    for (const id of moduleOrder) {
      const width = id === "name" ? 72 : id === "seconds" ? 58 : 24;
      const left = toolkit.snapMagneticCenter(width / 2 + 2, width, bounds);
      const center = toolkit.snapMagneticCenter(rowWidth / 2 + 2, width, bounds);
      const right = toolkit.snapMagneticCenter(rowWidth - width / 2 - 2, width, bounds);
      assert.deepEqual([left.target, center.target, right.target], ["left", "center", "right"], `${id}@${rowWidth}`);
      assert.ok(Math.abs(center.center - rowWidth / 2) < 0.01, `${id} center@${rowWidth}`);

      for (const neighbour of moduleOrder.filter((candidate) => candidate !== id)) {
        const neighbourRect = { id: neighbour, left: rowWidth / 2 - 20, right: rowWidth / 2 + 20 };
        const beforeCenter = neighbourRect.left - 6 - width / 2;
        const afterCenter = neighbourRect.right + 6 + width / 2;
        assert.equal(toolkit.snapMagneticCenter(beforeCenter + 1, width, bounds, [neighbourRect]).target, `before:${neighbour}`);
        assert.equal(toolkit.snapMagneticCenter(afterCenter - 1, width, bounds, [neighbourRect]).target, `after:${neighbour}`);
      }
    }
  }
});

test("every neighbour magnet survives insertion and final ordered solving", () => {
  const toolkit = createLayoutStateToolkit();
  let cases = 0;
  for (const rowWidth of [132, 216, 360, 413, 512]) {
    const bounds = { left: 0, right: rowWidth };
    for (const dragged of moduleOrder) {
      for (const neighbour of moduleOrder.filter((candidate) => candidate !== dragged)) {
        const neighbourWidth = moduleWidths[neighbour];
        const neighbourCenters = [neighbourWidth / 2, rowWidth / 2, rowWidth - neighbourWidth / 2];
        for (const neighbourCenter of neighbourCenters) {
          const neighbourRect = {
            id: neighbour,
            left: neighbourCenter - neighbourWidth / 2,
            right: neighbourCenter + neighbourWidth / 2,
            width: neighbourWidth,
          };
          for (const side of ["before", "after"]) {
            cases += 1;
            const requestedCenter = side === "before"
              ? neighbourRect.left - 6 - moduleWidths[dragged] / 2
              : neighbourRect.right + 6 + moduleWidths[dragged] / 2;
            const snap = toolkit.snapMagneticCenter(
              requestedCenter,
              moduleWidths[dragged],
              bounds,
              [neighbourRect],
              { gap: 6, threshold: 16 },
            );
            const context = `${dragged} ${side} ${neighbour} @ ${rowWidth}/${neighbourCenter}`;
            assert.equal(snap.snapped, true, context);

            const order = orderForMagneticTarget(toolkit, moduleOrder, dragged, snap, {
              [dragged]: { left: snap.center - moduleWidths[dragged] / 2, width: moduleWidths[dragged] },
              [neighbour]: neighbourRect,
            });
            const pairOrder = order.filter((candidate) => candidate === dragged || candidate === neighbour);
            const solved = toolkit.solveFreeLayout(pairOrder.map((id) => ({
              id,
              width: moduleWidths[id],
              minWidth: moduleMinimumWidths[id],
              shrinkPriority: moduleShrinkPriorities[id],
              desiredCenter: id === dragged ? snap.center : neighbourCenter,
            })), bounds, { gap: 6, pinnedId: dragged, preserveOrder: true });
            const expectedOrder = side === "before" ? [dragged, neighbour] : [neighbour, dragged];
            assert.deepEqual(solved.order, expectedOrder, context);
            const first = solved.positions[expectedOrder[0]];
            const second = solved.positions[expectedOrder[1]];
            assert.ok(first.left + first.width + solved.gap <= second.left + 0.01, context);
            assert.ok(Math.abs(solved.positions[dragged].center - snap.center) <= 0.01, context);
            assert.ok(Object.values(solved.positions).every((position) => position.left >= -0.01 && position.left + position.width <= rowWidth + 0.01), context);
            assert.equal(solved.overflow, 0, context);
          }
        }
      }
    }
  }
  assert.equal(cases, 3960);
});

test("pointer ordering rearranges only visible modules and preserves hidden-module order", () => {
  const toolkit = createLayoutStateToolkit();
  let cases = 0;
  for (let mask = 1; mask < (1 << moduleOrder.length); mask += 1) {
    const visible = moduleOrder.filter((_module, index) => mask & (1 << index));
    if (visible.length < 2) continue;
    const visibleSet = new Set(visible);
    const hiddenBefore = moduleOrder.filter((module) => !visibleSet.has(module));
    const rects = Object.fromEntries(visible.map((module, index) => [module, { left: index * 30, width: 20 }]));
    for (const dragged of visible) {
      const others = visible.filter((module) => module !== dragged);
      const otherCenters = others.map((module) => rects[module].left + rects[module].width / 2).sort((a, b) => a - b);
      for (let insertion = 0; insertion <= others.length; insertion += 1) {
        cases += 1;
        const pointerCenter = insertion === 0
          ? otherCenters[0] - 1
          : insertion === others.length
            ? otherCenters.at(-1) + 1
            : (otherCenters[insertion - 1] + otherCenters[insertion]) / 2;
        const expectedVisible = [...others];
        expectedVisible.splice(insertion, 0, dragged);
        const actualOrder = toolkit.orderForPointer(moduleOrder, dragged, pointerCenter, rects);
        const context = `${visible.join(",")} / ${dragged} -> ${insertion}`;
        assert.deepEqual(actualOrder.filter((module) => visibleSet.has(module)), expectedVisible, context);
        assert.deepEqual(actualOrder.filter((module) => !visibleSet.has(module)), hiddenBefore, context);
      }
    }
  }
  assert.equal(cases, 159732);
});

test("edge magnets outrank coincident neighbour magnets throughout a full layout", () => {
  const toolkit = createLayoutStateToolkit();
  let cases = 0;
  for (const rowWidth of [132, 216, 360, 413, 512]) {
    const bounds = { left: 0, right: rowWidth };
    const initial = toolkit.solveFreeLayout(moduleOrder.map((id) => ({
      id,
      width: moduleWidths[id],
      minWidth: moduleMinimumWidths[id],
      shrinkPriority: moduleShrinkPriorities[id],
      desiredCenter: toolkit.defaultAnchors[id] * rowWidth,
    })), bounds, { gap: 6, preserveOrder: true });
    const rects = Object.fromEntries(moduleOrder.map((id) => [id, {
      left: initial.positions[id].left,
      right: initial.positions[id].left + initial.positions[id].width,
      width: initial.positions[id].width,
    }]));
    const settledCenters = Object.fromEntries(moduleOrder.map((id) => [id, initial.positions[id].center]));

    for (const dragged of moduleOrder) {
      const draggedWidth = initial.positions[dragged].width;
      for (const side of ["left", "right"]) {
        cases += 1;
        const requestedCenter = side === "left" ? draggedWidth / 2 : rowWidth - draggedWidth / 2;
        const neighbours = moduleOrder
          .filter((id) => id !== dragged)
          .map((id) => ({ id, ...rects[id] }));
        const snap = toolkit.snapMagneticCenter(requestedCenter, draggedWidth, bounds, neighbours, { gap: 6, threshold: 16 });
        const context = `${dragged} ${side} @ ${rowWidth}`;
        assert.equal(snap.target, side, context);
        const order = orderForMagneticTarget(toolkit, moduleOrder, dragged, snap, rects);
        const solved = toolkit.solveFreeLayout(order.map((id) => ({
          id,
          width: initial.positions[id].width,
          minWidth: initial.positions[id].width,
          desiredCenter: id === dragged ? snap.center : settledCenters[id],
        })), bounds, { gap: initial.gap, pinnedId: dragged, preserveOrder: true });
        assert.equal(side === "left" ? solved.order[0] : solved.order.at(-1), dragged, context);
        assert.ok(Math.abs(solved.positions[dragged].center - requestedCenter) <= 0.01, context);
      }
    }
  }
  assert.equal(cases, 120);

  const bounds = { left: 0, right: 200 };
  assert.equal(
    toolkit.snapMagneticCenter(100, 20, bounds, [{ id: "name", left: 64, right: 84 }], { gap: 6 }).target,
    "after:name",
  );
  assert.equal(
    toolkit.snapMagneticCenter(100, 20, bounds, [{ id: "name", left: 116, right: 136 }], { gap: 6 }).target,
    "before:name",
  );
});

test("default avatar and name remain neighbours as the sidebar widens", () => {
  const toolkit = createLayoutStateToolkit();
  for (const rowWidth of [216, 360, 413, 512, 800]) {
    const solved = toolkit.solveFreeLayout([
      { id: "avatar", width: 18, desiredCenter: toolkit.defaultAnchors.avatar * rowWidth },
      { id: "name", width: 55, minWidth: 24, shrinkPriority: 0, desiredCenter: toolkit.defaultAnchors.name * rowWidth },
    ], { left: 0, right: rowWidth }, { gap: 6 });
    assert.ok(Math.abs(solved.positions.name.left - solved.positions.avatar.left - solved.positions.avatar.width - 6) < 0.01, `gap@${rowWidth}`);
  }
});

test("every visible-module combination settles inside the account row without overlap", () => {
  const toolkit = createLayoutStateToolkit();
  const widths = { avatar: 18, name: 88, dot: 7, value: 34, label: 22, countdown: 44, seconds: 66, date: 42, reset: 58 };
  for (let mask = 1; mask < (1 << moduleOrder.length); mask += 1) {
    const visible = moduleOrder.filter((_module, index) => mask & (1 << index));
    const solved = toolkit.solveFreeLayout(visible.map((id, index) => ({
      id,
      width: widths[id],
      minWidth: id === "name" ? 24 : Math.min(widths[id], 18),
      shrinkPriority: id === "name" ? 0 : 20 + index,
      desiredCenter: toolkit.defaultAnchors[id] * 360,
    })), { left: 0, right: 360 }, { gap: 6 });
    assert.equal(solved.overflow, 0, `overflow for ${visible.join(",")}`);
    const positions = solved.order.map((id) => solved.positions[id]);
    assert.ok(positions.every((position) => position.left >= -0.01 && position.left + position.width <= 360.01), `bounds for ${visible.join(",")}`);
    assert.ok(positions.every((position, index) => index === 0 || position.left >= positions[index - 1].left + positions[index - 1].width + solved.gap - 0.01), `overlap for ${visible.join(",")}`);
  }
});

test("every module can occupy left, center, or right and every three-module ordering remains collision-free", () => {
  const toolkit = createLayoutStateToolkit();
  const widths = { avatar: 18, name: 88, dot: 7, value: 34, label: 22, countdown: 44, seconds: 66, date: 42, reset: 58 };
  const bounds = { left: 0, right: 360 };
  const gravity = [0.04, 0.5, 0.96];

  for (const id of moduleOrder) {
    for (const anchor of gravity) {
      const solved = toolkit.solveFreeLayout([{ id, width: widths[id], desiredCenter: anchor * bounds.right }], bounds, { gap: 6, pinnedId: id });
      const position = solved.positions[id];
      assert.ok(position.left >= -0.01 && position.left + position.width <= bounds.right + 0.01, `${id}@${anchor}`);
      if (anchor === 0.5) assert.ok(Math.abs(position.center - 180) < 0.01, `${id} must keep the center gravity point`);
    }
  }

  for (let a = 0; a < moduleOrder.length; a += 1) {
    for (let b = a + 1; b < moduleOrder.length; b += 1) {
      for (let c = b + 1; c < moduleOrder.length; c += 1) {
        const chosen = [moduleOrder[a], moduleOrder[b], moduleOrder[c]];
        for (const permutation of [
          [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
        ]) {
          const items = chosen.map((id, index) => ({
            id,
            width: widths[id],
            minWidth: id === "name" ? 24 : Math.min(widths[id], 18),
            shrinkPriority: id === "name" ? 0 : 20 + index,
            desiredCenter: gravity[permutation[index]] * bounds.right,
          }));
          const solved = toolkit.solveFreeLayout(items, bounds, { gap: 6 });
          const positions = solved.order.map((id) => solved.positions[id]);
          assert.equal(solved.overflow, 0, `${chosen.join(",")} / ${permutation.join("")}`);
          assert.ok(positions.every((position) => position.left >= -0.01 && position.left + position.width <= bounds.right + 0.01));
          assert.ok(positions.every((position, index) => index === 0 || position.left >= positions[index - 1].left + positions[index - 1].width + solved.gap - 0.01));
        }
      }
    }
  }
});

test("free layout preserves an unconstrained drop and minimally separates collisions", () => {
  const toolkit = createLayoutStateToolkit();
  const unconstrained = toolkit.solveFreeLayout([
    { id: "avatar", width: 18, desiredCenter: 18 },
    { id: "value", width: 36, desiredCenter: 120 },
  ], { left: 0, right: 200 }, { gap: 6, pinnedId: "value" });
  assert.equal(unconstrained.positions.value.center, 120);
  assert.equal(unconstrained.positions.avatar.center, 18);

  const collided = toolkit.solveFreeLayout([
    { id: "avatar", width: 18, desiredCenter: 90 },
    { id: "value", width: 36, desiredCenter: 94 },
    { id: "name", width: 70, minWidth: 24, shrinkPriority: 0, desiredCenter: 98 },
  ], { left: 0, right: 200 }, { gap: 6, pinnedId: "value" });
  assert.ok(Math.abs(collided.positions.value.center - 94) < 0.01);
  const ordered = collided.order.map((id) => collided.positions[id]);
  assert.ok(ordered.every((position, index) => index === 0 || position.left >= ordered[index - 1].left + ordered[index - 1].width + collided.gap - 0.01));

  const settledAnchors = toolkit.anchorsFromRects(collided.positions, { left: 0, right: 200 });
  const settled = toolkit.solveFreeLayout(collided.order.map((id) => ({
    id,
    width: collided.positions[id].width,
    desiredCenter: settledAnchors[id] * 200,
  })), { left: 0, right: 200 }, { gap: 6 });
  for (const id of collided.order) {
    assert.ok(Math.abs(settled.positions[id].center - collided.positions[id].center) < 0.01);
  }
});

test("free layout anchors are normalized, keyboard-adjustable, and width-aware", () => {
  const toolkit = createLayoutStateToolkit();
  const anchors = toolkit.anchorsFromRects({ value: { left: 40, width: 20 } }, { left: 0, right: 100 });
  assert.equal(anchors.value, 0.5);
  assert.equal(toolkit.moveModuleAnchor(anchors, "value", "right", 0.1).value, 0.6);
  assert.equal(toolkit.cleanLayoutMode("free"), "free");
  assert.equal(toolkit.cleanLayoutMode("mystery"), "auto");

  const fitted = toolkit.solveFreeLayout([
    { id: "name", width: 150, minWidth: 24, shrinkPriority: 0, desiredCenter: 60 },
    { id: "value", width: 50, minWidth: 32, shrinkPriority: 20, desiredCenter: 100 },
  ], { left: 0, right: 120 }, { gap: 8 });
  assert.equal(fitted.overflow, 0);
  assert.ok(fitted.positions.name.width < 150);
  assert.ok(fitted.positions.value.left + fitted.positions.value.width <= 120.01);
});

test("hidden modules keep their saved anchor and a single visible module keeps its center", () => {
  const toolkit = createLayoutStateToolkit();
  const fallback = { ...toolkit.defaultAnchors, value: 0.8, name: 0.4 };
  const anchors = toolkit.anchorsFromRects({
    value: { left: 0, top: 0, width: 0, height: 0 },
    name: { left: 30, top: 4, width: 20, height: 18 },
  }, { left: 0, right: 100 }, fallback);
  assert.equal(anchors.value, 0.8);
  assert.equal(anchors.name, 0.4);
  for (const center of [40, 100, 160]) {
    const solved = toolkit.solveFreeLayout([{ id: "value", width: 28, desiredCenter: center }], { left: 0, right: 200 }, { gap: 6, pinnedId: "value" });
    assert.equal(solved.positions.value.center, center);
  }
  const nameOnly = toolkit.solveFreeLayout([
    { id: "name", width: 128, minWidth: 24, shrinkPriority: 0, desiredCenter: 160 },
  ], { left: 0, right: 200 }, { gap: 6, pinnedId: "name" });
  assert.ok(nameOnly.positions.name.center > 100, "a long name near the right edge must not fall back to the left");
  assert.equal(nameOnly.positions.name.left + nameOnly.positions.name.width <= 200.01, true);
});

test("a rightward free drag cannot reverse when it starts from settled visual centers", () => {
  const toolkit = createLayoutStateToolkit();
  const widths = { avatar: 18, name: 24, dot: 6, value: 28, label: 14, countdown: 28, seconds: 38, date: 28, reset: 42 };
  const settled = { avatar: 20, name: 42, dot: 59, value: 78, label: 99, countdown: 120, seconds: 148, date: 174, reset: 195 };
  let previous = -Infinity;
  for (let target = 96; target <= 184; target += 4) {
    const solved = toolkit.solveFreeLayout(Object.keys(widths).map((id) => ({
      id,
      width: widths[id],
      minWidth: id === "name" ? 24 : widths[id],
      shrinkPriority: id === "name" ? 0 : 100,
      desiredCenter: id === "value" ? target : settled[id],
    })), { left: 16, right: 212 }, { gap: 6, pinnedId: "value" });
    assert.ok(solved.positions.value.center >= previous - 0.01);
    previous = solved.positions.value.center;
  }
});

test("hidden command input is layout-independent and never consumes ordinary editable text", () => {
  const toolkit = createCommandStateToolkit();
  const sequence = ["ArrowLeft", "ArrowDown", "ArrowRight"];
  let state = toolkit.createCommandState();
  for (const [index, code] of ["KeyA", "KeyS", "KeyD"].entries()) {
    const result = toolkit.reduceCommandInput(state, { code, key: code.slice(-1).toLowerCase(), at: 100 + index * 100 }, { sequence });
    state = result.state;
    if (index < 2) assert.equal(result.complete, false);
    else assert.equal(result.complete, true);
    assert.equal(result.consume, index === 2);
  }

  const ordinary = toolkit.reduceCommandInput(toolkit.createCommandState(), {
    code: "KeyW", key: "w", at: 100, editable: true,
  }, { sequence });
  assert.equal(ordinary.accepted, false);
  assert.equal(ordinary.consume, false);

  state = toolkit.createCommandState();
  let complete = false;
  for (const [index, code] of ["KeyA", "KeyS", "KeyD"].entries()) {
    const result = toolkit.reduceCommandInput(state, {
      code, key: code.slice(-1).toLowerCase(), at: 100 + index * 100, editable: true, altKey: true,
    }, { sequence });
    state = result.state;
    complete = result.complete;
    assert.equal(result.consume, true);
  }
  assert.equal(complete, true);
});

test("gesture state separates short, hold, and cancelled paths", () => {
  const toolkit = createGestureStateToolkit();
  const initial = toolkit.createGestureState({ pointerId: 1, x: 10, y: 10, startedAt: 100 });
  assert.equal(toolkit.reduceGestureState(initial, { type: "release", at: 300 }).outcome, "short");
  assert.equal(toolkit.reduceGestureState(initial, { type: "release", at: 700 }).outcome, "hold");
  assert.equal(toolkit.reduceGestureState(initial, { type: "move", x: 30, y: 10 }).outcome, "cancelled");
});

test("optional effect state starts once and respects persistent eligibility", () => {
  const toolkit = createEffectStateToolkit();
  let state = toolkit.createEffectState();
  let result = toolkit.reduceEffectState(state, { enabled: true, detectedActive: true, variant: "variant-a" });
  assert.deepEqual(result.command, { type: "start", variant: "variant-a", persistent: false });
  state = result.state;
  result = toolkit.reduceEffectState(state, { enabled: true, detectedActive: true, variant: "variant-a" });
  assert.equal(result.command.type, "none");
  result = toolkit.reduceEffectState(state, { detectedActive: true, persistentRequested: "variant-b", persistentActive: false, effectPresent: false });
  assert.deepEqual(result.command, { type: "start", variant: "variant-b", persistent: true });
  state = result.state;
  result = toolkit.reduceEffectState(state, { detectedActive: true, persistentRequested: "", persistentActive: true });
  assert.deepEqual(result.command, { type: "clear" });
});

test("disabled optional monitoring performs zero classifications", () => {
  const toolkit = createEffectStateToolkit();
  let state = toolkit.createEffectMonitorState();
  for (const now of [1000, 1750, 2500, 13000, 60000]) {
    const result = toolkit.reduceEffectMonitorState(state, {
      enabled: false,
      controlsUnlocked: false,
      persistentActive: false,
      now,
      watchdogMs: 12000,
    });
    state = result.state;
    assert.equal(result.command, "none");
  }
  assert.equal(state.monitoring, false);
  assert.equal(state.classifications, 0);
});

test("optional monitoring classifies only on entry, invalidation, or bounded watchdog", () => {
  const toolkit = createEffectStateToolkit();
  let state = toolkit.createEffectMonitorState();
  let result = toolkit.reduceEffectMonitorState(state, { enabled: true, now: 1000, watchdogMs: 12000 });
  assert.equal(result.command, "classify");
  state = result.state;

  result = toolkit.reduceEffectMonitorState(state, { enabled: true, now: 1750, watchdogMs: 12000 });
  assert.equal(result.command, "none");
  state = toolkit.markEffectMonitorDirty(result.state);

  result = toolkit.reduceEffectMonitorState(state, { enabled: true, now: 1800, watchdogMs: 12000 });
  assert.equal(result.command, "classify");
  state = result.state;

  result = toolkit.reduceEffectMonitorState(state, { enabled: true, now: 13799, watchdogMs: 12000 });
  assert.equal(result.command, "none");
  result = toolkit.reduceEffectMonitorState(result.state, { enabled: true, now: 13800, watchdogMs: 12000 });
  assert.equal(result.command, "classify");
  assert.equal(result.state.classifications, 3);
});

test("i18n state keeps renderer labels and option contracts in one toolkit", () => {
  const toolkit = createI18nToolkit();
  assert.equal(toolkit.translate("en", "Saved"), "Saved");
  assert.equal(toolkit.translate("zh-CN", "Saved"), "已保存");
  assert.equal(toolkit.translate("ja", "Saved"), "保存しました");
  assert.equal(toolkit.translate("zh-CN", "Show seconds"), "显示秒级倒计时");
  assert.equal(toolkit.translate("ja", "Show reset date"), "リセット日を表示");
  assert.equal(toolkit.translate("zh-CN", "Glance"), "一眼看清");
  assert.equal(toolkit.translate("zh-CN", "Reset time"), "重置时间");
  assert.equal(toolkit.translate("ja", "Glance"), "ひと目");
  assert.equal(toolkit.translate("ja", "View"), "ビュー");
  assert.deepEqual(toolkit.selectOptions.window, [
    ["auto", "All returned"],
    ["shortest", "Shortest"],
    ["longest", "Longest"],
  ]);
  assert.deepEqual(toolkit.selectOptions.avatarShape[0], ["native", "Codex default"]);
  assert.equal(toolkit.translate("zh-CN", "Codex default"), "Codex 默认");
  assert.equal(toolkit.translate("ja", "Codex default"), "Codex の標準");
  assert.equal(toolkit.translate("zh-CN", "QuotaPin settings modes"), "QuotaPin 设置模式");
  assert.equal(toolkit.translate("ja", "Code draft not applied"), "コードの下書きは未適用です");
  assert.equal(toolkit.updateIntent("0.3.0-alpha.25", "0.3.0-alpha.26"), "update");
  assert.equal(toolkit.updateIntent("0.3.0-alpha.25", "0.3.0-alpha.25"), "repair");
  assert.equal(toolkit.updateIntent("0.3.0-alpha.25", "0.3.0-alpha.24"), "rollback");
  assert.equal(toolkit.updateIntent("0.3.0", "0.3.0-alpha.25"), "rollback");
  assert.equal(toolkit.updateIntent("not-a-version", "0.3.0"), "unknown");
  assert.deepEqual(toolkit.selectOptions.overdriveEffect, ["menuFire"]);
});

test("automatic quota colors preserve contrast on light Codex surfaces", () => {
  const toolkit = createColorStateToolkit();
  assert.equal(toolkit.surfaceFromTextColor("rgb(31, 35, 40)"), "light");
  assert.equal(toolkit.surfaceFromTextColor("rgb(237, 237, 237)"), "dark");
  for (const color of ["#6ee7b7", "#fbbf24", "#f87171"]) {
    const adapted = toolkit.automaticContrast(color, "severity", "light", 4.5);
    assert.ok(toolkit.contrastRatio(adapted, "#ffffff") >= 4.5, color);
  }
  assert.equal(toolkit.automaticContrast("#6ee7b7", "severity", "dark", 4.5), "#6ee7b7");
  assert.equal(toolkit.automaticContrast("#55aa77", "#55aa77", "light", 4.5), "#55aa77");
});
