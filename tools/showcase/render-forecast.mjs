import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShowcaseServer } from "./serve.mjs";
import { openCaptureBrowser } from "./cdp-capture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Keep audit captures out of the curated README assets. The English README
// uses a hand-picked, user-approved account-row capture; rerunning this check
// must never replace it.
const outputRoot = path.join(root, ".audit", "forecast");
fs.mkdirSync(outputRoot, { recursive: true });
const server = createShowcaseServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const captureBrowser = await openCaptureBrowser({ profilePrefix: "quotapin-forecast-" });

function pngSize(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 24 || data.subarray(1, 4).toString("ascii") !== "PNG") throw new Error(`Invalid PNG: ${filePath}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function capture(locale, suffix) {
  const output = path.join(outputRoot, `forecast-${suffix}.png`);
  await captureBrowser.navigate(`http://127.0.0.1:${port}/forecast.html?locale=${encodeURIComponent(locale)}`, 1080, 330);
  const evidence = JSON.parse(await captureBrowser.evaluate(`JSON.stringify([...document.querySelectorAll("iframe")].map((frame) => {
    const badge = frame.contentDocument?.getElementById("quotapin-inline-badge");
    const visible = badge ? [...badge.querySelectorAll("[data-quotapin-module]")]
      .filter((node) => frame.contentWindow.getComputedStyle(node).display !== "none")
      .map((node) => node.dataset.quotapinModule) : [];
    return { badge: Boolean(badge), visible };
  }))`));
  if (evidence.length !== 3 || evidence.some((item) => !item.badge || !item.visible.includes("pace") || !item.visible.includes("runway"))) {
    throw new Error(`Forecast preview did not materialize the production pace/runway modules: ${JSON.stringify(evidence)}`);
  }
  await captureBrowser.screenshot(output);
  const actual = pngSize(output);
  if (actual.width !== 1080 || actual.height !== 330) {
    throw new Error(`Unexpected screenshot size ${actual.width}x${actual.height}; expected 1080x330`);
  }
  return { output, width: actual.width, height: actual.height, evidence };
}

try {
  const outputs = [
    await capture("en", "en"),
    await capture("zh-CN", "zh-CN"),
    await capture("ja", "ja"),
  ];
  console.log(JSON.stringify({ ok: true, browser: captureBrowser.browser, outputs }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await captureBrowser.close();
}
