import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { assertVerificationPermissions, verificationPermissions } from "../scripts/verify-safety.mjs";

const readScript = (name) => fs.readFileSync(new URL(`../scripts/${name}`, import.meta.url), "utf8");

test("verification permissions are explicit and independent", () => {
  assert.deepEqual(verificationPermissions([]), { allowLiveInput: false, allowSensitiveCapture: false });
  assert.deepEqual(verificationPermissions(["--allow-live-input"]), { allowLiveInput: true, allowSensitiveCapture: false });
  assert.deepEqual(verificationPermissions(["--allow-sensitive-capture"]), { allowLiveInput: false, allowSensitiveCapture: true });
});

test("live mutation and sensitive capture fail closed", () => {
  assert.throws(
    () => assertVerificationPermissions({ argv: [], liveModes: ["--cleanup"] }),
    /--allow-live-input/,
  );
  assert.throws(
    () => assertVerificationPermissions({ argv: [], sensitiveCapture: true }),
    /--allow-sensitive-capture/,
  );
  assert.throws(
    () => assertVerificationPermissions({ argv: ["--allow-live-input"], liveModes: ["--open-editor"], sensitiveCapture: true }),
    /--allow-sensitive-capture/,
  );
  assert.doesNotThrow(() => assertVerificationPermissions({
    argv: ["--allow-live-input", "--allow-sensitive-capture"],
    liveModes: ["--open-editor"],
    sensitiveCapture: true,
  }));
});

test("every mutating verifier checks permission before opening CDP", () => {
  for (const name of ["verify-cdp.mjs", "verify-gestures.mjs", "verify-layout.mjs", "verify-panel.mjs"]) {
    const source = readScript(name);
    const preflight = source.indexOf("assertVerificationPermissions({");
    const transport = source.indexOf("fetch(");
    assert.ok(preflight >= 0, `${name} is missing a permission preflight`);
    assert.ok(transport >= 0, `${name} is missing its CDP transport`);
    assert.ok(preflight < transport, `${name} opens CDP before its permission preflight`);
  }
});

test("the general verifier classifies all live and capture modes", () => {
  const source = readScript("verify-cdp.mjs");
  for (const flag of ["--cleanup", "--exercise-render", "--bring-to-front", "--verify-interactions", "--open-editor"]) {
    assert.match(source, new RegExp(`${flag.replaceAll("-", "\\-")}\"`));
  }
  assert.match(source, /sensitiveCapture:\s*screenshotRequested \|\| inspectComposer/);
  assert.ok(source.indexOf("assertVerificationPermissions({") < source.indexOf("Page.bringToFront"));
  assert.ok(source.indexOf("assertVerificationPermissions({") < source.indexOf("Page.captureScreenshot"));
});

test("the account crop tool is capture-gated and cannot drive live input", () => {
  const source = readScript("capture-account-ui.mjs");
  const preflight = source.indexOf("assertVerificationPermissions({");
  assert.match(source, /sensitiveCapture:\s*true/);
  assert.ok(preflight >= 0 && preflight < source.indexOf("fetch("), "capture tool opens CDP before permission preflight");
  assert.ok(preflight < source.indexOf("Page.captureScreenshot"), "capture tool captures before permission preflight");
  assert.doesNotMatch(source, /Input\.|Page\.bringToFront/);
});

test("panel verification snapshots and restores its complete configuration", () => {
  const source = readScript("verify-panel.mjs");
  const snapshot = source.indexOf("const configSnapshotJson");
  const mutation = source.indexOf('openEditor?.()');
  const finallyBlock = source.indexOf("} finally {");
  const restore = source.indexOf('type: "replaceConfig"');
  assert.ok(snapshot >= 0 && snapshot < mutation, "configuration must be captured before the panel opens");
  assert.ok(finallyBlock >= 0 && restore > finallyBlock, "configuration restore must run from finally");
  assert.match(source, /configuration did not return to its pre-verification snapshot/);
});

test("live verifier fixtures keep the sealed input path out of readable arrays", () => {
  const source = readScript("verify-overdrive.mjs");
  const forbidden = [
    "WyJBcnJvd1VwIiwiQXJyb3dVcCIsIkFycm93RG93biIsIkFycm93RG93biIsIkFycm93TGVmdCIsIkFycm93UmlnaHQiXQ==",
    "WyJ3IiwiVyIsInMiLCJTIiwiYSIsImQiXQ==",
  ].map((encoded) => Buffer.from(encoded, "base64").toString("utf8"));
  for (const readablePath of forbidden) assert.equal(source.includes(readablePath), false);
});
