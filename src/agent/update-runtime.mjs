import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const RELEASES_API = "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases?per_page=20";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const INSTALL_MONITOR_TIMEOUT_MS = 12 * 60 * 1000;
const UPDATE_RESULT_STATUSES = new Set(["started", "succeeded", "degraded", "failed", "rolled-back", "rollback-failed"]);
const OFFICIAL_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";
export const MINIMUM_SAFE_VERSION = "0.3.0-alpha.25";

function packageName(version) {
  return `QuotaPin-${version}.exe`;
}

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value ?? ""));
  if (!match) return null;
  return {
    text: match[0],
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4]?.split(".") ?? [],
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const l = a.pre[index];
    const r = b.pre[index];
    if (l === undefined || r === undefined) return l === r ? 0 : l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l) ? Number(l) : null;
    const rn = /^\d+$/.test(r) ? Number(r) : null;
    if (ln !== null || rn !== null) {
      if (ln === null || rn === null) return ln === null ? 1 : -1;
      return ln < rn ? -1 : 1;
    }
    return l < r ? -1 : 1;
  }
  return 0;
}

export function updateDirection(targetVersion, currentVersion) {
  const comparison = compareVersions(targetVersion, currentVersion);
  if (comparison === null) return null;
  return comparison > 0 ? "update" : comparison < 0 ? "rollback" : "repair";
}

function decorateRelease(release, currentVersion) {
  return { ...release, direction: updateDirection(release.version, currentVersion) };
}

export function normalizeReleases(payload, currentVersion, minimumSafeVersion = MINIMUM_SAFE_VERSION) {
  const current = parseVersion(currentVersion);
  if (!current || !parseVersion(minimumSafeVersion) || !Array.isArray(payload)) return [];
  const acceptsPrerelease = current.pre.length > 0;
  const releases = [];
  for (const item of payload) {
    if (!item || item.draft === true || item.immutable !== true || (item.prerelease === true && !acceptsPrerelease)) continue;
    const tag = String(item.tag_name ?? "");
    if (!tag.startsWith("v")) continue;
    const parsed = parseVersion(tag.slice(1));
    if (!parsed || Boolean(parsed.pre.length) !== (item.prerelease === true)) continue;
    if (parsed.pre.length && !acceptsPrerelease) continue;
    if (compareVersions(parsed.text, minimumSafeVersion) < 0) continue;
    const assets = Array.isArray(item.assets) ? item.assets : [];
    const expectedName = packageName(parsed.text);
    const expectedUrl = `${OFFICIAL_REPOSITORY}/releases/download/${tag}/${expectedName}`;
    if (assets.length !== 1 || String(assets[0]?.name ?? "") !== expectedName ||
        String(assets[0]?.browser_download_url ?? "") !== expectedUrl ||
        !/^sha256:[0-9a-f]{64}$/.test(String(assets[0]?.digest ?? "")) ||
        !Number.isSafeInteger(Number(assets[0]?.size)) || Number(assets[0]?.size) <= 0 || Number(assets[0]?.size) > 160 * 1024 * 1024 ||
        String(item.html_url ?? "") !== `${OFFICIAL_REPOSITORY}/releases/tag/${tag}`) continue;
    releases.push(decorateRelease({ version: parsed.text, prerelease: item.prerelease === true }, currentVersion));
  }
  return [...new Map(releases.map((release) => [release.version, release])).values()]
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0)
    .slice(0, 12);
}

function normalizeCachedReleases(payload, currentVersion, minimumSafeVersion = MINIMUM_SAFE_VERSION) {
  const current = parseVersion(currentVersion);
  if (!current || !Array.isArray(payload)) return [];
  const acceptsPrerelease = current.pre.length > 0;
  const releases = [];
  for (const item of payload) {
    const parsed = parseVersion(item?.version);
    if (!parsed || compareVersions(parsed.text, minimumSafeVersion) < 0) continue;
    if (parsed.pre.length && !acceptsPrerelease) continue;
    releases.push(decorateRelease({ version: parsed.text, prerelease: parsed.pre.length > 0 }, currentVersion));
  }
  return [...new Map(releases.map((release) => [release.version, release])).values()]
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0)
    .slice(0, 12);
}

