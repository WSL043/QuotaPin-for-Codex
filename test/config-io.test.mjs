import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ConfigReadOnlyError,
  CURRENT_CONFIG_VERSION,
  getConfigLoadState,
  loadConfigResult,
  saveConfig,
} from "../src/core/config.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-config-"));
  return { root, configPath: path.join(root, "config.json") };
}

test("a corrupt config is preserved before defaults are returned", (t) => {
  const { root, configPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(configPath, "{ definitely not json", "utf8");

  const result = loadConfigResult(configPath);
  assert.equal(result.status, "recovered-corrupt");
  assert.equal(result.readOnly, false);
  assert.equal(result.config.version, CURRENT_CONFIG_VERSION);
  assert.equal(fs.existsSync(configPath), false);
  assert.equal(fs.readFileSync(result.backupPath, "utf8"), "{ definitely not json");

  saveConfig(configPath, result.config);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).version, CURRENT_CONFIG_VERSION);
});

test("a future config can be inspected but not overwritten", (t) => {
  const { root, configPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify({ version: 99, futureField: { keep: true } }), "utf8");

  const result = loadConfigResult(configPath);
  assert.equal(result.status, "future-version");
  assert.equal(result.readOnly, true);
  assert.equal(getConfigLoadState(configPath).sourceVersion, 99);
  assert.throws(() => saveConfig(configPath, result.config), ConfigReadOnlyError);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")).futureField, { keep: true });
});

test("an older config is migrated atomically while its original remains recoverable", (t) => {
  const { root, configPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = { version: 1, locale: "ja", display: { preset: "percent" } };
  fs.writeFileSync(configPath, JSON.stringify(original), "utf8");

  const result = loadConfigResult(configPath);
  assert.equal(result.status, "migrated");
  assert.equal(result.readOnly, false);
  assert.equal(result.sourceVersion, 1);
  assert.equal(result.config.version, CURRENT_CONFIG_VERSION);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${configPath}.previous`, "utf8")), original);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).version, CURRENT_CONFIG_VERSION);
});

test("a successful save keeps one recoverable previous version", (t) => {
  const { root, configPath } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(configPath, JSON.stringify({ version: CURRENT_CONFIG_VERSION, locale: "ja" }), "utf8");
  loadConfigResult(configPath);

  const saved = saveConfig(configPath, { version: CURRENT_CONFIG_VERSION, locale: "zh-CN" });
  assert.equal(saved.locale, "zh-CN");
  assert.equal(JSON.parse(fs.readFileSync(`${configPath}.previous`, "utf8")).locale, "ja");
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).locale, "zh-CN");
});
