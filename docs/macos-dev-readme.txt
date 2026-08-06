QuotaPin macOS developer preview

This is an unsigned, unsupported test artifact. It proves that the shared
renderer and self-contained Agent can build on GitHub's macOS runner. It does
not prove compatibility with a real Codex.app.

Quit Codex before launching. Run QuotaPin.Mac.Dev from Terminal. The launcher
does not close an existing Codex session and does not register a login item.

If Codex.app or its bundled app-server executable is not found automatically,
pass their exact paths with --codex-app and --codex-command. Do not point the
launcher at an executable outside the selected Codex.app bundle.

Remove the preview with scripts/macos/uninstall-dev.sh from a source checkout.
