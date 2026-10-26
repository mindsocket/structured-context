import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSON5 } from 'bun';
import { type Config, loadConfig, setConfigPath, updateSpaceField } from '../src/config';

const testDir = join(process.cwd(), 'tmp-config-test');
const mainConfigPath = join(testDir, 'main-config.json');
const includedConfigPath = join(testDir, 'included-config.json');
const nestedConfigPath = join(testDir, 'nested', 'nested-config.json');

describe('loadConfig with includeSpacesFrom', () => {
  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'nested'), { recursive: true });
    setConfigPath(undefined);
  });

  afterAll(() => {
    // Clean up test directory and reset config path override after all tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    setConfigPath(undefined);
  });

  it('loads spaces from included config file', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'included-space', path: '/path/to/included' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['included-config.json'],
          spaces: [{ name: 'main-space', path: '/path/to/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(2);
    expect(config.spaces.find((s) => s.name === 'main-space')?.path).toBe('/path/to/main');
    expect(config.spaces.find((s) => s.name === 'included-space')?.path).toBe('/path/to/included');
  });

  it('resolves relative paths relative to included config file', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'included-space', path: './relative-path' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['included-config.json'],
          spaces: [],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    const includedSpace = config.spaces.find((s) => s.name === 'included-space');
    expect(includedSpace?.path).toMatch(/\/tmp-config-test\/relative-path$/);
  });

  it('merges spaces from multiple included configs in order', () => {
    const firstIncludedPath = join(testDir, 'first.json');
    const secondIncludedPath = join(testDir, 'second.json');

    writeFileSync(
      firstIncludedPath,
      JSON.stringify(
        {
          spaces: [{ name: 'first-space', path: '/first' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      secondIncludedPath,
      JSON.stringify(
        {
          spaces: [{ name: 'second-space', path: '/second' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['first.json', 'second.json'],
          spaces: [{ name: 'main-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(3);
    // Main config spaces come first, then included in order
    expect(config.spaces[0]!.name).toBe('main-space');
    expect(config.spaces[1]!.name).toBe('first-space');
    expect(config.spaces[2]!.name).toBe('second-space');
  });

  it('handles absolute paths in includeSpacesFrom', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'abs-space', path: '/absolute/path' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: [includedConfigPath],
          spaces: [],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(1);
    expect(config.spaces[0]!.name).toBe('abs-space');
  });

  it('loads a config with only includeSpacesFrom and no spaces', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'included-space', path: '/path/to/included' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['included-config.json'],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(1);
    expect(config.spaces[0]?.name).toBe('included-space');
  });

  it('throws when neither spaces nor includeSpacesFrom is present', () => {
    writeFileSync(mainConfigPath, JSON.stringify({ schema: 'strategy_general.json' }, null, 2));

    setConfigPath(mainConfigPath);

    expect(() => loadConfig()).toThrow('Invalid config');
  });

  it('lets a space in the including file override an included space of the same name', () => {
    writeFileSync(includedConfigPath, JSON.stringify({ spaces: [{ name: 'duplicate-space', path: '/included' }] }));
    writeFileSync(
      mainConfigPath,
      JSON.stringify({
        includeSpacesFrom: ['included-config.json'],
        spaces: [{ name: 'duplicate-space', path: '/main' }],
      }),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(1);
    expect(config.spaces[0]?.path).toBe('/main');
  });

  it('lets a later include override an earlier include of the same name', () => {
    writeFileSync(join(testDir, 'first.json'), JSON.stringify({ spaces: [{ name: 'shared', path: '/first' }] }));
    writeFileSync(join(testDir, 'second.json'), JSON.stringify({ spaces: [{ name: 'shared', path: '/second' }] }));
    writeFileSync(mainConfigPath, JSON.stringify({ includeSpacesFrom: ['first.json', 'second.json'] }));

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(1);
    expect(config.spaces[0]?.path).toBe('/second');
  });

  it('reports a missing include with a stable code', () => {
    writeFileSync(mainConfigPath, JSON.stringify({ includeSpacesFrom: ['nope.json'] }));

    setConfigPath(mainConfigPath);

    expect(() => loadConfig()).toThrow('does not exist');
  });

  it('handles included configs with their own relative paths correctly', () => {
    writeFileSync(
      nestedConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'nested-space', path: './nested-space' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['nested/nested-config.json'],
          spaces: [],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    const nestedSpace = config.spaces.find((s) => s.name === 'nested-space');
    expect(nestedSpace?.path).toMatch(/\/tmp-config-test\/nested\/nested-space$/);
  });

  it('resolves relative paths in included configs relative to included file location', () => {
    const otherDir = join(testDir, 'other');
    mkdirSync(otherDir, { recursive: true });
    const otherConfigPath = join(otherDir, 'config.json');

    writeFileSync(
      otherConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'other-space', path: './other-space' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['other/config.json'],
          spaces: [],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    const otherSpace = config.spaces.find((s) => s.name === 'other-space');
    expect(otherSpace?.path).toMatch(/\/tmp-config-test\/other\/other-space$/);
  });

  it('updateSpaceField writes to the correct config file for included spaces', () => {
    const otherDir = join(testDir, 'other');
    mkdirSync(otherDir, { recursive: true });
    const otherConfigPath = join(otherDir, 'config.json');

    writeFileSync(
      otherConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'included-space', path: '/included', schema: 'old-schema' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['other/config.json'],
          spaces: [{ name: 'main-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    loadConfig(); // Load and track space sources

    // Update the included space
    updateSpaceField('included-space', 'schema', 'new-schema');

    // Verify the included config file was updated
    const updatedConfig = JSON5.parse(readFileSync(otherConfigPath, 'utf-8')) as Config;
    expect(updatedConfig.spaces[0]!.schema).toBe('new-schema');

    // Verify the main config was not modified
    const mainConfig = JSON5.parse(readFileSync(mainConfigPath, 'utf-8')) as Config;
    expect(mainConfig.spaces[0]!.name).toBe('main-space');
  });

  it('updatePluginConfig writes plugin config to correct file for included spaces', () => {
    const otherDir = join(testDir, 'other2');
    mkdirSync(otherDir, { recursive: true });
    const otherConfigPath = join(otherDir, 'config.json');

    writeFileSync(
      otherConfigPath,
      JSON.stringify(
        {
          spaces: [{ name: 'plugin-space', path: '/plugin', plugins: { miro: { boardId: 'board-1' } } }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      mainConfigPath,
      JSON.stringify(
        {
          includeSpacesFrom: ['other2/config.json'],
          spaces: [{ name: 'main-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    loadConfig();

    updateSpaceField('plugin-space', 'frameId', 'frame-abc', 'miro');

    const updatedConfig = JSON5.parse(readFileSync(otherConfigPath, 'utf-8')) as Config;
    expect(updatedConfig.spaces[0]!.plugins!.miro!.frameId).toBe('frame-abc');
    expect(updatedConfig.spaces[0]!.plugins!.miro!.boardId).toBe('board-1');

    const mainConfig = JSON5.parse(readFileSync(mainConfigPath, 'utf-8')) as Config;
    expect(mainConfig.spaces[0]!.name).toBe('main-space');
  });

  it('accepts model providers, a top-level semantic provider and a space override', () => {
    const configPath = join(testDir, 'judge-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        modelProviders: {
          jev: { api: 'openrouter-decisions' },
          claude: { api: 'anthropic-messages', model: 'claude-haiku-5-5' },
        },
        semantic: { provider: 'jev' },
        spaces: [{ name: 's', path: '/p', semantic: { provider: 'claude' } }],
      }),
    );
    setConfigPath(configPath);
    const config = loadConfig();
    expect(config.semantic?.provider).toBe('jev');
    expect(config.modelProviders?.claude?.model).toBe('claude-haiku-5-5');
    expect(config.spaces?.[0]?.semantic?.provider).toBe('claude');
  });
});
