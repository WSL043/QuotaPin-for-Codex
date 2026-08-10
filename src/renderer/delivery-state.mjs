export function createDeliveryStateToolkit() {
  function markDeliveryAccepted(runtime = {}, now = Date.now()) {
    const acceptedAt = Number(now);
    const recovered = runtime.stale === true;
    runtime.lastAcceptedAt = Number.isFinite(acceptedAt) ? acceptedAt : Date.now();
    runtime.stale = false;
    if (recovered) runtime.recoveries = Math.max(0, Number(runtime.recoveries) || 0) + 1;
    return recovered;
  }

  function evaluateDeliveryFreshness(runtime = {}, now = Date.now(), staleAfterMs = 45_000) {
    const currentTime = Number(now);
    const acceptedAt = Number(runtime.lastAcceptedAt);
    const threshold = Math.max(1_000, Number(staleAfterMs) || 45_000);
    if (!(Number(runtime.highestSequence) > 0) || !(acceptedAt > 0) || !Number.isFinite(currentTime)) return false;
    if (currentTime - acceptedAt <= threshold || runtime.stale === true) return false;
    runtime.stale = true;
    runtime.staleTransitions = Math.max(0, Number(runtime.staleTransitions) || 0) + 1;
    return true;
  }

  return { markDeliveryAccepted, evaluateDeliveryFreshness };
}
