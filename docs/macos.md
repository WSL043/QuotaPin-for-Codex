# QuotaPin for macOS

QuotaPin 1.3.0 includes the public macOS 13+ delivery path. It installs a thin native host plus an integrity-bound QuotaPin payload and uses the signed Node runtime already inside official Codex; nothing is injected into or copied out of the Codex application. GitHub Actions validates the offline package lifecycle on native Apple silicon and Intel runners; launch through official Codex, the account-row adapter, and Gatekeeper behavior still need evidence from a signed-in Mac before macOS can be listed as fully supported.

## What is implemented

- Native arm64 and x86_64 slices of a thin host that verifies the adjacent QuotaPin payload and the official Codex runtime before dispatch.
- One universal package assembled from both independently tested slices.
- Installation under `~/Library/Application Support/QuotaPin` without `sudo`, Homebrew, or a separately installed Node.js. QuotaPin does not download a fallback runtime.
- A user LaunchAgent at `~/Library/LaunchAgents/io.github.wsl043.quotapin.plist`.
- Normal launching from the official Codex icon. The watcher ignores a Codex session that was already open during install or update.
- A single generation-bound handoff for a fresh uninstrumented launch. PID, process start time, official bundle identifier, OpenAI Team ID, Agent PID, loopback port, and renderer receipt must all agree.
- A circuit breaker: a failed or ambiguous handoff is latched and is never retried while Codex remains open. QuotaPin does not force-quit Codex.
- Bounded Agent supervision after a successful handoff. If the Agent exits while the exact Codex PID, start time, generation, and loopback target still agree, the watcher resumes it without reopening Codex.
- Transactional reinstall/update with configuration and runtime receipt preservation.
- Exact-identity Agent shutdown and complete QuotaPin removal on uninstall.

The normal installer discovers one official app in `/Applications` or the current user's `Applications` directory, then falls back to Spotlight lookup by bundle identifier. A saved path that disappeared after an app rename does not block rediscovery. If two valid installations are present, pass `--codex-app /exact/path/Codex.app`; that selection is stored in the per-user install state and survives updates while it remains valid.

The official app must have bundle identifier `com.openai.codex`. The application, its main executable, and `Contents/Resources/cua_node/bin/node` must each have a strict-valid signature from Team ID `2DC432GLL2`; the runtime must be Node.js 20 or later. The App Server executable must resolve inside that same bundle. CDP binds to `127.0.0.1` on a fresh ephemeral port.

## Build and lifecycle verification

On macOS with the repository's pinned toolchain:

```bash
npm ci
./scripts/macos/build.sh
./scripts/macos/test-lifecycle.sh dist/macos-native
```

GitHub Actions runs the offline lifecycle independently on Apple silicon and Intel runners: build, host signature and payload-integrity checks, install, staged LaunchAgent validation, same-version update, rollback, configuration preservation, and uninstall. A second job combines the two verified host slices into `QuotaPin-macOS-VERSION.dmg`, containing a double-clickable `QuotaPin Installer.app`. GitHub validates the artifact digest when the image moves between jobs, then fresh macOS 15 and macOS 26 runners on both architectures independently mount and exercise that exact final image again. Those runners do not contain official Codex, so they cannot replace the signed-in real-Mac runtime test.

Development candidates are short-lived Actions artifacts. They are not GitHub Releases and do not enter the stable update channel. The stable remote bootstrap in `install-macos.sh` accepts only an immutable published release, verifies GitHub's SHA-256 digest, mounts the image read-only, validates the app bundle, and runs its embedded installer payload.

The three delivery paths are intentionally one implementation:

```bash
# Remote install or update from the latest stable cross-platform release
curl -fsSL https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install-macos.sh | bash

# Full removal
"$HOME/Library/Application Support/QuotaPin/uninstall.sh"
```

People who do not use Terminal download `QuotaPin-macOS-VERSION.dmg`, open the read-only image, and double-click `QuotaPin Installer.app`. Both paths install the same digest-bound payload. The DMG is ad-hoc signed rather than Developer ID notarized; CI therefore proves package integrity and lifecycle behavior, not the exact Gatekeeper prompt on a downloaded real-device copy.

## Real-Mac acceptance still required

Before marking a Codex/macOS combination supported, record sanitized evidence for:

1. current macOS version and architecture;
2. current Codex version, bundle identity, Team ID, and installed path;
3. a normal official-icon launch followed by exactly one bounded handoff;
4. a loopback-only debugging listener and a real App Server quota read;
5. a unique account-row match and badge geometry at two window widths;
6. short press, hold, outside-click close, and module dragging;
7. saved settings after a complete Codex quit and reopen;
8. update without interrupting an already-running session;
9. Gatekeeper behavior for the delivered package;
10. complete uninstall with the official Codex app unchanged.

Submit only sanitized results through the [macOS compatibility form](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=macos-compatibility.yml). Never include account identity, task content, credentials, private paths, or an unedited screenshot.
