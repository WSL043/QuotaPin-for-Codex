import fs from "node:fs";
import path from "node:path";

export function readJsonFile(filePath, fsImpl = fs) {
  try { return JSON.parse(fsImpl.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); } catch { return {}; }
}

export function createLifecycleStateWriter(options) {
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const configPath = options.configPath;
  const lifecyclePath = configPath ? pathImpl.join(pathImpl.dirname(configPath), "logs", "lifecycle.json") : null;
  const runtimePath = configPath ? pathImpl.join(pathImpl.dirname(configPath), "logs", "runtime.json") : null;
  const log = options.log ?? (() => {});
  const pid = options.pid ?? process.pid;
  const port = options.port;
  const generation = String(options.generation ?? "");
  const writerStartedAt = new Date(options.startedAt ?? Date.now());

  return function writeLifecycleState(stateName, reason = "") {
    if (!lifecyclePath) return;
    try {
      const runtime = runtimePath ? readJsonFile(runtimePath, fsImpl) : {};
      const previous = readJsonFile(lifecyclePath, fsImpl);
      if (generation && previous.generation && previous.generation !== generation) {
        const previousWrittenAt = new Date(previous.writtenAt);
        if (Number.isFinite(previousWrittenAt.getTime()) && previousWrittenAt > writerStartedAt) {
          log("lifecycle write ignored because a newer attach generation owns the state");
          return;
        }
      }
      const next = {
        schema: 1,
        state: stateName,
        writtenAt: new Date().toISOString(),
        agentPid: pid,
        port,
        ...(generation ? { generation } : {}),
        ...(Number.isInteger(Number(runtime.codexPid)) ? { codexPid: Number(runtime.codexPid) } : {}),
        ...(Number.isInteger(Number(previous.attempt)) ? { attempt: Number(previous.attempt) } : {}),
        ...(reason ? { reason: String(reason).slice(0, 160) } : {}),
      };
      fsImpl.mkdirSync(pathImpl.dirname(lifecyclePath), { recursive: true });
      const temporary = `${lifecyclePath}.${pid}.tmp`;
      fsImpl.writeFileSync(temporary, JSON.stringify(next), "utf8");
      fsImpl.renameSync(temporary, lifecyclePath);
    } catch (error) {
      log(`lifecycle write failed code=${error?.code ?? error?.name ?? "Error"}`);
    }
  };
}
