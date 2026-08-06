import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShowcaseServer } from "./serve.mjs";
import { openCaptureBrowser } from "./cdp-capture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const server = createShowcaseServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const outputRoot = path.join(root, "assets", "screenshots");
const captureBrowser = await openCaptureBrowser({ profilePrefix: "quotapin-docs-" });

function pngSize(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 24 || data.subarray(1, 4).toString("ascii") !== "PNG") throw new Error(`Invalid PNG: ${filePath}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function capture(route, width, height, outputName) {
  const output = path.join(outputRoot, outputName);
  await captureBrowser.navigate(`http://127.0.0.1:${port}${route}`, width, height);
  await captureBrowser.screenshot(output);
  const actual = pngSize(output);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`Unexpected screenshot size ${actual.width}x${actual.height}; expected ${width}x${height}`);
  }
  return { output, width, height };
}

const localeSuffixes = [
  ["en", "en"],
  ["zh-CN", "zh-CN"],
  ["ja", "ja"],
];

try {
  const results = [];
  for (const [locale, suffix] of localeSuffixes) {
    results.push(await capture(`/docs-focus.html?locale=${encodeURIComponent(locale)}&appearance=dark&remaining=1&modules=value`, 1080, 560, `product-${suffix}.png`));
    results.push(await capture(`/states.html?locale=${encodeURIComponent(locale)}`, 1080, 330, `states-${suffix}.png`));
    results.push(await capture(`/examples.html?locale=${encodeURIComponent(locale)}`, 1080, 420, `examples-${suffix}.png`));
  }
  console.log(JSON.stringify({ ok: true, browser: captureBrowser.browser, outputs: results }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await captureBrowser.close();
}
