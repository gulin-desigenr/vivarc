#!/bin/bash
# Develop Vivarc in a separate copy of Vivaldi, so the Vivaldi you work in is never closed or changed.
#
#   tools/dev-vivaldi.sh setup     clone /Applications/Vivaldi.app to ~/Applications/Vivaldi Dev.app (APFS clone,
#                                  no extra space) with its own bundle id; run again after a Vivaldi update
#   tools/dev-vivaldi.sh apply     inject this checkout's Vivarc into the copy only
#   tools/dev-vivaldi.sh restart   apply, then quit and reopen the copy only
#   tools/dev-vivaldi.sh quit      quit the copy
#   tools/dev-vivaldi.sh doctor    check the copy's files and, while it runs, its UI (vivarc.py doctor --port)
#
# The copy has its own bundle id (com.vivaldi.Vivaldi.vivarcdev), so links, the default browser and the
# Option+Command+N shortcut keep going to the real Vivaldi. Its profile lives in
# ~/Library/Application Support/Vivaldi Dev and uses a mock keychain: the copy is signed ad hoc and must not ask
# for the real Vivaldi's "Safe Storage" keychain item. Do not sign in to accounts there.
# DevTools for its UI: http://127.0.0.1:9555 (only while the copy runs).
set -euo pipefail

SOURCE_APP="${VIVARC_SOURCE_APP:-/Applications/Vivaldi.app}"
DEV_APP="${VIVARC_DEV_APP:-$HOME/Applications/Vivaldi Dev.app}"
DEV_DATA="${VIVARC_DEV_DATA:-$HOME/Library/Application Support/Vivaldi Dev}"
DEV_ID="com.vivaldi.Vivaldi.vivarcdev"
DEBUG_PORT="${VIVARC_DEV_PORT:-9555}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

running() { pgrep -f "$DEV_APP/Contents/MacOS/Vivaldi" >/dev/null; }

quit_dev() {
  running || return 0
  osascript -e "quit app id \"$DEV_ID\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do running || return 0; sleep 0.25; done
  echo "Vivaldi Dev did not quit; close it yourself." >&2
  exit 1
}

case "${1:-}" in
  setup)
    quit_dev
    rm -rf "$DEV_APP"
    mkdir -p "$(dirname "$DEV_APP")"
    cp -cR "$SOURCE_APP" "$DEV_APP"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $DEV_ID" -c "Set :CFBundleName Vivaldi Dev" \
      -c "Set :CFBundleDisplayName Vivaldi Dev" "$DEV_APP/Contents/Info.plist"
    codesign --force --sign - "$DEV_APP"
    python3 "$HERE/vivarc.py" --app "$DEV_APP" apply
    echo "Vivaldi Dev ready at $DEV_APP"
    ;;
  apply)
    python3 "$HERE/vivarc.py" --app "$DEV_APP" apply
    ;;
  restart)
    python3 "$HERE/vivarc.py" --app "$DEV_APP" apply
    quit_dev
    open -n "$DEV_APP" --args --user-data-dir="$DEV_DATA" --no-first-run --use-mock-keychain \
      --remote-debugging-port="$DEBUG_PORT"
    ;;
  quit)
    quit_dev
    ;;
  doctor)
    if running; then
      python3 "$HERE/vivarc.py" --app "$DEV_APP" doctor --port "$DEBUG_PORT"
    else
      python3 "$HERE/vivarc.py" --app "$DEV_APP" doctor
    fi
    ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
