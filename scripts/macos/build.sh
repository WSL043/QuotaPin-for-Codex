#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS build must run on macOS." >&2
  exit 2
fi

VERSION="$(tr -d '\r\n' < VERSION)"
COMMIT="$(git rev-parse HEAD)"
BUILD_ROOT="$ROOT/dist/macos-build-$(uname -m)"
OUTPUT_ROOT="$ROOT/dist/macos-native"
rm -rf "$BUILD_ROOT" "$OUTPUT_ROOT"
mkdir -p "$BUILD_ROOT" "$OUTPUT_ROOT"

RUNTIME="$OUTPUT_ROOT/QuotaPin.runtime.cjs"
"$ROOT/node_modules/.bin/esbuild" "$ROOT/src/macos/runtime-entry.mjs" \
  --bundle --platform=node --format=cjs --target=node20 --outfile="$RUNTIME"
node "$ROOT/scripts/stamp-build-origin.mjs" "$RUNTIME" "$COMMIT"
chmod 644 "$RUNTIME"
RUNTIME_SHA256="$(shasum -a 256 "$RUNTIME" | awk '{print $1}')"

HOST_SOURCE="$BUILD_ROOT/QuotaPinHost.swift"
sed \
  -e "s/__QUOTAPIN_VERSION__/$VERSION/g" \
  -e "s/__QUOTAPIN_COMMIT__/$COMMIT/g" \
  -e "s/__QUOTAPIN_RUNTIME_SHA256__/$RUNTIME_SHA256/g" \
  "$ROOT/src/macos/QuotaPinHost.swift" > "$HOST_SOURCE"
ARCH="$(uname -m)"
/usr/bin/swiftc -O -target "$ARCH-apple-macosx13.0" "$HOST_SOURCE" -o "$OUTPUT_ROOT/QuotaPin.Mac"
chmod 755 "$OUTPUT_ROOT/QuotaPin.Mac"
codesign --force --sign - "$OUTPUT_ROOT/QuotaPin.Mac"
codesign --verify --strict "$OUTPUT_ROOT/QuotaPin.Mac"

[[ "$($OUTPUT_ROOT/QuotaPin.Mac --launcher-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.runtimeVerified||value.downloadsRuntime) process.exit(1)' "$($OUTPUT_ROOT/QuotaPin.Mac --wrapper-self-test)"
[[ "$(node "$RUNTIME" --launcher-version)" == "$VERSION" ]]
[[ "$(node "$RUNTIME" --quotapin-agent-runtime --agent-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.loopbackOnly||!value.commandInsideBundle||!value.oneHandoffBudget) process.exit(1)' "$(node "$RUNTIME" --self-test)"
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok) process.exit(1)' "$(node "$RUNTIME" --quotapin-agent-runtime --renderer-self-test)"

{
  printf 'QuotaPin for macOS\n\n'
  printf 'QuotaPin is licensed under the MIT License included with this package.\n'
  printf 'The official Codex runtime is validated and used in place; it is not redistributed by QuotaPin.\n'
} > "$OUTPUT_ROOT/THIRD_PARTY_NOTICES.txt"

cp "$ROOT/config.default.json" "$OUTPUT_ROOT/config.default.json"
cp "$ROOT/LICENSE" "$OUTPUT_ROOT/LICENSE"
cp "$ROOT/scripts/macos/install.sh" "$OUTPUT_ROOT/install.sh"
cp "$ROOT/scripts/macos/uninstall.sh" "$OUTPUT_ROOT/uninstall.sh"
cp "$ROOT/install-macos.sh" "$OUTPUT_ROOT/update.sh"
cp "$ROOT/docs/macos-readme.txt" "$OUTPUT_ROOT/README.txt"
chmod 755 "$OUTPUT_ROOT/install.sh" "$OUTPUT_ROOT/uninstall.sh" "$OUTPUT_ROOT/update.sh"
printf '%s\n' "$VERSION" > "$OUTPUT_ROOT/VERSION"
printf '%s\n' "$COMMIT" > "$OUTPUT_ROOT/COMMIT"
printf '%s\n' "$ARCH" > "$OUTPUT_ROOT/ARCH"

(
  cd "$OUTPUT_ROOT"
  shasum -a 256 ARCH COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt VERSION \
    QuotaPin.Mac QuotaPin.runtime.cjs config.default.json install.sh uninstall.sh update.sh > MANIFEST.sha256
)

echo "$OUTPUT_ROOT"
