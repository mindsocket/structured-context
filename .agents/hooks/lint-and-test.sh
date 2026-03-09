#!/bin/bash
# Run linting and tests before agent stop
# Exit code 0: all checks passed (allow)
# Exit code 2: checks failed (deny/block for both Claude Code and Gemini CLI)

STATUS=0
echo "🔍 Running pre-stop checks..." >&2

echo "→ Linting (with auto-fix)..." >&2
if ! bun run lint:fix --error-on-warnings --reporter=summary >&2; then
    STATUS=2
fi

echo "→ Running tests..." >&2
if ! bun run test --only-failures >&2; then
    STATUS=2
fi

echo "→ Running build..." >&2
if ! bun run build >&2; then
    STATUS=2
fi

if [ $STATUS -ne 0 ]; then
    echo "⚠️ Checks failed. Review output above." >&2
    exit $STATUS
else
    exit 0
fi