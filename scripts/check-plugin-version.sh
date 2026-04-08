#!/usr/bin/env bash
# Verifies plugin/.claude-plugin/plugin.json version is consistent with
# package.json and plugin content changes in git history.
#
# Checks:
#   - plugin major.minor must match package major.minor
#   - no commits since the last release tag changed plugin content without
#     also updating plugin.json in the same commit
#
# Intended for pre-push and release checks — does NOT modify any files.

set -euo pipefail

PLUGIN_JSON="plugin/.claude-plugin/plugin.json"

BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if ! "$BUN" --version >/dev/null 2>&1; then
  echo "check-plugin-version: bun not found, cannot verify" >&2
  exit 1
fi

pkg_version=$("$BUN" -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
plugin_version=$("$BUN" -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).version)")

IFS='.' read -r pkg_major pkg_minor _pkg_patch <<< "$pkg_version"
IFS='.' read -r plugin_major plugin_minor _plugin_patch <<< "$plugin_version"

fail=0

# Check major.minor sync
if [ "$pkg_major" -gt "$plugin_major" ] || { [ "$pkg_major" -eq "$plugin_major" ] && [ "$pkg_minor" -gt "$plugin_minor" ]; }; then
  echo "ERROR: plugin version ($plugin_version) major.minor is behind package ($pkg_version)." >&2
  fail=1
fi

# Find the most recent release tag to use as the search baseline
last_tag=$(git describe --tags --abbrev=0 2>/dev/null || true)
range="${last_tag:+${last_tag}..}HEAD"

# Find commits in range where plugin content changed but plugin.json did NOT
unversioned=""
while IFS= read -r hash; do
  changed=$(git diff-tree --no-commit-id -r "$hash" --name-only)
  plugin_content=$(echo "$changed" | grep "^plugin/" | grep -v "^plugin/\.claude-plugin/plugin\.json$" || true)
  plugin_json_changed=$(echo "$changed" | grep "^plugin/\.claude-plugin/plugin\.json$" || true)
  if [ -n "$plugin_content" ] && [ -z "$plugin_json_changed" ]; then
    subject=$(git log -1 --format="%s" "$hash")
    unversioned="${unversioned}  ${hash:0:7} ${subject}"$'\n'
  fi
done < <(git log "$range" --format="%H")

if [ -n "$unversioned" ]; then
  echo "ERROR: plugin content changed without a version bump in:" >&2
  echo "$unversioned" >&2
  echo "Run 'bash scripts/sync-plugin-version.sh' staged with any plugin change to fix, then commit." >&2
  fail=1
fi

if [ "$fail" -eq 1 ]; then
  exit 1
fi

echo "Plugin version ($plugin_version) is consistent."
