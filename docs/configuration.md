# Configuration

QuotaPin creates `%LOCALAPPDATA%\QuotaPin\config.json` on first install and preserves it across updates. Hold the Codex account row for 480 ms to open the editor. A short press keeps the original Codex menu; pressing the row again or clicking outside closes the open panel.

The fresh-install default is deliberately small: Codex keeps its native avatar and account name, and QuotaPin adds only the remaining percentage. The status dot, quota bar, and every time module start off. Warning begins at 30% remaining; critical begins at 10%.

## The editor has three jobs

- **Quick** is the direct-manipulation surface. Choose a returned usage window, toggle modules, and drag visible modules. Drops stay exact unless they enter a small alignment zone near an edge, the center line, or another module.
- **Customize** changes the view name, avatar shape, quota text size, colors, warning levels, and attention behavior. The live account row stays draggable here.
- **Code** exposes the complete public configuration, including custom hover templates, and accepts validated JSON.

All three surfaces edit the same settings. A change appears immediately, but `Saved` is shown only after it has really reached the configuration file. If one save fails or times out, only that unconfirmed change is undone. JSON typed in Code does nothing until **Apply JSON** is pressed. Code can format a valid draft, discard it without touching saved settings, and reports the exact `line:column` for syntax errors. If the saved canonical form differs from the submitted document, the editor reloads that form and lists the adjusted paths instead of silently hiding the change.

The active tab owns its content scrolling. Opening a long list does not create a second nested scroll region.

## Twelve independent modules

```json
["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"]
```

| Module | Example | Meaning |
|---|---|---|
| `avatar` | account image | The existing Codex avatar. |
| `name` | `Aster` | The existing Codex account name. |
| `dot` | colored dot | Compact status based on the saved thresholds. |
| `value` | `42%` | Remaining percentage. |
| `todayTokens` | `Today 12.4M` | Tokens processed on this device during the current local calendar day, derived from Codex's local `token_count` events. |
| `lifetimeTokens` | `Total 44B` | Account lifetime tokens from Codex's settled profile statistics. |
| `label` | period name | The label Codex returns when more than one quota period exists. |
| `countdown` | `4d 8h` | Universal compact time until reset. It keeps `d / h / m` in every language. |
| `relative` | `4 days 8 hours` | Worded time in the selected language: `4 days 8 hours`, `4天8小时`, or `4日8時間`. |
| `seconds` | `104:00:00` | Precise time until reset as accumulated `HH:MM:SS`; days stay in the separate compact countdown module. |
| `date` | `Aug 9` | Localized reset calendar date. |
| `reset` | `Sun 02:15 AM` | Localized reset weekday and time. |

Quick shows each module as it looks now instead of asking you to decode setting names. Pressed means visible. The palette groups identity, quota, status, usage, and time; the status dot and quota bar share one status row. In Code, avatar and name are represented by `identity`; the ten inline quota modules use separate `show*` flags. The optional quota bar is a full-row overlay controlled by `showBar`; it is not part of horizontal `moduleOrder`.

The two token counters are optional and start off. Today's counter reads only numeric `token_count` fields from local Codex session logs; it never reads message bodies and refreshes from newly appended events. It therefore describes this computer, and two computers can show different Today values. Fork replays and repeated cumulative snapshots are deduplicated. The compact module stays clean; if bounded startup backfill cannot prove full-day coverage, the localized hover copy identifies the exact value as "at least" rather than presenting a lower bound as exact. Total uses Codex's account profile summary and is account-wide; that summary may settle later than the local counter. Neither value is written into the QuotaPin configuration or log, and an unavailable source stays `—` rather than becoming zero.

### Avatar shape

`avatarShape` affects only the avatar mask:

| Value | Result |
|---|---|
| `native` | Restores Codex's own styling. This is the default. |
| `rounded` | Small rounded-square mask. |
| `square` | Square mask. |

Switching back to `native` removes the QuotaPin override rather than freezing a radius sampled from an older Codex build.

## Layout

Quick has one layout behavior. The dragged module follows the pointer, while a completed drop records a durable relationship to the left edge, center line, right edge, or a neighbouring module. Vertical position is always centered automatically, so the user only decides horizontal order and gravity. This prevents a narrow sidebar from hiding an arbitrary fractional coordinate that later appears stranded when the sidebar is widened. Hidden modules retain their saved gravity and order.

Code retains the professional controls. `layoutMode: "free"` disables every magnetic target while preserving collision avoidance. In smart `auto` mode, `snapThreshold` controls the magnetic distance and `snapTargets` independently enables edge, center, and neighbouring-module targets. An empty `snapTargets` array is also valid.

