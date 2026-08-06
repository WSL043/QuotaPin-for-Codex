# macOS port kit

This is an implementation playbook, not a support claim. No macOS build is marked compatible until a real Mac produces the evidence below.

## Reuse unchanged

- `src/core/model.mjs`
- `src/core/config.mjs`
- `src/core/format.mjs`
- App Server initialization, `account/rateLimits/read`, and sparse update handling
- privacy, fail-closed matching, native-feature suppression, and uninstall rules

The documented Codex App Server protocol is platform-neutral. The host launcher and DOM evidence are not.

## Discover before implementing

On the test Mac, record without exposing account data:

1. macOS version and architecture;
2. Codex app version, bundle identifier, and executable path;
3. whether the packaged app honors a loopback-only remote-debugging argument when launched cleanly;
4. the exact main target URL and target type returned by the debugging endpoint;
5. account-row geometry and stable accessibility/test attributes;
6. whether an existing normal Codex instance must be closed before the debug-enabled instance starts;
7. code-signing, quarantine, Gatekeeper, and uninstall behavior for the proposed helper.

Do not infer any of these from Windows.

## Developer implementation

The repository now contains an intentionally limited developer path:

1. `src/macos/launcher-runtime.mjs` discovers both the current `ChatGPT.app` name and legacy `Codex.app` name, then requires one unambiguous bundle with identifier `com.openai.codex`. The App Server command must remain inside that exact bundle.
2. Before launch, `QuotaPin.Mac.Dev` requires a strict-valid Apple code signature and the official OpenAI signing Team ID. It refuses to close an existing Codex process, launches one clean instance on an ephemeral loopback debugging port, and accepts only a renderer receipt matching the launch generation, Agent PID, and port.
3. `scripts/macos/build-dev.sh` builds ad-hoc-signed self-contained Agent and launcher executables using Node SEA on a macOS runner.
4. `scripts/macos/install-dev.sh` copies the preview into the normal per-user Application Support location. It does not register a login item.
5. A successful attach writes a local receipt containing the verified bundle identity, generation, port, and Agent PID. `scripts/macos/uninstall-dev.sh` stops only the recorded Agent whose command remains under the QuotaPin install root, then removes QuotaPin-owned files.

GitHub Actions uploads this as a short-lived commit artifact, never as a GitHub Release. A signed helper app and opt-in login integration remain later decisions after the foreground path works on real hardware.

The downloaded developer artifact is self-contained and does not require Node.js on the test Mac. Building the artifact from source uses the repository's pinned Node toolchain. Report real-device results through the sanitized [macOS compatibility form](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=macos-compatibility.yml); a successful CI build alone is not compatibility evidence.

The first prototype should not add a menu-bar app merely because macOS has a menu bar. Placement inside Codex remains the point.

## Required evidence

- clean launch without elevated privilege;
- debugging listener bound only to loopback;
- App Server returns a sanitized window count and labels;
- unique account-row match;
- badge geometry remains inside the row at two window sizes;
- saved view, language, and appearance preferences persist across restart;
- normal Codex launch remains unmodified;
- uninstall removes the helper, preferences, and any login registration;
- at least one current Intel/Apple Silicon architecture is explicitly recorded, never implied.

Only after those checks pass should `docs/compatibility.md` gain a macOS row.

Apple documents [user-managed login items](https://support.apple.com/guide/mac-help/open-items-automatically-when-you-log-in-mh15189/mac) and the [`SMAppService` framework for bundled helpers](https://support.apple.com/guide/deployment/manage-login-items-and-background-tasks-depdca572563/web). Neither is necessary for the first foreground prototype.
