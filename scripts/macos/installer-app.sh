#!/bin/bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
PAYLOAD="$APP_ROOT/Contents/Resources/payload"
HEADLESS=false
[[ "${1:-}" == "--headless" ]] && HEADLESS=true

LOG_ROOT="$HOME/Library/Logs/QuotaPin"
LOG_PATH="$LOG_ROOT/installer.log"
mkdir -p "$LOG_ROOT"
chmod 700 "$LOG_ROOT"

show_result() {
  local succeeded="$1"
  [[ "$HEADLESS" == false ]] || return 0
  local locale
  locale="$(defaults read -g AppleLocale 2>/dev/null || true)"
  local title="QuotaPin"
  local message
  if [[ "$succeeded" == true ]]; then
    case "$locale" in
      zh*) message="安装完成。请像平常一样从官方图标打开 Codex。" ;;
      ja*) message="インストールが完了しました。いつもどおり公式アイコンから Codex を開いてください。" ;;
      *) message="Installation finished. Open Codex from its official icon as usual." ;;
    esac
  else
    case "$locale" in
      zh*) message="安装失败。诊断日志已保存在 ~/Library/Logs/QuotaPin/installer.log。" ;;
      ja*) message="インストールに失敗しました。診断ログは ~/Library/Logs/QuotaPin/installer.log に保存されています。" ;;
      *) message="Installation failed. The diagnostic log is at ~/Library/Logs/QuotaPin/installer.log." ;;
    esac
  fi
  /usr/bin/osascript - "$title" "$message" <<'APPLESCRIPT' >/dev/null || true
on run argv
  display dialog (item 2 of argv) with title (item 1 of argv) buttons {"OK"} default button "OK"
end run
APPLESCRIPT
}

{
  printf '\n[%s] QuotaPin Installer started\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  if [[ ! -x "$PAYLOAD/install.sh" ]]; then
    echo "Installer payload is incomplete: $PAYLOAD"
    show_result false
    exit 4
  fi
  if "$PAYLOAD/install.sh" --source "$PAYLOAD"; then
    show_result true
    exit 0
  else
    status=$?
    show_result false
    exit "$status"
  fi
} >>"$LOG_PATH" 2>&1
