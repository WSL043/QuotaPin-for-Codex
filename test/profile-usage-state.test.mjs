import test from "node:test";
import assert from "node:assert/strict";
import { createProfileUsageStateToolkit } from "../src/renderer/profile-usage-state.mjs";

const toolkit = createProfileUsageStateToolkit();
const now = new Date(2026, 7, 6, 10, 30, 0).getTime();

test("profile usage normalizes the official daily and lifetime counters", () => {
  const usage = toolkit.normalizeProfileUsage({
    stats: {
      lifetime_tokens: 44_020_000_000,
      daily_usage_buckets: [
        { start_date: "2026-08-05", tokens: 1_000 },
        { start_date: "2026-08-06", tokens: 12_345_678 },
      ],
    },
    metadata: { stats_error: "" },
  }, now);
  assert.deepEqual(usage, {
    status: "ready",
    todayTokens: 12_345_678,
    lifetimeTokens: 44_020_000_000,
    receivedAt: now,
    attemptedAt: now,
  });
});

test("a settled daily series without today's bucket does not invent zero", () => {
  const usage = toolkit.normalizeProfileUsage({
    stats: { lifetime_tokens: 50, daily_usage_buckets: [{ start_date: "2026-08-05", tokens: 50 }] },
  }, now);
  assert.equal(usage.todayTokens, null);
  assert.equal(usage.lifetimeTokens, 50);
  assert.equal(usage.status, "ready");
});

test("missing or unsafe counters fail closed without inventing zero", () => {
  assert.equal(toolkit.normalizeProfileUsage({}, now).status, "unavailable");
  const invalid = toolkit.normalizeProfileUsage({
    stats: { lifetime_tokens: -1, daily_usage_buckets: null },
  }, now);
  assert.equal(invalid.status, "unavailable");
  assert.equal(invalid.todayTokens, null);
  assert.equal(invalid.lifetimeTokens, null);
});

test("partial official statistics stay usable and carry a degraded state", () => {
  const usage = toolkit.normalizeProfileUsage({
    stats: { lifetime_tokens: 1_234, daily_usage_buckets: [] },
    metadata: { stats_error: "one aggregate was delayed" },
  }, now);
  assert.equal(usage.status, "partial");
  assert.equal(usage.todayTokens, null);
  assert.equal(usage.lifetimeTokens, 1_234);
});

test("token modules use concise locale-aware labels and explicit unavailable marks", () => {
  const usage = { todayTokens: 12_345_678, lifetimeTokens: 44_020_000_000 };
  const english = toolkit.formatProfileUsageParts(usage, "en");
  assert.match(english.todayTokens, /^Today /);
  assert.match(english.lifetimeTokens, /^Total /);
  const chinese = toolkit.formatProfileUsageParts(usage, "zh-CN");
  assert.match(chinese.todayTokens, /^今日 /);
  assert.match(chinese.lifetimeTokens, /^累计 /);
  assert.equal(chinese.todayTokensTitle, "今日 12,345,678");
  assert.equal(chinese.lifetimeTokensTitle, "累计 44,020,000,000");
  assert.equal(chinese.tooltip, "今日 12,345,678 · 累计 44,020,000,000");
  const japanese = toolkit.formatProfileUsageParts(usage, "ja");
  assert.match(japanese.todayTokens, /^今日 /);
  assert.match(japanese.lifetimeTokens, /^累計 /);
  assert.equal(toolkit.formatProfileUsageParts({}, "en").todayTokens, "Today —");
  assert.equal(toolkit.formatProfileUsageParts({ todayTokens: null, lifetimeTokens: null }, "en").todayTokens, "Today —");
  const local = toolkit.formatProfileUsageParts({ todayTokens: 1234, todaySource: "device", todayEstimated: true }, "en");
  assert.equal(local.todayTokens, "Today 1.2K");
  assert.match(local.todayTokensTitle, /This device today/);
  assert.equal(local.todayTokensTitle, "This device today ≥1,234");
  assert.equal(
    toolkit.formatProfileUsageParts({ todayTokens: 1234, todaySource: "device", todayEstimated: true }, "zh-CN").todayTokensTitle,
    "本机今日 ≥1,234",
  );
  assert.equal(toolkit.formatProfileUsageParts({}, "en").tooltip, "");
});

test("profile usage refreshes slowly after success and retries sooner after failure", () => {
  const ready = { status: "ready", receivedAt: now, attemptedAt: now };
  assert.equal(toolkit.nextRefreshDelay(ready, now), toolkit.refreshMs);
  assert.equal(toolkit.shouldRefreshProfileUsage(ready, now + toolkit.refreshMs - 1), false);
  assert.equal(toolkit.shouldRefreshProfileUsage(ready, now + toolkit.refreshMs), true);
  const unavailable = { status: "unavailable", receivedAt: 0, attemptedAt: now };
  assert.equal(toolkit.nextRefreshDelay(unavailable, now), toolkit.retryMs);
  assert.equal(toolkit.shouldRefreshProfileUsage(unavailable, now + toolkit.retryMs), true);
});
