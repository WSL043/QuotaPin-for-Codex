export const DEFAULT_MAIN_TARGET_URL = "app://-/index.html";

export class CdpSession {
  constructor(url, targetId, onConfigAction, options = {}) {
    const WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    if (typeof WebSocketImpl !== "function") throw new Error("WebSocket is unavailable");
    this.url = url;
    this.targetId = targetId;
    this.onConfigAction = onConfigAction;
    this.onUpdateAction = options.onUpdateAction;
    this.onClose = options.onClose;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.socket = new WebSocketImpl(url);
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        this.invalidate(new Error("CDP socket open timed out"));
      }, options.openTimeoutMs ?? 5000);
      this.settleReady = settle;
      this.socket.addEventListener("open", () => settle(), { once: true });
    });
    this.socket.addEventListener("error", () => {
      this.invalidate(new Error("CDP socket failed"));
    });
    this.socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.method === "Runtime.bindingCalled" && message.params?.name === "quotapinConfigAction") {
        this.onConfigAction?.(String(message.params.payload), this);
        return;
      }
      if (message.method === "Runtime.bindingCalled" && message.params?.name === "quotapinUpdateAction") {
        this.onUpdateAction?.(String(message.params.payload), this);
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => this.markClosed(new Error("CDP socket closed")));
  }

  markClosed(error = new Error("CDP socket closed")) {
    if (this.closed) return;
    this.closed = true;
    this.settleReady?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose?.(this, error);
  }

  invalidate(error) {
    this.markClosed(error);
    try { this.socket.close(); } catch {}
  }

  isAlive() {
    if (this.closed) return false;
    const readyState = Number(this.socket?.readyState);
    return !Number.isFinite(readyState) || readyState < 2;
  }

  async send(method, params = {}, timeoutMs = 5000) {
    await this.ready;
    if (!this.isAlive()) throw new Error("CDP socket is not open");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`CDP ${method} timed out`);
        reject(error);
        this.invalidate(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
        this.invalidate(error);
      }
    });
  }

  async install(source) {
    await this.send("Runtime.enable");
    await this.send("Runtime.addBinding", { name: "quotapinConfigAction" });
    await this.send("Runtime.addBinding", { name: "quotapinUpdateAction" });
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
    await this.send("Runtime.evaluate", { expression: source });
  }

  async update(state) {
    const serialized = JSON.stringify(state).replaceAll("<", "\\u003c");
    const rendererInstanceId = typeof state?.delivery?.rendererInstanceId === "string"
      ? state.delivery.rendererInstanceId.trim()
      : "";
    if (!rendererInstanceId) return false;
    const result = await this.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const controller = window.__quotaPinController;
        if (!controller || controller.instanceId !== ${JSON.stringify(rendererInstanceId)}) return false;
        return controller.update(JSON.parse(${JSON.stringify(serialized)})) === true;
      })()`,
    });
    return result.result?.value === true;
  }

  async verify() {
    const result = await this.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const badge = document.getElementById("quotapin-inline-badge");
        const rect = badge?.getBoundingClientRect();
        const parentRect = badge?.parentElement?.getBoundingClientRect();
        const menuButtonRects = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
          .map((node) => {
            const value = node.getBoundingClientRect();
            return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
          })
          .filter((value) => value.width > 0 && value.height > 0);
        return {
          controllerVersion: window.__quotaPinController?.version ?? null,
          controllerInstanceId: window.__quotaPinController?.instanceId ?? null,
          deliveryRuntime: window.__quotaPinController?.inspectDeliveryRuntime?.() ?? null,
          badgePresent: Boolean(badge),
          badgeTextPattern: badge?.textContent?.trim().replace(/\\d+/g, "#") ?? null,
          parentTag: badge?.parentElement?.tagName ?? null,
          parentHasMenuPopup: badge?.parentElement?.getAttribute("aria-haspopup") === "menu",
          badgeInsideParent: Boolean(rect && parentRect && rect.left >= parentRect.left && rect.right <= parentRect.right && rect.top >= parentRect.top && rect.bottom <= parentRect.bottom),
          menuButtonRects,
        };
      })()`,
    });
    return result.result.value;
  }

  async cleanup(rendererInstanceId) {
    const expected = typeof rendererInstanceId === "string" ? rendererInstanceId.trim() : "";
    if (!expected) return false;
    const result = await this.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const controller = window.__quotaPinController;
        if (!controller || controller.instanceId !== ${JSON.stringify(expected)}) return false;
        controller.cleanup?.();
        return true;
      })()`,
    });
    return result.result?.value === true;
  }

  close() {
    this.invalidate(new Error("CDP session closed"));
  }
}

export function selectMainTargets(list, mainTargetUrl = DEFAULT_MAIN_TARGET_URL) {
  return (Array.isArray(list) ? list : []).filter((target) =>
    target?.url === mainTargetUrl &&
    typeof target.webSocketDebuggerUrl === "string" &&
    target.webSocketDebuggerUrl.length > 0 &&
    ["page", "webview"].includes(target.type)
  );
}

export async function fetchCdpTargets(port, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}

export class CdpTargetRuntime {
  constructor(options) {
    this.port = options.port;
    this.mainTargetUrl = options.mainTargetUrl ?? DEFAULT_MAIN_TARGET_URL;
    this.installSource = options.installSource;
    this.onConfigAction = options.onConfigAction;
    this.onUpdateAction = options.onUpdateAction;
    this.getClientState = options.getClientState;
    this.reloadConfig = options.reloadConfig ?? (() => {});
    this.log = options.log ?? (() => {});
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.createSession = options.createSession ?? ((url, id, configHandler, updateHandler, onClosed) => new CdpSession(url, id, configHandler, {
      onUpdateAction: updateHandler,
      onClose: onClosed,
    }));
    this.sessions = new Map();
    this.everConnected = false;
    this.deliverySequence = 0;
    this.rendererInstanceId = typeof options.rendererInstanceId === "string"
      ? options.rendererInstanceId.trim()
      : "";
    if (!this.rendererInstanceId) throw new Error("Renderer instance ID is required");
  }

  async sync() {
    const list = await fetchCdpTargets(this.port, this.fetchImpl);
    const mainTargets = selectMainTargets(list, this.mainTargetUrl);
    let attached = false;
    for (const target of mainTargets) {
      const current = this.sessions.get(target.id);
      const currentAlive = current && (typeof current.isAlive !== "function" || current.isAlive() !== false);
      const currentEndpoint = typeof current?.url === "string" ? current.url : target.webSocketDebuggerUrl;
      if (currentAlive && currentEndpoint === target.webSocketDebuggerUrl) continue;
      if (current) {
        this.sessions.delete(target.id);
        current.close();
        this.log(`discarded unusable main target session id=${target.id}`);
      }
      const onClosed = (closedSession) => {
        if (this.sessions.get(target.id) !== closedSession) return;
        this.sessions.delete(target.id);
        this.log(`detached closed main target id=${target.id}`);
      };
      const session = this.createSession(
        target.webSocketDebuggerUrl,
        target.id,
        this.onConfigAction,
        this.onUpdateAction,
        onClosed,
      );
      try {
        await session.install(this.installSource);
        if (typeof session.isAlive === "function" && session.isAlive() === false) {
          throw new Error("CDP session closed during installation");
        }
      } catch (error) {
        session.close();
        throw error;
      }
      this.sessions.set(target.id, session);
      this.everConnected = true;
      attached = true;
      this.log(`attached main target id=${target.id}`);
    }
    const ids = new Set(mainTargets.map((target) => target.id));
    for (const [id, session] of this.sessions) {
      if (ids.has(id)) continue;
      session.close();
      this.sessions.delete(id);
    }
    const configChanged = this.reloadConfig() === true;
    if (attached || configChanged) {
      await this.updateAll(this.getClientState(), attached ? "attach" : "config-reload");
    }
  }

  deliveredState(state, reason = "runtime") {
    this.deliverySequence += 1;
    return {
      ...(state && typeof state === "object" ? state : {}),
      delivery: {
        rendererInstanceId: this.rendererInstanceId,
        sequence: this.deliverySequence,
        reason: String(reason || "runtime").slice(0, 32),
        createdAt: Date.now(),
      },
    };
  }

  updateAll(state, reason = "runtime") {
    const delivered = this.deliveredState(state, reason);
    return Promise.allSettled([...this.sessions.values()].map((session) => session.update(delivered)));
  }

  broadcast(state, reason = "runtime") {
    this.updateAll(state, reason).catch(() => {});
  }

  firstSession() {
    return this.sessions.values().next().value ?? null;
  }

  async cleanupAll() {
    return Promise.allSettled([...this.sessions.values()].map((session) => session.cleanup(this.rendererInstanceId)));
  }

  close() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}

export async function runRendererCleanup(options) {
  const list = await fetchCdpTargets(options.port, options.fetchImpl ?? globalThis.fetch);
  const mainTargets = selectMainTargets(list, options.mainTargetUrl ?? DEFAULT_MAIN_TARGET_URL);
  if (!mainTargets.length) return false;
  const createSession = options.createSession ?? ((url, id) => new CdpSession(url, id, null));
  let succeeded = false;
  for (const target of mainTargets) {
    const session = createSession(target.webSocketDebuggerUrl, target.id);
    try {
      await session.send("Runtime.enable");
      await session.send("Runtime.evaluate", {
        expression: "window.__quotaPinController?.cleanup?.(); true",
      });
      succeeded = true;
    } finally {
      session.close();
    }
  }
  return succeeded;
}
