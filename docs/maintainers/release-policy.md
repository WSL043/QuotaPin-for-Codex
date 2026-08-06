# Release policy

This file is for maintainers. It is deliberately separate from the user-facing README.

## Branches

- `main` contains the canonical released source and is the only branch from which a public release may be tagged.
- `develop` contains normal public development work.
- short-lived topic branches merge into `develop` through review, then an accepted beta or stable release commit is promoted to `main`.

Both long-lived branches are public after the repository opens. Development candidates may be downloaded from GitHub Actions, but they are not GitHub Releases.

## Versions and GitHub Releases

- Development builds use the source commit identity and Actions artifact name. They do not receive release tags.
- Public stable tags use `vMAJOR.MINOR.PATCH`; public beta tags use `vMAJOR.MINOR.PATCH-beta.N`. Both must be reachable from `origin/main`.
- Alpha, dev, nightly, preview, RC, and arbitrary `v*` tags are rejected by the release workflow.

The public release page may contain reviewed beta and stable command releases. Betas are GitHub prereleases, are never Latest, and require exact-version installation. Development builds stay in Actions. Only stable releases feed the moving Quick Start and default update channel.

## Clean source gate

Public source begins from a fresh export, not from an internal Git history. From an accepted clean `main`, run `scripts/export-public-baseline.ps1 -Channel stable` for a stable opening or `-Channel beta` for a reviewed public beta, review the exported tree, then initialize the public repository there. The export contains only tracked source and runs `scripts/check-public-baseline.mjs` before it is accepted.

The gate rejects local paths, temporary screenshots, internal repository/branch names, generated payloads, version drift, configuration-schema drift, and installer documentation that disagrees with the stable/default channel. Build artifacts and release assets remain products of CI; they are never copied into source history.
