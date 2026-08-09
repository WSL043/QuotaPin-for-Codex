# Architecture

QuotaPin is divided by change boundary. The quota model, saved configuration, renderer behavior, Codex DOM adapter, and Windows lifecycle can fail independently without borrowing each other's assumptions.

## Core contracts

### `QuotaSnapshot`

```js
{
  source: "codex-app-server",
  status: "ready",
  receivedAt: 1785715200000,
  buckets: [{
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    windows: [/* normalized windows */]
  }],
  windows: [{
    id: "codex:duration:9000",
    sourceId: "codex",
    sourceLabel: "Codex",
    label: "cycle",
    windowDurationMins: 9000,
    remainingPercent: 42,
    resetsAt: 1786089600
  }]
}
```

The model contains only observed sources and windows. `rateLimitsByLimitId` becomes keyed `buckets`; the flattened `windows` list keeps formatting and layout source-agnostic. The legacy single `rateLimits` shape remains a fallback. `primary` and `secondary` are transport details, not product assumptions, and sparse updates merge into their matching bucket without deleting the others.

### `DisplayPreferences`

Configuration selects the global account-row mode, active saved view, returned-window selection, module or template display, hover content, layout, avatar mask, colors, thresholds, attention behavior, and UI locale.

Layout stores one permutation of:

```js
["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"]
```

Visibility is separate from order and normalized horizontal anchors, so hiding a module does not erase its place. `avatarShape: "native"` removes QuotaPin's mask and lets Codex own the shape again; the visual editor also exposes rounded and square masks.

### `QuotaView`

```js
{
  text: "42%",
  parts: {
    value: "42%",
    label: "cycle",
    countdown: "4d 8h",
    relative: "4 days 8 hours",
    seconds: "104:00:00",
    date: "Aug 9",
    reset: "Sun 02:15 AM",
    todayTokens: "—",
    lifetimeTokens: "—"
  },
  runtimeWindows: [{
    label: "cycle",
    remaining: "42",
    value: "42%",
    resetsAt: 1786089600,
    date: "Aug 9",
    reset: "Sun 02:15 AM"
  }],
  severity: "normal",
  profileId: "glance",
  availableWindowCount: 1,
  displayMode: "modules",
  showValue: true,
  showDot: false,
  showBar: false,
  remainingPercent: 42,
  showLabel: false,
  showCountdown: false,
  showRelative: false,
  showSeconds: false,
  showDate: false,
  showReset: false,
  showTodayTokens: false,
  showLifetimeTokens: false,
  valueColor: "#6ee7b7",
  dotColor: "#6ee7b7",
  identityColor: "inherit",
  effect: "none",
  effectTarget: "dot",
  effectAt: "critical",
  layout: {
    moduleOrder: ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"],
    layoutMode: "auto",
    snapThreshold: 16,
    snapTargets: ["edges", "center", "modules"],
    moduleAnchors: {
      avatar: .04, name: .04, dot: .96, value: .96, todayTokens: .96, lifetimeTokens: .96, label: .96,
      countdown: .96, relative: .96, seconds: .96, date: .96, reset: .96
    },
    identity: "show",
    avatarShape: "native",
    fontSize: 14
  }
}
```

The Agent sends reset timestamps rather than streaming formatted seconds. A visibility-aware one-shot timer targets the next true second or minute boundary and derives every label from the absolute reset timestamp. Delayed browser work can skip a paint, but it cannot accumulate clock drift or increase App Server traffic.

App Server quota reads are single-flight. A refresh requested while one is active is coalesced, and each read records the notification revision that existed when it was sent. If a newer `account/rateLimits/updated` notification arrives first, the late full response is discarded and one clean read follows. Reads have a bounded timeout: one timeout receives a clean retry, while a second consecutive timeout retires the unresponsive App Server child, clears the stale ready state, and enters the bounded process-restart path. The initialization handshake is bounded by the same liveness rule, so a spawned PID is never treated as a healthy service merely because it still exists. This causal boundary prevents both out-of-order rollback and indefinitely frozen quota data.

