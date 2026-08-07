#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVE="${1:-}"
EXPECTED_ARCH="${2:-$(uname -m)}"

[[ "$(uname -s)" == "Darwin" ]] || { echo "Universal package testing requires macOS." >&2; exit 2; }
[[ "$EXPECTED_ARCH" == "arm64" || "$EXPECTED_ARCH" == "x86_64" ]] || { echo "Unsupported expected architecture: $EXPECTED_ARCH" >&2; exit 2; }
[[ "$(uname -m)" == "$EXPECTED_ARCH" ]] || { echo "Runner architecture mismatch: expected $EXPECTED_ARCH, got $(uname -m)." >&2; exit 2; }
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || { echo "Universal package archive is missing: $ARCHIVE" >&2; exit 2; }

VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
PACKAGE_NAME="QuotaPin-macOS-$VERSION"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quotapin-universal.XXXXXX")"
cleanup() { rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT INT TERM

while IFS= read -r entry; do
  case "$entry" in
    "$PACKAGE_NAME"|"$PACKAGE_NAME/"|"$PACKAGE_NAME/"*) ;;
    *) echo "Unexpected universal archive path: $entry" >&2; exit 3 ;;
  esac
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Unsafe universal archive path: $entry" >&2; exit 3 ;;
  esac
done < <(tar -tzf "$ARCHIVE")

tar -xzf "$ARCHIVE" -C "$TEMP_ROOT"
PACKAGE_ROOT="$TEMP_ROOT/$PACKAGE_NAME"
[[ -d "$PACKAGE_ROOT" && ! -L "$PACKAGE_ROOT" ]] || { echo "Universal package root is invalid." >&2; exit 3; }
if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  echo "Universal package contains a symbolic link." >&2
  exit 3
fi

for binary in QuotaPin.Agent QuotaPin.Mac; do
  ARCHS="$(lipo -archs "$PACKAGE_ROOT/$binary")"
  [[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]] || { echo "$binary is not universal: $ARCHS" >&2; exit 4; }
  codesign --verify --strict "$PACKAGE_ROOT/$binary"
done

"$ROOT/scripts/macos/test-lifecycle.sh" "$PACKAGE_ROOT"
echo "Universal package lifecycle on $EXPECTED_ARCH: OK"
