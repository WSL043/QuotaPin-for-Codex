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
