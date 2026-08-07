# Privacy

QuotaPin processes usage data locally and has no product telemetry.

It reads rate-limit windows returned by the locally launched Codex App Server. For the optional token modules and the detailed hover, it reads settled profile statistics through Codex's own signed-in desktop client and scans local Codex session files for numeric token-count and timestamp fields. The scanner does not read or retain prompt text, task content, thread titles, messages, cookies, authentication tokens, or account identifiers.

These values stay between the local Agent and the local Codex renderer. QuotaPin does not send them to the project author or to a QuotaPin service.

Lifecycle logs are stored under `%LOCALAPPDATA%\QuotaPin\logs` and are designed to contain only timestamps, process identifiers, ports, versions, and compatibility outcomes. Removing the QuotaPin installation directory removes those logs.

## Network access

The Windows and macOS bootstraps read the official GitHub release metadata, select the exact versioned platform package, and verify its GitHub SHA-256 digest before installation. Windows also verifies the executable's embedded file identity. Historical 1.0.0 compatibility repair may retrieve source assets from its matching release; current installations do not use that path. After attachment, QuotaPin checks the official GitHub release feed at most once per 24 hours and caches that small release list locally; opening the version picker can also request a fresh check. Codex profile statistics are requested from the same OpenAI endpoint used by Codex Desktop. QuotaPin never installs an update until the user selects a version and confirms.
