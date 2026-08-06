#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/dist/macos-dev"
TARGET="$HOME/Library/Application Support/QuotaPin"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This developer installer runs only on macOS." >&2
  exit 2
fi
if [[ ! -x "$SOURCE/QuotaPin.Agent" || ! -x "$SOURCE/QuotaPin.Mac.Dev" ]]; then
  echo "Build the developer artifact first: ./scripts/macos/build-dev.sh" >&2
  exit 3
fi

mkdir -p "$TARGET"
for name in QuotaPin.Agent QuotaPin.Mac.Dev THIRD_PARTY_NOTICES.txt README.txt VERSION COMMIT; do
  cp "$SOURCE/$name" "$TARGET/$name"
done
chmod 755 "$TARGET/QuotaPin.Agent" "$TARGET/QuotaPin.Mac.Dev"

echo "Installed the unsupported macOS developer preview in: $TARGET"
echo "Quit Codex, then run: $TARGET/QuotaPin.Mac.Dev"
