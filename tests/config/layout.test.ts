import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveSchemaPath } from '../../src/config';
import { configRoot, resourceDir } from '../../src/config/layout';
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

  it('ignores a plugins folder directly in a local root', () => {
    mkdirSync(join(env.vault, 'plugins'), { recursive: true });

    expect(resourceDir(env.vault, 'plugins')).toBeUndefined();
  });
});

describe('resolveSchemaPath by file name', () => {
  it('prefers .sctx/schemas over a file of the same name in the root', () => {
    mkdirSync(join(env.vault, '.sctx', 'schemas'), { recursive: true });
    writeFileSync(join(env.vault, 'mine.json'), '{}');
    writeFileSync(join(env.vault, '.sctx', 'schemas', 'mine.json'), '{}');

    expect(resolveSchemaPath('mine.json', env.vault)).toBe(join(env.vault, '.sctx', 'schemas', 'mine.json'));
  });
});
