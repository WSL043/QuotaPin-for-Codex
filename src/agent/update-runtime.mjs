import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readBoundedJsonResponse } from "../core/http-json.mjs";

const RELEASES_API = "https://api.github.com/repos/WSL043/QuotaPin-for-Codex/releases?per_page=20";
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const INSTALL_MONITOR_TIMEOUT_MS = 12 * 60 * 1000;
const UPDATE_RESULT_STATUSES = new Set(["started", "succeeded", "degraded", "failed", "rolled-back", "rollback-failed"]);
const UPDATE_RESULT_PHASES = new Set(["preparing", "downloading", "verifying", "installing", "reconnecting", "complete"]);
const TERMINAL_UPDATE_RESULT_STATUSES = new Set(["succeeded", "degraded", "failed", "rolled-back", "rollback-failed"]);
const DEFAULT_UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ERROR_RETRY_BASE_MS = 15 * 60 * 1000;
const DEFAULT_ERROR_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const DEFAULT_POST_INSTALL_CHECK_MS = 60 * 1000;
const OFFICIAL_REPOSITORY = "https://github.com/WSL043/QuotaPin-for-Codex";
const WINDOWS_PACKAGE_MAX_BYTES = 160 * 1024 * 1024;
const MAC_PACKAGE_MAX_BYTES = 128 * 1024 * 1024;
export const MINIMUM_SAFE_VERSION = "0.3.0-alpha.25";

function windowsPackageName(version) {
  return `QuotaPin-${version}.exe`;
}

