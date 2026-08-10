# Release policy

This file is for maintainers. It is deliberately separate from the user-facing README.

## Development and publication

- `main` is the canonical public source and the only branch used by the current project workflow.
- Normal fixes accumulate as commits and CI artifacts. They do not create a GitHub Release.
- Do not create a stable tag or invoke the release workflow until the owner explicitly approves that exact version after development acceptance.

Development candidates may be downloaded from GitHub Actions, but they are not GitHub Releases.

## Versions and GitHub Releases

- Development builds use the source commit identity and Actions artifact name. They do not receive release tags.
- Public stable tags use `vMAJOR.MINOR.PATCH`; public beta tags use `vMAJOR.MINOR.PATCH-beta.N`. Both must be reachable from `origin/main`.
- Alpha, dev, nightly, preview, RC, and arbitrary `v*` tags are rejected by the release workflow.

`VERSION` is the version built from the current source. `STABLE_VERSION` is the version served by the moving Quick Start and Latest channel. During 2.x beta work they intentionally differ; promoting a stable release requires updating both in the same reviewed release commit.

The public release page may contain reviewed beta and stable package releases. A cross-platform release exposes one versioned Windows executable and one versioned universal macOS disk image; build manifests, checksums, and SBOM evidence stay inside the verified CI handoff. Betas are GitHub prereleases, are never Latest, and require exact-version installation. Development builds stay in Actions. Only stable releases feed the moving Quick Start and default update channel.

## Clean source gate

Public source begins from a fresh export, not from an internal Git history. From an accepted clean `main`, run `scripts/export-public-baseline.ps1 -Channel stable` for a stable opening or `-Channel beta` for a reviewed public beta, review the exported tree, then initialize the public repository there. The export contains only tracked source and runs `scripts/check-public-baseline.mjs` before it is accepted.

The gate rejects local paths, temporary screenshots, internal repository/branch names, generated payloads, version drift, configuration-schema drift, and installer documentation that disagrees with the stable/default channel. Build artifacts and release assets remain products of CI; they are never copied into source history.
