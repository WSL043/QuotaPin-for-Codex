#!/bin/bash
set -euo pipefail

REPOSITORY="WSL043/QuotaPin-for-Codex"
WINDOWS_ASSET_MAX_BYTES=167772160
MAC_ASSET_MAX_BYTES=201326592
REQUESTED_VERSION=""
CODEX_APP=""
WRITE_RESULT=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) REQUESTED_VERSION="$2"; shift 2 ;;
    --codex-app) CODEX_APP="$2"; shift 2 ;;
    --write-result) WRITE_RESULT=true; shift ;;
    *) echo "Unknown installer argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer runs only on macOS." >&2
  exit 2
fi
if [[ -z "${HOME:-}" || "$HOME" == "/" ]]; then
  echo "Could not resolve the current macOS home directory." >&2
  exit 3
fi

UPDATE_ROOT="$HOME/Library/Application Support/QuotaPin"
UPDATE_RESULT="$UPDATE_ROOT/logs/update-result.json"
FROM_VERSION="$(tr -d '\r\n' < "$UPDATE_ROOT/VERSION" 2>/dev/null || true)"
if [[ "$WRITE_RESULT" == true ]]; then
  SCRIPT_REAL="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
  [[ "$SCRIPT_REAL" == "$UPDATE_ROOT/update.sh" ]] || {
    echo "The update-result channel is available only to the installed QuotaPin updater." >&2
    exit 3
  }
fi

