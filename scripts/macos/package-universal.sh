#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARM_SOURCE="${1:-}"
X64_SOURCE="${2:-}"
OUTPUT_ROOT="${3:-$ROOT/dist/macos-universal}"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Universal macOS packaging must run on macOS." >&2
  exit 2
fi
if [[ ! -d "$ARM_SOURCE" || ! -d "$X64_SOURCE" ]]; then
  echo "Usage: package-universal.sh ARM64_DIRECTORY X64_DIRECTORY [OUTPUT_DIRECTORY]" >&2
  exit 2
fi

for name in VERSION COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt config.default.json install.sh uninstall.sh; do
  cmp "$ARM_SOURCE/$name" "$X64_SOURCE/$name"
done
[[ "$(tr -d '\r\n' < "$ARM_SOURCE/ARCH")" == "arm64" ]]
[[ "$(tr -d '\r\n' < "$X64_SOURCE/ARCH")" == "x86_64" ]]

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"
for name in VERSION COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt config.default.json install.sh uninstall.sh; do
  cp "$ARM_SOURCE/$name" "$OUTPUT_ROOT/$name"
done
printf 'universal\n' > "$OUTPUT_ROOT/ARCH"
chmod 755 "$OUTPUT_ROOT/install.sh" "$OUTPUT_ROOT/uninstall.sh"

for binary in QuotaPin.Agent QuotaPin.Mac; do
  lipo -create "$ARM_SOURCE/$binary" "$X64_SOURCE/$binary" -output "$OUTPUT_ROOT/$binary"
  chmod 755 "$OUTPUT_ROOT/$binary"
  codesign --force --sign - "$OUTPUT_ROOT/$binary"
  codesign --verify --strict "$OUTPUT_ROOT/$binary"
  ARCHS="$(lipo -archs "$OUTPUT_ROOT/$binary")"
  [[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]]
done

VERSION="$(tr -d '\r\n' < "$OUTPUT_ROOT/VERSION")"
[[ "$($OUTPUT_ROOT/QuotaPin.Agent --agent-version)" == "$VERSION" ]]
[[ "$($OUTPUT_ROOT/QuotaPin.Mac --launcher-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.oneHandoffBudget) process.exit(1)' "$($OUTPUT_ROOT/QuotaPin.Mac --self-test)"

(
  cd "$OUTPUT_ROOT"
  shasum -a 256 ARCH COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt VERSION \
    QuotaPin.Agent QuotaPin.Mac config.default.json install.sh uninstall.sh > MANIFEST.sha256
)

PACKAGE_PARENT="$ROOT/dist/macos-package"
PACKAGE_NAME="QuotaPin-macOS-$VERSION"
PACKAGE_ROOT="$PACKAGE_PARENT/$PACKAGE_NAME"
ARCHIVE="$ROOT/dist/$PACKAGE_NAME.tar.gz"
rm -rf "$PACKAGE_PARENT" "$ARCHIVE"
mkdir -p "$PACKAGE_ROOT"
cp -R "$OUTPUT_ROOT/." "$PACKAGE_ROOT/"
COPYFILE_DISABLE=1 tar -C "$PACKAGE_PARENT" -czf "$ARCHIVE" "$PACKAGE_NAME"
tar -tzf "$ARCHIVE" >/dev/null
echo "$ARCHIVE"
