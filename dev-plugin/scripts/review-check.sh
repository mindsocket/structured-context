#!/usr/bin/env bash
# Exits 2 while the branch adds prose (docs and code comments) or tests that no review
# has seen. A kind argument (prose or tests) checks that kind only. --mark <kind>
# records the current additions of that kind as reviewed.
#
# Paths with the linguist-generated attribute in .gitattributes are left out.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

mark=
if [ "${1:-}" = "--mark" ]; then
  mark=1
  shift
  if [ $# -ne 1 ]; then
    echo "usage: $script --mark prose|tests" >&2
    exit 1
  fi
fi
kinds="${*:-prose tests}"
for kind in $kinds; do
  case "$kind" in
    prose | tests) ;;
    *)
      echo "unknown kind: $kind (expected prose or tests)" >&2
      exit 1
      ;;
  esac
done

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

# A slow or unreachable remote must not hold up a hook, so the fetch gets 10 seconds.
git fetch --quiet origin main >/dev/null 2>&1 &
fetch=$!
(sleep 10 && kill "$fetch") >/dev/null 2>&1 &
watch=$!
wait "$fetch" 2>/dev/null
kill "$watch" 2>/dev/null

base="$(git merge-base origin/main HEAD 2>/dev/null)" || exit 0

# Prints "file<TAB>label<TAB>line" for each added line of the kind, untracked files included.
added() {
  local specs
  case "$1" in
    prose) specs=('*.md' '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.sh' '*.yml' '*.yaml' '*.json5' '*.jsonc') ;;
    tests) specs=('*.test.*' '*.spec.*') ;;
  esac
  specs+=(':(exclude,attr:linguist-generated)')
  {
    git diff -U0 --no-color "$base" -- "${specs[@]}"
    git ls-files -z --others --exclude-standard -- "${specs[@]}" |
      xargs -0 -r -n1 git diff -U0 --no-color --no-index /dev/null
  } | awk -v kind="$1" '
    /^\+\+\+ b\// { file = substr($0, 7); doc = file ~ /\.md$/; next }
    /^\+/ {
      line = substr($0, 2)
      if (line !~ /[^[:space:]]/) next
      if (kind == "tests") print file "\ttest\t" line
      else if (doc) print file "\tdoc\t" line
      else if (line ~ /^[[:space:]]*(\/\/|\/\*|\*|#)/ && line !~ /^#!/) print file "\tcomment\t" line
    }'
}

status=0
for kind in $kinds; do
  lines="$(added "$kind")"
  stamp="$(git rev-parse --git-path "$kind-reviewed")"
  hash="$(printf '%s' "$lines" | git hash-object --stdin)"
  if [ -n "$mark" ]; then
    echo "$hash" >"$stamp"
    continue
  fi
  [ -z "$lines" ] && continue
  [ "$(cat "$stamp" 2>/dev/null)" = "$hash" ] && continue

  case "$kind" in
    prose) what="Prose" skill="doc-review" ;;
    tests) what="Tests" skill="test-review" ;;
  esac
  {
    echo "$what added in $root since the last $skill:"
    printf '%s\n' "$lines" | awk -F'\t' '{ n[$1 " (" $2 ")"]++ } END { for (f in n) printf "  %4d %s\n", n[f], f }' | sort -rn
    echo "Run the $skill skill on this diff, apply its findings, then run $script --mark $kind."
  } >&2
  status=2
done
exit "$status"
