import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalizedRemainingTime, formatRemainingTime } from "../src/core/format.mjs";
import { createTimeStateToolkit } from "../src/renderer/time-state.mjs";

const toolkit = createTimeStateToolkit();

test("precise countdown derives every frame from the absolute reset timestamp", () => {
  const resetsAt = 10;
  assert.equal(toolkit.formatPreciseRemainingTime(resetsAt, 5_001), "00:00:05");
  assert.equal(toolkit.formatPreciseRemainingTime(resetsAt, 6_001), "00:00:04");
  assert.equal(toolkit.formatPreciseRemainingTime(resetsAt, 10_001), "now");
  assert.equal(toolkit.formatPreciseRemainingTime(259_200, 0), "72:00:00");
});

test("live countdown scheduler targets the next true display boundary instead of drifting intervals", () => {
  const windows = [{ resetsAt: 10 }];
  assert.equal(toolkit.nextBoundaryDelay(windows, 5_401, 1_000, 12), 611);
  assert.equal(toolkit.nextBoundaryDelay(windows, 5_000, 1_000, 12), 1_012);
  assert.equal(toolkit.nextBoundaryDelay(windows, 5_401, 60_000, 12), 4_611);
  assert.equal(toolkit.nextBoundaryDelay([{ resetsAt: 1 }], 2_000, 1_000), null);
});

test("seconds opt into one-second refresh while compact countdown stays minute-aligned", () => {
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "modules", showSeconds: true }), 1_000);
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "template", renderTemplate: "{remaining}% · {seconds}" }), 1_000);
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "modules", showCountdown: true }), 60_000);
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "modules", showRelative: true }), 60_000);
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "template", renderTemplate: "{relative}" }), 60_000);
  assert.equal(toolkit.liveRefreshUnit({ displayMode: "modules", showValue: true }), null);
});

test("live compact and localized countdowns share one absolute clock", () => {
  const resetsAt = 4 * 86400 + 8 * 3600;
  assert.equal(toolkit.formatRemainingTime(resetsAt, 0, "zh-CN"), "4d 8h");
  assert.equal(toolkit.formatLocalizedRemainingTime(resetsAt, 0, "zh-CN"), "4天8小时");
  assert.equal(toolkit.formatLocalizedRemainingTime(resetsAt, 0, "ja-JP"), "4日8時間");
  assert.equal(toolkit.formatLocalizedRemainingTime(resetsAt, 0, "en-US"), "4 days 8 hours");
});

test("live and initial time formatters stay byte-for-byte aligned", () => {
  const cases = [
    { resetsAt: 4 * 86400 + 8 * 3600, now: 0 },
    { resetsAt: 3900, now: 0 },
    { resetsAt: 61, now: 0 },
    { resetsAt: 1, now: 2_000 },
    { resetsAt: "bad", now: 0 },
  ];
  for (const locale of ["en-US", "zh-CN", "ja-JP"]) {
    for (const item of cases) {
      assert.equal(toolkit.formatRemainingTime(item.resetsAt, item.now, locale), formatRemainingTime(item.resetsAt, item.now, locale));
      assert.equal(toolkit.formatLocalizedRemainingTime(item.resetsAt, item.now, locale), formatLocalizedRemainingTime(item.resetsAt, item.now, locale));
    }
  }
});
