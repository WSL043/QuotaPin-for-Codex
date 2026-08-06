import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOverdrive,
  compileEffectRecipe,
  createEffectRegistry,
  decideEffectReconciliation,
  persistentEffectPolicy,
  startRegisteredEffect,
  validateEffectRecipe,
} from "../src/renderer/experiments.mjs";

const unseal = (encoded) => JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
test("the optional classifier accepts only exact structural state", () => {
  const scenarios = unseal("W3sic2VsZWN0ZWRUZXh0IjoiNS42IFNvbCIsInNlbGVjdGVkRWZmb3J0IjoidWx0cmEiLCJmYXN0SW5kaWNhdG9yIjp0cnVlLCJleHBlY3RlZCI6dHJ1ZX0seyJzZWxlY3RlZFRleHQiOiI1LjYgU29sIiwic2VsZWN0ZWRFZmZvcnQiOiJ4aGlnaCIsImZhc3RJbmRpY2F0b3IiOnRydWUsImV4cGVjdGVkIjpmYWxzZX0seyJzZWxlY3RlZFRleHQiOiI1LjYgTHVuYSIsInNlbGVjdGVkRWZmb3J0IjoidWx0cmEiLCJmYXN0SW5kaWNhdG9yIjp0cnVlLCJleHBlY3RlZCI6ZmFsc2V9LHsic2VsZWN0ZWRUZXh0IjoiNS42IFNvbCBVbHRyYSIsImZhc3RJbmRpY2F0b3IiOnRydWUsImV4cGVjdGVkIjpmYWxzZX0seyJzZWxlY3RlZFRleHQiOiI1LjYgU29sIiwic2VsZWN0ZWRFZmZvcnQiOiJ1bHRyYSIsImV4cGVjdGVkIjpmYWxzZX0seyJzZWxlY3RlZFRleHQiOiI1LjYgU29sIiwidWx0cmFFZmZvcnRJbmRpY2F0b3IiOnRydWUsImZhc3RJbmRpY2F0b3IiOnRydWUsImV4cGVjdGVkIjp0cnVlfV0=");
  for (const scenario of scenarios) {
    const { expected, ...input } = scenario;
    assert.equal(classifyOverdrive(input).active, expected);
  }
});

test("persistent effects run only while their condition remains active", () => {
  const settings = { persistWhileCondition: true, effectId: "sample-b" };
  assert.equal(persistentEffectPolicy(settings, { active: true }), "sample-b");
  assert.equal(persistentEffectPolicy(settings, { active: false }), "");
  assert.equal(persistentEffectPolicy({ ...settings, persistWhileCondition: false }, { active: true }), "");
});

test("the registry reports the effect that actually started after fallback", () => {
  const stopped = [];
  const registry = createEffectRegistry([
    { id: "sample-a", start: () => null },
    { id: "sample-b", supportsPersistent: true, start: () => ({ stop: () => stopped.push("sample-b") }) },
  ]);
  const result = startRegisteredEffect(registry, "sample-a", {}, { fallbackId: "sample-b" });
  assert.equal(result.requested, "sample-a");
  assert.equal(result.actual, "sample-b");
  result.handle.stop();
  assert.deepEqual(stopped, ["sample-b"]);
});

test("persistent registry selection excludes definitions that cannot persist", () => {
  const registry = createEffectRegistry([
    { id: "sample-a", start: () => () => {} },
    { id: "sample-b", supportsPersistent: true, start: () => () => {} },
  ]);
  const result = startRegisteredEffect(registry, "sample-a", {}, { persistent: true, fallbackId: "sample-b" });
  assert.equal(result.actual, "sample-b");
});

test("reconciliation restarts a persistent effect when Codex replaces its owned DOM", () => {
  const baseline = { enabled: true, persistent: true, conditionActive: true, badgeConnected: true, requestedId: "sample-a", runningRequestedId: "sample-a" };
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: false }), "start");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, surfaceConnected: true, artifactConnected: true }), "keep");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, surfaceConnected: false, artifactConnected: false }), "restart");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, surfaceConnected: true, artifactConnected: false }), "restart");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, surfaceConnected: true, artifactConnected: true, requestedId: "sample-b" }), "restart");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, conditionActive: false }), "stop");
  assert.equal(decideEffectReconciliation({ ...baseline, hasInstance: true, badgeConnected: false }), "stop");
});

const safeRecipe = Object.freeze({
  schemaVersion: 1,
  id: "sample-a",
  name: "Sample A",
  target: "quota",
  primitive: "color-cycle",
  mode: "once",
  durationMs: 1800,
  fps: 12,
  intensity: .7,
  palette: ["#6ee7b7", "#60a5fa"],
});

test("declarative recipes compile only to registered built-in primitives", () => {
  const calls = [];
  const compiled = compileEffectRecipe(safeRecipe, {
    "color-cycle": ({ target, recipe, persistent }) => {
      calls.push({ target, id: recipe.id, persistent });
      return () => {};
    },
  });
  assert.equal(compiled.ok, true);
  const registry = createEffectRegistry([compiled.definition]);
  const result = startRegisteredEffect(registry, "sample-a", { resolveTarget: () => "mock-target" });
  assert.equal(result.actual, "sample-a");
  assert.deepEqual(calls, [{ target: "mock-target", id: "sample-a", persistent: false }]);
});

test("recipes reject executable content, markup, selectors, URLs, network, and file access", () => {
  const rejected = [
    { ...safeRecipe, javascript: "alert(1)" },
    { ...safeRecipe, html: "<b>hello</b>" },
    { ...safeRecipe, selector: "#account" },
    { ...safeRecipe, sourceUrl: "https://example.invalid/a" },
    { ...safeRecipe, network: { fetch: "https://example.invalid" } },
    { ...safeRecipe, filePath: "C:\\private\\effect.js" },
    { ...safeRecipe, name: "<img src=x>" },
  ];
  for (const recipe of rejected) assert.equal(validateEffectRecipe(recipe).ok, false);
});

test("recipes enforce bounded duration, frame rate, intensity, colors, and known fields", () => {
  for (const recipe of [
    { ...safeRecipe, durationMs: 30000 },
    { ...safeRecipe, fps: 60 },
    { ...safeRecipe, intensity: 2 },
    { ...safeRecipe, palette: ["red"] },
    { ...safeRecipe, surprise: true },
  ]) assert.equal(validateEffectRecipe(recipe).ok, false);
});
