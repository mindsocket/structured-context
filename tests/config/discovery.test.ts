import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadConfig, resolveConfigPath, setConfigPath } from '../../src/config';
import { LOCAL_CONFIG_FILE } from '../../src/constants';
import { useConfigEnv, writeJson as write } from '../helpers/config-env';

const env = useConfigEnv();

describe('resolveConfigPath', () => {
  it('finds the nearest .sctx.json walking up from a subfolder', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [] });

    const resolved = resolveConfigPath(join(env.vault, 'notes', 'deep'));

    expect(resolved).toEqual({ path: join(env.vault, LOCAL_CONFIG_FILE), source: 'local' });
  });

  it('uses the nearest of two ancestor configs without merging', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [{ name: 'outer', path: '.' }] });
    write(join(env.vault, 'notes', LOCAL_CONFIG_FILE), { spaces: [{ name: 'inner', path: '.' }] });

    expect(resolveConfigPath(join(env.vault, 'notes', 'deep')).path).toBe(join(env.vault, 'notes', LOCAL_CONFIG_FILE));
  });

  it('prefers a local config over the global one', () => {
    write(env.globalFile, { spaces: [] });
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [] });

    expect(resolveConfigPath(env.vault).source).toBe('local');
  });

  it('falls back to the global config, then to none', () => {
    expect(resolveConfigPath(env.vault)).toEqual({ path: env.globalFile, source: 'none' });

    write(env.globalFile, { spaces: [] });

    expect(resolveConfigPath(env.vault)).toEqual({ path: env.globalFile, source: 'global' });
  });

  it('does not walk down into folders below the start', () => {
    write(join(env.vault, 'notes', LOCAL_CONFIG_FILE), { spaces: [] });

    expect(resolveConfigPath(env.vault).source).toBe('none');
  });

  it('lets an explicit override and $SCTX_CONFIG beat discovery', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [] });
    process.env.SCTX_CONFIG = join(env.root, 'env.json');

    expect(resolveConfigPath(env.vault)).toEqual({ path: join(env.root, 'env.json'), source: 'env' });

    setConfigPath(join(env.root, 'flag.json'));

    expect(resolveConfigPath(env.vault)).toEqual({ path: join(env.root, 'flag.json'), source: 'override' });
  });
});

describe('loadConfig with discovery', () => {
  it('resolves space paths against the folder holding .sctx.json, so the env.vault itself is "."', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [{ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' }] });

    const config = loadConfig({ startDir: join(env.vault, 'notes') });

    expect(config.spaces[0]?.path).toBe(env.vault);
  });

  it('expands ~ in includeSpacesFrom', () => {
    process.env.HOME = env.root;
    write(join(env.root, 'shared.json'), { spaces: [{ name: 'shared', path: '/shared' }] });
    write(join(env.vault, LOCAL_CONFIG_FILE), { includeSpacesFrom: ['~/shared.json'] });

    const config = loadConfig({ startDir: env.vault });

    expect(config.spaces.map((s) => s.name)).toEqual(['shared']);
  });
});
