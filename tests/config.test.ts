import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSON5 from 'json5';
import { loadConfig, setConfigPath, updateSpaceField } from '../src/config';

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
          spaces: [{ alias: 'included-space', path: '/path/to/included' }],
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
          spaces: [{ alias: 'main-space', path: '/path/to/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(2);
    expect(config.spaces.find((s) => s.alias === 'main-space')?.path).toBe('/path/to/main');
    expect(config.spaces.find((s) => s.alias === 'included-space')?.path).toBe('/path/to/included');
  });

  it('resolves relative paths relative to included config file', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'included-space', path: './relative-path' }],
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

    const includedSpace = config.spaces.find((s) => s.alias === 'included-space');
    expect(includedSpace?.path).toMatch(/\/tmp-config-test\/relative-path$/);
  });

  it('merges spaces from multiple included configs in order', () => {
    const firstIncludedPath = join(testDir, 'first.json');
    const secondIncludedPath = join(testDir, 'second.json');

    writeFileSync(
      firstIncludedPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'first-space', path: '/first' }],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      secondIncludedPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'second-space', path: '/second' }],
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
          spaces: [{ alias: 'main-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    const config = loadConfig();

    expect(config.spaces).toHaveLength(3);
    // Main config spaces come first, then included in order
    expect(config.spaces[0].alias).toBe('main-space');
    expect(config.spaces[1].alias).toBe('first-space');
    expect(config.spaces[2].alias).toBe('second-space');
  });

  it('handles absolute paths in includeSpacesFrom', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'abs-space', path: '/absolute/path' }],
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
    expect(config.spaces[0].alias).toBe('abs-space');
  });

  it('throws error when included config has duplicate alias', () => {
    writeFileSync(
      includedConfigPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'duplicate-space', path: '/included' }],
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
          spaces: [{ alias: 'duplicate-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);

    expect(() => loadConfig()).toThrow('Included config contains spaces with duplicate aliases');
  });

  it('handles included configs with their own relative paths correctly', () => {
    writeFileSync(
      nestedConfigPath,
      JSON.stringify(
        {
          spaces: [{ alias: 'nested-space', path: './nested-space' }],
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

    const nestedSpace = config.spaces.find((s) => s.alias === 'nested-space');
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
          spaces: [{ alias: 'other-space', path: './other-space' }],
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

    const otherSpace = config.spaces.find((s) => s.alias === 'other-space');
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
          spaces: [{ alias: 'included-space', path: '/included', miroFrameId: 'old-frame-id' }],
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
          spaces: [{ alias: 'main-space', path: '/main' }],
        },
        null,
        2,
      ),
    );

    setConfigPath(mainConfigPath);
    loadConfig(); // Load and track space sources

    // Update the included space
    updateSpaceField('included-space', 'miroFrameId', 'new-frame-id');

    // Verify the included config file was updated
    const updatedConfig = JSON5.parse(readFileSync(otherConfigPath, 'utf-8'));
    expect(updatedConfig.spaces[0].miroFrameId).toBe('new-frame-id');

    // Verify the main config was not modified
    const mainConfig = JSON5.parse(readFileSync(mainConfigPath, 'utf-8'));
    expect(mainConfig.spaces[0].alias).toBe('main-space');
  });
});
