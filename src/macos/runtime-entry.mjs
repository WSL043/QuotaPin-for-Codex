const AGENT_MODE_ARGUMENT = "--quotapin-agent-runtime";

async function main() {
  const modeIndex = process.argv.indexOf(AGENT_MODE_ARGUMENT);
  if (modeIndex >= 0) {
    process.argv.splice(modeIndex, 1);
    await import("../injector.mjs");
    return;
  }
  await import("./launcher.mjs");
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exit(1);
});
