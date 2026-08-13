import fs from "node:fs";
import path from "node:path";
import { createQuotaPaceState, estimateQuotaPace, observeQuotaPace } from "../core/quota-pace.mjs";

export class QuotaPaceRuntime {
  constructor(options = {}) {
    this.statePath = options.statePath ?? null;
    this.fsImpl = options.fsImpl ?? fs;
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? (() => {});
    this.state = this.#load();
    this.usage = { status: "loading", windows: [] };
  }

  #load() {
    if (!this.statePath || !this.fsImpl.existsSync(this.statePath)) return createQuotaPaceState();
    try {
      return createQuotaPaceState(JSON.parse(this.fsImpl.readFileSync(this.statePath, "utf8")), this.now());
    } catch (error) {
      this.log(`quota pace history ignored code=${error?.code ?? error?.name ?? "Error"}`);
      return createQuotaPaceState();
    }
  }

  #save() {
    if (!this.statePath) return;
    const directory = path.dirname(this.statePath);
    this.fsImpl.mkdirSync(directory, { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    this.fsImpl.writeFileSync(temporary, `${JSON.stringify(this.state)}\n`, "utf8");
    try {
      this.fsImpl.renameSync(temporary, this.statePath);
    } catch {
      this.fsImpl.copyFileSync(temporary, this.statePath);
      this.fsImpl.unlinkSync(temporary);
    }
  }

  observe(usage) {
    this.usage = usage && typeof usage === "object" ? usage : { status: "unavailable", windows: [] };
    const result = observeQuotaPace(this.state, this.usage, this.now());
    this.state = result.state;
    if (result.changed) {
      try { this.#save(); }
      catch (error) { this.log(`quota pace history save failed code=${error?.code ?? error?.name ?? "Error"}`); }
    }
    return result.changed;
  }

  getState(usage = this.usage) {
    return {
      schema: 1,
      observedAt: this.now(),
      windows: estimateQuotaPace(this.state, usage, this.now()),
    };
  }
}
