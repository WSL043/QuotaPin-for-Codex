import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryStateToolkit } from "../src/renderer/delivery-state.mjs";

test("renderer delivery freshness becomes stale only after missed heartbeats and recovers on delivery", () => {
  const { markDeliveryAccepted, evaluateDeliveryFreshness } = createDeliveryStateToolkit();
  const runtime = { highestSequence: 1, lastAcceptedAt: 0, stale: false, staleTransitions: 0, recoveries: 0 };
  assert.equal(markDeliveryAccepted(runtime, 1_000), false);
  assert.equal(evaluateDeliveryFreshness(runtime, 45_999, 45_000), false);
  assert.equal(evaluateDeliveryFreshness(runtime, 46_001, 45_000), true);
  assert.equal(runtime.stale, true);
  assert.equal(runtime.staleTransitions, 1);
  assert.equal(evaluateDeliveryFreshness(runtime, 90_000, 45_000), false);
  assert.equal(markDeliveryAccepted(runtime, 90_000), true);
  assert.equal(runtime.stale, false);
  assert.equal(runtime.recoveries, 1);
});

test("fixture-only renderer state never becomes stale", () => {
  const { evaluateDeliveryFreshness } = createDeliveryStateToolkit();
  const runtime = { highestSequence: 0, lastAcceptedAt: 1_000, stale: false };
  assert.equal(evaluateDeliveryFreshness(runtime, 100_000, 45_000), false);
  assert.equal(runtime.stale, false);
});