Every complete Agent-to-renderer state carries the owning renderer instance id and one process-local monotonic delivery sequence. CDP checks the owner before calling the global controller, and the controller checks it again before comparing sequences. A retired Agent therefore cannot feed its high sequence into a replacement renderer; late or unsequenced states from the current Agent are rejected after live delivery has begun. A CDP session is removed as soon as its WebSocket closes or a command times out. The next target poll may therefore reconnect even when Electron reuses the same target id; endpoint identity and live transport state, rather than Map membership alone, define attachment. Target discovery sends state only when a renderer is newly attached or an external configuration reload is observed; it does not resend the full document on each healthy two-second endpoint poll. The local token scanner likewise publishes only when its user-visible total or health changes. A bounded renderer delivery trace contains owner, sequence, source reason, and visible module ids without page or account content.

Renderer installation has a separate per-Agent instance id in addition to the public semantic version. Repeating installation from the same process is idempotent, while a replacement Agent with the same version cleans up and replaces the previous controller. Disposal is a lifecycle boundary rather than a global-reference swap: the retired controller rejects updates, rendering, timers, focus callbacks, profile refreshes, and late asynchronous callbacks, and cleanup continues even if one restoration step fails. A badge-scoped integrity observer remains defense-in-depth for external DOM drift; it is not used as a substitute for owner-scoped delivery. This keeps repair and development hot-resume honest without restarting Codex.

The account row has one canonical state renderer plus two bounded hot paths. Quota, settings, and profile changes use the complete renderer. Sidebar resize events are coalesced to at most one animation-frame commit and run only the horizontal solver; clock boundaries update only time-derived copy and invoke the same solver only when that copy changes width. Both hot paths refresh the canonical binding, layout signature, and committed plan, so the integrity observer still validates one result rather than competing with an alternate renderer. Unrelated Codex content mutations are ignored unless they touch the verified account host or replace the optional effect signal. This keeps streaming task output, sidebar dragging, and second-by-second countdowns from waking the full renderer.

The quota bar is an auxiliary surface outside the twelve-module horizontal collision solver, so enabling it cannot push or resize account identity and quota text. Its default `quota` scope derives its left and right edges from the first and last visible quota module after each committed layout; this keeps the progress signal attached to the information it describes while resize and drag remain frame-bounded. Code can opt into `barScope: "row"` for the former full-row rail. Its Quick control shares the status group with the dot.

The token counters deliberately use two sources with different freshness. `todayTokens` is computed by the Agent from numeric `token_count` events in local Codex JSONL sessions, so its scope is the current device rather than a cross-device account total. Startup backfill reads backwards only to the local day boundary with a fixed byte budget; subsequent passes inspect changed file tails. An unchanged scan updates internal file cursors without broadcasting another renderer document. Cumulative snapshots provide fork/replay deduplication and stale-regression checks, while message bodies are never parsed. Incomplete backfill is exposed as a lower bound. `lifetimeTokens` remains the settled account-wide total from the authenticated Codex renderer client. The renderer feature-detects that client, keeps the response in memory, and never sends authentication material or the profile payload to the Agent. A five-minute successful refresh interval, single-flight requests, an eight-second UI timeout, and one-minute failure backoff bound the profile integration; either source can fail closed independently. Inline modules use compact localized notation, while the shared hover surface uses exact grouped counts and is available even when those modules are hidden.

`availableWindowCount` is runtime state. `window` selects one or more periods inside the ordinary Codex quota. Separately metered model-specific buckets are filtered at the normalization boundary, so a bucket disappearing from one full refresh and returning in the next cannot replace or move the primary row. The built-in tooltip formats every ordinary period with remaining percentage, relative reset, date, and time. No period duration is assumed by the configuration contract.

## Gesture boundary

The renderer owns gesture isolation at the Codex account boundary. Legacy scopes that boundary to the native account button. Beta first proves one bounded footer and one adjacent Help control, hides that control reversibly, expands the account button into the freed width, and scopes the same classifier to the complete footer. Pointer-down is captured before the host sees it. A short release is replayed to the native account trigger; a hold opens QuotaPin; movement cancels the hold. Pressing the row again closes the open panel. The invisible target remains available even when all QuotaPin modules are hidden. Ambiguous host chrome always falls back to Legacy.

