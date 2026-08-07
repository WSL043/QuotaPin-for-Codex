# Contributing

QuotaPin changes stay small, testable, and fail-closed. Maintainers follow the branch and release rules in [`docs/maintainers/release-policy.md`](docs/maintainers/release-policy.md).

## Good first contributions

- sanitized compatibility reports for a current Codex Desktop build;
- tests for an existing formatter or configuration behavior;
- documentation fixes and translations;
- a real-device macOS probe following [`docs/macos.md`](docs/macos.md) and the [sanitized report form](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=macos-compatibility.yml);
- narrow bug fixes with before-and-after evidence.

For a large feature or new platform adapter, open an issue before writing the whole patch. Early discussion avoids duplicate work and is the fastest way to reach a change that can be merged.

## Ideas

Before opening a feature request, [search the open ideas](https://github.com/WSL043/QuotaPin-for-Codex/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc). If the idea already exists, add a 👍 instead of making its twin; reactions are the lightweight vote. If it is new, use the [feature-request form](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml).

Issues are public. Remove account details, task content, tokens, private paths, and unsanitized screenshots before submitting. A tiny feature still deserves a clear problem statement; “more knobs” is not yet a problem statement.

Security vulnerabilities follow [SECURITY.md](SECURITY.md). The private security channel is not a general idea inbox.

## Before opening a change

1. Do not commit screenshots with account names or private thread titles.
2. Do not commit extracted Codex application contents or proprietary assets.
3. Do not modify the official Codex installation or its permissions, and do not add credential import, analytics, or remote listeners.
4. Add a compatibility fixture or test for selector changes.
5. Run `npm run check` and the PowerShell parser check in CI.

By submitting a contribution, you agree to license it under the repository's current license.

## Design rule

QuotaPin gets one compact status slot. New data must help a user make an immediate decision. If it needs a dashboard, it probably packed too much for this trip.

## Pull-request shape

Include:

1. the user-visible problem;
2. the smallest change that solves it;
3. tests or sanitized runtime evidence;
4. compatibility and privacy impact;
5. a clean uninstall or rollback path when lifecycle behavior changes.
