#!/usr/bin/env bash
#
# Start the game at http://localhost:5173/ and open a browser on it.
#
# It exists because none of the three things standing between a clone and a
# playable window are in `npm run dev`: node may not be on PATH, node_modules
# may not exist, and Vite quietly moves to the next free port when 5173 is
# taken. Each of those fails in its own way, and only the last one fails
# silently.
#
#   ./start.sh              start the server and open a browser on it
#   ./start.sh --no-open    just the server
#
# Ctrl-C stops it. npm run dev is exec'd, so the signal reaches Vite directly
# rather than being absorbed by this script.
set -eu

URL='http://localhost:5173/'
OPEN=1
[ "${1:-}" = '--no-open' ] && OPEN=0

# Run from the project root whatever directory the script was invoked from, so
# npm finds package.json.
cd "$(dirname "$0")"

# CLAUDE.md's PATH note, applied rather than remembered: Node 24 lives here, but
# a shell whose environment predates the install doesn't know that. Only
# prepended when node is genuinely missing, so a different Node on PATH wins.
if ! command -v node >/dev/null 2>&1; then
  export PATH="/c/Program Files/nodejs:$PATH"
  command -v node >/dev/null 2>&1 || {
    echo "start.sh: node not found, and not at /c/Program Files/nodejs either." >&2
    echo "Install Node 24 LTS, or put your own on PATH before running this." >&2
    exit 1
  }
fi

# Opening a URL is per-platform, and Git Bash is the shell this repo is developed
# in — hence cmd's start first. The others are here so the script isn't
# Windows-only for the sake of one line.
open_url() {
  if command -v cmd >/dev/null 2>&1; then
    # The empty "" is start's title argument; without it start treats the URL as
    # one. The // is Git Bash's escape so /c isn't rewritten into a path.
    cmd //c start "" "$1" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$1" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 &
  else
    echo "start.sh: open $1 yourself — no browser launcher found." >&2
  fi
}

serving() { curl -sf -o /dev/null --max-time 2 "$URL"; }

# A second server on the same port is the one case where doing nothing is right.
# Vite would either refuse to start (--strict-port, below) or drift to 5174,
# where the game runs but every headless driver and every bookmark still points
# at 5173.
if serving; then
  echo "Already serving $URL — leaving it alone."
  [ "$OPEN" = 1 ] && open_url "$URL"
  exit 0
fi

[ -d node_modules ] || npm install

# Wait for the server rather than opening immediately: a cold Vite start takes a
# moment, and a browser that lands first shows a connection error and stays
# there. Backgrounded before the server, since the line below never returns.
if [ "$OPEN" = 1 ]; then
  (
    for _ in $(seq 240); do
      serving && { open_url "$URL"; exit 0; }
      sleep 0.25
    done
    echo "start.sh: $URL never came up — not opening a browser." >&2
  ) &
fi

# --strict-port turns "5173 is taken" into an error instead of a different port.
# The base stays relative (vite.config.js) and the server stays at the root,
# which is where the drivers navigate — don't add a base here.
exec npm run dev -- --port 5173 --strict-port