## Layout boundary

Quick exposes one smart horizontal drag model and always calculates vertical centering from the host row. In `auto`, a completed placement becomes stable left, intentional center, right, or neighbour gravity rather than an arbitrary percentage exposed by a later resize. Text width is re-measured from current glyph bounds rather than a previously painted solver width, and background refreshes never animate row geometry. Code may set `layoutMode` to `free` for literal normalized coordinates, change `snapThreshold`, or choose any subset of `snapTargets`; these expert controls stay out of the direct-manipulation surface. No module type is assigned a mandatory side.

During a gesture, the dragged module follows the exact pointer and a weighted projection moves only the smallest necessary neighbourhood. The grabbed module has no interpolation; displaced neighbours receive a short position-only spring, while width and every background refresh remain deterministic. On commit, smart layout resolves that gesture to its semantic dock and preserves the new order; free layout retains every exact settled center. The account name starts at its measured glyph width and shrinks before fixed-value modules. Hidden zero-sized rectangles are ignored when anchors are measured.

## Settings transaction

The settings renderer maintains two explicit documents: the last host-confirmed `committed` state and an optimistic `draft`. Every normal action receives an action id. The host sanitizes the complete result, writes it atomically, and returns the canonical configuration.

An acknowledgement advances `committed` and replays any newer pending actions. A rejection removes only the failed action and rebuilds the draft from committed state plus the remaining queue. Code input is staged locally until **Apply JSON**. Syntax diagnostics remain local; after a successful save, the host-confirmed canonical document replaces the submitted text and any normalized paths are reported. A render callback runs only after the canonical state has painted, which keeps newly enabled modules immediately draggable.

**Restore view defaults** replaces the active profile with its shipped behavior, including order, gravity, magnetic controls, and quota text size.

## Windows lifecycle

The versioned Windows executable owns both supported installation experiences. PowerShell Quick Start runs it in quiet command mode, which installs a self-contained `QuotaPin.Agent.exe` plus Windows PowerShell 5.1 lifecycle scripts under `%LOCALAPPDATA%\QuotaPin` and starts only the per-user attachment watcher. Double-clicking the same file installs the tray companion instead. The tray owns lifecycle status, startup, updates, project access, uninstall, and exit; it does not open or control the settings renderer. Settings have one entry point: hold the account row inside Codex. Both install modes register the same native Apps uninstall entry; neither needs a service, administrator token, system-wide registry entry, or modified Codex package.

Panel and tray updates converge on `scripts/update.ps1`; the tray no longer carries a second downloader. The transaction resolves the current install owner before invoking Setup, resumes partial GitHub assets, verifies the release digest and embedded Windows identity, and uses phase-tagged atomic receipts. The wrapper owns runtime resume during an in-app update, while a directly launched installer owns one equivalent handoff. Setup ignores stale command-mode flags when an existing native Setup registration proves tray ownership, so an update cannot silently change the installation flavor. A terminal completion receipt survives replacement long enough for the new Agent and tray to report the actual outcome.

The helper accepts only a fresh official root `ChatGPT.exe` launch. The launcher validates the app-managed Codex executable, binds CDP to loopback on a fresh ephemeral port, and starts the Agent. An already instrumented, stale, child, or ambiguous process is ignored. The command installation has no tray UI.

## Modules

