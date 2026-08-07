export function createSettingsStateToolkit() {
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function applyDraftAction(preferences, action = {}) {
    const current = clone(preferences) ?? null;
    if (!current || !action || typeof action !== "object") return current;
    if (action.type === "selectProfile") {
      if (current.profiles?.some((profile) => profile.id === action.id)) current.activeProfile = action.id;
      return current;
    }
    if (action.type === "updateLocale") {
      current.locale = action.locale;
      return current;
    }
    if (action.type === "updateAccountRowMode") {
      current.accountRowMode = action.mode;
      return current;
    }
    if (action.type === "updateProfile") {
      current.profiles = (current.profiles ?? []).map((profile) =>
        profile.id === action.id ? { ...profile, ...(clone(action.patch) ?? {}), id: profile.id } : profile
      );
      return current;
    }
    if (action.type === "replaceConfig") return clone(action.config) ?? current;
    if (action.type === "addProfile" && (current.profiles?.length ?? 0) < 8) {
      const source = current.profiles?.find((profile) => profile.id === action.fromId)
        ?? current.profiles?.find((profile) => profile.id === current.activeProfile)
        ?? current.profiles?.[0];
      if (!source) return current;
      const added = { ...clone(source), id: String(action.id), name: String(action.name) };
      current.profiles = [...current.profiles, added];
      current.activeProfile = added.id;
      return current;
    }
    if (action.type === "deleteProfile" && (current.profiles?.length ?? 0) > 1) {
      const index = current.profiles.findIndex((profile) => profile.id === action.id);
      if (index < 0) return current;
      current.profiles = current.profiles.filter((profile) => profile.id !== action.id);
      if (current.activeProfile === action.id) current.activeProfile = current.profiles[Math.max(0, index - 1)].id;
      return current;
    }
    if (action.type === "updateThresholds") {
      current.thresholds = { ...(current.thresholds ?? {}), ...(clone(action.patch) ?? {}) };
      return current;
    }
    if (action.type === "updatePalette") {
      current.palette = { ...(current.palette ?? {}), ...(clone(action.patch) ?? {}) };
      return current;
    }
    if (action.type === "updateExperiments") {
      current.experiments = { ...(current.experiments ?? {}), ...(clone(action.patch) ?? {}) };
      return current;
    }
    // resetProfile intentionally waits for the host because shipped defaults
    // belong to the canonical config module, not to the renderer draft.
    return current;
  }

  function replay(committed, pending) {
    return pending.reduce((draft, entry) => applyDraftAction(draft, entry.action), clone(committed));
  }

  function createSettingsState(preferences = null) {
    const committed = clone(preferences);
    return {
      committed,
      draft: clone(committed),
      stagedDraft: null,
      pending: [],
      nextSequence: 1,
      highestAckSequence: 0,
      phase: "idle",
      dirty: false,
      error: null,
      lastAck: null,
    };
  }

  function syncSettingsPreferences(current, preferences) {
    const state = current ?? createSettingsState();
    const committed = clone(preferences);
    const committedChanged = JSON.stringify(committed) !== JSON.stringify(state.committed);
    const hasPending = Boolean(state.pending?.length);
    const hostRecovered = !hasPending && ["host_unavailable", "host_timeout"].includes(state.error?.code);
    return {
      ...state,
      committed,
      draft: replay(state.stagedDraft ?? committed, state.pending ?? []),
      phase: hasPending ? "saving" : (committedChanged || hostRecovered) && state.phase === "error" ? "saved" : state.phase,
      error: !hasPending && (committedChanged || hostRecovered) ? null : state.error,
    };
  }

  function stageSettingsDraft(current, draft) {
    const state = current ?? createSettingsState();
    return {
      ...state,
      draft: replay(draft, state.pending ?? []),
      stagedDraft: clone(draft),
      dirty: true,
      phase: "dirty",
      error: null,
    };
  }

  function discardSettingsDraft(current) {
    const state = current ?? createSettingsState();
    const pending = [...(state.pending ?? [])];
    return {
      ...state,
      draft: replay(state.committed, pending),
      stagedDraft: null,
      dirty: false,
      phase: pending.length ? "saving" : "idle",
      error: null,
    };
  }

  function queueSettingsAction(current, action, now = Date.now()) {
    const state = current ?? createSettingsState();
    const sequence = Number(state.nextSequence) || 1;
    const actionId = "settings-" + Number(now).toString(36) + "-" + sequence.toString(36);
    const entry = { actionId, sequence, action: clone(action) };
    const pending = [...(state.pending ?? []), entry];
    const stagedDraft = clone(state.stagedDraft);
    return {
      actionId,
      message: entry,
      state: {
        ...state,
        draft: replay(stagedDraft ?? state.committed, pending),
        stagedDraft,
        pending,
        dirty: Boolean(stagedDraft),
        nextSequence: sequence + 1,
        phase: "saving",
        error: null,
      },
    };
  }

  function reduceSettingsAck(current, ack) {
    const state = current ?? createSettingsState();
    const actionId = String(ack?.actionId ?? "");
    const matched = (state.pending ?? []).find((entry) => entry.actionId === actionId);
    if (!matched) return state;
    const pending = state.pending.filter((entry) => entry.actionId !== actionId);
    const stale = Number(matched.sequence) < Number(state.highestAckSequence ?? 0);
    const clearAppliedStage = ack?.ok === true && matched.action?.type === "replaceConfig";
    const stagedDraft = clearAppliedStage
      ? null
      : ack?.ok === true && state.stagedDraft
        ? applyDraftAction(state.stagedDraft, matched.action)
        : clone(state.stagedDraft);
    if (stale) {
      return {
        ...state,
        draft: replay(stagedDraft ?? state.committed, pending),
        stagedDraft,
        pending,
        dirty: Boolean(stagedDraft),
        phase: pending.length ? "saving" : state.error ? "error" : stagedDraft ? "dirty" : "saved",
        lastAck: { actionId, ok: ack?.ok === true, stale: true },
      };
    }
    const ok = ack?.ok === true;
    const committed = ok
      ? clone(ack.preferences) ?? applyDraftAction(state.committed, matched.action)
      : clone(state.committed);
    return {
      ...state,
      committed,
      draft: replay(stagedDraft ?? committed, pending),
      stagedDraft,
      pending,
      highestAckSequence: Math.max(Number(state.highestAckSequence ?? 0), Number(matched.sequence) || 0),
      dirty: Boolean(stagedDraft),
      phase: pending.length ? "saving" : !ok ? "error" : stagedDraft ? "dirty" : "saved",
      error: ok ? null : clone(ack?.error) ?? { code: "save_failed", message: "Settings could not be saved." },
      lastAck: { actionId, ok },
    };
  }

  function getSettingsDraft(state) {
    return clone(state?.draft);
  }

  function getRenderableSettings(state) {
    if (!state) return null;
    return replay(state.committed, state.pending ?? []);
  }

  return {
    applyDraftAction,
    createSettingsState,
    syncSettingsPreferences,
    stageSettingsDraft,
    discardSettingsDraft,
    queueSettingsAction,
    reduceSettingsAck,
    getSettingsDraft,
    getRenderableSettings,
  };
}
