#!/usr/bin/env bash
# Keeps plugin/.claude-plugin/plugin.json version in sync with package.json.
#
# Wrapper for scripts/sync-plugin-version.ts
#
# Usage:
#   bash scripts/sync-plugin-version.sh         # sync mode
#   bash scripts/sync-plugin-version.sh --check # check mode

set -euo pipefail

BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if ! "$BUN" --version >/dev/null 2>&1; then
  echo "sync-plugin-version: bun not found, cannot sync plugin version" >&2
  exit 1
fi

"$BUN" run scripts/sync-plugin-version.ts "$@"