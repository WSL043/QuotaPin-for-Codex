import fs from "node:fs";
import path from "node:path";

export function createAttachReadinessWriter(options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const pathImpl = options.pathImpl ?? path;
  const configPath = options.configPath;
  const generation = String(options.generation ?? "");
  const port = Number(options.port);
  const pid = Number(options.pid ?? process.pid);
  const readyPath = configPath && /^[0-9a-f]{32}$/i.test(generation)
    ? pathImpl.join(pathImpl.dirname(configPath), "logs", `attach-ready.${generation}.json`)
    : null;
  let written = false;

  return {
    clear() {
      if (!readyPath) return;
      try { fsImpl.rmSync(readyPath, { force: true }); } catch {}
    },
    markRendererAttached() {
      if (written || !readyPath || !generation) return false;
      const temporary = `${readyPath}.${pid}.tmp`;
      const value = {
        schema: 1,
        state: "renderer-attached",
        generation,
        agentPid: pid,
        port,
        writtenAt: new Date().toISOString(),
      };
      fsImpl.mkdirSync(pathImpl.dirname(readyPath), { recursive: true });
      fsImpl.writeFileSync(temporary, JSON.stringify(value), "utf8");
      fsImpl.renameSync(temporary, readyPath);
      written = true;
      return true;
    },
  };
}