export class UpdateRuntime {
  constructor(options = {}) {
    this.currentVersion = String(options.currentVersion ?? "");
    this.installRoot = options.installRoot ? path.resolve(options.installRoot) : null;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.fsImpl = options.fsImpl ?? fs;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    this.onChange = options.onChange ?? (() => {});
    this.log = options.log ?? (() => {});
    this.cacheMs = Number(options.cacheMs) || 24 * 60 * 60 * 1000;
    this.autoCheckDelayMs = Number.isFinite(Number(options.autoCheckDelayMs)) ? Math.max(0, Number(options.autoCheckDelayMs)) : 10_000;
    this.autoCheck = options.autoCheck !== false;
    this.cachePath = this.installRoot ? path.join(this.installRoot, "logs", "update-cache.json") : null;
    this.resultPath = this.installRoot ? path.join(this.installRoot, "logs", "update-result.json") : null;
    this.lastCheckedAt = 0;
    this.inFlight = null;
    this.resultMonitor = null;
    this.autoCheckTimer = null;
    this.state = {
      status: "idle",
      currentVersion: this.currentVersion,
      latestVersion: null,
      releases: [],
      message: "",
    };
    this.#restoreCache();
    const restoredResult = this.#readUpdateResult();
    const restoredInstallActive = restoredResult?.version === this.currentVersion && restoredResult.status === "started";
    let terminalResultApplied = false;
    if (restoredInstallActive) {
      this.state = { ...this.state, status: "installing", selectedVersion: restoredResult.version, message: "" };
      this.#monitorUpdateResult(restoredResult.version, Date.parse(restoredResult.writtenAt) || this.now());
    } else {
      terminalResultApplied = this.#applyUpdateResult(restoredResult, false);
      if (restoredResult && (terminalResultApplied || ["started", "succeeded", "degraded"].includes(restoredResult.status))) this.#consumeUpdateResult(restoredResult);
    }
    const staleResultDiscarded = Boolean(restoredResult && !restoredInstallActive && !terminalResultApplied
      && ["started", "succeeded", "degraded"].includes(restoredResult.status));
    if (this.installRoot && this.autoCheck) {
      if (!restoredResult || staleResultDiscarded) this.#scheduleAutoCheck(this.autoCheckDelayMs);
      else if (terminalResultApplied) this.#scheduleAutoCheck(this.cacheMs);
    }
  }

  clientState() {
    return { ...this.state, releases: this.state.releases.map((release) => ({ ...release })) };
  }

