#!/usr/bin/env bash
# Exits 2 while the branch adds docs or code comments that no doc-review has seen.
# --mark records the current additions as reviewed.
set -uo pipefail

root="$(git rev-parse --show-toplevel)" || exit 0
cd "$root" || exit 0
base="$(git merge-base origin/main HEAD 2>/dev/null)" || exit 0
stamp="$(git rev-parse --git-path prose-reviewed)"

code='*.ts *.tsx *.js *.mjs *.cjs *.sh *.yml *.yaml'
generated=':!plugin/hooks/projection.js :!plugin/types/index.d.ts :!schemas/generated'

# Prints "file<TAB>kind<TAB>line" for each added prose line, untracked files included.
added() {
  {
    git diff -U0 --no-color "$base" -- '*.md' $code $generated
    git ls-files -z --others --exclude-standard -- '*.md' $code $generated |
      xargs -0 -r -n1 git diff -U0 --no-color --no-index /dev/null
  } | awk '
    /^\+\+\+ b\// { file = substr($0, 7); doc = file ~ /\.md$/; next }
    /^\+/ {
      line = substr($0, 2)
      if (doc) { if (line ~ /[^[:space:]]/) print file "\tdoc\t" line }
      else if (line ~ /^[[:space:]]*(\/\/|\/\*|\*|#)/ && line !~ /^#!/) print file "\tcomment\t" line
    }'
}

lines="$(added)"
[ -z "$lines" ] && exit 0
hash="$(printf '%s' "$lines" | git hash-object --stdin)"

if [ "${1:-}" = "--mark" ]; then
  echo "$hash" >"$stamp"
  exit 0
fi
[ "$(cat "$stamp" 2>/dev/null)" = "$hash" ] && exit 0

{
  echo "Prose added since the last doc-review:"
  printf '%s\n' "$lines" | awk -F'\t' '{ n[$1 " (" $2 ")"]++ } END { for (f in n) printf "  %4d %s\n", n[f], f }' | sort -rn
  echo "Run the doc-review skill on this diff, apply its cuts, then run scripts/prose-check.sh --mark."
} >&2
exit 2
