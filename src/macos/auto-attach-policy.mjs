export const MAC_AUTO_ATTACH_IDLE_SECONDS = 30;

export function macAgentResumeDelayMs(failureCount) {
  const failures = Math.max(0, Math.trunc(Number(failureCount) || 0));
  if (failures === 0) return 0;
  return Math.min(30_000, 2_000 * (2 ** Math.min(4, failures - 1)));
}

export function macDiscoveryRetryDelayMs(failureCount) {
  const failures = Math.max(0, Math.trunc(Number(failureCount) || 0));
  if (failures === 0) return 0;
  return Math.min(300_000, 5_000 * (2 ** Math.min(6, failures - 1)));
}

export function macAutoAttachDecision(options = {}) {
  const guardState = String(options.guardState ?? "none");
  const roots = Array.isArray(options.roots) ? options.roots : [];
  const protectedPid = Number(options.protectedPid ?? 0);
  const candidateFresh = options.candidateFresh === true;
  const idleSeconds = Number(options.idleSeconds ?? 0);

  if (roots.length > 1) return guardState === "none" ? "ignore-ambiguous" : "latch";

  if (guardState === "successor-observed") {
    if (roots.length === 1 && Number(roots[0]?.pid) === protectedPid) return "adopt";
    if (roots.length === 0) {
      return idleSeconds >= MAC_AUTO_ATTACH_IDLE_SECONDS ? "rearm" : "wait-idle";
    }
    return "latch";
  }

  if (guardState === "handoff-pending") return "wait-handoff";

  if (guardState === "degraded-latched") {
    if (roots.length === 0) {
      return idleSeconds >= MAC_AUTO_ATTACH_IDLE_SECONDS ? "rearm" : "wait-idle";
    }
    return "stop";
  }

  if (roots.length === 0) return "wait";
  return candidateFresh ? "launch-once" : "ignore-existing";
}

export function macProcessIdentityKey(process = {}) {
  const pid = Number(process.pid ?? 0);
  const startedAt = String(process.startedAt ?? "").trim();
  return pid > 0 && startedAt ? `${pid}:${startedAt}` : "";
}

export function macProcessIdentityMatches(actual = {}, expected = {}) {
  return Number(actual.pid) > 0
    && Number(actual.pid) === Number(expected.pid)
    && String(actual.startedAt ?? "").trim() === String(expected.startedAt ?? "").trim()
    && String(actual.executablePath ?? "") === String(expected.executablePath ?? "");
}
