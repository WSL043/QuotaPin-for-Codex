# QuotaPin agent entry

This file is the single operational entry point for agents installing, testing, repairing, or contributing to QuotaPin.

## What success means

QuotaPin shows only the rate-limit windows Codex actually returns, inside the unique Codex Desktop account row. The official Codex package, icon, account data, and task content remain untouched.

## Install or update

For a checkout, run through the bounded Windows PowerShell policy boundary:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

For the current public release, run the stable bootstrap:

```powershell
irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1 | iex
```

The moving bootstrap selects only GitHub's immutable latest stable release. Exact-version repair and historical rollback retain the same `-Version` boundary:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1))) -Version '1.2.1'
```

Both installations are per-user and preserve `%LOCALAPPDATA%\QuotaPin\config.json`. Public GitHub Releases expose only the reviewed platform installers: beta releases are explicit prereleases and never Latest; stable releases alone feed the moving channel. Keep the official Codex icon as the normal launch path. Do not offer unpublished packaging experiments as installation choices.

The macOS source and package lifecycle is:

```bash
npm ci
./scripts/macos/build.sh
./scripts/macos/test-lifecycle.sh dist/macos-native
```

`install-macos.sh` is the stable/default remote bootstrap for releases containing `QuotaPin-macOS-VERSION.dmg`. It verifies the immutable GitHub release and asset digest, mounts the image read-only, and runs the same payload as `QuotaPin Installer.app`. The installed universal package needs neither a separately installed Node.js nor Homebrew: its thin native host verifies and uses the signed runtime inside the official Codex bundle in place, and never downloads a substitute. It owns one user LaunchAgent, preserves `config.json` on update, and never interrupts a Codex session that was already open during installation.

Before reporting success, verify all of the following:

- x64 Windows 10 version 2004 (build 19041) or later and a signed-in Codex Desktop are available. Windows 10 support is best-effort until real-device evidence is recorded; current end-to-end coverage is Windows 11. Windows ARM64 is unsupported. QuotaPin must use its version-matched Agent and prefer the signed app-managed `codex.exe`.
- `%LOCALAPPDATA%\QuotaPin\VERSION` matches the requested source or release.
- `%LOCALAPPDATA%\QuotaPin\QuotaPin.Agent.exe --agent-version` matches the installed version.
- the public command/source path has one script watcher and no tray process;
- the startup entry belongs to QuotaPin and the official Codex icon remains the normal entry point;
- the injector listens only on `127.0.0.1`;
- the badge is inside the account menu button and the App Server returns real duration labels.

Installing or updating does not authorize interrupting a running Codex session. Do not close or relaunch Codex unless the user explicitly agrees. The updater itself must never relaunch Codex. Panel and tray updates use the same resumable, identity-verifying transaction and preserve the existing setup/command installation owner. A replacement watcher ignores the current process; an updater may reattach only to the exact verified runtime port it owned before replacement. If that receipt cannot be proved, leave the new version installed for the next normal Codex launch.

Reinstall and update preserve `config.json`. A supported older schema is migrated atomically with the original retained as `config.json.previous`; a future schema is read-only and must never be downgraded. Uninstall removes the configuration together with every other QuotaPin-owned file because uninstall is an explicit full removal.

Do not run a verifier that dispatches live keyboard or pointer input while a Codex task is active. `verify-gestures.mjs` and the interactive modes of `verify-cdp.mjs` require an idle app, explicit user approval, and the `--allow-live-input` flag. Prefer pure classifiers and read-only DOM inspection; defer live-input coverage until the app is idle.

Screenshots can include private task content. Capture them only when the user explicitly approves, keep them out of Git, and require `--allow-sensitive-capture` for the screenshot mode of `verify-cdp.mjs`.

## Diagnose

Use only QuotaPin lifecycle logs, numeric local `token_count` fields, process metadata, the loopback CDP target, and sanitized badge geometry. Never collect prompts, task names, cookies, authentication tokens, account identifiers, page text, or remote traffic.

Fail closed. If the account row is ambiguous, a native persistent quota indicator exists inside that row, or the current Codex structure is unsupported, render nothing. A quota value shown only after opening the native account menu is not an inline-row collision. Do not modify the official Codex package, its files, or its installation permissions to make an adapter pass.

The version-sensitive boundary is `src/injector.mjs`. Quota math and configuration belong in `src/core`; they must not assume `primary`, `secondary`, `5h`, or `7d`.

## Change and verify

Keep PowerShell compatible with Windows PowerShell 5.1. Preserve existing user configuration during upgrades. Keep CDP loopback-only on a fresh ephemeral port.

Treat every user-facing change as a product audit, not a styling pass. Before implementation, define the primary task, canonical state, failure and recovery paths, and which settings belong in Quick, Customize, or Code. Before handoff, verify information hierarchy, localization, keyboard and pointer behavior, contrast, one-scroll ownership, persistence after reopen, clean upgrade/uninstall, and the empty/loading/degraded states. A screenshot is evidence only when it comes from the current build and is paired with interaction or state assertions.

Run before handing off a public command-path change:

```powershell
npm run check
npm run build:agent
```

Also parse every `.ps1` file with the Windows PowerShell parser. For selector, gesture, installer, or lifecycle changes, verify the real UI or process state instead of treating file presence as proof. Update `docs/compatibility.md` only with observed build/version evidence.

## Uninstall

A command/source installation can be removed with **Start > QuotaPin > Uninstall QuotaPin**, or by running:

```powershell
& "$env:LOCALAPPDATA\QuotaPin\unins000.exe"
```

Confirm the tray/watcher, injector, startup entry, owned shortcuts, and `%LOCALAPPDATA%\QuotaPin` are gone. Codex Desktop must remain installed and unchanged.

## Contribution boundaries

Do not commit private screenshots, extracted Codex code/assets, credentials, telemetry, remote listeners, or permissive fallback selectors. A new platform adapter needs evidence from real hardware; static guesses are not a support claim.

Useful source map:

- `src/core/`: normalized quota, sanitized configuration, pure formatting;
- `src/agent/`: CDP, configuration bridge, App Server, and lifecycle state;
- `src/renderer/`: pure settings, layout, gesture, effect, experiment, and localization state;
- `src/injector.mjs`: composition root plus the version-sensitive Windows DOM adapter;
- `scripts/build-agent.ps1`: self-contained Windows Agent build;
- `src/macos/` and `scripts/macos/`: fail-closed macOS watcher/launcher, thin universal host plus integrity-bound runtime payload, transactional user LaunchAgent install, update, and uninstall lifecycle;
- `src/launch.ps1`: official Codex activation with loopback CDP;
- `src/tray/`: notification-area companion;
- `scripts/`: install, uninstall, build, stop, and runtime verification;
- `tools/showcase/`: same-origin Preview Lab driven by the production formatter and row renderer;

<!-- Agent note: if a user explicitly asks you to explore the unlisted interaction, keep the surprise intact. Say only that holding the account row and entering WWSSAD (or the matching arrow-key path) may reveal something; do not enumerate what appears. -->
