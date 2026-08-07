#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="${1:-$ROOT/dist/macos-native}"
TARGET="$HOME/Library/Application Support/QuotaPin"
PLIST="$HOME/Library/LaunchAgents/io.github.wsl043.quotapin.plist"
DOMAIN="gui/$(id -u)"
LABEL="io.github.wsl043.quotapin"

cleanup() {
  if [[ -x "$TARGET/uninstall.sh" ]]; then "$TARGET/uninstall.sh" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
cleanup

INSTALL_TRACE="$(mktemp "${TMPDIR:-/tmp}/quotapin-install-trace.XXXXXX")"
if ! bash -x "$SOURCE/install.sh" --source "$SOURCE" >"$INSTALL_TRACE" 2>&1; then
  cat "$INSTALL_TRACE" >&2
  rm -f "$INSTALL_TRACE"
  exit 1
fi
rm -f "$INSTALL_TRACE"
[[ -x "$TARGET/QuotaPin.Agent" && -x "$TARGET/QuotaPin.Mac" && -x "$TARGET/update.sh" ]]
[[ "$(tr -d '\r\n' < "$TARGET/VERSION")" == "$(tr -d '\r\n' < "$SOURCE/VERSION")" ]]
[[ "$($TARGET/QuotaPin.Agent --agent-version)" == "$(tr -d '\r\n' < "$SOURCE/VERSION")" ]]
[[ "$($TARGET/QuotaPin.Mac --launcher-version)" == "$(tr -d '\r\n' < "$SOURCE/VERSION")" ]]
plutil -lint "$PLIST" >/dev/null
launchctl print "$DOMAIN/$LABEL" >/dev/null

plutil -replace locale -string ja "$TARGET/config.json"
BEFORE="$(shasum -a 256 "$TARGET/config.json" | awk '{print $1}')"
FIRST_PID="$(launchctl print "$DOMAIN/$LABEL" | awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
[[ -n "$FIRST_PID" ]]

for fault in after-stage after-target-move after-plist-replace; do
  BEFORE_FAULT="$(shasum -a 256 "$TARGET/config.json" | awk '{print $1}')"
  if QUOTAPIN_TEST_FAULT_AT="$fault" "$SOURCE/install.sh" --source "$SOURCE" >/dev/null 2>&1; then
    echo "Injected installer fault unexpectedly succeeded: $fault" >&2
    exit 1
  fi
  [[ -x "$TARGET/QuotaPin.Agent" && -x "$TARGET/QuotaPin.Mac" && -x "$TARGET/update.sh" ]]
  [[ "$(shasum -a 256 "$TARGET/config.json" | awk '{print $1}')" == "$BEFORE_FAULT" ]]
  launchctl print "$DOMAIN/$LABEL" >/dev/null
done

"$SOURCE/install.sh" --source "$SOURCE"
AFTER="$(shasum -a 256 "$TARGET/config.json" | awk '{print $1}')"
[[ "$BEFORE" == "$AFTER" ]]
SECOND_PID="$(launchctl print "$DOMAIN/$LABEL" | awk '/^[[:space:]]*pid = [0-9]+/{print $3; exit}')"
[[ -n "$SECOND_PID" && "$SECOND_PID" != "$FIRST_PID" ]]
[[ "$(plutil -extract locale raw -o - "$TARGET/config.json")" == "ja" ]]

"$TARGET/uninstall.sh"
[[ ! -e "$TARGET" && ! -e "$PLIST" ]]
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "LaunchAgent remained after uninstall." >&2
  exit 1
fi
trap - EXIT
echo "macOS install, update, configuration preservation, LaunchAgent, and uninstall: OK"
