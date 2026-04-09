#!/usr/bin/env bun
/**
 * Keeps plugin/.claude-plugin/plugin.json version in sync with package.json.
 *
 * Sync mode (default): Bumps plugin version if needed based on staged changes.
 * Check mode (--check): Validates that no plugin content changes were committed
 *                     without a version bump since the last release tag.
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
const plugin = JSON.parse(readFileSync(PLUGIN_JSON, 'utf-8'));

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

  // Find commits where plugin content changed but plugin.json did NOT
  const lastTag = tryExec('git describe --tags --abbrev=0') ?? '';
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';

  const commits = tryExec(`git log ${range} --format=%H`)?.split('\n') ?? [];

  const unversioned: string[] = [];
  for (const hash of commits) {
    if (!hash) continue;

    const changed = tryExec(`git diff-tree --no-commit-id -r ${hash} --name-only`) ?? '';
    const files = changed.split('\n');

    const pluginContent = files.filter((f) => f.startsWith('plugin/') && f !== PLUGIN_JSON);
    const pluginJsonChanged = files.includes(PLUGIN_JSON);

    if (pluginContent.length > 0 && !pluginJsonChanged) {
      const subject = tryExec(`git log -1 --format=%s ${hash}`) ?? '';
      unversioned.push(`  ${hash.slice(0, 7)} ${subject}`);
    }
  }

  if (unversioned.length > 0) {
    errors.push(`plugin content changed without a version bump in:\n${unversioned.join('\n')}`);
    errors.push("Run 'bash scripts/sync-plugin-version.sh' staged with any plugin change to fix, then commit.");
  }

  if (errors.length > 0) {
    console.error(`ERROR: ${errors.join('\n')}`);
    process.exit(1);
  }

  console.error(`Plugin version (${formatSemver(pluginVersion)}) is consistent.`);
}

// Main
const args = process.argv.slice(2);
const isCheck = args.includes('--check');

if (isCheck) {
  checkMode();
} else {
  syncMode();
}
