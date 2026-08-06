export function createGestureStateToolkit() {
  function createGestureState(input = {}) {
    return {
      ...input,
      startedAt: Number(input.startedAt) || 0,
      x: Number(input.x) || 0,
      y: Number(input.y) || 0,
      cancelled: false,
      held: false,
    };
  }

  function reduceGestureState(current, event = {}, options = {}) {
    if (!current) return null;
    const holdMs = Number(options.holdMs) || 480;
    const slop = Number(options.slop) || 10;
    if (event.type === "cancel") return { ...current, cancelled: true, outcome: "cancelled" };
    if (event.type === "move") {
      const distance = Math.hypot(Number(event.x) - current.x, Number(event.y) - current.y);
      return distance > slop ? { ...current, cancelled: true, outcome: "cancelled" } : current;
    }
    if (event.type === "hold") {
      return current.cancelled ? current : { ...current, held: true, outcome: "hold" };
    }
    if (event.type === "release") {
      if (current.cancelled) return { ...current, outcome: "cancelled" };
      const duration = Number(event.at) - current.startedAt;
      return { ...current, held: current.held || duration >= holdMs, outcome: current.held || duration >= holdMs ? "hold" : "short" };
    }
    return current;
  }

  return { createGestureState, reduceGestureState };
}
