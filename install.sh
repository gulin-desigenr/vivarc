#!/bin/bash
# Vivarc: one-line install, update and repair for macOS.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/gulin-desigenr/vivarc/main/install.sh)"
#
# It downloads the current fork main into ~/.vivarc/app and runs its installer. Running it again updates
# Vivarc and re-applies it after a Vivaldi update. Extra arguments go to `vivarc.py install` (for example --no-peek).
set -e

REPO="gulin-desigenr/vivarc"
DEST="$HOME/.vivarc/app"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "Vivarc is for macOS."
[ "$(id -u)" != "0" ] || fail "Do not use sudo. Run this command as yourself; if macOS blocks it, the installer will guide you."

if [ -L "$DEST" ]; then
  fail "This Vivarc installation uses a linked Git checkout. Run python3 ~/.vivarc/app/vivarc.py update instead."
fi

if ! xcode-select -p >/dev/null 2>&1; then
  say "Vivarc needs Python, which comes with Apple's free command line developer tools."
  say "A window is about to appear: click Install, wait for it to finish (a few minutes), then run this command again."
  xcode-select --install >/dev/null 2>&1 || true
  exit 1
fi
PYTHON=/usr/bin/python3
[ -x "$PYTHON" ] || fail "python3 was not found at $PYTHON."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="${VIVARC_TARBALL_URL:-}"
if [ -z "$URL" ]; then
  say "Downloading the Vivarc fork (main)..."
  URL="https://github.com/$REPO/archive/refs/heads/main.tar.gz"
fi
curl -fsSL "$URL" -o "$TMP/vivarc.tar.gz" || fail "Download failed. Check your internet connection."
mkdir "$TMP/src"
tar -xzf "$TMP/vivarc.tar.gz" -C "$TMP/src" --strip-components=1
[ -f "$TMP/src/vivarc.py" ] || fail "The download does not look like Vivarc."

mkdir -p "$HOME/.vivarc"
rm -rf "$DEST"
mv "$TMP/src" "$DEST"

exec "$PYTHON" "$DEST/vivarc.py" install "$@"