Dragging stays stable even when a countdown changes while the pointer is down. Every text module is measured from its current glyphs rather than a width painted by an earlier layout. The grabbed module follows the pointer directly; neighbours use a brief position-only spring as they make room. Width and background data refreshes never animate. Unchanged endpoint polls and local-token scans do not send another full renderer state, and a late state is rejected by delivery sequence, so a refresh cannot restore an older module set or leave a later measurement on an intermediate size or position. The account name keeps its natural width until the row becomes crowded, then shortens with an ellipsis.

**Restore view defaults** in Customize resets the whole active view, including its layout. A custom view keeps its name while returning to the shipped Glance behavior. Quick deliberately contains no permanent layout-instruction or undo bar; the visible modules themselves are the editor.

## Saved views

Three editable views ship as starting points:

| View | Visible quota modules | Example |
|---|---|---|
| `Glance` | value | `42%` |
| `Countdown` | value, countdown | `42% 4d 8h` |
| `Reset time` | value, reset | `42% Sun 02:15 AM` |

Duplicate and rename a useful view instead of rebuilding it. Up to eight views are retained and at least one always remains. Date and precise-seconds combinations can be built directly in Quick or Code.

## Configuration JSON (schema 15)

A compact valid document looks like this:

```json
{
  "version": 15,
  "locale": "en",
  "panelTheme": "dark",
  "activeProfile": "glance",
  "profiles": [{
    "id": "glance",
    "name": "Glance",
    "template": "{remaining}%",
    "hoverTemplate": "{remaining}% left · resets in {countdown} ({date}, {reset})",
    "window": "auto",
    "separator": " · ",
    "displayMode": "modules",
    "showValue": true,
    "showDot": false,
    "showBar": false,
    "showLabel": false,
    "showCountdown": false,
    "showRelative": false,
    "showSeconds": false,
    "showDate": false,
    "showReset": false,
    "showTodayTokens": false,
    "showLifetimeTokens": false,
    "valueColor": "severity",
    "dotColor": "severity",
    "identityColor": "inherit",
    "moduleOrder": ["avatar", "name", "value", "label", "dot", "countdown", "relative", "seconds", "date", "reset", "todayTokens", "lifetimeTokens"],
    "layoutMode": "auto",
    "snapThreshold": 16,
    "snapTargets": ["edges", "center", "modules"],
    "moduleAnchors": {
      "avatar": 0.04,
      "name": 0.04,
      "dot": 0.96,
      "value": 0.96,
      "todayTokens": 0.96,
      "lifetimeTokens": 0.96,
      "label": 0.96,
      "countdown": 0.96,
      "relative": 0.96,
      "seconds": 0.96,
      "date": 0.96,
      "reset": 0.96
    },
    "identity": "show",
    "avatarShape": "native",
    "fontSize": 14,
    "effect": "none",
    "effectTarget": "dot",
    "effectAt": "critical"
  }],
  "thresholds": { "warning": 30, "critical": 10 },
  "palette": {
    "warning": "#fbbf24",
    "critical": "#f87171",
    "accent": "#6ee7b7"
  }
}
```

### Profile fields

| Field | Accepted values | Purpose |
|---|---|---|
| `id` | normalized identifier | Stable view id. |
| `name` | non-empty string, max 24 chars | User-facing view name. |
| `template` | string, max 120 chars | Combined value in `template` mode. |
| `hoverTemplate` | string, max 180 chars | Hover content; empty disables it. |
| `window` | `auto`, `all`, `shortest`, `longest`, `duration:<minutes>` | What to show when Codex reports more than one quota period. |
| `separator` | string, max 8 chars | Joins multiple quota periods in template mode; it does not draw a separate visual module. |
| `displayMode` | `modules`, `template` | Independent modules or one Code-defined value. |
| `showValue`, `showDot`, `showTodayTokens`, `showLifetimeTokens`, `showLabel`, `showCountdown`, `showRelative`, `showSeconds`, `showDate`, `showReset` | boolean | Independent inline module visibility. The token counters are optional; `countdown` is compact and universal; `relative` uses localized words. |
| `showBar` | boolean | Optional full-width quota line at the bottom of the account row; it uses the current percentage and value color without entering horizontal layout. |
| `moduleOrder` | one permutation of all twelve module ids | Fallback order when two modules are saved at the same horizontal point. |
| `layoutMode` | `auto`, `free` | Stable semantic docking or exact normalized coordinates. Quick uses `auto`; `free` is an expert Code option. |
| `snapThreshold` | integer `0`–`48` | Magnetic distance in pixels for `auto`; `0` requires an exact target hit. |
| `snapTargets` | any subset of `edges`, `center`, `modules` | Magnetic target families for `auto`; an empty array disables all targets. |
| `moduleAnchors` | number from `0` to `1` per module | In `auto`, values resolve to left, intentional center, or right gravity and order modules sharing a dock. In `free`, they remain exact normalized centers. |
| `identity` | `show`, `hideName`, `hideAvatar`, `quotaOnly` | Avatar/name visibility. |
| `avatarShape` | `native`, `rounded`, `square` | Avatar mask exposed by the visual editor. |
| `fontSize` | integer `9`–`18` | Quota text size in pixels. |
| `valueColor` | `severity`, `accent`, `muted`, or `#rrggbb` | Quota text color. |
| `dotColor` | `severity`, `match`, `accent`, `muted`, or `#rrggbb` | Status-dot color. |
| `identityColor` | `inherit`, `severity`, `match`, `accent`, `muted`, or `#rrggbb` | Account-name color. |
| `effect` | `none`, `pulse`, `blink`, `rainbow` | Attention effect. |
| `effectTarget` | `dot`, `value`, `both` | Which visible quota surface animates. |
| `effectAt` | `always`, `warning`, `critical` | When the effect begins. |