- `src/core/model.mjs` normalizes returned rate-limit windows and merges sparse updates.
- `src/core/config.mjs` migrates, sanitizes, and atomically saves configuration.
- `src/core/format.mjs` formats percentage, universal compact time, locale-aware worded time, precise seconds, date, reset time, and hover text.
- `src/agent/` owns App Server stdio, CDP transport, local numeric token-event aggregation, configuration acknowledgements, lifecycle state, and the user-initiated release picker.
- `src/renderer/` owns pure settings, layout, gesture, effect, localization, time-boundary, and interaction state machines.
- `src/injector.mjs` composes those modules and contains the version-sensitive Codex DOM adapter.
- `scripts/build-agent.ps1` bundles the runtime into the self-contained Windows Agent and embeds version/source provenance.
- `src/launch.ps1` validates and activates the official Codex process with loopback-only CDP.
- `src/auto-attach.ps1` watches for eligible official launches and authorizes one generation-bound relaunch. Success requires a renderer-attached receipt; any mismatch latches a circuit breaker instead of retrying a destructive transition.
- `install.ps1` selects and verifies the Windows package from an immutable platform package set; `installer/QuotaPin.iss` owns installed files, mode-specific startup, migration, and native uninstall. `scripts/install.ps1` and `scripts/uninstall.ps1` remain the source-checkout lifecycle for development.

The moving remote bootstrap chooses GitHub's immutable latest stable release unless an exact published version is requested. It accepts the historical Windows-only package or the exact Windows-plus-macOS package set, rejects any other public asset, checks GitHub's SHA-256 digest and the executable's embedded identity, then invokes the same installer used by the guided path. Install and update preserve configuration and launch preference. A successful release check is cached for six hours; transient failures preserve the last verified list and use bounded retry backoff beginning at 15 minutes. Update never launches Codex; the new Agent may resume only against the exact previously verified loopback runtime, otherwise attachment is deferred to the next normal launch. Native uninstall is the explicit full-removal boundary and deletes configuration with the rest of the QuotaPin install root.

## macOS lifecycle

The macOS package contains two self-contained universal Mach-O executables: the shared Agent and a platform launcher. End-user machines do not need Node.js, Homebrew, `sudo`, or a modified Codex bundle. Installation is per user under `~/Library/Application Support/QuotaPin`; one LaunchAgent owns the background watcher, while the user continues to open the official Codex icon normally.

The launcher accepts only a strict-valid `com.openai.codex` bundle signed with the expected OpenAI Team ID. Its App Server command must resolve inside that same bundle, and CDP listens only on an ephemeral `127.0.0.1` port. A fresh uninstrumented Codex generation receives at most one bounded handoff. The successor PID, start time, executable, source generation, renderer receipt, Agent PID, and loopback endpoint must agree. Ambiguity or failure latches the generation until Codex has been completely closed for the rearm interval, preventing restart loops.

Install and update use staging plus rollback, preserve the canonical configuration and runtime receipt, and start the replacement watcher with the already-open Codex generation ignored. They do not close or relaunch Codex. If the exact previous runtime remains valid, the new Agent may recover it without a host restart; otherwise QuotaPin waits for the next normal launch. Uninstall first removes the LaunchAgent, then stops only an Agent whose PID, start time, and executable match the installed receipt before deleting the per-user root.

Apple silicon and Intel slices are built and lifecycle-tested independently on their native macOS 15 GitHub runners. A separate macOS job combines only those tested slices with `lipo`, verifies both architectures and ad-hoc signatures, and produces one `QuotaPin-macOS-VERSION.dmg`. The read-only disk image contains a Finder-launchable `QuotaPin Installer.app`; its embedded payload is also the only payload accepted by the remote bootstrap. GitHub's immutable artifact handoff validates the upload digest on download. The final image is mounted and lifecycle-tested again on both architectures under macOS 15 and macOS 26, so the gate covers the package users would receive rather than only its intermediate slices. The future tagged-release manifest binds that image and the Windows executable together; only those two platform packages are public assets, while provenance and SBOM files remain internal release evidence.

## Adapter rules

1. Match host elements by geometry and semantics, never by user text.
2. Require one unique match.
3. Store no page content.
4. Restore every native style changed by a view.
5. Suppress QuotaPin if a native persistent quota indicator is detected inside the account row; a value shown only in the opened account menu is not a collision.
6. Treat host-version changes as compatibility work, not permission to weaken matching.

Keeping these boundaries explicit lets a source change fail closed without corrupting quota math, and lets a layout change be tested without launching Codex.
