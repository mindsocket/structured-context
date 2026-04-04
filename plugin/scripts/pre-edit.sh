#!/usr/bin/env bash
# Pre-edit hook: capture validation baseline before a file is modified.
# Output is fed to Claude as context so it knows which errors pre-existed the edit.
# Claude should not attempt to fix errors that were already present before the edit.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Not all edit tools provide file_path (e.g. MultiEdit uses the same field, but check anyway)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only run for .md files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

RESULT=$(bunx ost-tools validate-file "$FILE_PATH" --json 2>/dev/null || true)

# If the file isn't in any space, nothing to report
IN_SPACE=$(echo "$RESULT" | jq -r '.inSpace // false')
if [[ "$IN_SPACE" != "true" ]]; then
  exit 0
fi

ERROR_COUNT=$(echo "$RESULT" | jq -r '.errorCount // 0')
SPACE=$(echo "$RESULT" | jq -r '.space // ""')
LABEL=$(echo "$RESULT" | jq -r '.label // ""')

if [[ "$ERROR_COUNT" -eq 0 ]]; then
  echo "[ost-tools] Pre-edit baseline: $LABEL (space: $SPACE) — no existing errors"
else
  echo "[ost-tools] Pre-edit baseline: $LABEL (space: $SPACE) — $ERROR_COUNT pre-existing error(s):"
  echo "$RESULT" | jq -r '.errors[] | "  [\(.kind)] \(.message)"'
  echo "Do not fix these — they existed before your edit."
fi