write_update_result() {
  [[ "$WRITE_RESULT" == true ]] || return 0
  local status="$1"
  local phase="${2:-preparing}"
  local temporary="$UPDATE_RESULT.$$.tmp"
  mkdir -p "$(dirname "$UPDATE_RESULT")"
  plutil -create xml1 "$temporary"
  plutil -insert schema -integer 2 "$temporary"
  plutil -insert status -string "$status" "$temporary"
  plutil -insert phase -string "$phase" "$temporary"
  plutil -insert version -string "$VERSION" "$temporary"
  if [[ "$FROM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]]; then
    plutil -insert fromVersion -string "$FROM_VERSION" "$temporary"
  fi
  plutil -insert writtenAt -string "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$temporary"
  plutil -convert json "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$UPDATE_RESULT"
}

report_update_failure() {
  local exit_code=$?
  trap - ERR
  write_update_result failed complete || true
  exit "$exit_code"
}
if [[ -n "$REQUESTED_VERSION" && ! "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]]; then
  echo "Invalid QuotaPin version: $REQUESTED_VERSION" >&2
  exit 2
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quotapin-macos.XXXXXX")"
MOUNT_ROOT="$TEMP_ROOT/mount"
mkdir -p "$MOUNT_ROOT"
ATTACHED=false
cleanup() {
  if [[ "$ATTACHED" == true ]]; then hdiutil detach -quiet "$MOUNT_ROOT" >/dev/null 2>&1 || true; fi
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM
RELEASE_JSON="$TEMP_ROOT/release.json"
if [[ -n "$REQUESTED_VERSION" ]]; then
  RELEASE_API="https://api.github.com/repos/$REPOSITORY/releases/tags/v$REQUESTED_VERSION"
else
  RELEASE_API="https://api.github.com/repos/$REPOSITORY/releases/latest"
fi
curl --fail --silent --show-error --location --retry 6 --retry-all-errors \
  --connect-timeout 20 --max-time 120 "$RELEASE_API" --output "$RELEASE_JSON"

TAG="$(plutil -extract tag_name raw -o - "$RELEASE_JSON")"
VERSION="${TAG#v}"
PAGE_URL="$(plutil -extract html_url raw -o - "$RELEASE_JSON")"
DRAFT="$(plutil -extract draft raw -o - "$RELEASE_JSON")"
PRERELEASE="$(plutil -extract prerelease raw -o - "$RELEASE_JSON")"
IMMUTABLE="$(plutil -extract immutable raw -o - "$RELEASE_JSON" 2>/dev/null || true)"
[[ "$DRAFT" == "false" ]] || { echo "Refusing a draft GitHub release." >&2; exit 3; }
if [[ -z "$REQUESTED_VERSION" ]]; then
  [[ "$PRERELEASE" == "false" ]] || { echo "GitHub returned a prerelease for the stable channel." >&2; exit 3; }
fi
[[ "$IMMUTABLE" == "true" ]] || { echo "The selected GitHub release is not immutable." >&2; exit 3; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]] || { echo "GitHub returned an invalid tag: $TAG" >&2; exit 3; }
[[ "$PAGE_URL" == "https://github.com/$REPOSITORY/releases/tag/$TAG" ]] || { echo "GitHub returned an unexpected release identity." >&2; exit 3; }
write_update_result started preparing
if [[ "$WRITE_RESULT" == true ]]; then trap report_update_failure ERR; fi

ASSET_NAME="QuotaPin-macOS-$VERSION.dmg"
WINDOWS_ASSET_NAME="QuotaPin-$VERSION.exe"
ASSET_URL=""
ASSET_DIGEST=""
ASSET_BYTES=""
WINDOWS_ASSET_SEEN=false
ASSET_COUNT=0
index=0
while name="$(plutil -extract "assets.$index.name" raw -o - "$RELEASE_JSON" 2>/dev/null)"; do
  ASSET_COUNT=$((ASSET_COUNT + 1))
  asset_url="$(plutil -extract "assets.$index.browser_download_url" raw -o - "$RELEASE_JSON")"
  asset_digest="$(plutil -extract "assets.$index.digest" raw -o - "$RELEASE_JSON")"
  asset_bytes="$(plutil -extract "assets.$index.size" raw -o - "$RELEASE_JSON")"
  case "$name" in
    "$ASSET_NAME")
      [[ -z "$ASSET_URL" ]] || { echo "The macOS package appears more than once." >&2; exit 4; }
      ASSET_URL="$asset_url"
      ASSET_DIGEST="$asset_digest"
      ASSET_BYTES="$asset_bytes"
      ;;
    "$WINDOWS_ASSET_NAME")
      [[ "$WINDOWS_ASSET_SEEN" == false ]] || { echo "The Windows package appears more than once." >&2; exit 4; }
      [[ "$asset_url" == "https://github.com/$REPOSITORY/releases/download/$TAG/$WINDOWS_ASSET_NAME" && "$asset_digest" =~ ^sha256:[0-9a-f]{64}$ && "$asset_bytes" =~ ^[0-9]+$ && "$asset_bytes" -gt 0 && "$asset_bytes" -le "$WINDOWS_ASSET_MAX_BYTES" ]] || {
        echo "The companion Windows package does not match the official release identity." >&2
        exit 4
      }
      WINDOWS_ASSET_SEEN=true
      ;;
    *) echo "The release contains an unexpected public asset: $name" >&2; exit 4 ;;
  esac
  index=$((index + 1))
done
[[ "$ASSET_COUNT" -eq 2 && "$WINDOWS_ASSET_SEEN" == true ]] || { echo "The release does not match the two-platform package policy." >&2; exit 4; }
[[ -n "$ASSET_URL" ]] || {
  echo "QuotaPin $VERSION does not contain the macOS package yet. Choose a release that publishes $ASSET_NAME." >&2
  exit 4
}
[[ "$ASSET_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "The macOS release asset has no trusted SHA-256 digest." >&2; exit 4; }
[[ "$ASSET_URL" == "https://github.com/$REPOSITORY/releases/download/$TAG/$ASSET_NAME" && "$ASSET_BYTES" =~ ^[0-9]+$ && "$ASSET_BYTES" -gt 0 && "$ASSET_BYTES" -le "$MAC_ASSET_MAX_BYTES" ]] || { echo "The macOS release asset does not match the official release identity." >&2; exit 4; }

ARCHIVE="$TEMP_ROOT/$ASSET_NAME"
echo "Downloading $ASSET_NAME"
write_update_result started downloading
curl --fail --show-error --location --retry 6 --retry-all-errors --connect-timeout 20 \
  --max-time 600 --continue-at - "$ASSET_URL" --output "$ARCHIVE"
[[ "$(stat -f '%z' "$ARCHIVE")" -eq "$ASSET_BYTES" ]] || { echo "The macOS package size does not match GitHub." >&2; exit 4; }
write_update_result started verifying
ACTUAL_DIGEST="sha256:$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
[[ "$ACTUAL_DIGEST" == "$ASSET_DIGEST" ]] || { echo "The macOS package SHA-256 does not match GitHub." >&2; exit 4; }

hdiutil attach -quiet -readonly -nobrowse -mountpoint "$MOUNT_ROOT" "$ARCHIVE"
ATTACHED=true
APP_ROOT="$MOUNT_ROOT/QuotaPin Installer.app"
PACKAGE_ROOT="$APP_ROOT/Contents/Resources/payload"
[[ -d "$PACKAGE_ROOT" && ! -L "$PACKAGE_ROOT" ]] || { echo "The macOS package root is invalid." >&2; exit 4; }
if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  echo "The macOS package contains an unexpected symbolic link." >&2
  exit 4
fi
plutil -lint "$APP_ROOT/Contents/Info.plist" >/dev/null
codesign --verify --strict --deep "$APP_ROOT"
INSTALL_ARGUMENTS=(--source "$PACKAGE_ROOT")
if [[ -n "$CODEX_APP" ]]; then INSTALL_ARGUMENTS+=(--codex-app "$CODEX_APP"); fi
write_update_result started installing
"$PACKAGE_ROOT/install.sh" "${INSTALL_ARGUMENTS[@]}"
write_update_result degraded complete
trap - ERR
