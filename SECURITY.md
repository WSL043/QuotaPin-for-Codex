# Security policy

## Supported versions

Only the latest published beta or stable release is supported.

## Security model

QuotaPin starts Codex Desktop with a Chromium DevTools Protocol endpoint bound to a random port on `127.0.0.1`. CDP can inspect and modify renderer content. Other processes running as the same Windows user may be able to connect to that port while Codex is open.

QuotaPin reduces exposure by:

- binding only to loopback;
- selecting a new ephemeral port per launch;
- attaching only to the exact Codex main-page URL;
- keeping the rate-limit App Server on `stdio`;
- terminating the Agent after the Codex endpoint closes;
- avoiding token, cookie, prompt, and page-content logs.

The public command installation runs one hidden per-user PowerShell watcher and no tray process. It checks the local `ChatGPT.exe` path, process identifier, creation time, and launch freshness so it can ignore child, stale, or already instrumented processes. It does not install a Windows service or require elevation.

The remote bootstrap accepts only an exact tag backed by a published immutable GitHub release. The command installer then requires a release manifest that binds the repository, tag, source commit, Agent, notices, and SHA-256 documents to one version. The release workflow also publishes an SPDX SBOM and GitHub artifact attestations, and refuses publication when repository-level immutable releases are disabled. The app-managed Codex command is accepted only with a valid Authenticode signature whose signer identifies OpenAI.

QuotaPin does not claim to protect against malicious software already running as the same Windows user.

The current release is intended for a normal single-user Windows desktop. Shared hosts with concurrently logged-on, mutually untrusted local accounts are outside the supported threat model until the cross-account loopback boundary has been validated separately.

## Reporting a vulnerability

Use GitHub's **Security -> Report a vulnerability** flow so the report remains private. Include the affected version, reproduction steps, impact, and any suggested mitigation, but never include credentials or private Codex task content.

If private vulnerability reporting is temporarily unavailable, open a public issue requesting a private contact channel without disclosing the vulnerability. Do not place an unresolved security report in a public issue.