function macPackageName(version) {
  return `QuotaPin-macOS-${version}.dmg`;
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

function validReleaseAsset(asset, expectedName, tag, maximumBytes) {
  return String(asset?.name ?? "") === expectedName
    && String(asset?.browser_download_url ?? "") === `${OFFICIAL_REPOSITORY}/releases/download/${tag}/${expectedName}`
    && /^sha256:[0-9a-f]{64}$/.test(String(asset?.digest ?? ""))
    && Number.isSafeInteger(Number(asset?.size))
    && Number(asset?.size) > 0
    && Number(asset?.size) <= maximumBytes;
}

function releaseAssetsAreTrusted(assets, version, tag, platform) {
  const windowsName = windowsPackageName(version);
  const macName = macPackageName(version);
  if (platform === "win32" && assets.length === 1) {
    return validReleaseAsset(assets[0], windowsName, tag, WINDOWS_PACKAGE_MAX_BYTES);
  }
  if (!['win32', 'darwin'].includes(platform) || assets.length !== 2) return false;
  const byName = new Map(assets.map((asset) => [String(asset?.name ?? ""), asset]));
  return byName.size === 2
    && validReleaseAsset(byName.get(windowsName), windowsName, tag, WINDOWS_PACKAGE_MAX_BYTES)
    && validReleaseAsset(byName.get(macName), macName, tag, MAC_PACKAGE_MAX_BYTES);
}

export function normalizeReleases(payload, currentVersion, minimumSafeVersion = MINIMUM_SAFE_VERSION, platform = process.platform) {
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
    if (!releaseAssetsAreTrusted(assets, parsed.text, tag, platform) ||
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
    this.platform = String(options.platform ?? process.platform);
    this.pathImpl = options.pathImpl ?? (this.platform === "win32" ? path.win32 : path);
    this.installRoot = options.installRoot ? this.pathImpl.resolve(options.installRoot) : null;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.fsImpl = options.fsImpl ?? fs;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
    this.onChange = options.onChange ?? (() => {});
    this.log = options.log ?? (() => {});
    this.cacheMs = Number(options.cacheMs) || DEFAULT_UPDATE_CACHE_MS;
    this.errorRetryBaseMs = Number(options.errorRetryBaseMs) || DEFAULT_ERROR_RETRY_BASE_MS;
    this.errorRetryMaxMs = Math.max(this.errorRetryBaseMs, Number(options.errorRetryMaxMs) || DEFAULT_ERROR_RETRY_MAX_MS);
    this.postInstallCheckMs = Number(options.postInstallCheckMs) || DEFAULT_POST_INSTALL_CHECK_MS;
    this.autoCheckDelayMs = Number.isFinite(Number(options.autoCheckDelayMs)) ? Math.max(0, Number(options.autoCheckDelayMs)) : 10_000;
    this.autoCheck = options.autoCheck !== false;
    this.cachePath = this.installRoot ? this.pathImpl.join(this.installRoot, "logs", "update-cache.json") : null;
    this.resultPath = this.installRoot ? this.pathImpl.join(this.installRoot, "logs", "update-result.json") : null;
    this.handoffResultPath = this.installRoot ? this.pathImpl.join(this.installRoot, "logs", "installer-handoff-result.json") : null;
    this.receiptAckPath = this.installRoot ? this.pathImpl.join(this.installRoot, "logs", "update-receipt-ack.json") : null;
    this.lastCheckedAt = 0;
    this.checkFailures = 0;
    this.inFlight = null;
    this.resultMonitor = null;
    this.autoCheckTimer = null;
    this.state = {
      status: "idle",
      currentVersion: this.currentVersion,
      latestVersion: null,
      releases: [],
      message: "",
      phase: null,
      checkError: false,
      lastCheckedAt: 0,
    };
    this.#restoreCache();
    const restoredResult = this.#readUpdateResult();
    const restoredInstallActive = restoredResult?.version === this.currentVersion && restoredResult.status === "started";
    let terminalResultApplied = false;
    if (restoredInstallActive) {
      this.state = { ...this.state, status: "installing", phase: restoredResult.phase, selectedVersion: restoredResult.version, message: "" };
      this.#monitorUpdateResult(restoredResult.version, Date.parse(restoredResult.writtenAt) || this.now());
    } else if (restoredResult?._acknowledged && ["succeeded", "degraded"].includes(restoredResult.status)) {
      const deferredUpgrade = restoredResult.status === "degraded"
        && restoredResult.fromVersion === this.currentVersion
        && compareVersions(restoredResult.version, this.currentVersion) === 1;
      this.state = { ...this.state, status: deferredUpgrade ? "available" : "current", phase: "complete", message: "" };
      this.#consumeUpdateResult(restoredResult);
    } else {
      terminalResultApplied = this.#applyUpdateResult(restoredResult, false);
      if (restoredResult && (terminalResultApplied || ["started", "succeeded", "degraded"].includes(restoredResult.status))) this.#consumeUpdateResult(restoredResult);
    }
    const staleResultDiscarded = Boolean(restoredResult && !restoredInstallActive && !terminalResultApplied
      && ["started", "succeeded", "degraded"].includes(restoredResult.status));
    if (this.installRoot && this.autoCheck) {
      if (!restoredResult || staleResultDiscarded) this.#scheduleAutoCheck(this.autoCheckDelayMs);
      else if (terminalResultApplied) this.#scheduleAutoCheck(this.postInstallCheckMs);
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
      lastCheckedAt: checkedAt,
    };
  }

  #persistCache() {
    if (!this.cachePath || typeof this.fsImpl.writeFileSync !== "function" || typeof this.fsImpl.renameSync !== "function") return;
    try {
      this.fsImpl.mkdirSync?.(this.pathImpl.dirname(this.cachePath), { recursive: true });
      const temporary = `${this.cachePath}.${process.pid}.tmp`;
      this.fsImpl.writeFileSync(temporary, JSON.stringify({ schema: 2, checkedAt: this.lastCheckedAt, currentVersion: this.currentVersion, releases: this.state.releases }), "utf8");
      this.fsImpl.renameSync(temporary, this.cachePath);
    } catch (error) {
      this.log(`update cache write failed code=${error?.code ?? error?.name ?? "Error"}`);
    }
  }

  #readUpdateReceipt(filePath, source) {
    const result = this.#readJson(filePath);
    const writtenAt = Date.parse(result?.writtenAt);
    if (!result || ![1, 2].includes(result.schema) || !UPDATE_RESULT_STATUSES.has(result.status)
      || !parseVersion(result.version) || !Number.isFinite(writtenAt)
      || writtenAt > this.now() + CLOCK_SKEW_MS || this.now() - writtenAt > 24 * 60 * 60 * 1000) return null;
    if (result.fromVersion != null && !parseVersion(result.fromVersion)) return null;
    if (result.direction != null && !["update", "repair", "rollback"].includes(result.direction)) return null;
    if (result.phase != null && !UPDATE_RESULT_PHASES.has(result.phase)) return null;
    return { ...result, phase: result.phase ?? (result.status === "started" ? "preparing" : "complete"), _source: source };
  }

  #readUpdateResult() {
    const primary = this.#readUpdateReceipt(this.resultPath, "updater");
    const handoff = this.#readUpdateReceipt(this.handoffResultPath, "handoff");
    let selected;
    if (!primary) selected = handoff;
    else if (!handoff) selected = primary;
    else if (primary.version === handoff.version) {
      if (TERMINAL_UPDATE_RESULT_STATUSES.has(handoff.status) && !["failed", "rolled-back", "rollback-failed"].includes(primary.status)) selected = handoff;
      else if (TERMINAL_UPDATE_RESULT_STATUSES.has(primary.status) && handoff.status === "started") selected = primary;
    }
    if (!selected && primary && handoff) selected = Date.parse(handoff.writtenAt) > Date.parse(primary.writtenAt) ? handoff : primary;
    if (!selected) return null;
    return { ...selected, _acknowledged: this.#receiptWasAcknowledged(selected) };
  }

  #receiptWasAcknowledged(result) {
    if (!result || result._source !== "handoff") return false;
    const ack = this.#readJson(this.receiptAckPath);
    return ack?.schema === 1
      && ack.source === result._source
      && ack.version === result.version
      && ack.status === result.status
      && ack.writtenAt === result.writtenAt;
  }

  #acknowledgeReceipt(result) {
    if (!this.receiptAckPath || result?._source !== "handoff" || typeof this.fsImpl.writeFileSync !== "function" || typeof this.fsImpl.renameSync !== "function") return;
    try {
      this.fsImpl.mkdirSync?.(this.pathImpl.dirname(this.receiptAckPath), { recursive: true });
      const temporary = `${this.receiptAckPath}.${process.pid}.tmp`;
      this.fsImpl.writeFileSync(temporary, JSON.stringify({ schema: 1, source: result._source, version: result.version, status: result.status, writtenAt: result.writtenAt }), "utf8");
      this.fsImpl.renameSync(temporary, this.receiptAckPath);
    } catch (error) {
      this.log(`update receipt acknowledgement failed code=${error?.code ?? error?.name ?? "Error"}`);
    }
  }

  #applyUpdateResult(result, publish = true) {
    if (!result || !["succeeded", "degraded", "failed", "rolled-back", "rollback-failed"].includes(result.status)) return false;
    const deferredUpgrade = result.status === "degraded"
      && result.fromVersion === this.currentVersion
      && compareVersions(result.version, this.currentVersion) === 1;
    if (["succeeded", "degraded"].includes(result.status) && result.version !== this.currentVersion && !deferredUpgrade) return false;
    const direction = result.direction ?? updateDirection(result.version, result.fromVersion ?? this.currentVersion) ?? "repair";
    const operation = {
      direction,
      fromVersion: result.fromVersion ?? null,
      toVersion: result.version,
      result: result.status,
    };
    let patch;
    if (result.status === "rolled-back") {
      patch = { status: "error", phase: "complete", checkError: false, message: "QuotaPin could not complete the update. The previous version was restored.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else if (result.status === "rollback-failed") {
      patch = { status: "error", phase: "complete", checkError: false, message: "QuotaPin could not complete the update or fully restore the previous version. Run the install command to repair it.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else if (result.status === "failed") {
      patch = { status: "error", phase: "complete", checkError: false, message: "QuotaPin could not complete the update. Open the version menu to retry.", selectedVersion: result.version, selectedDirection: direction, lastOperation: operation };
    } else {
      patch = {
        status: deferredUpgrade ? "available" : "current",
        message: result.status === "degraded"
          ? "QuotaPin updated. The new version will join the next Codex launch."
          : "QuotaPin updated without restarting Codex.",
        selectedVersion: null,
        selectedDirection: null,
        phase: "complete",
        checkError: false,
        lastOperation: operation,
      };
    }
    if (publish) this.#publish(patch);
    else this.state = { ...this.state, ...patch };
    return true;
  }

  #consumeUpdateResult(result) {
    if (!this.resultPath || !result || typeof this.fsImpl.unlinkSync !== "function") return;
    this.#acknowledgeReceipt(result);
    try {
      const current = this.#readJson(this.resultPath);
      if ([1, 2].includes(current?.schema) && current?.version === result.version &&
          (current?.writtenAt === result.writtenAt || result._source === "handoff")) {
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
        this.#scheduleAutoCheck(this.postInstallCheckMs, true);
        return;
      }
      if (result?.version === version && result.status === "started" && this.state.phase !== result.phase) {
        this.#publish({ phase: result.phase, message: "" });
      }
      if (this.now() >= deadline) {
        this.resultMonitor = null;
        if (result?.version === version && result.status === "started") this.#consumeUpdateResult(result);
        this.#publish({ status: "error", phase: null, message: "QuotaPin could not confirm the update result." });
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
    if (!force && !this.state.checkError && this.lastCheckedAt && this.now() - this.lastCheckedAt < this.cacheMs && ["current", "available"].includes(this.state.status)) {
      this.#scheduleAutoCheck(Math.max(1, this.cacheMs - (this.now() - this.lastCheckedAt)));
      return this.clientState();
    }
    const fallback = this.clientState();
    this.#publish({ status: "checking", phase: null, checkError: false, message: "" });
    this.inFlight = (async () => {
      try {
        if (typeof this.fetchImpl !== "function") throw new Error("fetch unavailable");
        const response = await this.fetchImpl(RELEASES_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `QuotaPin/${this.currentVersion}`,
            "X-GitHub-Api-Version": "2026-03-10",
          },
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const releaseDocument = await readBoundedJsonResponse(response, { maximumBytes: 1024 * 1024 });
        if (!Array.isArray(releaseDocument) || releaseDocument.length > 20) throw new Error("Release response has an invalid shape");
        const releases = normalizeReleases(releaseDocument, this.currentVersion, MINIMUM_SAFE_VERSION, this.platform);
        const latest = releases[0]?.version ?? null;
        const available = latest && compareVersions(latest, this.currentVersion) === 1;
        this.lastCheckedAt = this.now();
        this.checkFailures = 0;
        this.#publish({
          status: available ? "available" : "current",
          latestVersion: latest,
          releases,
          message: "",
          checkError: false,
          lastCheckedAt: this.lastCheckedAt,
        });
        this.#persistCache();
        this.#scheduleAutoCheck(this.cacheMs, true);
      } catch (error) {
        this.log(`update check failed code=${error?.name ?? "Error"}`);
        this.checkFailures += 1;
        const retryDelay = Math.min(this.errorRetryMaxMs, this.errorRetryBaseMs * (2 ** Math.min(8, this.checkFailures - 1)));
        const knownState = ["current", "available"].includes(fallback.status);
        this.#publish({
          status: knownState ? fallback.status : "error",
          latestVersion: knownState ? fallback.latestVersion : this.state.latestVersion,
          releases: knownState ? fallback.releases : this.state.releases,
          lastCheckedAt: knownState ? fallback.lastCheckedAt : this.state.lastCheckedAt,
          checkError: true,
          message: "QuotaPin could not check for updates.",
        });
        this.#scheduleAutoCheck(retryDelay, true);
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
    const updaterName = this.platform === "darwin" ? "update.sh" : this.platform === "win32" ? "update.ps1" : "";
    const updater = this.installRoot && updaterName ? this.pathImpl.join(this.installRoot, updaterName) : "";
    if (!updater || !this.fsImpl.existsSync(updater)) {
      this.#publish({ status: "error", message: "The QuotaPin update helper is unavailable. Run the install command once to repair it." });
      return false;
    }
    try {
      const executable = this.platform === "darwin"
        ? "/bin/bash"
        : this.pathImpl.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const args = this.platform === "darwin"
        ? [updater, "--version", requested, "--write-result"]
        : ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", updater, "-Version", requested];
      const child = this.spawnImpl(executable, args, { detached: true, stdio: "ignore", windowsHide: this.platform === "win32" });
      const failLaunch = (error) => {
        if (this.state.status !== "installing" || this.state.selectedVersion !== requested) return;
        const startedResult = this.#readUpdateResult();
        if (startedResult?.version === requested && startedResult.status === "started") this.#consumeUpdateResult(startedResult);
        if (this.resultMonitor) {
          try { this.clearTimeoutImpl(this.resultMonitor); } catch {}
          this.resultMonitor = null;
        }
        this.log(`update launch failed code=${error?.code ?? error?.name ?? "Error"}`);
        this.#publish({ status: "error", phase: null, message: "QuotaPin could not start the update." });
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
          this.#scheduleAutoCheck(this.postInstallCheckMs, true);
          return;
        }
        failLaunch({ code: Number.isInteger(code) ? `EXIT_${code}` : "EARLY_EXIT" });
      });
      child.unref?.();
      this.#publish({ status: "installing", phase: "preparing", checkError: false, message: "", selectedVersion: requested, selectedDirection: selectedRelease.direction });
      this.#monitorUpdateResult(requested, this.now());
      this.log(`update helper launched version=${requested}`);
      return true;
    } catch (error) {
      this.log(`update launch failed code=${error?.code ?? error?.name ?? "Error"}`);
      this.#publish({ status: "error", phase: null, message: "QuotaPin could not start the update." });
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
