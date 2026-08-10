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

for source in "$ARM_SOURCE" "$X64_SOURCE"; do
  if find "$source" -type l -print -quit | grep -q .; then
    echo "A native slice contains an unexpected symbolic link: $source" >&2
    exit 3
  fi
  (cd "$source" && shasum -a 256 -c MANIFEST.sha256 >/dev/null)
done

for name in VERSION COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt QuotaPin.runtime.cjs config.default.json install.sh uninstall.sh update.sh; do
  cmp "$ARM_SOURCE/$name" "$X64_SOURCE/$name"
done
[[ "$(tr -d '\r\n' < "$ARM_SOURCE/ARCH")" == "arm64" ]]
[[ "$(tr -d '\r\n' < "$X64_SOURCE/ARCH")" == "x86_64" ]]

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"
for name in VERSION COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt QuotaPin.runtime.cjs config.default.json install.sh uninstall.sh update.sh; do
  cp "$ARM_SOURCE/$name" "$OUTPUT_ROOT/$name"
done
printf 'universal\n' > "$OUTPUT_ROOT/ARCH"
chmod 755 "$OUTPUT_ROOT/install.sh" "$OUTPUT_ROOT/uninstall.sh" "$OUTPUT_ROOT/update.sh"

for binary in QuotaPin.Mac; do
  lipo -create "$ARM_SOURCE/$binary" "$X64_SOURCE/$binary" -output "$OUTPUT_ROOT/$binary"
  chmod 755 "$OUTPUT_ROOT/$binary"
  codesign --force --sign - "$OUTPUT_ROOT/$binary"
  codesign --verify --strict "$OUTPUT_ROOT/$binary"
  ARCHS="$(lipo -archs "$OUTPUT_ROOT/$binary")"
  [[ "$ARCHS" == *arm64* && "$ARCHS" == *x86_64* ]]
done

VERSION="$(tr -d '\r\n' < "$OUTPUT_ROOT/VERSION")"
BUNDLE_SHORT_VERSION="${VERSION%%-*}"
BUNDLE_VERSION="$BUNDLE_SHORT_VERSION"
if [[ "$VERSION" =~ -beta\.([0-9]+)$ ]]; then BUNDLE_VERSION="$BUNDLE_SHORT_VERSION.${BASH_REMATCH[1]}"; fi
[[ "$($OUTPUT_ROOT/QuotaPin.Mac --launcher-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.runtimeVerified||value.downloadsRuntime) process.exit(1)' "$($OUTPUT_ROOT/QuotaPin.Mac --wrapper-self-test)"
[[ "$(node "$OUTPUT_ROOT/QuotaPin.runtime.cjs" --launcher-version)" == "$VERSION" ]]
[[ "$(node "$OUTPUT_ROOT/QuotaPin.runtime.cjs" --quotapin-agent-runtime --agent-version)" == "$VERSION" ]]
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok||!value.oneHandoffBudget) process.exit(1)' "$(node "$OUTPUT_ROOT/QuotaPin.runtime.cjs" --self-test)"
node -e 'const value=JSON.parse(process.argv[1]); if(!value.ok) process.exit(1)' "$(node "$OUTPUT_ROOT/QuotaPin.runtime.cjs" --quotapin-agent-runtime --renderer-self-test)"

(
  cd "$OUTPUT_ROOT"
  shasum -a 256 ARCH COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt VERSION \
    QuotaPin.Mac QuotaPin.runtime.cjs config.default.json install.sh uninstall.sh update.sh > MANIFEST.sha256
)

IMAGE_ROOT="$ROOT/dist/macos-image"
APP_ROOT="$IMAGE_ROOT/QuotaPin Installer.app"
CONTENTS="$APP_ROOT/Contents"
PAYLOAD="$CONTENTS/Resources/payload"
IMAGE="$ROOT/dist/QuotaPin-macOS-$VERSION.dmg"
rm -rf "$IMAGE_ROOT" "$IMAGE"
mkdir -p "$CONTENTS/MacOS" "$PAYLOAD"
cp -R "$OUTPUT_ROOT/." "$PAYLOAD/"
cp "$ROOT/scripts/macos/installer-app.sh" "$CONTENTS/MacOS/QuotaPin Installer"
cp "$OUTPUT_ROOT/README.txt" "$IMAGE_ROOT/README.txt"
chmod 755 "$CONTENTS/MacOS/QuotaPin Installer"
ICONSET="$IMAGE_ROOT/QuotaPin.iconset"
mkdir -p "$ICONSET"
for specification in "16 icon_16x16.png" "32 icon_16x16@2x.png" "32 icon_32x32.png" "64 icon_32x32@2x.png" "128 icon_128x128.png" "256 icon_128x128@2x.png" "256 icon_256x256.png" "512 icon_256x256@2x.png" "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
  size="${specification%% *}"
  name="${specification#* }"
  sips -s format png -z "$size" "$size" "$ROOT/assets/quotapin-icon.png" --out "$ICONSET/$name" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/QuotaPin.icns"
rm -rf "$ICONSET"
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>QuotaPin Installer</string>
  <key>CFBundleExecutable</key><string>QuotaPin Installer</string>
  <key>CFBundleIdentifier</key><string>io.github.wsl043.quotapin.installer</string>
  <key>CFBundleIconFile</key><string>QuotaPin</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>QuotaPin Installer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$BUNDLE_SHORT_VERSION</string>
  <key>CFBundleVersion</key><string>$BUNDLE_VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
plutil -lint "$CONTENTS/Info.plist" >/dev/null
codesign --force --sign - "$APP_ROOT"
codesign --verify --strict --deep "$APP_ROOT"
hdiutil create -quiet -ov -format UDZO -volname "QuotaPin $VERSION" -srcfolder "$IMAGE_ROOT" "$IMAGE"
[[ -s "$IMAGE" ]]
echo "$IMAGE"
