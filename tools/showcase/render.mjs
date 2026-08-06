import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createShowcaseServer } from "./serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const candidates = [
  process.env.QUOTAPIN_BROWSER,
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
].filter(Boolean);
const browser = candidates.find((candidate) => fs.existsSync(candidate));
if (!browser) throw new Error("A Chromium browser is required to render the showcase assets.");

const server = createShowcaseServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-showcase-"));

function pngSize(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 24 || data.subarray(1, 4).toString("ascii") !== "PNG") throw new Error(`Invalid PNG: ${filePath}`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function capture(route, width, height, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const captureProfile = path.join(profileRoot, `capture-${path.basename(output, path.extname(output))}`);
  await new Promise((resolve, reject) => {
    const child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
      "--force-device-scale-factor=1", `--window-size=${width},${height}`, "--virtual-time-budget=1800",
      `--user-data-dir=${captureProfile}`, `--screenshot=${output}`, `http://127.0.0.1:${port}${route}`,
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Browser capture failed (${code}): ${errorText.slice(-800)}`)));
  });
  const actual = pngSize(output);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`Unexpected screenshot size ${actual.width}x${actual.height}; expected ${width}x${height}`);
  }
}

async function dumpRenderedCase(scenario) {
  const verificationProfile = path.join(profileRoot, `verify-${scenario}`);
  return await new Promise((resolve, reject) => {
    const child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
      "--force-device-scale-factor=1", `--window-size=286,46`, "--virtual-time-budget=1800",
      `--user-data-dir=${verificationProfile}`, "--dump-dom", `http://127.0.0.1:${port}/verify.html?case=${scenario}`,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorText = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { errorText += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(output)
      : reject(new Error(`Browser DOM verification failed (${code}): ${errorText.slice(-800)}`)));
  });
}

async function verifyProductionRenderer() {
  const expectations = [
    ["default", /data-visible="value:42%"/],
    ["date", /data-visible="value:42%\|date:Aug 9"/],
    ["dot", /data-visible="dot:"[^>]*data-aria="Codex remaining quota: normal"/],
    ["critical", /data-visible="value:1%\|seconds:00:04:59"/],
  ];
  for (const [scenario, expectation] of expectations) {
    const dom = await dumpRenderedCase(scenario);
    if (!dom.includes('data-badge="true"') || !expectation.test(dom)) {
      throw new Error(`Production renderer did not materialize the ${scenario} showcase case: ${dom.slice(-1200)}`);
    }
  }
}

try {
  const fixtureRoot = path.join(root, ".audit", "showcase");
  const hero = path.join(fixtureRoot, "synthetic-shell-fixture.png");
  const showcase = path.join(fixtureRoot, "module-layout-fixture.png");
  const previewLab = path.join(fixtureRoot, "preview-lab.png");
  await verifyProductionRenderer();
  await capture("/hero.html", 1281, 848, hero);
  await capture("/showcase.html", 780, 420, showcase);
  await capture("/preview.html", 1280, 760, previewLab);
  console.log(JSON.stringify({ ok: true, browser, hero, showcase, previewLab }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(profileRoot);
  const prefix = path.resolve(os.tmpdir(), "quotapin-showcase-");
  if (resolved.startsWith(prefix)) fs.rmSync(resolved, { recursive: true, force: true });
}
