import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("the bootstrap shows progress and resumes an interrupted package download", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows curl bootstrap contract");
    return;
  }

  const payload = crypto.randomBytes(2 * 1024 * 1024);
  const firstChunkBytes = 512 * 1024;
  let requestCount = 0;
  let rangeRequestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    const range = request.headers.range;
    if (!range && requestCount === 1) {
      response.writeHead(200, { "Content-Length": payload.length, "Content-Type": "application/octet-stream" });
      response.write(payload.subarray(0, firstChunkBytes), () => {
        setTimeout(() => response.socket?.destroy(), 75);
      });
      return;
    }

    const start = range ? Number.parseInt(range.match(/^bytes=(\d+)-$/)?.[1] ?? "0", 10) : 0;
    if (range) rangeRequestCount += 1;
    const body = payload.subarray(start);
    response.writeHead(range ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Length": body.length,
      "Content-Range": `bytes ${start}-${payload.length - 1}/${payload.length}`,
      "Content-Type": "application/octet-stream",
    });
    response.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-bootstrap-download-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "QuotaPin-fixture.exe");
  const scriptPath = path.join(directory, "download.ps1");
  const bootstrap = fs.readFileSync(new URL("install.ps1", root), "utf8");
  const functionStart = bootstrap.indexOf("function Receive-QuotaPinBootstrapFile(");
  const functionEnd = bootstrap.indexOf("\n$LocalInstaller = $null", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, "download function must be extractable");
  const port = server.address().port;
  const functionSource = bootstrap.slice(functionStart, functionEnd);
  fs.writeFileSync(
    scriptPath,
    [
      "$ErrorActionPreference = 'Stop'",
      functionSource,
      `Receive-QuotaPinBootstrapFile 'http://127.0.0.1:${port}/QuotaPin-fixture.exe' ${quotePowerShell(destination)} 4MB 30 'QuotaPin fixture' ${payload.length}`,
    ].join("\r\n"),
    "utf8",
  );

  const result = await runPowerShell(scriptPath);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(requestCount, 2);
  assert.equal(rangeRequestCount, 1);
  assert.deepEqual(fs.readFileSync(destination), payload);
  assert.match(result.stdout, /attempt 1 of 6/);
  assert.match(result.stdout, /attempt 2 of 6/);
  assert.match(result.stdout, /Verifying SHA-256/);
  assert.match(result.stderr, /#+/);
});
