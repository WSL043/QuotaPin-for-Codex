const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : NaN);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Usage: node scripts/verify-overdrive.mjs --port <loopback-port>");
}

const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
const targets = response.ok ? await response.json() : [];
const target = targets.find((item) => item.url === "app://-/index.html" && item.webSocketDebuggerUrl);
if (!target) throw new Error("Codex main target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const scenarios = JSON.parse(Buffer.from("W3sibmFtZSI6ImV4YWN0LXN0cnVjdHVyYWwtc3RhdGUiLCJ0ZXh0IjoiNS42IFNvbCIsImVmZm9ydCI6InVsdHJhIiwiZmFzdEluZGljYXRvciI6dHJ1ZSwiZXhwZWN0ZWQiOnRydWV9LHsibmFtZSI6ImRpZmZlcmVudC1lZmZvcnQiLCJ0ZXh0IjoiNS42IFNvbCIsImVmZm9ydCI6Im1heCIsImZhc3RJbmRpY2F0b3IiOnRydWUsImV4cGVjdGVkIjpmYWxzZX0seyJuYW1lIjoiZXhhY3QtZWZmb3J0LWZsYWciLCJ0ZXh0IjoiNS42IFNvbCIsImVmZm9ydCI6IiIsImZhc3RJbmRpY2F0b3IiOnRydWUsInVsdHJhRWZmb3J0SW5kaWNhdG9yIjp0cnVlLCJleHBlY3RlZCI6dHJ1ZX0seyJuYW1lIjoibmVhci1lZmZvcnQiLCJ0ZXh0IjoiNS42IFNvbCIsImVmZm9ydCI6InhoaWdoIiwiZmFzdEluZGljYXRvciI6dHJ1ZSwiZXhwZWN0ZWQiOmZhbHNlfSx7Im5hbWUiOiJ2aXNpYmxlLWNvcHktb25seSIsInRleHQiOiI1LjYgU29sIFVsdHJhIiwiZXhwZWN0ZWQiOmZhbHNlfSx7Im5hbWUiOiJtaXNzaW5nLXNwZWVkIiwidGV4dCI6IjUuNiBTb2wiLCJlZmZvcnQiOiJ1bHRyYSIsImZhc3RJbmRpY2F0b3IiOmZhbHNlLCJleHBlY3RlZCI6ZmFsc2V9LHsibmFtZSI6ImRpZmZlcmVudC1tb2RlbCIsInRleHQiOiI1LjYgTHVuYSIsImVmZm9ydCI6InVsdHJhIiwiZmFzdEluZGljYXRvciI6dHJ1ZSwiZXhwZWN0ZWQiOmZhbHNlfV0=", "base64").toString("utf8"));
const persistentFixture = Buffer.from("bWVudUZpcmU=", "base64").toString("utf8");

const unsealKeys = (encoded) => JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
const inputPathA = unsealKeys("WyJBcnJvd1VwIiwiQXJyb3dVcCIsIkFycm93RG93biIsIkFycm93RG93biIsIkFycm93TGVmdCIsIkFycm93UmlnaHQiXQ==");
const inputPathB = unsealKeys("WyJ3IiwiVyIsInMiLCJTIiwiYSIsImQiXQ==");
const invalidPath = unsealKeys("WyJ3IiwicyIsInciLCJzIiwiYSIsImQiXQ==");
const mixedPath = inputPathB.map((key, index) => index % 2 === 0 ? key : inputPathA[index]);
const acceptedTimeline = inputPathB.map((key, index) => ({ key, at: 1000 + index * 250 }));
const slowTimeline = inputPathB.map((key, index) => ({ key, at: 1000 + index * 1800 }));
const repeatedTimeline = [
  { key: inputPathB[0], at: 1000 },
  { key: inputPathB[0], at: 1100, repeat: true },
  { key: inputPathB[1], at: 1200 },
  { key: inputPathB[2], at: 1300 },
  { key: inputPathB[3], at: 1400 },
  { key: inputPathB[4], at: 1500 },
  { key: inputPathB[5], at: 1600 },
];
const editableTimeline = acceptedTimeline.map((entry, index) => index === 2 ? { ...entry, editable: true } : entry);
const editableAltTimeline = acceptedTimeline.map((entry) => ({ ...entry, editable: true, altKey: true }));

const result = await new Promise((resolve, reject) => {
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== 1) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result.result.value);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      returnByValue: true,
      expression: `(() => {
        const controller = window.__quotaPinController;
        const scenarios = ${JSON.stringify(scenarios)};
        return {
          live: controller?.sampleOverdrive?.() ?? null,
          scenarios: scenarios.map((item) => ({
            name: item.name,
            expected: item.expected,
            actual: controller?.classifyOverdrive?.(item.text, item.signals, item.effort, item.fastIndicator, item.ultraEffortIndicator)?.active ?? null,
          })),
          pathA: controller?.testCheatSequence?.(${JSON.stringify(inputPathA)}) ?? false,
          pathB: controller?.testCheatSequence?.(${JSON.stringify(inputPathB)}) ?? false,
          pathMixed: controller?.testCheatSequence?.(${JSON.stringify(mixedPath)}) ?? false,
          pathInvalid: controller?.testCheatSequence?.(${JSON.stringify(invalidPath)}) ?? true,
          timelineAccepted: controller?.testCheatTimeline?.(${JSON.stringify(acceptedTimeline)}) ?? false,
          timelineSlowAccepted: controller?.testCheatTimeline?.(${JSON.stringify(slowTimeline)}) ?? true,
          timelineRepeatIgnored: controller?.testCheatTimeline?.(${JSON.stringify(repeatedTimeline)}) ?? false,
          timelineEditableAccepted: controller?.testCheatTimeline?.(${JSON.stringify(editableTimeline)}) ?? true,
          timelineEditableAltAccepted: controller?.testCheatTimeline?.(${JSON.stringify(editableAltTimeline)}) ?? false,
          persistentPolicy: {
            disabledMaxed: controller?.testPersistentOverdrivePolicy?.(false, true) ?? "missing",
            enabledNotMaxed: controller?.testPersistentOverdrivePolicy?.(true, false) ?? "missing",
            enabledMaxed: controller?.testPersistentOverdrivePolicy?.(true, true) ?? "missing",
          },
          structuralSignalTypes: controller?.testStructuralSignalTypes?.() ?? null,
        };
      })()`,
    },
  }));
});
socket.close();

console.log(JSON.stringify(result));
if (
  !result.scenarios?.every((item) => item.actual === item.expected)
  || !result.pathA
  || !result.pathB
  || !result.pathMixed
  || result.pathInvalid
  || !result.timelineAccepted
  || result.timelineSlowAccepted
  || !result.timelineRepeatIgnored
  || result.timelineEditableAccepted
  || !result.timelineEditableAltAccepted
  || result.persistentPolicy?.disabledMaxed !== ""
  || result.persistentPolicy?.enabledNotMaxed !== ""
  || result.persistentPolicy?.enabledMaxed !== persistentFixture
  || !result.structuralSignalTypes?.svg
  || !result.structuralSignalTypes?.html
) process.exit(1);