`critical` cannot be higher than `warning`. With the defaults, 10% or less is critical, 30% or less is warning, and anything above that is normal. Values outside 0–100 are corrected when the file is loaded.

### Quota periods

**Usage window** chooses one or more periods from the ordinary Codex quota returned by the desktop app, and the optional `label` module can identify them. `availableWindowCount` reports how many ordinary periods arrived before that choice. Separately metered model-specific buckets are intentionally ignored so they cannot replace or move the primary quota row during background refreshes.

### Templates and hover text

Code templates accept:

- `{remaining}` — rounded remaining percentage, without `%`;
- `{label}` — returned-window label;
- `{countdown}` — compact time until reset;
- `{relative}` — worded time until reset in the selected language;
- `{seconds}` — precise time until reset as accumulated `HH:MM:SS`;
- `{date}` — localized reset date;
- `{reset}` — localized reset weekday and time.

In `template` mode, `showValue` controls the combined result and `showDot` remains independent. The other time/label modules are not duplicated alongside the template.

The built-in hover is intentionally fuller than the inline row: it lists every ordinary quota period with remaining percentage, compact time to reset, localized reset date, and localized weekday/time. It then includes exact, grouped token counts for this device today and the account lifetime total when those sources are available; inline token modules remain compact. A custom quota `hoverTemplate` remains fully user-controlled without suppressing the token details.

## Recovery

If `config.json` is damaged, QuotaPin keeps the original as `config.json.corrupt-<timestamp>` and opens safe defaults instead of overwriting the evidence. When a supported older schema is loaded, QuotaPin writes the migrated form atomically and keeps the untouched original as `config.json.previous`. A file created by a newer QuotaPin version can be inspected but stays read-only, so an older version cannot silently erase newer settings.

## Language

The editor defaults to English. The header switches between English, Simplified Chinese, and Japanese. Shipped view names are localized at display time; user-authored names and templates are never translated or rewritten.

## Panel appearance

`panelTheme` accepts `dark` or `light` and defaults to `dark`. The choice affects only the QuotaPin editor and persists with the rest of the configuration. It is deliberately independent from Windows and Codex appearance, while the inline account row continues to inherit the native Codex surface around it.

## Launch preference

The command installation starts a per-user attachment helper at sign-in, so the official Codex icon remains the normal entry point.

| Switch | Behavior |
|---|---|
| `-DisableAutoAttach` | Disable automatic attachment and create a QuotaPin-aware launcher. |
| `-EnableAutoAttach` | Explicitly restore automatic attachment after it was disabled. |
| `-CreateLauncherShortcut` | Also create that launcher while automatic attachment stays enabled. |
| `-NoDesktopShortcut` | Keep a required launcher in the Start menu only. |

These switches are source-checkout controls for development. They are intentionally absent from the one-line package bootstrap. From a checkout, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -DisableAutoAttach -CreateLauncherShortcut
```

## Updates and recovery versions

The version control in the editor can read the official GitHub release list. Automatic release checks run at most once per 24 hours; opening the control can request a fresh check. Checking is read-only and never starts an installation.

Only compatible, immutable releases containing exactly one correctly named Windows executable are eligible. The user must select a version and confirm before installation begins. The updater checks GitHub's asset digest and the executable's embedded repository, version, and filename identity, preserves the current configuration and launch preference, and then uses the same package as Quick Start. It never closes or launches Codex: it may reattach only to the exact loopback runtime receipt from the current session; otherwise the new version waits for the next normal Codex launch. A version absent from the picker is not treated as compatible.

The remote bootstrap without `-Version` resolves GitHub's immutable latest stable release. Supplying an exact published stable version permits a repair or compatible rollback. Reinstalling the same version follows the same transactional replacement path and does not reset configuration.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1))) -Version '1.0.2'
```

Older entries are user-selected recovery versions, not a transactional rollback guarantee. If an older Agent encounters a configuration from a newer schema, it opens that configuration read-only instead of overwriting it. Published update behavior is counted as supported only after the corresponding path appears in [observed compatibility](compatibility.md).
