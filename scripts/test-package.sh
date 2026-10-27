#!/usr/bin/env bash
# Pack the package, install the tarball into an empty project, and run the installed CLI,
# so a broken build or a missing file fails here rather than after `npm publish`.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cd "$root"
bun run build >/dev/null
npm pack --silent --pack-destination "$tmp" >/dev/null

cd "$tmp"
echo '{}' >package.json
bun add ./structured-context-*.tgz >/dev/null
fixture=$root/tests/fixtures/rule-severity
cat >config.json <<EOF
{ "spaces": [{ "name": "smoke", "path": "$fixture/clean", "schema": "$fixture/schema.json" }] }
EOF
export SCTX_CONFIG="$tmp/config.json"

sctx=node_modules/.bin/sctx
"$sctx" --version
"$sctx" plugins >/dev/null
"$sctx" docs concepts >/dev/null
"$sctx" validate smoke >/dev/null
"$sctx" dump smoke --graph >graph.json
cat >browser.mjs <<'EOF2'
import { readFileSync } from 'node:fs';
import { spaceGraphFrom } from 'structured-context/browser';
const graph = spaceGraphFrom(JSON.parse(readFileSync('graph.json', 'utf-8')));
if (graph.nodes.size === 0) throw new Error('empty graph from structured-context/browser');
EOF2
bun browser.mjs
echo "package ok"
