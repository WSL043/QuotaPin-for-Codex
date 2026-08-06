#!/bin/bash
set -euo pipefail

TARGET="$HOME/Library/Application Support/QuotaPin"
PID_FILE="$TARGET/logs/macos-agent.pid"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This developer uninstaller runs only on macOS." >&2
  exit 2
fi
if [[ -z "${HOME:-}" || "$HOME" == "/" || "$TARGET" != "$HOME/Library/Application Support/QuotaPin" ]]; then
  echo "Refusing to remove an unresolved install root." >&2
  exit 3
fi

if [[ -f "$PID_FILE" ]]; then
  PID="$(tr -dc '0-9' < "$PID_FILE")"
  if [[ -n "$PID" ]]; then
    COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"
    if [[ "$COMMAND" == "$TARGET/QuotaPin.Agent"* ]]; then
      kill "$PID" 2>/dev/null || true
    fi
  fi
fi

rm -rf "$TARGET"
echo "Removed the QuotaPin macOS developer preview. Codex.app was not modified."
