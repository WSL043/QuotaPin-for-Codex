#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${1:-}"
EXPECTED_ARCH="${2:-$(uname -m)}"

[[ "$(uname -s)" == "Darwin" ]] || { echo "Universal package testing requires macOS." >&2; exit 2; }
[[ "$EXPECTED_ARCH" == "arm64" || "$EXPECTED_ARCH" == "x86_64" ]] || { echo "Unsupported expected architecture: $EXPECTED_ARCH" >&2; exit 2; }
[[ "$(uname -m)" == "$EXPECTED_ARCH" ]] || { echo "Runner architecture mismatch: expected $EXPECTED_ARCH, got $(uname -m)." >&2; exit 2; }
[[ -f "$IMAGE" && ! -L "$IMAGE" ]] || { echo "Universal package image is missing: $IMAGE" >&2; exit 2; }

VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quotapin-universal.XXXXXX")"
MOUNT_ROOT="$TEMP_ROOT/mount"
mkdir -p "$MOUNT_ROOT"
ATTACHED=false
cleanup() {
  if [[ "$ATTACHED" == true ]]; then hdiutil detach -quiet "$MOUNT_ROOT" >/dev/null 2>&1 || true; fi
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

hdiutil attach -quiet -readonly -nobrowse -mountpoint "$MOUNT_ROOT" "$IMAGE"
ATTACHED=true
APP_ROOT="$MOUNT_ROOT/QuotaPin Installer.app"
PACKAGE_ROOT="$APP_ROOT/Contents/Resources/payload"
[[ -d "$PACKAGE_ROOT" && ! -L "$PACKAGE_ROOT" ]] || { echo "Universal package root is invalid." >&2; exit 3; }
if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  echo "Universal package contains a symbolic link." >&2
  exit 3
fi
plutil -lint "$APP_ROOT/Contents/Info.plist" >/dev/null
codesign --verify --strict --deep "$APP_ROOT"

for binary in QuotaPin.Mac; do
  ARCHS="$(lipo -archs "$PACKAGE_ROOT/$binary")"
  [[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || { echo "$binary is not universal: $ARCHS" >&2; exit 4; }
  codesign --verify --strict "$PACKAGE_ROOT/$binary"
done

[[ "$("$PACKAGE_ROOT/QuotaPin.Mac" --launcher-version)" == "$VERSION" ]]
[[ "$("$PACKAGE_ROOT/QuotaPin.Mac" --quotapin-agent-runtime --agent-version)" == "$VERSION" ]]

"$ROOT/scripts/macos/test-lifecycle.sh" "$PACKAGE_ROOT"
"$APP_ROOT/Contents/MacOS/QuotaPin Installer" --headless
[[ -x "$HOME/Library/Application Support/QuotaPin/uninstall.sh" ]]
"$HOME/Library/Application Support/QuotaPin/uninstall.sh"
echo "Universal package lifecycle on $EXPECTED_ARCH: OK"
