import fs from "node:fs";
import { createEffectStateToolkit } from "../src/renderer/effect-state.mjs";
import { createGestureStateToolkit } from "../src/renderer/gesture-state.mjs";
import { createLayoutStateToolkit } from "../src/renderer/layout-state.mjs";
import { createSettingsStateToolkit } from "../src/renderer/settings-state.mjs";

const toolkits = {
  createEffectStateToolkit,
  createGestureStateToolkit,
  createLayoutStateToolkit,
  createSettingsStateToolkit,
};

export function loadRendererSource() {
  const source = fs.readFileSync(new URL("../src/injector.mjs", import.meta.url), "utf8");
  const match = source.match(/const installScript = String\.raw`([\s\S]*?)`;\s*\r?\n\r?\nif \(rendererSelfTest\)/);
  if (!match) throw new Error("Could not locate the injected renderer script");

  let renderer = match[1];
  for (const [name, toolkit] of Object.entries(toolkits)) {
    renderer = renderer.replaceAll(`\${${name}.toString()}`, toolkit.toString());
  }
  if (/\$\{create[A-Za-z]+StateToolkit\.toString\(\)\}/.test(renderer)) {
    throw new Error("An embedded renderer toolkit was not expanded");
  }
  return renderer;
}
