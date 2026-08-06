#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS developer build must run on macOS." >&2
  exit 2
fi

VERSION="$(tr -d '\r\n' < VERSION)"
COMMIT="$(git rev-parse HEAD)"
BUILD_ROOT="$ROOT/dist/macos-build"
OUTPUT_ROOT="$ROOT/dist/macos-dev"
mkdir -p "$BUILD_ROOT" "$OUTPUT_ROOT"

build_sea() {
  local source="$1"
  local name="$2"
  local bundle="$BUILD_ROOT/$name.cjs"
  local config="$BUILD_ROOT/$name-sea.json"
  local blob="$BUILD_ROOT/$name.blob"
  local output="$OUTPUT_ROOT/$name"

  "$ROOT/node_modules/.bin/esbuild" "$source" --bundle --platform=node --format=cjs --target=node22 --outfile="$bundle"
  node "$ROOT/scripts/stamp-build-origin.mjs" "$bundle" "$COMMIT"
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({main:process.argv[2],output:process.argv[3],disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false}))' "$config" "$bundle" "$blob"
  node --experimental-sea-config "$config"
  cp "$(command -v node)" "$output"
  chmod 755 "$output"
  codesign --remove-signature "$output" 2>/dev/null || true
  "$ROOT/node_modules/.bin/postject" "$output" NODE_SEA_BLOB "$blob" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    --macho-segment-name NODE_SEA
  codesign --force --sign - "$output"
}

build_sea "$ROOT/src/injector.mjs" "QuotaPin.Agent"
build_sea "$ROOT/src/macos/dev-launcher.mjs" "QuotaPin.Mac.Dev"

[[ "$($OUTPUT_ROOT/QuotaPin.Agent --agent-version)" == "$VERSION" ]]
[[ "$($OUTPUT_ROOT/QuotaPin.Mac.Dev --launcher-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.loopbackOnly||!value.commandInsideBundle) process.exit(1)' "$($OUTPUT_ROOT/QuotaPin.Mac.Dev --self-test)"
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok) process.exit(1)' "$($OUTPUT_ROOT/QuotaPin.Agent --renderer-self-test)"

NODE_VERSION="$(node -p 'process.versions.node')"
LICENSE_URL="https://raw.githubusercontent.com/nodejs/node/v$NODE_VERSION/LICENSE"
curl --fail --silent --show-error --location --retry 4 --retry-all-errors --connect-timeout 20 --max-time 240 "$LICENSE_URL" --output "$BUILD_ROOT/node-license.txt"
grep -q "Copyright Node.js contributors" "$BUILD_ROOT/node-license.txt"
{
  printf 'QuotaPin macOS developer build\n\n'
  printf 'This artifact embeds Node.js %s.\n' "$NODE_VERSION"
  printf 'Source and license: https://github.com/nodejs/node/tree/v%s\n\n' "$NODE_VERSION"
  cat "$BUILD_ROOT/node-license.txt"
} > "$OUTPUT_ROOT/THIRD_PARTY_NOTICES.txt"

cp "$ROOT/docs/macos-dev-readme.txt" "$OUTPUT_ROOT/README.txt"
printf '%s\n' "$VERSION" > "$OUTPUT_ROOT/VERSION"
printf '%s\n' "$COMMIT" > "$OUTPUT_ROOT/COMMIT"

echo "$OUTPUT_ROOT"
