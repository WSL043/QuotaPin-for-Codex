import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createAttachReadinessWriter } from "../src/agent/attach-readiness.mjs";
import { createLifecycleStateWriter, readJsonFile } from "../src/agent/lifecycle-state.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policyPath = path.join(root, "src", "auto-attach-policy.ps1").replaceAll("'", "''");

function runPolicy(expression) {
  const command = `. '${policyPath}'; ${expression} | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("one user launch can authorize only one destructive handoff", () => {
  assert.equal(runPolicy("Get-QuotaPinAutoAttachDecision -GuardState none -RootIds @(100) -CandidateFresh $true"), "launch-once");
  const decisions = runPolicy("@(1..100 | ForEach-Object { Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @(200) -ProtectedPid 200 })");
  assert.equal(decisions.length, 100);
  assert.ok(decisions.every((decision) => decision === "adopt"));
});

test("a successor mismatch or failed handoff fails closed", () => {
  assert.equal(
    runPolicy("Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @(300) -ProtectedPid 200"),
    "latch",
  );
  assert.equal(
    runPolicy("Get-QuotaPinAutoAttachDecision -GuardState degraded-latched -RootIds @(300)"),
    "stop",
  );
  assert.equal(
    runPolicy("Get-QuotaPinAutoAttachDecision -GuardState none -RootIds @(100,101) -CandidateFresh $true"),
    "ignore-ambiguous",
  );
});

test("successor generation is rearmed only after a sustained fully closed interval", () => {
  assert.equal(
    runPolicy("Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @() -ProtectedPid 200 -IdleSeconds 29"),
    "wait-idle",
  );
  assert.equal(
    runPolicy("Get-QuotaPinAutoAttachDecision -GuardState successor-observed -RootIds @() -ProtectedPid 200 -IdleSeconds 30"),
    "rearm",
  );
});

test("renderer readiness is generation-bound and atomically persisted", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-ready-"));
  try {
    const configPath = path.join(directory, "config.json");
    const writer = createAttachReadinessWriter({ configPath, generation: "a".repeat(32), port: 43123, pid: 777 });
    assert.equal(writer.markRendererAttached(), true);
    assert.equal(writer.markRendererAttached(), false);
    const ready = JSON.parse(fs.readFileSync(path.join(directory, "logs", `attach-ready.${"a".repeat(32)}.json`), "utf8"));
    assert.deepEqual(
      { state: ready.state, generation: ready.generation, agentPid: ready.agentPid, port: ready.port },
      { state: "renderer-attached", generation: "a".repeat(32), agentPid: 777, port: 43123 },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Node lifecycle reader accepts Windows PowerShell UTF-8 BOM state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-bom-"));
  try {
    const statePath = path.join(directory, "runtime.json");
    fs.writeFileSync(statePath, `\uFEFF${JSON.stringify({ codexPid: 42, generation: "b".repeat(32) })}`, "utf8");
    assert.deepEqual(readJsonFile(statePath), { codexPid: 42, generation: "b".repeat(32) });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an old Agent generation cannot overwrite newer lifecycle ownership", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-generation-"));
  try {
    const configPath = path.join(directory, "config.json");
    const logs = path.join(directory, "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "lifecycle.json"), JSON.stringify({
      schema: 1,
      state: "attached",
      generation: "b".repeat(32),
      writtenAt: "2026-08-04T12:01:00.000Z",
    }));
    const oldWriter = createLifecycleStateWriter({
      configPath,
      generation: "a".repeat(32),
      startedAt: "2026-08-04T12:00:00.000Z",
      port: 43123,
      pid: 100,
    });
    oldWriter("degraded", "late exit");
    assert.equal(readJsonFile(path.join(logs, "lifecycle.json")).generation, "b".repeat(32));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("watcher and launcher source enforce the single-flight transaction", () => {
  const watcher = fs.readFileSync(path.join(root, "src", "auto-attach.ps1"), "utf8");
  const launcher = fs.readFileSync(path.join(root, "src", "launch.ps1"), "utf8");
  assert.match(watcher, /budget=1\/1/);
  assert.match(watcher, /degraded-latched/);
  assert.doesNotMatch(watcher, /RetryAfter|Dictionary\[int,int\]|attach retry scheduled/);
  assert.ok(launcher.indexOf("Test-QuotaPinAttachAuthorization $Package.InstallLocation") < launcher.indexOf("$Running = @(Find-CodexProcesses"));
  assert.ok(launcher.indexOf("Test-QuotaPinRendererReady") < launcher.indexOf("Write-QuotaPinJsonAtomic -Path $RuntimeStatePath"));
  assert.match(launcher, /Local\\QuotaPinCodexRelaunch/);
});
