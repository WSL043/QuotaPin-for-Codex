import test from "node:test";
import assert from "node:assert/strict";
import { createCodeConfigStateToolkit } from "../src/renderer/code-config-state.mjs";

test("Code JSON reports syntax location and formats valid drafts", () => {
  const toolkit = createCodeConfigStateToolkit();
  const invalid = toolkit.parseJsonDraft('{\n  "version": 11,\n  "profiles": [\n}');
  assert.equal(invalid.ok, false);
  assert.ok(Number(invalid.error.line) >= 3);
  assert.ok(Number(invalid.error.column) >= 1);

  const formatted = toolkit.formatJsonDraft('{"version":11,"profiles":[]}');
  assert.equal(formatted.ok, true);
  assert.equal(formatted.text, '{\n  "version": 11,\n  "profiles": []\n}');
});

test("Code JSON canonicalization reports stable configuration paths", () => {
  const toolkit = createCodeConfigStateToolkit();
  assert.deepEqual(
    toolkit.diffJsonPaths(
      { version: 11, profiles: [{ id: "glance", snapThreshold: 99 }], extra: true },
      { version: 11, profiles: [{ id: "glance", snapThreshold: 48 }] },
    ),
    ["$.extra", "$.profiles[0].snapThreshold"],
  );
  assert.deepEqual(toolkit.diffJsonPaths({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
});
