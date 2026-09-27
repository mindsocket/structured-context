#!/usr/bin/env bash
# Runs lint, typecheck and the unit and hook-unit suites against the commits being
# pushed rather than the working tree, so uncommitted work in progress can neither
# mask a problem nor block a good push.
#
# The checks run in a detached worktree at HEAD, created in a temp directory, with
# node_modules symlinked in. A linked worktree nested inside the main checkout (e.g.
# .claude/worktrees/*) has no node_modules of its own, so fall back to the main
# checkout's.
#
# Lefthook does not forward git's pre-push stdin, so the pushed ref is taken as
# HEAD. Pushing a ref other than the current branch checks HEAD instead.
set -uo pipefail

root="$(git rev-parse --show-toplevel)" || exit 1
cd "$root" || exit 1

tmp="$(mktemp -d)"
wt="$tmp/pushed-tree"
cleanup() {
  git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1
  git -C "$root" worktree prune >/dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT

if ! git worktree add --detach "$wt" HEAD >/dev/null 2>&1; then
  echo "could not create a worktree for the pushed commits; skipping checks"
  exit 0
fi

modules="$root/node_modules"
if [ ! -d "$modules" ]; then
  main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
  modules="$main_root/node_modules"
fi
if [ ! -d "$modules" ]; then
  echo "no node_modules found (run bun install); skipping checks"
  exit 0
fi
ln -s "$modules" "$wt/node_modules"
cd "$wt" || exit 1

status=0
echo "checking $(git rev-parse --short HEAD), not the working tree"

bun run lint || status=1
bun run typecheck || status=1
bun run test || status=1
bun run test:hook || status=1

exit "$status"
