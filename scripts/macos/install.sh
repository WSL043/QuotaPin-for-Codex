#!/bin/bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd -P || true)"
if [[ -x "$SCRIPT_DIR/QuotaPin.Mac" ]]; then
  SOURCE="$SCRIPT_DIR"
else
  SOURCE="$REPOSITORY_ROOT/dist/macos-native"
fi
START_SERVICE=true
CODEX_APP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$(cd "$2" && pwd -P)"; shift 2 ;;
    --codex-app) CODEX_APP="$2"; shift 2 ;;
    --no-start) START_SERVICE=false; shift ;;
    *) echo "Unknown macOS installer argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "QuotaPin for macOS can be installed only on macOS." >&2
  exit 2
fi
if [[ -z "${HOME:-}" || "$HOME" == "/" ]]; then
  echo "Could not resolve the current macOS home directory." >&2
  exit 3
fi

TARGET="$HOME/Library/Application Support/QuotaPin"
TARGET_PARENT="$HOME/Library/Application Support"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LABEL="io.github.wsl043.quotapin"
PLIST="$LAUNCH_AGENTS/$LABEL.plist"
DOMAIN="gui/$(id -u)"
STAGING="$TARGET.installing.$$"
PREVIOUS="$TARGET.previous.$$"
PLIST_BACKUP="$TARGET_PARENT/.quotapin-launchagent.previous.$$"
ACTIVATED=false
CUTOVER_STARTED=false
TARGET_REPLACED=false
PREVIOUS_MOVED=false
PLIST_REPLACED=false
OLD_SERVICE_ACTIVE=false

case "$TARGET" in
  "$HOME/Library/Application Support/QuotaPin") ;;
  *) echo "Refusing unresolved install target: $TARGET" >&2; exit 3 ;;
esac

for name in ARCH QuotaPin.Agent QuotaPin.Mac config.default.json install.sh uninstall.sh update.sh VERSION COMMIT LICENSE README.txt THIRD_PARTY_NOTICES.txt MANIFEST.sha256; do
  [[ -f "$SOURCE/$name" && ! -L "$SOURCE/$name" ]] || {
    echo "The macOS package is incomplete: $name" >&2
    exit 4
  }
done
[[ -x "$SOURCE/QuotaPin.Agent" && -x "$SOURCE/QuotaPin.Mac" ]] || {
  echo "The macOS executables are not runnable." >&2
  exit 4
}
VERSION="$(tr -d '\r\n' < "$SOURCE/VERSION")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?$ ]] || {
  echo "The macOS package has an invalid version: $VERSION" >&2
  exit 4
}
(
  cd "$SOURCE"
  shasum -a 256 -c MANIFEST.sha256 >/dev/null
)
codesign --verify --strict "$SOURCE/QuotaPin.Agent"
codesign --verify --strict "$SOURCE/QuotaPin.Mac"
[[ "$($SOURCE/QuotaPin.Agent --agent-version)" == "$VERSION" ]]
[[ "$($SOURCE/QuotaPin.Mac --launcher-version)" == "$VERSION" ]]

if [[ -z "$CODEX_APP" && -f "$TARGET/install-state.json" ]]; then
  CODEX_APP="$(plutil -extract codexApp raw -o - "$TARGET/install-state.json" 2>/dev/null || true)"
