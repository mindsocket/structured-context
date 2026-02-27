#!/bin/bash
# Run linting and tests before task stop
# Exit code 1: warning (show results but don't block stop)
# Exit code 0: all checks passed

echo "🔍 Running pre-stop checks..." >&2

# Track overall status
STATUS=0

echo "→ Linting (with auto-fix)..." >&2
if ! bun run lint:fix --error-on-warnings --reporter=summary; then
    STATUS=1
fi

echo "" >&2
echo "→ Running tests..." >&2
if ! bun run test --only-failures; then
    STATUS=1
fi

if [ $STATUS -ne 0 ]; then
    echo "⚠️ Checks failed. Review output above." >&2
else
    echo "✅ All checks passed!" >&2
fi

exit $STATUS