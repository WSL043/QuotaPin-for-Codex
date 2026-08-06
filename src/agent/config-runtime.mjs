import fs from "node:fs";
import { applyConfigAction, loadConfigResult, saveConfig } from "../core/config.mjs";
import { formatQuota } from "../core/format.mjs";

const localeNames = { en: "en-US", "zh-CN": "zh-CN", ja: "ja-JP" };

export class ConfigRuntime {
  constructor(options = {}) {
    this.configPath = options.configPath ?? null;
    this.fsImpl = options.fsImpl ?? fs;
    this.load = options.loadConfigResult ?? loadConfigResult;
    this.save = options.saveConfig ?? saveConfig;
    this.applyAction = options.applyConfigAction ?? applyConfigAction;
    this.format = options.formatQuota ?? formatQuota;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
    this.loadResult = this.load(this.configPath);
    this.config = this.loadResult.config;
    this.modifiedAt = this.#readModifiedAt(0);
  }

  #readModifiedAt(fallback) {
    return this.configPath && this.fsImpl.existsSync(this.configPath)
      ? this.fsImpl.statSync(this.configPath).mtimeMs
      : fallback;
  }

  clientState(usage, settingsAck = null) {
    const state = {
      status: usage.status,
      view: this.format(usage, this.config, this.now(), localeNames[this.config.locale] ?? "en-US"),
      preferences: this.config,
      configStatus: {
        status: this.loadResult.status,
        readOnly: this.loadResult.readOnly === true,
        message: this.loadResult.status === "recovered-corrupt"
          ? "The damaged configuration was preserved and defaults were restored."
          : this.loadResult.status === "future-version"
            ? "This configuration was created by a newer QuotaPin version and is read-only."
            : this.loadResult.status === "migration-pending"
              ? "QuotaPin is using the upgraded configuration in memory but could not write it to disk."
            : "",
      },
    };
    if (settingsAck) state.settingsAck = settingsAck;
    return state;
  }

  handleAction(payload) {
    let envelope;
    try {
      envelope = JSON.parse(payload);
    } catch {
      this.log("ignored malformed configuration envelope");
      return { broadcast: false, settingsAck: null };
    }
    const actionId = typeof envelope?.actionId === "string" ? envelope.actionId.slice(0, 96) : null;
    const action = envelope?.action && typeof envelope.action === "object" ? envelope.action : envelope;
    try {
      this.config = this.save(this.configPath, this.applyAction(this.config, action));
      this.loadResult = { config: this.config, status: "ready", readOnly: false };
      this.modifiedAt = this.#readModifiedAt(this.modifiedAt);
      this.log(`configuration action type=${String(action?.type ?? "unknown").slice(0, 32)}`);
      return {
        broadcast: true,
        settingsAck: actionId ? { actionId, ok: true, preferences: this.config } : null,
      };
    } catch (error) {
      this.log(`configuration action failed type=${String(action?.type ?? "unknown").slice(0, 32)} code=${error?.code ?? error?.name ?? "Error"}`);
      return {
        broadcast: Boolean(actionId),
        settingsAck: actionId ? {
          actionId,
          ok: false,
          error: {
            code: error?.code ?? "save_failed",
            message: error?.code === "QUOTAPIN_CONFIG_READ_ONLY"
              ? "This configuration is read-only because it was created by a newer QuotaPin version."
              : "QuotaPin could not save this setting.",
          },
        } : null,
      };
    }
  }

  reloadIfChanged() {
    if (!this.configPath || !this.fsImpl.existsSync(this.configPath)) return false;
    const modifiedAt = this.fsImpl.statSync(this.configPath).mtimeMs;
    if (modifiedAt === this.modifiedAt) return false;
    this.loadResult = this.load(this.configPath);
    this.config = this.loadResult.config;
    this.modifiedAt = modifiedAt;
    this.log("configuration reloaded");
    return true;
  }
}
