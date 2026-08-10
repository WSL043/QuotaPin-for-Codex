const DEFAULT_MAX_BYTES = 1024 * 1024;

function declaredLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^\d+$/.test(String(raw))) throw new Error("HTTP response has an invalid Content-Length");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("HTTP response Content-Length is not safe");
  return value;
}

async function boundedBytes(response, maximumBytes) {
  const announced = declaredLength(response);
  if (announced !== null && announced > maximumBytes) {
    throw new Error(`HTTP response exceeds ${maximumBytes} bytes`);
  }

  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += bytes.byteLength;
        if (total > maximumBytes) throw new Error(`HTTP response exceeds ${maximumBytes} bytes`);
        chunks.push(bytes);
      }
    } catch (error) {
      try { await reader.cancel(error); } catch {}
      throw error;
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  if (typeof response?.arrayBuffer !== "function") throw new Error("HTTP response body is unreadable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`HTTP response exceeds ${maximumBytes} bytes`);
  return bytes;
}

export async function readBoundedJsonResponse(response, options = {}) {
  const maximumBytes = Number(options.maximumBytes ?? DEFAULT_MAX_BYTES);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("A positive JSON response limit is required");
  if (response?.redirected) throw new Error("Redirected JSON responses are not accepted");
  const bytes = await boundedBytes(response, maximumBytes);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("HTTP response is not valid UTF-8");
  }
  if (!text.trim()) throw new Error("HTTP response body is empty");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("HTTP response is not valid JSON");
  }
}
