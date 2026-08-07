#!/bin/bash
set -euo pipefail

REPOSITORY="WSL043/QuotaPin-for-Codex"
REQUESTED_VERSION=""
CODEX_APP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) REQUESTED_VERSION="$2"; shift 2 ;;
    --codex-app) CODEX_APP="$2"; shift 2 ;;
    *) echo "Unknown installer argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer runs only on macOS." >&2
  exit 2
fi
if [[ -n "$REQUESTED_VERSION" && ! "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]]; then
  echo "Invalid QuotaPin version: $REQUESTED_VERSION" >&2
  exit 2
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quotapin-macos.XXXXXX")"
cleanup() { rm -rf "$TEMP_ROOT"; }
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
DRAFT="$(plutil -extract draft raw -o - "$RELEASE_JSON")"
PRERELEASE="$(plutil -extract prerelease raw -o - "$RELEASE_JSON")"
IMMUTABLE="$(plutil -extract immutable raw -o - "$RELEASE_JSON" 2>/dev/null || true)"
[[ "$DRAFT" == "false" ]] || { echo "Refusing a draft GitHub release." >&2; exit 3; }
if [[ -z "$REQUESTED_VERSION" ]]; then
  [[ "$PRERELEASE" == "false" ]] || { echo "GitHub returned a prerelease for the stable channel." >&2; exit 3; }
fi
[[ "$IMMUTABLE" == "true" ]] || { echo "The selected GitHub release is not immutable." >&2; exit 3; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]] || { echo "GitHub returned an invalid tag: $TAG" >&2; exit 3; }

ASSET_NAME="QuotaPin-macOS-$VERSION.tar.gz"
ASSET_URL=""
ASSET_DIGEST=""
index=0
while name="$(plutil -extract "assets.$index.name" raw -o - "$RELEASE_JSON" 2>/dev/null)"; do
  if [[ "$name" == "$ASSET_NAME" ]]; then
    ASSET_URL="$(plutil -extract "assets.$index.browser_download_url" raw -o - "$RELEASE_JSON")"
    ASSET_DIGEST="$(plutil -extract "assets.$index.digest" raw -o - "$RELEASE_JSON")"
    break
  fi
  index=$((index + 1))
done
[[ -n "$ASSET_URL" ]] || {
  echo "QuotaPin $VERSION does not contain the macOS package yet. Choose a release that publishes $ASSET_NAME." >&2
  exit 4
}
[[ "$ASSET_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "The macOS release asset has no trusted SHA-256 digest." >&2; exit 4; }

ARCHIVE="$TEMP_ROOT/$ASSET_NAME"
echo "Downloading $ASSET_NAME"
curl --fail --show-error --location --retry 6 --retry-all-errors --connect-timeout 20 \
  --max-time 600 --continue-at - "$ASSET_URL" --output "$ARCHIVE"
ACTUAL_DIGEST="sha256:$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
[[ "$ACTUAL_DIGEST" == "$ASSET_DIGEST" ]] || { echo "The macOS package SHA-256 does not match GitHub." >&2; exit 4; }

while IFS= read -r entry; do
  case "$entry" in
    /*|../*|*/../*|*/..) echo "Unsafe archive path: $entry" >&2; exit 4 ;;
  esac
done < <(tar -tzf "$ARCHIVE")
tar -xzf "$ARCHIVE" -C "$TEMP_ROOT"
PACKAGE_ROOT="$TEMP_ROOT/QuotaPin-macOS-$VERSION"
[[ -d "$PACKAGE_ROOT" && ! -L "$PACKAGE_ROOT" ]] || { echo "The macOS package root is invalid." >&2; exit 4; }
if find "$PACKAGE_ROOT" -type l -print -quit | grep -q .; then
  echo "The macOS package contains an unexpected symbolic link." >&2
  exit 4
fi
INSTALL_ARGUMENTS=(--source "$PACKAGE_ROOT")
if [[ -n "$CODEX_APP" ]]; then INSTALL_ARGUMENTS+=(--codex-app "$CODEX_APP"); fi
"$PACKAGE_ROOT/install.sh" "${INSTALL_ARGUMENTS[@]}"
