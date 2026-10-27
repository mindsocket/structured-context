import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { LOCAL_CONFIG_FILE } from '../../src/constants';
import { listSchemas } from '../../src/schema/list-schemas';
import { useConfigEnv, writeJson as write } from '../helpers/config-env';

const env = useConfigEnv();

const vaultConfig = (spaces: unknown[], schema?: string) =>
  write(join(env.vault, LOCAL_CONFIG_FILE), { spaces, ...(schema && { schema }) });

describe('listSchemas', () => {
  it('lists bundled schemas by name, flags partials and leaves out the path', async () => {
    vaultConfig([]);

    const listings = await listSchemas({ startDir: env.vault });
    const strategy = listings.find((l) => l.schema === 'strategy_general.json');
    const partial = listings.find((l) => l.schema === '_sctx_base.json');

    expect(strategy).toMatchObject({ source: 'core', partial: false, usedBy: [], id: 'sctx://core/strategy_general' });
    expect(strategy?.title).toBeString();
    expect(strategy).not.toHaveProperty('path');
    expect(partial).toMatchObject({ source: 'core', partial: true });
  });

  it('lists a bundled schema once, under core, with the spaces that use it', async () => {
    vaultConfig(
      [
        { name: 'a', path: '.', schema: 'strategy_general.json' },
        { name: 'b', path: '.', schema: 'strategy_general.json' },
      ],
      'strategy_general.json',
    );

    const listings = await listSchemas({ startDir: env.vault });

    expect(listings.filter((l) => l.schema === 'strategy_general.json')).toHaveLength(1);
    expect(listings.find((l) => l.schema === 'strategy_general.json')?.usedBy).toEqual(['global', 'a', 'b']);
    expect(listings.some((l) => l.source === 'configured')).toBe(false);
  });

  it('lists a schema file in the vault as configured, with its absolute path', async () => {
    write(join(env.vault, 'schemas', 'mine.json'), { $id: 'sctx://mine', title: 'Mine', description: 'My schema' });
    vaultConfig([{ name: 'notes', path: 'notes', schema: './schemas/mine.json' }]);

    const configured = (await listSchemas({ startDir: env.vault })).filter((l) => l.source === 'configured');

    expect(configured).toEqual([
      {
        // loadConfig has already resolved a relative path against the config file
        schema: join(env.vault, 'schemas', 'mine.json'),
        path: join(env.vault, 'schemas', 'mine.json'),
        source: 'configured',
        usedBy: ['notes'],
        partial: false,
        id: 'sctx://mine',
        title: 'Mine',
        description: 'My schema',
      },
    ]);
  });

  it('lists a schema shared by several spaces once', async () => {
    write(join(env.vault, 'mine.json'), { title: 'Mine' });
    vaultConfig([
      { name: 'a', path: 'a', schema: './mine.json' },
      { name: 'b', path: 'b', schema: 'mine.json' },
    ]);

    const configured = (await listSchemas({ startDir: env.vault })).filter((l) => l.source === 'configured');

    expect(configured).toHaveLength(1);
    expect(configured[0]?.usedBy).toEqual(['a', 'b']);
  });

  it('reports a missing or malformed schema instead of throwing', async () => {
    write(join(env.vault, 'broken.json'), '{ not json');
    vaultConfig([
      { name: 'a', path: 'a', schema: './missing.json' },
      { name: 'b', path: 'b', schema: './broken.json' },
    ]);

    const configured = (await listSchemas({ startDir: env.vault })).filter((l) => l.source === 'configured');

    expect(configured.map((l) => l.usedBy)).toEqual([['a'], ['b']]);
    expect(configured[0]?.error).toMatch(/not found/);
    expect(configured[1]?.error).toBeString();
  });

  it('lists a remote schema without fetching it', async () => {
    vaultConfig([{ name: 'a', path: 'a', schema: 'https://example.com/schema.json' }]);

    const configured = (await listSchemas({ startDir: env.vault })).filter((l) => l.source === 'configured');

    expect(configured).toMatchObject([
      { schema: 'https://example.com/schema.json', path: 'https://example.com/schema.json', usedBy: ['a'] },
    ]);
    expect(configured[0]?.error).toBeString();
  });

  it('lists schemas contributed by a plugin in the config folder, named by the plugin', async () => {
    write(join(env.vault, 'plugins', 'sctx-demo', 'package.json'), { name: 'sctx-demo' });
    write(
      join(env.vault, 'plugins', 'sctx-demo', 'index.js'),
      'module.exports = { name: "sctx-demo", configSchema: {} };',
    );
    write(join(env.vault, 'plugins', 'sctx-demo', 'schemas', 'demo.json'), { $id: 'sctx://demo/demo' });
    write(join(env.vault, 'plugins', 'sctx-demo', 'schemas', '_part.json'), { $id: 'sctx://demo/_part' });
    vaultConfig([{ name: 'a', path: 'a', schema: 'sctx-demo/demo.json' }]);

    const plugin = (await listSchemas({ startDir: env.vault })).filter((l) => l.source === 'demo');

    expect(plugin.map((l) => [l.schema, l.partial, l.usedBy])).toEqual([
      ['demo/_part.json', true, []],
      ['demo/demo.json', false, ['a']],
    ]);
    expect(plugin[0]?.path).toBe(join(env.vault, 'plugins', 'sctx-demo', 'schemas', '_part.json'));
  });

  it('uses a config passed in instead of discovering one', async () => {
    write(join(env.vault, 'mine.json'), { title: 'Mine' });

    const listings = await listSchemas({
      config: { spaces: [{ name: 'x', path: '.', schema: './mine.json', sourceDir: env.vault }] },
      startDir: env.vault,
    });

    expect(listings.find((l) => l.source === 'configured')?.usedBy).toEqual(['x']);
  });
});
