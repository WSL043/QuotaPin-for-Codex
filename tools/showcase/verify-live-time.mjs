import { createShowcaseServer } from "./serve.mjs";
import { openCaptureBrowser } from "./cdp-capture.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = createShowcaseServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const browser = await openCaptureBrowser({ profilePrefix: "quotapin-time-" });

try {
  await browser.navigate(`http://127.0.0.1:${port}/case.html?preview=1&preset=critical&remaining=6&locale=en&appearance=dark&modules=seconds`, 286, 46, 700);
  const changes = [];
  let previous = "";
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4_400) {
    const text = await browser.evaluate(`document.querySelector('[data-part="seconds"]')?.textContent ?? ""`);
    if (text && text !== previous) {
      changes.push({ elapsedMs: Date.now() - startedAt, text });
      previous = text;
    }
    await delay(35);
  }
  if (changes.length < 4) throw new Error(`Expected at least four visible second boundaries, observed ${JSON.stringify(changes)}`);
  const steadyIntervals = changes.slice(2).map((entry, index) => entry.elapsedMs - changes[index + 1].elapsedMs);
  if (steadyIntervals.some((interval) => interval < 850 || interval > 1_150)) {
    throw new Error(`Visible second boundaries drifted: ${JSON.stringify({ changes, steadyIntervals })}`);
  }
  console.log(JSON.stringify({ ok: true, changes, steadyIntervals }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await browser.close();
}
