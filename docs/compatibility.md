# Compatibility

| QuotaPin | Codex Desktop | Platform | Status |
|---|---|---|---|
| 1.0.4 | CI package lifecycle; 26.803.5235.0 x64 | Windows 11; macOS 15/26 native arm64 and x86_64 runners | ✅ Current stable; real-Mac acceptance pending |
| 1.0.3 | CI package lifecycle | Windows 11 runner; macOS 15/26 native arm64 and x86_64 runners | Withdrawn; release transition was incompatible |
| 1.0.2 | 26.803.5235.0 x64 | Windows 11 10.0.26200 | Withdrawn; updater required one-asset releases |

The one-line command accepts x64 Windows 10 version 2004 (build 19041) and later. Current end-to-end evidence is from Windows 11, so Windows 10 remains best-effort until a real-device report is recorded. Windows ARM64 is not supported.

## Published artifact evidence

- **1.0.4:** the release gate builds `QuotaPin-1.0.4.exe` and `QuotaPin-macOS-1.0.4.dmg`, then validates the exact platform packages before publication. It is the clean stable baseline; withdrawn earlier releases are not part of its supported update matrix.
- **1.0.3:** cross-platform package CI passed, but the two-asset publication exposed an incompatibility in the 1.0.2 updater and was withdrawn from public downloads.
- **1.0.2:** Windows install and uninstall acceptance passed, but its exact-one-asset update filter could not cross into the first multi-platform release. It was withdrawn when 1.0.4 became the new clean baseline.

## Automated evidence

- The quota value and time modules come only from the windows returned by Codex.
- App Server reads are single-flight; a response made stale by a newer quota notification is rejected before it can reach the renderer.
- Complete renderer states carry monotonic delivery sequences. A 240-cycle Chromium stress case deliberately delivers an older value and ten disabled modules after each current state; every stale state is rejected, while a newer control state proves the detector can observe the same flash when it is legitimately accepted.
- Unchanged CDP target polls and unchanged ten-second local token scans do not rebroadcast the renderer document. A replacement Agent receives a distinct renderer instance id, so same-version hot-resume replaces old code without restarting Codex.
- The badge attaches only to the unique account row and stays inside its visible boundary.
- Hidden modules keep their saved anchors; a single visible name, value, date, or seconds module retains its requested horizontal position.
- Quick exposes one smart horizontal drag behavior: the grabbed module tracks the pointer, displaced neighbours use a short position-only spring, and exact drops retain small left, center, right, and adjacent-module alignment zones; every visible module is vertically centered.
- Code can disable magnets entirely or tune their distance and target families without weakening collision avoidance.
- Native, rounded-square, and square avatar choices resolve independently, and the native option returns styling ownership to Codex.
- Gesture state separates short press, hold, movement cancellation, and close-while-open paths.
- The editor has one canonical draft, one content-scroll owner per tab, bounded host acknowledgements, atomic configuration writes, line-and-column JSON errors, explicit format/revert actions, and canonicalization feedback. Live panel-size acceptance remains listed below.
- English, Simplified Chinese, and Japanese use the same configuration state.
- macOS CI executes the platform-neutral quota, configuration, renderer-state, showcase, and effect contracts. This is portability evidence for the core, not a macOS application support claim.
- The official Codex installation remains unchanged when QuotaPin is installed or removed.
- The one-line command and guided installer use the same versioned executable, self-contained Agent, renderer, and provenance gates; only their startup companion differs.
- A Windows PowerShell 5.1 `Restricted` caller completed the in-memory bootstrap, fresh installation, and Start-menu uninstall path; installation and update use controlled child processes without changing the user's policy.
- The public 1.0.2 command bootstrap selected the immutable Latest release, displayed resumable download progress, verified the exact GitHub digest and Windows identity, installed command ownership, and uninstalled cleanly without changing the running Codex root process.
- An independent download of the sole public 1.0.2 EXE matched the GitHub digest and Windows version metadata, installed setup ownership with its tray startup companion, and uninstalled cleanly without changing the running Codex root process.
- Command uninstall stopped the persistent Agent before renderer cleanup, removed its startup and Start-menu entries, and left no QuotaPin controller in the live renderer.

## Live acceptance still required

- normal Codex launch and automatic attachment on a clean command installation;
- short press, hold, second-press close, outside-click close, and three-module drag feel;
- stable editor size across Quick, Customize, and Code, with one scroll owner per tab;
- first-launch handoff and degraded circuit-breaker recovery on a clean installed copy;
- update from a tagged GitHub release, including user confirmation, progress, preserved settings, and a recoverable failure result;
- high-DPI behavior and Windows 10 real-device coverage.

Host UI changes can invalidate an otherwise compatible release. QuotaPin fails closed when it cannot identify the account row uniquely or detects a native persistent quota indicator inside that row. The current quota value inside the opened Codex account menu does not collide with QuotaPin's inline account-row placement.

Development evidence is marked as development. A tagged release is added only after the same checks are repeated against its published artifacts. Windows 10 remains best-effort until a real-device report is recorded.

The macOS package is CI-validated and included in 1.0.4. Real signed-in Codex and Gatekeeper acceptance remains provisional; see [the macOS implementation and acceptance boundary](macos.md).
