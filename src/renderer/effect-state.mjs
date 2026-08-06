export function createEffectStateToolkit() {
  function createEffectMonitorState() {
    return { monitoring: false, dirty: false, lastClassifiedAt: 0, classifications: 0 };
  }

  function shouldMonitorEffect(input = {}) {
    return input.enabled === true || input.controlsUnlocked === true || input.persistentActive === true;
  }

  function markEffectMonitorDirty(current) {
    const state = current ?? createEffectMonitorState();
    return state.monitoring ? { ...state, dirty: true } : state;
  }

  function reduceEffectMonitorState(current, input = {}) {
    const state = current ?? createEffectMonitorState();
    const monitoring = shouldMonitorEffect(input);
    if (!monitoring) return { state: createEffectMonitorState(), command: "none" };
    const now = Number.isFinite(Number(input.now)) ? Number(input.now) : 0;
    const watchdogMs = Math.min(60000, Math.max(5000, Number(input.watchdogMs) || 12000));
    const dirty = state.dirty || input.invalidated === true;
    const first = state.monitoring !== true || state.lastClassifiedAt <= 0;
    const watchdogDue = !first && now - state.lastClassifiedAt >= watchdogMs;
    if (!first && !dirty && !watchdogDue) return { state: { ...state, monitoring: true }, command: "none" };
    return {
      state: {
        monitoring: true,
        dirty: false,
        lastClassifiedAt: now,
        classifications: state.classifications + 1,
      },
      command: "classify",
    };
  }

  function createEffectState() {
    return { detectedActive: false };
  }

  function reduceEffectState(current, input = {}) {
    const state = current ?? createEffectState();
    const detectedActive = input.detectedActive === true;
    const persistentRequested = String(input.persistentRequested ?? "");
    let command = { type: "none" };

    if (persistentRequested) {
      if (detectedActive) {
        if (!input.persistentActive || input.currentRequested !== persistentRequested || !input.effectPresent) {
          command = { type: "start", variant: persistentRequested, persistent: true };
        }
      } else if (input.persistentActive) command = { type: "clear" };
      return { state: { detectedActive }, command };
    }

    if (input.persistentActive) command = { type: "clear" };
    else if (input.enabled !== true) {
      if (!input.manualProtected) command = { type: "clear" };
      return { state: { detectedActive: false }, command };
    } else if (detectedActive && !state.detectedActive) {
      command = { type: "start", variant: input.variant ?? "menuFire", persistent: false };
    }
    return { state: { detectedActive }, command };
  }

  return {
    createEffectState,
    reduceEffectState,
    createEffectMonitorState,
    shouldMonitorEffect,
    markEffectMonitorDirty,
    reduceEffectMonitorState,
  };
}
