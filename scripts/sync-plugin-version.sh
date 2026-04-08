#!/usr/bin/env bash
# Keeps plugin/.claude-plugin/plugin.json version in sync with package.json.
#
# Rules:
#   - If package major.minor is ahead of plugin major.minor → sync plugin to
#     pkg_major.pkg_minor.0 (a minor package bump signals compatibility change)
#   - If any plugin content files are staged (excluding plugin.json itself) →
#     bump plugin patch
#   - If package is only a patch ahead → no automatic plugin change
#   - Both conditions can apply in the same commit

set -euo pipefail

PLUGIN_JSON="plugin/.claude-plugin/plugin.json"

pkg_version=$(bun -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
plugin_version=$(bun -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PLUGIN_JSON','utf8')).version)")

IFS='.' read -r pkg_major pkg_minor _pkg_patch <<< "$pkg_version"
IFS='.' read -r plugin_major plugin_minor plugin_patch <<< "$plugin_version"

# Check if any plugin content files (not plugin.json itself) are staged
staged_plugin_content=$(git diff --cached --name-only | grep "^plugin/" | grep -v "^plugin/\.claude-plugin/plugin\.json$" || true)

new_major=$plugin_major
new_minor=$plugin_minor
new_patch=$plugin_patch

# Sync major.minor if package is ahead
if [ "$pkg_major" -gt "$new_major" ] || { [ "$pkg_major" -eq "$new_major" ] && [ "$pkg_minor" -gt "$new_minor" ]; }; then
    new_major=$pkg_major
    new_minor=$pkg_minor
    new_patch=0
fi

# Bump patch if plugin content changed
if [ -n "$staged_plugin_content" ]; then
    new_patch=$((new_patch + 1))
fi

new_version="${new_major}.${new_minor}.${new_patch}"

if [ "$new_version" = "$plugin_version" ]; then
    exit 0
fi

echo "sync-plugin-version: $plugin_version → $new_version"

bun -e "
const fs = require('fs');
const path = '$PLUGIN_JSON';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
data.version = '$new_version';
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
"

git add "$PLUGIN_JSON"
