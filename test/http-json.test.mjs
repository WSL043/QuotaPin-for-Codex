import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedJsonResponse } from "../src/core/http-json.mjs";

test("bounded JSON accepts a small UTF-8 response", async () => {
  const response = new Response(JSON.stringify([{ ok: true }]));
  assert.deepEqual(await readBoundedJsonResponse(response, { maximumBytes: 128 }), [{ ok: true }]);
});

test("bounded JSON rejects an oversized declared response before reading", async () => {
  const response = new Response("{}", { headers: { "content-length": "1024" } });
  await assert.rejects(readBoundedJsonResponse(response, { maximumBytes: 64 }), /exceeds 64 bytes/);
});

test("bounded JSON rejects an oversized streamed response", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
      controller.enqueue(new Uint8Array(40));
      controller.close();
    },
  }));
  await assert.rejects(readBoundedJsonResponse(response, { maximumBytes: 64 }), /exceeds 64 bytes/);
});

test("bounded JSON rejects malformed UTF-8 and JSON", async () => {
  await assert.rejects(
    readBoundedJsonResponse(new Response(new Uint8Array([0xc3, 0x28])), { maximumBytes: 64 }),
    /valid UTF-8/,
  );
  await assert.rejects(readBoundedJsonResponse(new Response("{"), { maximumBytes: 64 }), /valid JSON/);
});
