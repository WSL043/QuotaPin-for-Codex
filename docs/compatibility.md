# Compatibility

| QuotaPin | Codex Desktop | Windows | Status |
|---|---|---|---|
| 1.0.2 release candidate | 26.730.8199.0 x64 | Windows 11 10.0.26200 | The single `QuotaPin-1.0.2.exe` retains the command-install and guided-install ownership model. Its release consumers normalize Windows version-resource padding while still checking the exact immutable release, digest, version, filename, and project identity. Source, Chromium, PowerShell, installer, update, and lifecycle gates pass locally; published command and guided installation are repeated before this row is promoted from candidate evidence. |

The one-line command accepts x64 Windows 10 version 2004 (build 19041) and later. Current end-to-end evidence is from Windows 11, so Windows 10 remains best-effort until a real-device report is recorded. Windows ARM64 is not supported.

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
- A local exact-version replacement preserved the configuration, restored `quota-ready` on the same loopback port, and left the WindowsApps Codex PID unchanged. This is not yet evidence for the public GitHub release path.
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

macOS is not yet a supported platform. See [the macOS port kit](macos-port.md) for the evidence required before adding it here.
