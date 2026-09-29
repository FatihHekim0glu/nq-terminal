#!/bin/sh
# Start the nq-lab terminal (read only) on 127.0.0.1 from macOS or Linux; start.ps1 does the same on Windows.
#
#   ./start.sh                  the full terminal when the nq-lab venv is found, otherwise the demo
#   ./start.sh doctor           check this machine and say which mode would start
#   ./start.sh --dry-run        print the plan and start nothing
#   ./start.sh --help           every option
#
# This file only finds Node and hands over to scripts/start.mjs, which checks the Node version (web/package.json
# engines), switches to an installed Node 24 when the default one is too old, and runs the launcher
# (web/scripts/start/launcher.ts). Set NQT_NODE to a Node binary to choose one yourself.
set -eu

# CDPATH is cleared for this cd: with CDPATH set, cd prints the folder it found and `here` would hold it twice.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node=${NQT_NODE:-node}

if ! command -v "$node" >/dev/null 2>&1; then
  printf '%s\n' "start.sh: Node was not found (looked for \"$node\"). Install Node 24 (for example with nvm: nvm install 24), or set NQT_NODE to a Node 24 binary, then run ./start.sh again." >&2
  exit 1
fi

exec "$node" "$here/scripts/start.mjs" "$@"
