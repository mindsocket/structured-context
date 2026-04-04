#!/usr/bin/env bash
# Post-edit hook: validate the edited file after a write/edit operation.
# Reports errors attributable to the file. Claude should fix any errors
# it introduced (compare against the pre-edit baseline shown earlier).

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

RESULT=$(bunx ost-tools validate-file "$FILE_PATH" --json 2>/dev/null || true)

IN_SPACE=$(echo "$RESULT" | jq -r '.inSpace // false')
if [[ "$IN_SPACE" != "true" ]]; then
  exit 0
fi

ERROR_COUNT=$(echo "$RESULT" | jq -r '.errorCount // 0')
SPACE=$(echo "$RESULT" | jq -r '.space // ""')
LABEL=$(echo "$RESULT" | jq -r '.label // ""')

if [[ "$ERROR_COUNT" -eq 0 ]]; then
  echo "[ost-tools] $LABEL (space: $SPACE) — valid"
else
  echo "[ost-tools] $LABEL (space: $SPACE) — $ERROR_COUNT error(s) after edit:"
  echo "$RESULT" | jq -r '.errors[] | "  [\(.kind)] \(.message)"'
  echo "Fix any errors you introduced (check pre-edit baseline above to identify pre-existing ones)."
fi
