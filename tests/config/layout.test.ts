import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configRoot, resourceDir } from '../../src/config';
import { useConfigEnv } from '../helpers/config-env';

const env = useConfigEnv();

describe('configRoot', () => {
  it('is the folder holding .sctx.json or .sctx', () => {
    expect(configRoot(join(env.vault, '.sctx.json'))).toBe(env.vault);
    expect(configRoot(join(env.vault, '.sctx', 'config.json'))).toBe(env.vault);
    expect(configRoot(env.globalFile)).toBe(dirname(env.globalFile));
  });
});

describe('resourceDir', () => {
  it('finds a resource folder in .sctx', () => {
    mkdirSync(join(env.vault, '.sctx', 'plugins'), { recursive: true });

    expect(resourceDir(env.vault, 'plugins')).toBe(join(env.vault, '.sctx', 'plugins'));
    expect(resourceDir(env.vault, 'map-views')).toBeUndefined();
  });

  it('finds the global config resources beside the config file', () => {
    const globalDir = dirname(env.globalFile);
    mkdirSync(join(globalDir, 'plugins'), { recursive: true });

    expect(resourceDir(globalDir, 'plugins')).toBe(join(globalDir, 'plugins'));
  });

  it('still finds a plugins folder beside .sctx.json, with a deprecation warning', () => {
    mkdirSync(join(env.vault, 'plugins'), { recursive: true });
    mkdirSync(join(env.vault, 'evals'), { recursive: true });
    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    expect(resourceDir(env.vault, 'plugins')).toBe(join(env.vault, 'plugins'));
    expect(resourceDir(env.vault, 'evals')).toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toContain(join(env.vault, '.sctx', 'plugins'));
    warn.mockRestore();
  });

  it('prefers .sctx over the old location', () => {
    mkdirSync(join(env.vault, 'plugins'), { recursive: true });
    mkdirSync(join(env.vault, '.sctx', 'plugins'), { recursive: true });

    expect(resourceDir(env.vault, 'plugins')).toBe(join(env.vault, '.sctx', 'plugins'));
  });
});
