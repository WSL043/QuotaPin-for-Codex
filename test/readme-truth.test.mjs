import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const version = fs.readFileSync(new URL("VERSION", root), "utf8").trim();

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), "utf8");
}

function pngSize(relativePath) {
  const data = fs.readFileSync(new URL(relativePath, root));
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG", `${relativePath} must be a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test("localized READMEs keep one product hero and current interaction truth", () => {
  const variants = [
    ["README.md", "assets/screenshots/product-en.png", "assets/screenshots/states-en.png", "assets/screenshots/examples-en.png", /account menu/i],
    ["README.zh-CN.md", "assets/screenshots/product-zh-CN.png", "assets/screenshots/states-zh-CN.png", "assets/screenshots/examples-zh-CN.png", /账户菜单/],
    ["README.ja.md", "assets/screenshots/product-ja.png", "assets/screenshots/states-ja.png", "assets/screenshots/examples-ja.png", /アカウントメニュー/],
  ];

  for (const [readme, product, states, examples, currentBehavior] of variants) {
    const text = read(readme);
    assert.equal(text.split(product).length - 1, 1, `${readme} must have one product hero`);
    assert.ok(text.indexOf(product) < text.search(/^## /m), `${readme} must show the product before onboarding`);
    assert.ok(text.includes(version), `${readme} must state the current stable version`);
    assert.match(text, /Windows 11/i, `${readme} must expose platform status near the top`);
    assert.match(text, /macOS/i, `${readme} must expose the provisional Mac boundary near the top`);
    assert.match(text, new RegExp(states.replaceAll(".", "\\.")));
    assert.match(text, new RegExp(examples.replaceAll(".", "\\.")));
    assert.match(text, /assets\/screenshots\/drag-layout\.gif/);
    assert.match(text, currentBehavior, `${readme} must state the current native-menu behavior`);
    assert.ok(!/assets\/hero(?:\.|-)/.test(text), `${readme} must not publish the retired concept hero`);
    assert.ok(!text.includes("assets/showcase.png"), `${readme} must not publish the synthetic showcase`);
    assert.ok(!/assets\/screenshots\/(?:codex-|layouts|themes-)/.test(text), `${readme} must not reference retired screenshot sets`);
    assert.ok(!/\b1:1\b/i.test(text), `${readme} must not claim a synthetic image is 1:1`);
  }
});

test("localized documentation assets are deterministic and lightweight", () => {
  for (const locale of ["en", "zh-CN", "ja"]) {
    assert.deepEqual(pngSize(`assets/screenshots/product-${locale}.png`), { width: 1080, height: 560 });
    assert.deepEqual(pngSize(`assets/screenshots/states-${locale}.png`), { width: 1080, height: 330 });
    assert.deepEqual(pngSize(`assets/screenshots/examples-${locale}.png`), { width: 1080, height: 420 });
  }
  assert.ok(fs.statSync(new URL("assets/screenshots/drag-layout.gif", root)).size < 250_000, "drag demo should stay lightweight");
  for (const retired of ["assets/hero.png", "assets/hero.zh-CN.png", "assets/hero.ja.png"]) {
    assert.equal(fs.existsSync(new URL(retired, root)), false, `${retired} should not compete with the product hero`);
  }
  assert.equal(fs.existsSync(new URL("assets/showcase.png", root)), false);

  const renderer = read("tools/showcase/render.mjs");
  assert.ok(renderer.includes('path.join(root, ".audit", "showcase")'));
  assert.ok(!renderer.includes('path.join(root, "assets", "hero.png")'));
  assert.ok(!renderer.includes('path.join(root, "assets", "showcase.png")'));
});