fi
if [[ -n "$CODEX_APP" ]]; then
  [[ "$CODEX_APP" == /* && "$CODEX_APP" == *.app && -d "$CODEX_APP" && ! -L "$CODEX_APP" ]] || {
    echo "The explicit Codex application path is invalid: $CODEX_APP" >&2
    exit 4
  }
  CODEX_APP="$(cd "$CODEX_APP" && pwd -P)"
fi

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

write_plist() {
  local destination="$1"
  local escaped_binary escaped_stdout escaped_stderr
  escaped_binary="$(xml_escape "$TARGET/QuotaPin.Mac")"
  escaped_stdout="$(xml_escape "$TARGET/logs/launchagent.stdout.log")"
  escaped_stderr="$(xml_escape "$TARGET/logs/launchagent.stderr.log")"
  cat > "$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_binary</string>
    <string>watch</string>
    <string>--ignore-existing</string>
$(if [[ -n "$CODEX_APP" ]]; then printf '    <string>--codex-app</string>\n    <string>%s</string>\n' "$(xml_escape "$CODEX_APP")"; fi)
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$escaped_stdout</string>
  <key>StandardErrorPath</key><string>$escaped_stderr</string>
</dict>
</plist>
EOF
  plutil -lint "$destination" >/dev/null
}

bootout_service() {
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
}

test_fault() {
  if [[ "${QUOTAPIN_TEST_FAULT_AT:-}" == "$1" ]]; then
    echo "Injected macOS installer fault at $1." >&2
    return 97
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR INT TERM
  if [[ "$CUTOVER_STARTED" == true ]]; then
    bootout_service
    if [[ "$TARGET_REPLACED" == true && -e "$TARGET" ]]; then rm -rf "$TARGET"; fi
    if [[ "$PREVIOUS_MOVED" == true && -e "$PREVIOUS" ]]; then mv "$PREVIOUS" "$TARGET"; fi
    if [[ "$PLIST_REPLACED" == true ]]; then rm -f "$PLIST"; fi
    if [[ -f "$PLIST_BACKUP" ]]; then
      mkdir -p "$LAUNCH_AGENTS"
      cp "$PLIST_BACKUP" "$PLIST"
    fi
    if [[ "$OLD_SERVICE_ACTIVE" == true && -f "$PLIST" ]]; then
      launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$STAGING" "$PREVIOUS"
  rm -f "$PLIST_BACKUP" "$PLIST.installing.$$"
  echo "QuotaPin macOS installation failed; the previous installation was restored when available." >&2
  exit "$exit_code"
}
trap rollback ERR INT TERM

mkdir -p "$TARGET_PARENT" "$LAUNCH_AGENTS"
rm -rf "$STAGING" "$PREVIOUS"
mkdir -p "$STAGING/logs"
for name in ARCH QuotaPin.Agent QuotaPin.Mac LICENSE README.txt THIRD_PARTY_NOTICES.txt VERSION COMMIT MANIFEST.sha256 config.default.json update.sh; do
  cp "$SOURCE/$name" "$STAGING/$name"
done
cp "$SOURCE/install.sh" "$STAGING/install.sh"
cp "$SOURCE/uninstall.sh" "$STAGING/uninstall.sh"
chmod 755 "$STAGING/QuotaPin.Agent" "$STAGING/QuotaPin.Mac" "$STAGING/install.sh" "$STAGING/uninstall.sh" "$STAGING/update.sh"

if [[ -f "$TARGET/config.json" && ! -L "$TARGET/config.json" ]]; then
  cp "$TARGET/config.json" "$STAGING/config.json"
else
  cp "$SOURCE/config.default.json" "$STAGING/config.json"
fi
chmod 600 "$STAGING/config.json"
if [[ -d "$TARGET/logs" && ! -L "$TARGET/logs" ]]; then
  cp -R "$TARGET/logs/." "$STAGING/logs/"
fi
plutil -create json "$STAGING/install-state.json"
plutil -insert schema -integer 1 "$STAGING/install-state.json"
plutil -insert owner -string command "$STAGING/install-state.json"
plutil -insert platform -string macos "$STAGING/install-state.json"
plutil -insert version -string "$VERSION" "$STAGING/install-state.json"
plutil -insert preferences -json '{"autoAttach":true}' "$STAGING/install-state.json"
if [[ -n "$CODEX_APP" ]]; then plutil -insert codexApp -string "$CODEX_APP" "$STAGING/install-state.json"; fi
chmod 600 "$STAGING/install-state.json"
test_fault after-stage

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then OLD_SERVICE_ACTIVE=true; fi
if [[ -f "$PLIST" ]]; then cp "$PLIST" "$PLIST_BACKUP"; fi
CUTOVER_STARTED=true
bootout_service
if [[ -e "$TARGET" ]]; then
  mv "$TARGET" "$PREVIOUS"
  PREVIOUS_MOVED=true
fi
mv "$STAGING" "$TARGET"
TARGET_REPLACED=true
test_fault after-target-move
PLIST_TEMP="$PLIST.installing.$$"
write_plist "$PLIST_TEMP"
chmod 600 "$PLIST_TEMP"
mv "$PLIST_TEMP" "$PLIST"
PLIST_REPLACED=true
test_fault after-plist-replace

if [[ "$START_SERVICE" == true ]]; then
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  launchctl print "$DOMAIN/$LABEL" >/dev/null
  ACTIVATED=true
fi

rm -rf "$PREVIOUS"
rm -f "$PLIST_BACKUP"
trap - ERR INT TERM
printf 'QuotaPin %s installed for macOS. Open Codex from its official icon as usual.\n' "$VERSION"
if [[ "$ACTIVATED" == false ]]; then
  printf 'The LaunchAgent was staged but not started because --no-start was requested.\n'
fi
