#!/usr/bin/env bash
# Runs the review check for the repo holding the hook's cwd: the session's checkout, or a
# subagent's own worktree on SubagentStop. Where cwd is a folder above several checkouts,
# each git checkout directly under it gets the check.
set -uo pipefail

check="$(dirname "$0")/review-check.sh"

# Without jq the hook stays in the directory Claude Code ran it from.
cwd="$(jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exec bash "$check"
fi

status=0
for dir in */; do
  [ -e "$dir.git" ] || continue
  (cd "$dir" && bash "$check")
  [ $? -eq 2 ] && status=2
done
exit "$status"
