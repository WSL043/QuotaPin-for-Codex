const recipeFields = new Set([
  "schemaVersion",
  "id",
  "name",
  "target",
  "primitive",
  "mode",
  "durationMs",
  "fps",
  "intensity",
  "palette",
]);
const recipeTargets = new Set(["quota", "sidebar"]);
const recipePrimitives = new Set(["color-cycle", "pixel-field", "pulse"]);
const recipeModes = new Set(["once", "while-condition"]);
const blockedKey = /(?:script|javascript|html|selector|query|url|uri|network|fetch|xhr|websocket|socket|file|path|command|exec|shell|css|style|src|href)/i;
const blockedString = /(?:<[^>]*>|\b(?:javascript|data|file|https?|wss?):|(?:^|[\s"'])(?:[a-z]:\\|\\\\|\.{0,2}\/))/i;
const hexColor = /^#[0-9a-f]{6}$/i;

export function classifyOverdrive({
  selectedText = "",
  selectedEffort = "",
  fastIndicator = false,
  ultraEffortIndicator = false,
} = {}) {
  const text = String(selectedText);
  const model = /5\.6\s*sol/i.test(text);
  const effort = String(selectedEffort).toLowerCase();
  const ultra = effort === "ultra"
    || Boolean(ultraEffortIndicator);
  const fast = Boolean(fastIndicator);
  return {
    active: model && ultra && fast,
    model,
    ultra,
    fast,
    selectedText: text,
    selectedEffort: String(selectedEffort),
    effortCode: effort,
    fastIndicator: Boolean(fastIndicator),
    ultraEffortIndicator: Boolean(ultraEffortIndicator),
  };
}

export function persistentEffectPolicy(settings = {}, detected = {}) {
  if (settings.persistWhileCondition !== true || detected.active !== true) return "";
  return typeof settings.effectId === "string" && settings.effectId ? settings.effectId : "random";
}

function normalizeHandle(result) {
  if (typeof result === "function") return Object.freeze({ stop: result });
  if (!result || typeof result !== "object" || typeof result.stop !== "function") return null;
  return result;
}

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("effect definition must be an object");
  const id = String(definition.id ?? "");
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || id === "random") throw new TypeError("effect id is invalid");
  if (typeof definition.start !== "function") throw new TypeError(`effect ${id} must provide start()`);
  return Object.freeze({
    id,
    supportsPersistent: definition.supportsPersistent === true,
    start: definition.start,
  });
}

export function createEffectRegistry(definitions = []) {
  const entries = new Map();
  for (const candidate of definitions) {
    const definition = normalizeDefinition(candidate);
    if (entries.has(definition.id)) throw new TypeError(`duplicate effect id: ${definition.id}`);
    entries.set(definition.id, definition);
  }
  const ids = Object.freeze([...entries.keys()]);
  return Object.freeze({
    ids,
    has(id) {
      return entries.has(String(id));
    },
    get(id) {
      return entries.get(String(id)) ?? null;
    },
  });
}

function selectedDefinition(registry, requestedId, random) {
  if (!registry?.ids?.length) return null;
  if (requestedId !== "random" && registry.has(requestedId)) return registry.get(requestedId);
  if (requestedId !== "random") return null;
  const sample = Math.min(.999999999, Math.max(0, Number(random?.()) || 0));
  return registry.get(registry.ids[Math.floor(sample * registry.ids.length)]);
}

export function startRegisteredEffect(registry, requestedId, context = {}, {
  fallbackId = "",
  random = Math.random,
  persistent = false,
} = {}) {
  const requested = typeof requestedId === "string" && requestedId ? requestedId : "random";
  const first = selectedDefinition(registry, requested, random);
  const fallback = registry?.get?.(fallbackId) ?? null;
  const attempted = new Set();
  const errors = [];
  for (const definition of [first, fallback]) {
    if (!definition || attempted.has(definition.id)) continue;
    attempted.add(definition.id);
    if (persistent && !definition.supportsPersistent) continue;
    try {
      const handle = normalizeHandle(definition.start(context, { persistent }));
      if (handle) return { requested, actual: definition.id, handle, errors };
    } catch (error) {
      errors.push(String(error?.message ?? error).slice(0, 160));
    }
  }
  return { requested, actual: "", handle: null, errors };
}

export function decideEffectReconciliation({
  enabled = false,
  persistent = false,
  conditionActive = false,
  hasInstance = false,
  badgeConnected = false,
  surfaceConnected = false,
  artifactConnected = false,
  requestedId = "",
  runningRequestedId = "",
} = {}) {
  const shouldRun = enabled && (!persistent || conditionActive);
  if (!shouldRun) return hasInstance ? "stop" : "none";
  if (!badgeConnected) return hasInstance ? "stop" : "none";
  if (!hasInstance) return "start";
  if (persistent && requestedId !== runningRequestedId) return "restart";
  if (!surfaceConnected || !artifactConnected) return persistent ? "restart" : "stop";
  return "keep";
}

function unsafeValue(value, trail, errors, seen) {
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(`${trail} contains executable or unsupported data`);
    return;
  }
  if (typeof value === "string" && blockedString.test(value)) errors.push(`${trail} contains markup, a URL, or a file path`);
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    errors.push(`${trail} contains a cycle`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => unsafeValue(item, `${trail}[${index}]`, errors, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (blockedKey.test(key)) errors.push(`${trail}.${key} is not allowed`);
      unsafeValue(item, `${trail}.${key}`, errors, seen);
    }
  }
  seen.delete(value);
}

function inRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function validateEffectRecipe(input) {
  const errors = [];
  let source = input;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return { ok: false, value: null, errors: ["recipe is not valid JSON"] };
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, value: null, errors: ["recipe must be an object"] };
  }
  unsafeValue(source, "recipe", errors, new Set());
  for (const key of Object.keys(source)) {
    if (!recipeFields.has(key)) errors.push(`unknown field: ${key}`);
  }
  if (source.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(source.id ?? ""))) errors.push("id must be a short lowercase slug");
  if (typeof source.name !== "string" || !source.name.trim() || source.name.length > 48) errors.push("name must contain 1 to 48 characters");
  if (!recipeTargets.has(source.target)) errors.push("target is not supported");
  if (!recipePrimitives.has(source.primitive)) errors.push("primitive is not supported");
  if (!recipeModes.has(source.mode)) errors.push("mode is not supported");
  if (!inRange(source.durationMs, 400, 5000)) errors.push("durationMs must be between 400 and 5000");
  if (!inRange(source.fps, 4, 15)) errors.push("fps must be between 4 and 15");
  if (!inRange(source.intensity, 0, 1)) errors.push("intensity must be between 0 and 1");
  if (!Array.isArray(source.palette) || source.palette.length < 1 || source.palette.length > 8 || source.palette.some((item) => !hexColor.test(String(item)))) {
    errors.push("palette must contain 1 to 8 six-digit hex colors");
  }
  if (errors.length) return { ok: false, value: null, errors: [...new Set(errors)] };
  const value = Object.freeze({
    schemaVersion: 1,
    id: source.id,
    name: source.name.trim(),
    target: source.target,
    primitive: source.primitive,
    mode: source.mode,
    durationMs: source.durationMs,
    fps: source.fps,
    intensity: source.intensity,
    palette: Object.freeze(source.palette.map((item) => String(item).toLowerCase())),
  });
  return { ok: true, value, errors: [] };
}

export function compileEffectRecipe(input, primitiveRegistry = {}) {
  const validated = validateEffectRecipe(input);
  if (!validated.ok) return { ok: false, definition: null, errors: validated.errors };
  const recipe = validated.value;
  const primitive = primitiveRegistry?.[recipe.primitive];
  if (typeof primitive !== "function") {
    return { ok: false, definition: null, errors: [`primitive is unavailable: ${recipe.primitive}`] };
  }
  const definition = normalizeDefinition({
    id: recipe.id,
    supportsPersistent: recipe.mode === "while-condition",
    start(context, options) {
      const target = context?.resolveTarget?.(recipe.target);
      if (!target) return null;
      return primitive({ target, recipe, persistent: options.persistent === true });
    },
  });
  return { ok: true, definition, recipe, errors: [] };
}
