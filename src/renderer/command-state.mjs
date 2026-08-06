export function createCommandStateToolkit() {
  const physicalDirections = Object.freeze({
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    KeyW: "ArrowUp",
    KeyS: "ArrowDown",
    KeyA: "ArrowLeft",
    KeyD: "ArrowRight",
  });
  const keyDirections = Object.freeze({
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    w: "ArrowUp",
    s: "ArrowDown",
    a: "ArrowLeft",
    d: "ArrowRight",
  });

  function normalizeDirection(input = {}) {
    const code = String(input.code ?? "");
    if (physicalDirections[code]) return physicalDirections[code];
    const key = String(input.key ?? "");
    return keyDirections[key] ?? keyDirections[key.toLowerCase()] ?? null;
  }

  function createCommandState(input = {}) {
    return {
      progress: Math.max(0, Number(input.progress) || 0),
      lastAt: Math.max(0, Number(input.lastAt) || 0),
    };
  }

  function reduceCommandInput(current, input = {}, options = {}) {
    const state = createCommandState(current);
    const sequence = Array.isArray(options.sequence) ? options.sequence.map(String) : [];
    const now = Math.max(0, Number(input.at) || 0);
    const modifier = input.altKey === true && input.ctrlKey !== true && input.metaKey !== true;
    const editable = input.editable === true;
    if (input.repeat === true || input.composing === true || !sequence.length) {
      return { state, key: null, complete: false, consume: false, accepted: false };
    }
    if (editable && !modifier) {
      return { state: createCommandState(), key: null, complete: false, consume: false, accepted: false };
    }
    const key = normalizeDirection(input);
    if (!key) {
      return { state: createCommandState(), key: null, complete: false, consume: false, accepted: false };
    }
    let progress = state.progress;
    if (state.lastAt && now - state.lastAt > (Number(options.timeoutMs) || 1600)) progress = 0;
    progress = key === sequence[progress] ? progress + 1 : key === sequence[0] ? 1 : 0;
    const complete = progress === sequence.length;
    const nextState = complete ? createCommandState() : createCommandState({ progress, lastAt: progress > 0 ? now : 0 });
    return {
      state: nextState,
      key,
      complete,
      accepted: true,
      // Ordinary panel navigation keeps its native behavior. Editable controls
      // require the explicit modifier, in which case every accepted key is
      // consumed so no command characters or cursor moves leak into the field.
      consume: modifier || complete,
    };
  }

  return { createCommandState, normalizeDirection, reduceCommandInput };
}
