import { afterEach, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setConfigPath } from '../../src/config';

export type ConfigEnv = { root: string; vault: string; globalFile: string };

export function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

/** Isolated temp tree with a `vault/notes/deep` folder, a private XDG dir and no ambient config. */
export function useConfigEnv(): ConfigEnv {
  const env = { root: '', vault: '', globalFile: '' };
  const savedEnv = { ...process.env };
  beforeEach(() => {
    env.root = realpathSync(mkdtempSync(join(tmpdir(), 'sctx-config-')));
    env.vault = join(env.root, 'vault');
    mkdirSync(join(env.vault, 'notes', 'deep'), { recursive: true });
    process.env.XDG_CONFIG_HOME = join(env.root, 'xdg');
    delete process.env.SCTX_CONFIG;
    env.globalFile = join(env.root, 'xdg', 'structured-context', 'config.json');
    setConfigPath(undefined);
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    setConfigPath(undefined);
    rmSync(env.root, { recursive: true, force: true });
  });
  return env;
}
