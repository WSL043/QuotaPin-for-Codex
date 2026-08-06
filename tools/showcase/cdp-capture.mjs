import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function findChromium() {
  const candidates = [
    process.env.QUOTAPIN_BROWSER,
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(filePath, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await delay(50);
  }
  throw new Error(`Chromium did not publish ${path.basename(filePath)} within ${timeoutMs}ms`);
}

class CdpSession {
  constructor(socketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(socketUrl);
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result ?? {});
    });
  }

  async send(method, params = {}, timeoutMs = 8_000) {
    await this.opened;
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

export async function openCaptureBrowser(options = {}) {
  const browser = options.browser ?? findChromium();
  if (!browser) throw new Error("A Chromium browser is required to render documentation assets.");
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), options.profilePrefix ?? "quotapin-cdp-"));
  const child = spawn(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-extensions",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profileRoot}`,
    "--window-size=1000,800", "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let errorText = "";
  child.stderr.on("data", (chunk) => { errorText += String(chunk); });
  const activePortPath = path.join(profileRoot, "DevToolsActivePort");
  try {
    await waitForFile(activePortPath);
    const [portLine] = fs.readFileSync(activePortPath, "utf8").split(/\r?\n/);
    const port = Number(portLine);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Chromium published an invalid DevTools port");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!target) throw new Error("Chromium did not publish a page target");
    const debuggerUrl = new URL(target.webSocketDebuggerUrl);
    if (debuggerUrl.protocol !== "ws:" || debuggerUrl.hostname !== "127.0.0.1" || Number(debuggerUrl.port) !== port) {
      throw new Error("Chromium returned a non-loopback debugger target");
    }
    const session = new CdpSession(debuggerUrl.href);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    return {
      browser,
      profileRoot,
      child,
      session,
      async navigate(url, width, height, settleMs = 1200) {
        await session.send("Emulation.setDeviceMetricsOverride", {
          width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height,
        });
        await session.send("Page.navigate", { url });
        await delay(settleMs);
      },
      async evaluate(expression) {
        const result = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
        return result.result?.value;
      },
      async screenshot(output, clip = null) {
        const result = await session.send("Page.captureScreenshot", {
          format: "png", fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
        });
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, Buffer.from(result.data, "base64"));
      },
      async close() {
        session.close();
        const exited = child.exitCode !== null
          ? Promise.resolve()
          : new Promise((resolve) => child.once("exit", resolve));
        try { child.kill(); } catch {}
        await Promise.race([exited, delay(2_000)]);
        const resolved = path.resolve(profileRoot);
        const temporary = path.resolve(os.tmpdir());
        if (resolved.startsWith(temporary + path.sep)) {
          fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
        }
      },
      errorText: () => errorText,
    };
  } catch (error) {
    try { child.kill(); } catch {}
    fs.rmSync(profileRoot, { recursive: true, force: true });
    throw new Error(`${error.message}${errorText ? `: ${errorText.slice(-600)}` : ""}`);
  }
}
