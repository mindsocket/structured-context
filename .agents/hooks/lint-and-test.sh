#!/bin/bash
# Runs linting and tests, providing feedback without blocking.

echo "🔍 Running pre-stop checks..." >&2

echo "→ Linting (with auto-fix)..." >&2
LINT_OUT=$(bun run lint:fix --reporter=summary 2>&1)
LINT_STATUS=$?

echo "→ Running tests..." >&2
TEST_OUT=$(bun run test 2>&1)
TEST_STATUS=$?

if [ $LINT_STATUS -eq 0 ] && [ $TEST_STATUS -eq 0 ]; then
    STATUS=0
    SUMMARY="✅ All checks passed!"
else
    STATUS=1
    SUMMARY="⚠️ Checks failed. Review the output below."
fi

FULL_REPORT=$(printf "Summary: %s\n\n--- Lint Output ---\n%s\n\n--- Test Output ---\n%s" "$SUMMARY" "$LINT_OUT" "$TEST_OUT")

# Escape for JSON
JSON_SAFE_REPORT=$(echo "$FULL_REPORT" | python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))')
JSON_SAFE_SUMMARY=$(echo "$SUMMARY" | python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))')

# Output JSON to stdout
# decision: "allow" ensures Gemini CLI doesn't block/retry
# systemMessage is shown to the user in Gemini CLI
# message is used by Claude Code
cat <<EOF
{
  "decision": "allow",
  "systemMessage": $JSON_SAFE_REPORT,
  "message": $JSON_SAFE_REPORT,
  "summary": $JSON_SAFE_SUMMARY
}
EOF

exit 0
