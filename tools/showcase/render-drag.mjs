import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createShowcaseServer } from "./serve.mjs";
import { openCaptureBrowser } from "./cdp-capture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const frameRoot = path.join(root, ".audit", "showcase", "drag-frames");
const output = path.join(root, "assets", "screenshots", "drag-layout.gif");
function pythonCommand() {
  if (process.env.QUOTAPIN_PYTHON) return { command: process.env.QUOTAPIN_PYTHON, args: [] };
  if (process.platform === "win32") {
    const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
    if (fs.existsSync(bundled)) return { command: bundled, args: [] };
  }
  return { command: process.platform === "win32" ? "py.exe" : "python3", args: process.platform === "win32" ? ["-3"] : [] };
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createShowcaseServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await openCaptureBrowser({ profilePrefix: "quotapin-drag-" });

function frameName(index) {
  return path.join(frameRoot, `frame-${String(index).padStart(3, "0")}.png`);
}

async function waitForEditing() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const ready = await browser.evaluate(`Boolean(
      document.getElementById("quotapin-profile-editor")?.dataset.rowEditing === "true"
      && document.querySelector('[data-quotapin-module="value"]')?.getBoundingClientRect().width
    )`);
    if (ready) return;
    await delay(80);
  }
  throw new Error("The production panel did not enter row-editing mode");
}

async function installCursor() {
  await browser.evaluate(`(() => {
    const cursor=document.createElement("div");
    cursor.id="quotapin-demo-cursor";
    Object.assign(cursor.style,{position:"fixed",left:"0",top:"0",width:"16px",height:"20px",border:"0",borderRadius:"0",background:"#b8ffe0",clipPath:"polygon(0 0,0 100%,4px 74%,8px 96%,11px 94%,7px 72%,16px 72%)",filter:"drop-shadow(0 1px 1px rgba(0,0,0,.72))",zIndex:"2147483647",pointerEvents:"none",transform:"translate(-2px,-2px)"});
    document.body.appendChild(cursor);
    return true;
  })()`);
}

async function moduleCenter(module) {
  return await browser.evaluate(`(() => { const rect=document.querySelector('[data-quotapin-module="${module}"]').getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()`);
}

async function pointer(type, x, y) {
  await browser.evaluate(`(() => {
    const node=document.querySelector('[data-quotapin-module="value"]');
    const cursor=document.getElementById("quotapin-demo-cursor");
    cursor.style.left=${JSON.stringify(x)}+"px";cursor.style.top=${JSON.stringify(y)}+"px";
    node.dispatchEvent(new PointerEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,button:0,buttons:${type === "pointerup" ? 0 : 1},pointerId:71,pointerType:"mouse",isPrimary:true,clientX:${JSON.stringify(x)},clientY:${JSON.stringify(y)}}));
    return {editing:document.getElementById("quotapin-profile-editor")?.dataset.rowEditing,order:[...document.querySelectorAll('[data-quotapin-module]')].filter(node=>getComputedStyle(node).display!=="none").sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left).map(node=>node.dataset.quotapinModule)};
  })()`);
}

async function captureFrame(index) {
  await browser.screenshot(frameName(index), { x: 0, y: 0, width: 405, height: 600 });
}

async function hold(index, frames) {
  for (let offset = 0; offset < frames; offset += 1) {
    await captureFrame(index + offset);
    await delay(55);
  }
  return index + frames;
}

async function drag(index, destinationX, steps = 15) {
  const start = await moduleCenter("value");
  await pointer("pointerdown", start.x, start.y);
  for (let step = 0; step <= steps; step += 1) {
    const eased = 1 - Math.pow(1 - step / steps, 3);
    const x = start.x + (destinationX - start.x) * eased;
    await pointer("pointermove", x, start.y);
    await delay(36);
    await captureFrame(index++);
  }
  await pointer("pointerup", destinationX, start.y);
  await delay(180);
  return index;
}

try {
  fs.rmSync(frameRoot, { recursive: true, force: true });
  fs.mkdirSync(frameRoot, { recursive: true });
  await browser.navigate(`http://127.0.0.1:${port}/panel.html?locale=en&theme=dark`, 440, 600, 1400);
  await waitForEditing();
  await installCursor();
  const initial = await moduleCenter("value");
  await pointer("pointermove", initial.x, initial.y);
  let index = await hold(0, 6);
  index = await drag(index, 30);
  index = await hold(index, 6);
  index = await drag(index, 212);
  index = await hold(index, 5);
  // End on the fixed center gravity point. This makes the demo cover all
  // three useful outcomes without adding another panel or a long tutorial.
  index = await drag(index, 124, 13);
  await hold(index, 7);

  const python = pythonCommand();
  const result = spawnSync(python.command, [...python.args, path.join(root, "tools", "showcase", "assemble-gif.py"), frameRoot, output, "65"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`GIF assembly failed with ${python.command}: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  const bytes = fs.statSync(output).size;
  console.log(JSON.stringify({ ok: true, output, bytes, frames: fs.readdirSync(frameRoot).length }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await browser.close();
}
