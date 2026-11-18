#!/usr/bin/env bash
# Runs the review check for the session's repo. A session started in a folder above
# several checkouts gets the check for each git checkout directly under it.
set -uo pipefail

check="$(dirname "$0")/review-check.sh"

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