  #publish(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.clientState());
  }

  #readJson(filePath) {
    if (!filePath || typeof this.fsImpl.readFileSync !== "function") return null;
    try { return JSON.parse(String(this.fsImpl.readFileSync(filePath, "utf8")).replace(/^\uFEFF/, "")); } catch { return null; }
  }

  #restoreCache() {
    const cached = this.#readJson(this.cachePath);
    if (cached?.schema !== 2 || cached.currentVersion !== this.currentVersion) return;
    const checkedAt = Number(cached?.checkedAt);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > this.now() + CLOCK_SKEW_MS || !Array.isArray(cached?.releases)) return;
    const releases = normalizeCachedReleases(cached.releases, this.currentVersion);
    const latestVersion = releases[0]?.version ?? null;
    this.lastCheckedAt = checkedAt;
    this.state = {
      ...this.state,
      status: latestVersion && compareVersions(latestVersion, this.currentVersion) === 1 ? "available" : "current",
      latestVersion,
      releases,
    };
  }

  #persistCache() {
    if (!this.cachePath || typeof this.fsImpl.writeFileSync !== "function" || typeof this.fsImpl.renameSync !== "function") return;
    try {
      this.fsImpl.mkdirSync?.(path.dirname(this.cachePath), { recursive: true });
      const temporary = `${this.cachePath}.${process.pid}.tmp`;
      this.fsImpl.writeFileSync(temporary, JSON.stringify({ schema: 2, checkedAt: this.lastCheckedAt, currentVersion: this.currentVersion, releases: this.state.releases }), "utf8");
      this.fsImpl.renameSync(temporary, this.cachePath);
    } catch (error) {
      this.log(`update cache write failed code=${error?.code ?? error?.name ?? "Error"}`);
    }
  }

  #readUpdateResult() {
    const result = this.#readJson(this.resultPath);
    const writtenAt = Date.parse(result?.writtenAt);
    if (!result || result.schema !== 1 || !UPDATE_RESULT_STATUSES.has(result.status)
      || !parseVersion(result.version) || !Number.isFinite(writtenAt)
      || writtenAt > this.now() + CLOCK_SKEW_MS || this.now() - writtenAt > 24 * 60 * 60 * 1000) return null;
    if (result.fromVersion != null && !parseVersion(result.fromVersion)) return null;
    if (result.direction != null && !["update", "repair", "rollback"].includes(result.direction)) return null;
    return result;
  }

  #applyUpdateResult(result, publish = true) {
    if (!result || !["succeeded", "degraded", "failed", "rolled-back", "rollback-failed"].includes(result.status)) return false;
    if (["succeeded", "degraded"].includes(result.status) && result.version !== this.currentVersion) return false;
    const direction = result.direction ?? updateDirection(result.version, result.fromVersion ?? this.currentVersion) ?? "repair";
    const operation = {
      direction,
      fromVersion: result.fromVersion ?? null,
      toVersion: result.version,
      result: result.status,
    };
    let patch;
    if (result.status === "rolled-back") {
      patch = { status: "error", message: "QuotaPin could not complete the update. The previous version was restored.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else if (result.status === "rollback-failed") {
      patch = { status: "error", message: "QuotaPin could not complete the update or fully restore the previous version. Run the install command to repair it.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else if (result.status === "failed") {
      patch = { status: "error", message: "QuotaPin could not complete the update. Open the version menu to retry.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else {
      patch = {
        status: "current",
        message: result.status === "degraded" ? "QuotaPin updated. Attachment will retry on the next Codex launch." : "QuotaPin updated successfully.",
        selectedVersion: null,
        selectedDirection: null,
        lastOperation: operation,
      };
    }
    if (publish) this.#publish(patch);
    else this.state = { ...this.state, ...patch };
    return true;
  }

  #consumeUpdateResult(result) {
    if (!this.resultPath || !result || typeof this.fsImpl.unlinkSync !== "function") return;
    try {
      const current = this.#readJson(this.resultPath);
      if (current?.schema === result.schema && current?.status === result.status && current?.version === result.version && current?.writtenAt === result.writtenAt) {
        this.fsImpl.unlinkSync(this.resultPath);
      }
    } catch {}
  }

  #scheduleAutoCheck(delay, replace = false) {
    if (!this.installRoot || !this.autoCheck) return;
    if (replace && this.autoCheckTimer) {
      try { this.clearTimeoutImpl(this.autoCheckTimer); } catch {}
      this.autoCheckTimer = null;
    }
    if (this.autoCheckTimer) return;
    this.autoCheckTimer = this.setTimeoutImpl(() => {
      this.autoCheckTimer = null;
      if (this.state.status === "installing") return;
      this.check(false).catch(() => {});
    }, Math.max(0, Number(delay) || 0));
    this.autoCheckTimer?.unref?.();
  }

  #monitorUpdateResult(version, notBefore) {
    if (!this.resultPath || this.resultMonitor) return;
    const deadline = Number(notBefore) + INSTALL_MONITOR_TIMEOUT_MS;
    const tick = () => {
      if (this.state.status !== "installing" || this.state.selectedVersion !== version) {
        this.resultMonitor = null;
        return;
      }
      const result = this.#readUpdateResult();
      const writtenAt = Date.parse(result?.writtenAt);
      if (result?.version === version && Number.isFinite(writtenAt) && writtenAt >= notBefore && this.#applyUpdateResult(result)) {
        this.#consumeUpdateResult(result);
        this.resultMonitor = null;
        this.#scheduleAutoCheck(this.cacheMs, true);
        return;
      }
      if (this.now() >= deadline) {
        this.resultMonitor = null;
        if (result?.version === version && result.status === "started") this.#consumeUpdateResult(result);
        this.#publish({ status: "error", message: "QuotaPin could not confirm the update result." });
        this.#scheduleAutoCheck(this.autoCheckDelayMs);
        return;
      }
      this.resultMonitor = this.setTimeoutImpl(tick, 500);
      this.resultMonitor?.unref?.();
    };
    this.resultMonitor = this.setTimeoutImpl(tick, 250);
    this.resultMonitor?.unref?.();
  }

  async check(force = false) {
    if (this.state.status === "installing") return this.clientState();
    if (this.inFlight) return this.inFlight;
    if (!force && this.lastCheckedAt && this.now() - this.lastCheckedAt < this.cacheMs && ["current", "available"].includes(this.state.status)) {
      this.#scheduleAutoCheck(Math.max(1, this.cacheMs - (this.now() - this.lastCheckedAt)));
      return this.clientState();
    }
    this.#publish({ status: "checking", message: "" });
    this.inFlight = (async () => {
      try {
        if (typeof this.fetchImpl !== "function") throw new Error("fetch unavailable");
        const response = await this.fetchImpl(RELEASES_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `QuotaPin/${this.currentVersion}`,
            "X-GitHub-Api-Version": "2026-03-10",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const releases = normalizeReleases(await response.json(), this.currentVersion);
        const latest = releases[0]?.version ?? null;
        const available = latest && compareVersions(latest, this.currentVersion) === 1;
        this.lastCheckedAt = this.now();
        this.#publish({
          status: available ? "available" : "current",
          latestVersion: latest,
          releases,
          message: "",
        });
        this.#persistCache();
        this.#scheduleAutoCheck(this.cacheMs, true);
      } catch (error) {
        this.log(`update check failed code=${error?.name ?? "Error"}`);
        this.#publish({ status: "error", message: "QuotaPin could not check for updates." });
        this.#scheduleAutoCheck(this.cacheMs, true);
      } finally {
        this.inFlight = null;
      }
      return this.clientState();
    })();
    return this.inFlight;
  }

  install(version) {
    if (this.inFlight || !["current", "available"].includes(this.state.status)) return false;
    const requested = parseVersion(version)?.text ?? "";
    const selectedRelease = this.state.releases.find((release) => release.version === requested);
    if (!requested || !selectedRelease) {
      this.#publish({ status: "error", message: "Choose a supported QuotaPin release first." });
      return false;
    }
    const updater = this.installRoot ? path.join(this.installRoot, "update.ps1") : "";
    if (!updater || !this.fsImpl.existsSync(updater)) {
      this.#publish({ status: "error", message: "The QuotaPin update helper is unavailable. Run the install command once to repair it." });
      return false;
    }
    const windowsPowerShell = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
      const child = this.spawnImpl(windowsPowerShell, [
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", updater, "-Version", requested,
      ], { detached: true, stdio: "ignore", windowsHide: true });
      const failLaunch = (error) => {
        if (this.state.status !== "installing" || this.state.selectedVersion !== requested) return;
        const startedResult = this.#readUpdateResult();
        if (startedResult?.version === requested && startedResult.status === "started") this.#consumeUpdateResult(startedResult);
        if (this.resultMonitor) {
          try { this.clearTimeoutImpl(this.resultMonitor); } catch {}
          this.resultMonitor = null;
        }
        this.log(`update launch failed code=${error?.code ?? error?.name ?? "Error"}`);
        this.#publish({ status: "error", message: "QuotaPin could not start the update." });
      };
      child.once?.("error", failLaunch);
      child.once?.("exit", (code) => {
        if (this.state.status !== "installing" || this.state.selectedVersion !== requested) return;
        const result = this.#readUpdateResult();
        if (result?.version === requested && this.#applyUpdateResult(result)) {
          this.#consumeUpdateResult(result);
          if (this.resultMonitor) {
            try { this.clearTimeoutImpl(this.resultMonitor); } catch {}
            this.resultMonitor = null;
          }
          this.#scheduleAutoCheck(this.cacheMs, true);
          return;
        }
        failLaunch({ code: Number.isInteger(code) ? `EXIT_${code}` : "EARLY_EXIT" });
      });
      child.unref?.();
      this.#publish({ status: "installing", message: "", selectedVersion: requested, selectedDirection: selectedRelease.direction });
      this.#monitorUpdateResult(requested, this.now());
      this.log(`update helper launched version=${requested}`);
      return true;
    } catch (error) {
      this.log(`update launch failed code=${error?.code ?? error?.name ?? "Error"}`);
      this.#publish({ status: "error", message: "QuotaPin could not start the update." });
      return false;
    }
  }

  handleAction(payload) {
    let action;
    try { action = JSON.parse(String(payload)); } catch { return false; }
    if (action?.type === "check") {
      this.check(action.force === true).catch(() => {});
      return true;
    }
    if (action?.type === "refresh") {
      this.check(true).catch(() => {});
      return true;
    }
    if (action?.type === "install") return this.install(action.version);
    return false;
  }
}
