#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "QuotaPin for macOS can be uninstalled only on macOS." >&2
  exit 2
fi
if [[ -z "${HOME:-}" || "$HOME" == "/" ]]; then
  echo "Could not resolve the current macOS home directory." >&2
  exit 3
fi

TARGET="$HOME/Library/Application Support/QuotaPin"
LABEL="io.github.wsl043.quotapin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
case "$TARGET" in
  "$HOME/Library/Application Support/QuotaPin") ;;
  *) echo "Refusing unresolved uninstall target: $TARGET" >&2; exit 3 ;;
esac

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true

if [[ -x "$TARGET/QuotaPin.Mac" ]]; then
  "$TARGET/QuotaPin.Mac" stop-agent
fi
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "QuotaPin LaunchAgent is still active; installation was preserved." >&2
  exit 4
fi

rm -f "$PLIST"
rm -rf "$TARGET"
printf 'QuotaPin was removed from macOS. The official Codex app was not modified.\n'
