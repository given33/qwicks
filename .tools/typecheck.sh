#!/usr/bin/env bash
# Typecheck qwicks with the project's pinned Node 22.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE22="$SCRIPT_DIR/node-v22.13.1-win-x64"
QWICKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/qwicks"
cd "$QWICKS_DIR"
exec env -u PATH PATH="$NODE22" "$NODE22/node.exe" node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
