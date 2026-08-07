QuotaPin for macOS

QuotaPin is installed per user and does not modify the official Codex app.
Its LaunchAgent waits for a normal launch from the official Codex icon, then
allows at most one generation-bound handoff to add a loopback-only debugging
port. A failed handoff is latched and will not be retried while Codex remains
open.

The downloaded package is self-contained. Node.js and Homebrew are not needed.
Installation and updates preserve config.json and do not close or relaunch an
already-running Codex session.

Uninstall from Terminal with:

  "$HOME/Library/Application Support/QuotaPin/uninstall.sh"

The uninstaller removes QuotaPin's LaunchAgent, verified Agent process,
configuration, logs, and application files. It leaves the official Codex app
unchanged.
