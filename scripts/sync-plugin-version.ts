#!/usr/bin/env bun
/**
 * Keeps plugin/.claude-plugin/plugin.json version in sync with package.json.
 *
 * Sync mode (default): Bumps plugin version if needed based on staged changes.
 * Check mode (--check): Validates that plugin content changes since the fork point
 *                     from origin/main include a version bump.
 *
 * Usage:
 *   bun run scripts/sync-plugin-version.ts         # sync mode
 *   bun run scripts/sync-plugin-version.ts --check # check mode
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemVer {
  const parts = version.split('.').map(Number);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0 };
}

function formatSemver(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const PLUGIN_JSON = 'plugin/.claude-plugin/plugin.json';
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const isCheck = process.argv.slice(2).includes('--check');
// Check mode judges the commits being pushed, not the working tree.
const plugin = JSON.parse(
  (isCheck ? tryExec(`git show HEAD:${PLUGIN_JSON}`) : null) ?? readFileSync(PLUGIN_JSON, 'utf-8'),
);

const pkgVersion = parseSemver(pkg.version);
const pluginVersion = parseSemver(plugin.version);

function syncMode(): void {
  const newVersion = { ...pluginVersion };

  // Sync major.minor if package is ahead
  if (
    pkgVersion.major > newVersion.major ||
    (pkgVersion.major === newVersion.major && pkgVersion.minor > newVersion.minor)
  ) {
    newVersion.major = pkgVersion.major;
    newVersion.minor = pkgVersion.minor;
    newVersion.patch = 0;
  }

  // Bump patch if plugin content is staged
  const staged = tryExec('git diff --cached --name-only') ?? '';
  const stagedPluginContent = staged.split('\n').filter((line) => line.startsWith('plugin/') && line !== PLUGIN_JSON);

  if (stagedPluginContent.length > 0) {
    newVersion.patch += 1;
  }

  const newVersionStr = formatSemver(newVersion);
  const currentVersionStr = formatSemver(pluginVersion);

  if (newVersionStr === currentVersionStr) {
    return;
  }

  console.error(`sync-plugin-version: ${currentVersionStr} → ${newVersionStr}`);

  plugin.version = newVersionStr;
  writeFileSync(PLUGIN_JSON, `${JSON.stringify(plugin, null, 2)}\n`);

  // JSON.stringify's layout differs from biome's (e.g. short arrays on one line). Format here because
  // the biome pre-commit job only sees files that were staged before this script ran.
  if (tryExec(`bunx @biomejs/biome format --write ${PLUGIN_JSON}`) === null) {
    console.error(`sync-plugin-version: biome format failed for ${PLUGIN_JSON}`);
  }

  // Stage the updated plugin.json
  tryExec(`git add ${PLUGIN_JSON}`);
}

function checkMode(): void {
  const errors: string[] = [];

  // Check major.minor sync
  if (
    pkgVersion.major > pluginVersion.major ||
    (pkgVersion.major === pluginVersion.major && pkgVersion.minor > pluginVersion.minor)
  ) {
    errors.push(
      `plugin version (${formatSemver(pluginVersion)}) major.minor is behind package (${formatSemver(pkgVersion)})`,
    );
  }

  // Consumers install the plugin from main, so each change landing there needs one bump,
  // in any of its commits. Fetch so a branch can't count a bump main already has.
  tryExec('git fetch --quiet origin main');
  const base = tryExec('git merge-base HEAD origin/main') ?? tryExec('git describe --tags --abbrev=0') ?? '';
  const range = base ? `${base}..HEAD` : 'HEAD';
  const changed = tryExec(`git diff --name-only ${range}`) ?? '';
  const pluginContentChanged = changed.split('\n').some((file) => file.startsWith('plugin/') && file !== PLUGIN_JSON);

  if (pluginContentChanged) {
    const basePlugin = base ? tryExec(`git show ${base}:${PLUGIN_JSON}`) : null;
    const basePluginVersion = basePlugin
      ? parseSemver(JSON.parse(basePlugin).version)
      : { major: 0, minor: 0, patch: 0 };

    if (
      pluginVersion.major < basePluginVersion.major ||
      (pluginVersion.major === basePluginVersion.major && pluginVersion.minor < basePluginVersion.minor) ||
      (pluginVersion.major === basePluginVersion.major &&
        pluginVersion.minor === basePluginVersion.minor &&
        pluginVersion.patch <= basePluginVersion.patch)
    ) {
      errors.push(
        `plugin content changed since ${base ? 'origin/main' : 'the first commit'}, but plugin version (${formatSemver(pluginVersion)}) was not bumped from ${formatSemver(basePluginVersion)}`,
      );
      errors.push("Run 'bash scripts/sync-plugin-version.sh' staged with any plugin change to fix, then commit.");
    }
  }

  if (errors.length > 0) {
    console.error(`ERROR: ${errors.join('\n')}`);
    process.exit(1);
  }

  console.error(`Plugin version (${formatSemver(pluginVersion)}) is consistent.`);
}

// Main
if (isCheck) {
  checkMode();
} else {
  syncMode();
}
