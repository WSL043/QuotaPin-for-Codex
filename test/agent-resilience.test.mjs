import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = [
  "../src/injector.mjs",
  "../src/agent/app-server-runtime.mjs",
  "../src/agent/cdp-runtime.mjs",
  "../src/agent/lifecycle-state.mjs",
].map((relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8")).join("\n");

test("settings and CDP operations have bounded acknowledgements", () => {
  assert.match(source, /host_timeout/);
  assert.match(source, /CDP \$\{method\} timed out/);
  assert.match(source, /CDP socket open timed out/);
  assert.match(source, /clearTimeout\(pending\.timer\)/);
});

test("the usage service reports readiness and has bounded restart recovery", () => {
  assert.match(source, /this\.restartAttempt >= 5/);
  assert.match(source, /this\.writeLifecycleState\("quota-ready"\)/);
  assert.match(source, /this\.writeLifecycleState\("degraded"/);
  assert.match(source, /broadcastClientState\(null, "quota"\)/);
});

test("disabled optional runtime performs no DOM classification", () => {
  assert.match(source, /enabled: view\?\.overdriveEgg === true/);
  assert.match(source, /const monitoring = effectMonitoringEnabled\(view\)/);
  assert.match(source, /if \(!monitoring\)/);
  assert.match(source, /transition\.command === "classify"\) \{/);
  assert.equal((source.match(/detectOverdrive\(/g) ?? []).length, 2);
  assert.doesNotMatch(source, /querySelectorAll\('\[aria-label\],\[title\],\[data-state\],\[aria-pressed\]'/);
});

test("optional DOM classification uses targeted invalidation and a bounded watchdog", () => {
  assert.match(source, /data-codex-intelligence-trigger="true"/);
  assert.match(source, /const effectWatchdogMs = 12000/);
  assert.match(source, /effectSignalObserver\.observe\(effectSignalRoot/);
  assert.match(source, /if \(!effectMonitoringEnabled\(\)\) return;/);
  assert.match(source, /setInterval\(\(\) => \{[\s\S]*?\}, effectWatchdogMs\)/);
});
