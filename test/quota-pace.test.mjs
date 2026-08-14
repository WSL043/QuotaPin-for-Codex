import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createQuotaPaceState,
  estimateQuotaPace,
  observeQuotaPace,
} from "../src/core/quota-pace.mjs";
import { QuotaPaceRuntime } from "../src/agent/quota-pace-runtime.mjs";

const hour = 60 * 60 * 1000;
const base = Date.UTC(2026, 7, 13, 0, 0, 0);

function usage(remainingPercent, at, resetsAt = (base + 7 * 24 * hour) / 1000) {
  return {
    status: "ready",
    receivedAt: at,
    windows: [{
      id: "limit:codex:duration:10080",
      sourceId: "codex",
      windowDurationMins: 10080,
      remainingPercent,
      resetsAt,
    }],
  };
}

test("quota pace is derived only from official account-window changes", () => {
  let state = createQuotaPaceState();
  for (const [offset, remaining] of [[0, 90], [.5, 88], [1, 86]]) {
    state = observeQuotaPace(state, usage(remaining, base + offset * hour), base + offset * hour).state;
  }
  const [estimate] = estimateQuotaPace(state, usage(86, base + hour), base + hour);
  assert.equal(estimate.status, "ready");
  assert.ok(Math.abs(estimate.pacePerHour - 4) < 0.05, JSON.stringify(estimate));
  assert.ok(Math.abs(estimate.runwaySeconds - 21.5 * 3600) < 120, JSON.stringify(estimate));
  assert.equal(estimate.survivesReset, false);
  assert.equal(estimate.sampleCount, 3);
  assert.equal(estimate.forecastVersion, 2);
  assert.equal(estimate.regime, "steady");
  assert.ok(Math.abs(estimate.currentPacePerHour - 4) < 0.05, JSON.stringify(estimate));
  assert.ok(Math.abs(estimate.slowPacePerHour - 4) < 0.05, JSON.stringify(estimate));
  assert.ok(estimate.runwayLowSeconds <= estimate.runwaySeconds, JSON.stringify(estimate));
  assert.ok(estimate.runwayHighSeconds >= estimate.runwaySeconds, JSON.stringify(estimate));
});

test("forecast v2 reacts to an accelerating recent regime without replacing the stable baseline", () => {
  let state = createQuotaPaceState();
  const trajectory = [[0, 100], [2, 99], [4, 98], [6, 97], [8, 96], [10, 95], [11, 90], [12, 85]];
  for (const [offset, remaining] of trajectory) {
    state = observeQuotaPace(state, usage(remaining, base + offset * hour), base + offset * hour).state;
  }
  const [estimate] = estimateQuotaPace(state, usage(85, base + 12 * hour), base + 12 * hour);

  assert.equal(estimate.status, "ready");
  assert.equal(estimate.regime, "accelerating");
  assert.ok(estimate.currentPacePerHour > estimate.pacePerHour * 1.5, JSON.stringify(estimate));
  assert.ok(estimate.runwayLowSeconds < estimate.runwaySeconds, JSON.stringify(estimate));
  assert.equal(estimate.confidence, "low", "a regime change must widen uncertainty even with many samples");
  assert.equal(estimate.evidenceConfidence, "high");
});

test("forecast v2 recognizes a sustained idle period and extends only the high bound to reset", () => {
  const reset = (base + 106 * hour) / 1000;
  let state = createQuotaPaceState();
  const trajectory = [[0, 90], [1, 88], [2, 86], [3, 84], [4, 84], [5, 84], [6, 84]];
  for (const [offset, remaining] of trajectory) {
    state = observeQuotaPace(state, usage(remaining, base + offset * hour, reset), base + offset * hour).state;
  }
  const [estimate] = estimateQuotaPace(state, usage(84, base + 6 * hour, reset), base + 6 * hour);

  assert.equal(estimate.status, "ready");
  assert.equal(estimate.regime, "idle");
  assert.equal(estimate.currentPacePerHour, 0);
  assert.equal(estimate.rangeSurvivesReset, true);
  assert.equal(estimate.runwayHighSeconds, 100 * 3600);
  assert.ok(estimate.runwayLowSeconds < estimate.runwayHighSeconds, JSON.stringify(estimate));
});

