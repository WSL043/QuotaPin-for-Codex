import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BUNDLE_NAMES = ["ChatGPT.app", "Codex.app"];
export const OFFICIAL_CODEX_BUNDLE_ID = "com.openai.codex";
export const OFFICIAL_OPENAI_TEAM_ID = "2DC432GLL2";
export const OFFICIAL_CODEX_NODE_SUFFIX = ["Contents", "Resources", "cua_node", "bin", "node"];
const COMMAND_SUFFIXES = [
  ["Contents", "Resources", "app", "bin", "codex"],
  ["Contents", "Resources", "bin", "codex"],
  ["Contents", "Resources", "codex"],
  ["Contents", "MacOS", "codex"],
];

function uniqueRealPaths(values, fsImpl) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value || !fsImpl.existsSync(value)) continue;
    const real = fsImpl.realpathSync(value);
    if (seen.has(real)) continue;
    seen.add(real);
    result.push(real);
  }
  return result;
}

export function defaultCodexBundleCandidates(options = {}) {
  const home = options.home ?? os.homedir();
  const names = options.names ?? DEFAULT_BUNDLE_NAMES;
  return names.flatMap((name) => [
    path.join("/Applications", name),
    path.join(home, "Applications", name),
  ]);
}

export function resolveCodexBundle(options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const override = options.override ?? options.env?.QUOTAPIN_CODEX_APP ?? "";
  const candidates = override
    ? [path.resolve(override)]
    : (options.candidates ?? defaultCodexBundleCandidates(options));
  const matches = uniqueRealPaths(candidates, fsImpl).filter((candidate) => candidate.toLowerCase().endsWith(".app"));
  if (matches.length === 0) throw new Error("Codex.app was not found. Pass --codex-app with its exact path.");
  if (matches.length > 1) throw new Error("More than one Codex.app was found. Pass --codex-app to choose one explicitly.");
  return matches[0];
}

export function isPathInsideBundle(bundlePath, candidatePath, pathImpl = path) {
  const relative = pathImpl.relative(bundlePath, candidatePath);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(relative);
}

export function resolveCodexCommand(bundlePath, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const override = options.override ?? options.env?.QUOTAPIN_CODEX_COMMAND ?? "";
  const resolvedBundle = fsImpl.existsSync(bundlePath) ? fsImpl.realpathSync(bundlePath) : bundlePath;
  const candidates = override
    ? [path.resolve(override)]
    : COMMAND_SUFFIXES.map((segments) => path.join(resolvedBundle, ...segments));
  const matches = uniqueRealPaths(candidates, fsImpl).filter((candidate) => {
    if (!isPathInsideBundle(resolvedBundle, candidate)) return false;
    try {
      fsImpl.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (matches.length === 0) {
    throw new Error("The Codex app-server executable was not found inside Codex.app. Pass --codex-command after inspecting the current bundle.");
  }
  if (matches.length > 1) {
    throw new Error("More than one Codex app-server executable was found. Pass --codex-command to choose one explicitly.");
  }
  return matches[0];
}

export function resolveCodexNodeRuntime(bundlePath, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const resolvedBundle = fsImpl.existsSync(bundlePath) ? fsImpl.realpathSync(bundlePath) : bundlePath;
  const candidate = path.join(resolvedBundle, ...OFFICIAL_CODEX_NODE_SUFFIX);
  if (!fsImpl.existsSync(candidate)) {
    throw new Error("The signed Node.js runtime bundled with official Codex was not found; QuotaPin does not download or substitute a runtime.");
  }
  const resolved = fsImpl.realpathSync(candidate);
  if (!isPathInsideBundle(resolvedBundle, resolved)) {
    throw new Error("The Codex Node.js runtime resolves outside the official application bundle");
  }
  try {
    fsImpl.accessSync(resolved, fs.constants.X_OK);
  } catch {
    throw new Error("The signed Node.js runtime bundled with official Codex is not executable");
  }
  return resolved;
}

export function codexOpenArguments(bundlePath, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("A valid unprivileged debugging port is required");
  return [
    "-na",
    bundlePath,
    "--args",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ];
}

export function validateOfficialCodexIdentity(identity = {}, options = {}) {
  const bundleIdentifier = String(identity.bundleIdentifier ?? "").trim();
  const teamIdentifier = String(identity.teamIdentifier ?? "").trim();
  const expectedBundleIdentifier = options.bundleIdentifier ?? OFFICIAL_CODEX_BUNDLE_ID;
  const expectedTeamIdentifier = options.teamIdentifier ?? OFFICIAL_OPENAI_TEAM_ID;
  if (identity.signatureValid !== true) throw new Error("Codex.app does not have a valid strict code signature");
  if (bundleIdentifier !== expectedBundleIdentifier) throw new Error(`Unexpected Codex bundle identifier: ${bundleIdentifier || "missing"}`);
  if (teamIdentifier !== expectedTeamIdentifier) throw new Error(`Unexpected Codex signing team: ${teamIdentifier || "missing"}`);
  return { bundleIdentifier, teamIdentifier, signatureValid: true };
}

export function validateOfficialCodexRuntimeIdentity(identity = {}, options = {}) {
  const expectedTeamIdentifier = options.teamIdentifier ?? OFFICIAL_OPENAI_TEAM_ID;
  const checks = [
    ["application", identity.app],
    ["main executable", identity.executable],
    ["Node.js runtime", identity.node],
  ];
  for (const [label, value] of checks) {
    if (value?.signatureValid !== true) throw new Error(`The official Codex ${label} does not have a valid strict code signature`);
    const teamIdentifier = String(value?.teamIdentifier ?? "").trim();
    if (teamIdentifier !== expectedTeamIdentifier) {
      throw new Error(`Unexpected Codex ${label} signing team: ${teamIdentifier || "missing"}`);
    }
  }
  return { teamIdentifier: expectedTeamIdentifier, signatureValid: true };
}

export function matchesRendererReceipt(value, expected = {}) {
  return value?.schema === 1
    && value?.state === "renderer-attached"
    && String(value?.generation ?? "") === String(expected.generation ?? "")
    && Number(value?.agentPid) === Number(expected.agentPid)
    && Number(value?.port) === Number(expected.port);
}

export function macosInstallRoot(options = {}) {
  const home = options.home ?? os.homedir();
  return path.join(home, "Library", "Application Support", "QuotaPin");
}

export function macosLaunchPlan(options = {}) {
  const bundlePath = resolveCodexBundle({ ...options, override: options.bundleOverride ?? options.override });
  const commandPath = resolveCodexCommand(bundlePath, {
    ...options,
    override: options.commandOverride ?? options.env?.QUOTAPIN_CODEX_COMMAND ?? "",
  });
  const port = Number(options.port);
  return {
    bundlePath,
    commandPath,
    port,
    openArguments: codexOpenArguments(bundlePath, port),
    installRoot: options.installRoot ?? macosInstallRoot(options),
  };
}
