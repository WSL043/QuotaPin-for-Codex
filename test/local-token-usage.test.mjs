import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalTokenUsageRuntime, aggregateTokenEvents, scanLocalTodayUsage, tokenEventFromLine } from "../src/agent/local-token-usage.mjs";

const now = new Date(2026, 7, 6, 12, 0, 0).getTime();
const stamp = (hour, minute = 0) => new Date(2026, 7, 6, hour, minute, 0).toISOString();
const tokenLine = (timestamp, last, total) => JSON.stringify({
  timestamp,
  type: "event_msg",
  payload: { type: "token_count", info: { last_token_usage: last, total_token_usage: total } },
});

test("token log parsing follows Codex input/output/reasoning accounting without double-counting cache", () => {
  const event = tokenEventFromLine(tokenLine(stamp(9), {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 10,
    reasoning_output_tokens: 5,
  }, {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 10,
    reasoning_output_tokens: 5,
  }), "session");
  const result = aggregateTokenEvents([event]);
  assert.equal(result.addedTokens, 115);
});

test("cumulative snapshots deduplicate fork replays and ignore small stale regressions", () => {
  const event = (timestamp, input, lastInput) => ({
    timestamp,
    scopeId: "parent",
    total: { input, output: 0, cached: 0, reasoning: 0 },
    last: { input: lastInput, output: 0, cached: 0, reasoning: 0 },
  });
  const result = aggregateTokenEvents([
    event(1, 100, 100),
    event(2, 120, 20),
    event(3, 120, 20),
    event(4, 119, 1),
    event(5, 140, 20),
  ]);
  assert.equal(result.addedTokens, 140);
  assert.equal(result.acceptedEvents, 3);
});

test("local daily scan excludes inherited fork history before the child's own turn", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-token-test-"));
  try {
    const sessions = path.join(root, "sessions", "2026", "08", "06");
    fs.mkdirSync(sessions, { recursive: true });
    const parent = path.join(sessions, "parent.jsonl");
    const child = path.join(sessions, "child.jsonl");
    const parentId = "019fbca0-8f49-76e0-921f-19e89c7aefef";
    const childId = "019fd511-f87e-73f3-a98a-95b0b018fcff";
    const usage = (input) => ({ input_tokens: input, output_tokens: 0, reasoning_output_tokens: 0 });
    fs.writeFileSync(parent, [
      JSON.stringify({ timestamp: stamp(8), type: "session_meta", payload: { id: parentId } }),
      tokenLine(stamp(9), usage(100), usage(100)),
      tokenLine(stamp(10), usage(20), usage(120)),
    ].join("\n") + "\n");
    fs.writeFileSync(child, [
      JSON.stringify({ timestamp: stamp(10, 30), type: "session_meta", payload: { id: childId, forked_from_id: parentId } }),
      tokenLine(stamp(10, 30), usage(100), usage(100)),
      tokenLine(stamp(10, 30), usage(20), usage(120)),
      JSON.stringify({ timestamp: stamp(10, 31), type: "turn_context", payload: { turn_id: "child-turn" } }),
      tokenLine(stamp(11), usage(30), usage(150)),
    ].join("\n") + "\n");
    fs.utimesSync(parent, new Date(now), new Date(now));
    fs.utimesSync(child, new Date(now), new Date(now));
    const result = scanLocalTodayUsage({ codexHome: root, now });
    assert.equal(result.status, "ready");
    assert.equal(result.todayTokens, 150);
    assert.equal(result.acceptedEvents, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime refresh reads only appended token events and does not recount its overlap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-token-runtime-"));
  try {
    const sessions = path.join(root, "sessions", "2026", "08", "06");
    fs.mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "session.jsonl");
    const id = "019fbca0-8f49-76e0-921f-19e89c7aefef";
    const usage = (input) => ({ input_tokens: input, output_tokens: 0, reasoning_output_tokens: 0 });
    fs.writeFileSync(file, [
      JSON.stringify({ timestamp: stamp(8), type: "session_meta", payload: { id } }),
      tokenLine(stamp(9), usage(100), usage(100)),
      tokenLine(stamp(10), usage(20), usage(120)),
    ].join("\n") + "\n");
    fs.utimesSync(file, new Date(now), new Date(now));
    let resolveChange;
    const changes = [];
    const runtime = new LocalTokenUsageRuntime({
      codexHome: root,
      now: () => now,
      onChange: (state) => {
        changes.push(state);
        const resolve = resolveChange;
        resolveChange = null;
        resolve?.(state);
      },
    });
    const refresh = () => new Promise((resolve) => {
      resolveChange = resolve;
      runtime.refresh();
    });
    assert.equal((await refresh()).todayTokens, 120);
    runtime.refresh();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(changes.length, 1, "an unchanged ten-second scan rebroadcast the full client state");
    fs.appendFileSync(file, tokenLine(stamp(11), usage(30), usage(150)) + "\n");
    fs.utimesSync(file, new Date(now), new Date(now));
    const updated = await refresh();
    assert.equal(updated.todayTokens, 150);
    assert.equal(updated.acceptedEvents, 3);
    assert.equal(changes.length, 2);
    runtime.stop();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