test("forecast v2 does not let yesterday's faster burn masquerade as today's pace", () => {
  const reset = (base + 213 * hour) / 1000;
  let state = createQuotaPaceState();
  const trajectory = [[0, 100], [2, 96], [4, 92], [6, 88], [8, 84], [10, 80], [11, 80], [12, 79], [13, 79]];
  for (const [offset, remaining] of trajectory) {
    state = observeQuotaPace(state, usage(remaining, base + offset * hour, reset), base + offset * hour).state;
  }
  const [estimate] = estimateQuotaPace(state, usage(79, base + 13 * hour, reset), base + 13 * hour);

  assert.equal(estimate.status, "ready");
  assert.equal(estimate.regime, "cooling");
  assert.ok(estimate.currentPacePerHour < estimate.pacePerHour * .55, JSON.stringify(estimate));
  assert.ok(estimate.runwayLowSeconds < estimate.runwayHighSeconds, JSON.stringify(estimate));
  assert.equal(estimate.confidence, "low", "conflicting day-scale behavior must be shown as uncertainty");
  assert.equal(estimate.evidenceConfidence, "high");
});

test("active epoch storage keeps observations beyond one day while the model remains bounded", () => {
  let state = createQuotaPaceState();
  for (let offset = 0; offset <= 30; offset += 1) {
    state = observeQuotaPace(state, usage(100 - offset, base + offset * hour), base + offset * hour).state;
  }
  const record = state.windows["codex:10080"];
  assert.ok(record.samples.length > 24, "the current weekly epoch should not be truncated at 24 hours");
  const [estimate] = estimateQuotaPace(state, usage(70, base + 30 * hour), base + 30 * hour);
  assert.ok(estimate.observedSpanMs <= 24 * hour, "the prediction window stays bounded even when storage is longer");
});

test("an account reset starts a new calibration epoch instead of reporting a negative pace", () => {
  let state = createQuotaPaceState();
  state = observeQuotaPace(state, usage(20, base), base).state;
  state = observeQuotaPace(state, usage(15, base + hour), base + hour).state;
  const nextReset = (base + 14 * 24 * hour) / 1000;
  state = observeQuotaPace(state, usage(100, base + 2 * hour, nextReset), base + 2 * hour).state;
  const [estimate] = estimateQuotaPace(state, usage(100, base + 2 * hour, nextReset), base + 2 * hour);
  assert.equal(estimate.status, "calibrating");
  assert.equal(estimate.sampleCount, 1);
  assert.equal(estimate.pacePerHour, null);
});

test("a forecast that outlasts the official reset is marked as a lower bound", () => {
  const reset = (base + 4 * hour) / 1000;
  let state = createQuotaPaceState();
  state = observeQuotaPace(state, usage(90, base, reset), base).state;
  state = observeQuotaPace(state, usage(89, base + hour, reset), base + hour).state;
  state = observeQuotaPace(state, usage(88, base + 2 * hour, reset), base + 2 * hour).state;
  const [estimate] = estimateQuotaPace(state, usage(88, base + 2 * hour, reset), base + 2 * hour);
  assert.equal(estimate.status, "ready");
  assert.equal(estimate.survivesReset, true);
});

test("quota pace calibration survives an Agent restart", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-pace-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "quota-pace.json");
  let now = base;
  let runtime = new QuotaPaceRuntime({ statePath, now: () => now });
  runtime.observe(usage(90, now));
  now += .5 * hour;
  runtime.observe(usage(88, now));

  runtime = new QuotaPaceRuntime({ statePath, now: () => now });
  now += .5 * hour;
  runtime.observe(usage(86, now));
  const [estimate] = runtime.getState().windows;

  assert.equal(estimate.status, "ready");
  assert.equal(estimate.sampleCount, 3);
  assert.ok(Math.abs(estimate.pacePerHour - 4) < 0.05, JSON.stringify(estimate));
});

test("corrupt quota pace history fails closed without blocking fresh observations", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-pace-corrupt-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "quota-pace.json");
  fs.writeFileSync(statePath, "not-json", "utf8");
  const messages = [];
  const runtime = new QuotaPaceRuntime({ statePath, now: () => base, log: (message) => messages.push(message) });

  assert.equal(runtime.getState(usage(90, base)).windows[0].status, "calibrating");
  assert.equal(runtime.observe(usage(90, base)), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(statePath, "utf8")));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /history ignored/);
});
