/**
 * Utilities for isolating test fixtures so tests never modify git-tracked files.
 */

import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_FIXTURES = join(import.meta.dir, 'fixtures');

export interface IsolatedFixtures {
  /** Root of the isolated copy */
  fixtureDir: string;
  /** Isolated vault directory (contains the markdown files) */
  vaultDir: string;
  /** Absolute path to the isolated config.json (vault path rewritten to absolute) */
  configPath: string;
  /** Remove the isolated copy */
  cleanup: () => void;
}

/**
 * Copies hook-test/fixtures/ to a unique temp directory.
 * Rewrites config.json so the space path is absolute (not relative).
 * Returns paths and a cleanup function.
 */
export function isolateFixtures(): IsolatedFixtures {
  const id = crypto.randomUUID();
  // Use realpathSync to resolve macOS /var -> /private/var symlink so paths
  // match what Claude Code reports in hook inputs.
  const fixtureDir = join(realpathSync(tmpdir()), `ost-hook-test-${id}`);
  const vaultDir = join(fixtureDir, 'vault');
  const configPath = join(fixtureDir, 'config.json');

  mkdirSync(fixtureDir, { recursive: true });
  cpSync(BASE_FIXTURES, fixtureDir, { recursive: true });

  // Rewrite config.json: replace relative vault path with absolute path
  const config = { spaces: [{ name: 'test-space', path: vaultDir }] };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  return {
    fixtureDir,
    vaultDir,
    configPath,
    cleanup: () => rmSync(fixtureDir, { recursive: true, force: true }),
  };
}
