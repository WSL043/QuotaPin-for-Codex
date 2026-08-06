const LIVE_INPUT_PERMISSION = "--allow-live-input";
const SENSITIVE_CAPTURE_PERMISSION = "--allow-sensitive-capture";

function normalizeModes(modes) {
  return [...new Set((Array.isArray(modes) ? modes : []).filter((mode) => typeof mode === "string" && mode.trim()).map((mode) => mode.trim()))];
}

export function verificationPermissions(argv = []) {
  const values = Array.isArray(argv) ? argv : [];
  return {
    allowLiveInput: values.includes(LIVE_INPUT_PERMISSION),
    allowSensitiveCapture: values.includes(SENSITIVE_CAPTURE_PERMISSION),
  };
}

export function assertVerificationPermissions({
  argv = [],
  liveModes = [],
  sensitiveCapture = false,
} = {}) {
  const permissions = verificationPermissions(argv);
  const requestedLiveModes = normalizeModes(liveModes);

  if (requestedLiveModes.length > 0 && !permissions.allowLiveInput) {
    throw new Error(`This verification changes the live Codex surface (${requestedLiveModes.join(", ")}). Run it only while Codex is idle and the user has explicitly agreed, then add ${LIVE_INPUT_PERMISSION}.`);
  }
  if (sensitiveCapture && !permissions.allowSensitiveCapture) {
    throw new Error(`This verification can capture private Codex task content. Capture only with explicit user approval, then add ${SENSITIVE_CAPTURE_PERMISSION}.`);
  }

  return {
    ...permissions,
    liveModes: requestedLiveModes,
    sensitiveCapture: Boolean(sensitiveCapture),
  };
}
