<h1 align="center">QuotaPin for Codex</h1>

<p align="center">
  <strong>See your Codex quota before opening the menu.</strong><br>
  QuotaPin adds the remaining percentage to the native account row.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Windows 11 verified" src="https://img.shields.io/badge/Windows_11-verified-111827?style=flat-square">
  <img alt="Local only and zero telemetry" src="https://img.shields.io/badge/data-local_only-10b981?style=flat-square">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-6366f1?style=flat-square">
</p>

## Quick Start

Open Windows PowerShell and paste:

```powershell
irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1 | iex
```

This command installs the latest stable version. Launch Codex from its usual icon. If Codex is already running, the command leaves it alone and QuotaPin joins the next normal launch. Deliberate version selection and rollback use the explicit command in [configuration](docs/configuration.md#updates-and-recovery-versions).

Prefer a normal installer? [Open the latest stable release](https://github.com/WSL043/QuotaPin-for-Codex/releases/latest), download its single `.exe`, and double-click it.

<p align="center">
  <img src="assets/screenshots/product-en.png" width="960" alt="QuotaPin showing one percent remaining in the closed Codex account row">
</p>

> [!IMPORTANT]
> QuotaPin is an unofficial community project. It is not affiliated with, endorsed by, or supported by OpenAI.

## One less click, one less interruption

Short-click the account row for the normal Codex account menu. Hold the same row for QuotaPin. Press it again—or click outside—to close the open panel. The native help button, avatar, and account name remain in place.

<details>
<summary>Requirements and first launch</summary>

- **Verified:** x64 Windows 11 with a signed-in Codex Desktop installation.
- **Best effort:** x64 Windows 10 version 2004 (build 19041) or later. Windows ARM64 is not supported yet.
- **Permissions:** per-user installation; no administrator prompt.
- **Running work:** installation and updates never close or relaunch Codex. If the current process cannot be attached safely, QuotaPin waits for the next normal launch.

Installing from a clone also works under a restrictive PowerShell policy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Reinstalling or updating keeps your views and preferences. Version selection, rollback, and configuration recovery are covered in [configuration](docs/configuration.md).

</details>

## Quiet by default, flexible when asked

A fresh install keeps the native Codex avatar and account name, then adds only the remaining percentage.

<p align="center">
  <img src="assets/screenshots/states-en.png" width="900" alt="Normal, warning, and critical quota colors with the optional quota line">
  <br><sub>The default thresholds are 30% for warning and 10% for critical; both are editable.</sub>
</p>

<p align="center">
  <img src="assets/screenshots/examples-en.png" width="900" alt="Six production-rendered QuotaPin arrangements including countdowns, status-only, and reordered identity">
</p>

Percentage, status dot, quota line, time left, second-by-second countdown, reset date, and reset time can each be shown, hidden, and reordered. Optional token modules show today's total from this device and the settled account lifetime total; the hover gives their exact values and makes the device-local scope explicit. Compact time (`4d 8h`) is the universal shorthand, while a separate worded module follows the selected language (`4 days 8 hours`, `4天8小时`, or `4日8時間`).

<p align="center">
  <img src="assets/screenshots/drag-layout.gif" width="405" alt="Dragging a QuotaPin module to the left, right, and center while neighboring modules make room">
  <br><sub>Drag left, right, or to the center; the row makes room as you go.</sub>
</p>

- **Quick** chooses the usage window, what is visible, and where it sits.
- **Customize** handles colors, thresholds, hover text, avatar shape, appearance, and motion.
- **Code** exposes the validated configuration surface, with reset available if an experiment goes sideways.

Save useful combinations as named views and switch between them without rebuilding the row.

## Reads the quota, not your work

QuotaPin reads remaining usage from Codex on your machine. It does not read task content, prompts, cookies, or account identity, and it sends no product telemetry. If it cannot identify one unambiguous account row, it renders nothing. The official Codex package is never patched.

Details: [configuration](docs/configuration.md) · [security](SECURITY.md) · [privacy](PRIVACY.md) · [architecture](docs/architecture.md) · [observed compatibility](docs/compatibility.md)

QuotaPin checks for updates at most once a day and never installs one without confirmation. It never restarts Codex; when safe in-place reattachment is unavailable, the new version waits for the next normal launch.

## The Mac build still needs a real Mac

GitHub Actions builds a self-contained macOS developer artifact, but CI cannot prove compatibility with the current Codex app, Gatekeeper, or real account-row geometry. The [macOS port kit](docs/macos-port.md) lists the required hardware evidence and links to a sanitized [compatibility report](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=macos-compatibility.yml).

## Ideas & contributions

[Search existing ideas](https://github.com/WSL043/QuotaPin-for-Codex/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc), vote with 👍, or [submit a new one](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml). See [CONTRIBUTING.md](CONTRIBUTING.md) before sending code.

## Uninstall

Use **Start > QuotaPin > Uninstall QuotaPin**, or run:

```powershell
& "$env:LOCALAPPDATA\QuotaPin\unins000.exe"
```

QuotaPin removes its own files and shortcuts. Codex stays untouched.
