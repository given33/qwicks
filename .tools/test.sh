#!/usr/bin/env bash
# Run qwicks tests with the project's pinned Node 22 (matches CI NODE_VERSION=22.13.1).
# The system Node is 20.11.0 which is below rolldown's requirement (util.styleText).
# This wrapper isolates PATH to the bundled node22 so vitest forks use the right runtime.
# Usage: .tools/test.sh [vitest args...]   e.g.  .tools/test.sh src/dream/types.test.ts
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE22="$SCRIPT_DIR/node-v22.13.1-win-x64"
QWICKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/qwicks"
cd "$QWICKS_DIR"
exec env -u PATH PATH="$NODE22" "$NODE22/node.exe" node_modules/vitest/dist/cli.js "$@"
