QuotaPin for macOS

QuotaPin is installed per user and does not modify the official Codex app.
Its LaunchAgent waits for a normal launch from the official Codex icon, then
allows at most one generation-bound handoff to add a loopback-only debugging
port. A failed handoff is latched and will not be retried while Codex remains
open.

The downloaded package needs no separate Node.js or Homebrew. Its thin native
host verifies and uses the signed runtime already inside official Codex; it
does not download a fallback runtime.
Installation and updates preserve config.json and do not close or relaunch an
already-running Codex session.

Uninstall from Terminal with:

  "$HOME/Library/Application Support/QuotaPin/uninstall.sh"

The uninstaller removes QuotaPin's LaunchAgent, verified Agent process,
configuration, logs, and application files. It leaves the official Codex app
unchanged.
