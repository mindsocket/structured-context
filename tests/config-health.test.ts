import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setConfigPath } from '../src/config';
import { checkConfig, hasBlockingProblem } from '../src/config-health';
import { addSpace, chooseWriteTarget } from '../src/config-write';
import { LOCAL_CONFIG_FILE } from '../src/constants';
import { SctxError } from '../src/errors';
import { useConfigEnv, writeJson as write } from './helpers/config-env';

const env = useConfigEnv();

describe('checkConfig', () => {
  it('reports "not set up" as info, not as a failure', () => {
    const health = checkConfig({ startDir: env.vault });

    expect(health.config.source).toBe('none');
    expect(health.problems.map((p) => [p.code, p.severity])).toEqual([['E_CONFIG_NOT_FOUND', 'info']]);
    expect(hasBlockingProblem(health)).toBe(false);
  });

  it('reports a missing explicit config as an error', () => {
    setConfigPath(join(env.root, 'missing.json'));

    const health = checkConfig();

    expect(health.problems[0]).toMatchObject({ code: 'E_CONFIG_NOT_FOUND', severity: 'error' });
    expect(hasBlockingProblem(health)).toBe(true);
  });

  it('reports invalid JSON with a code and a fix', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), '{ not json');

    const health = checkConfig({ startDir: env.vault });

    expect(health.problems[0]).toMatchObject({ code: 'E_CONFIG_INVALID', severity: 'error' });
    expect(health.problems[0]?.fix).not.toBe('');
  });

  it('reports a moved space path and a missing schema per space', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), {
      spaces: [
        { name: 'gone', path: 'nope', schema: 'knowledge_wiki.json' },
        { name: 'noschema', path: '.' },
        { name: 'badschema', path: '.', schema: 'does_not_exist.json' },
      ],
    });

    const codes = checkConfig({ startDir: env.vault }).problems.map((p) => `${p.space}:${p.code}`);

    expect(codes).toEqual(['gone:E_SPACE_PATH_MISSING', 'noschema:E_SCHEMA_MISSING', 'badschema:E_SCHEMA_NOT_FOUND']);
  });

  it('is clean for a healthy space', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [{ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' }] });

    const health = checkConfig({ startDir: env.vault });

    expect(health.problems).toEqual([]);
    expect(health.spaces[0]?.name).toBe('wiki');
  });
});

describe('addSpace', () => {
  function inVault<T>(run: () => T): T {
    const cwd = process.cwd();
    process.chdir(env.vault);
    try {
      return run();
    } finally {
      process.chdir(cwd);
    }
  }

  it('requires an explicit target when nothing exists', () => {
    const err = inVault(() => {
      try {
        addSpace({ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' });
      } catch (e) {
        return e;
      }
    });

    expect(err).toBeInstanceOf(SctxError);
    expect((err as SctxError).code).toBe('E_TARGET_REQUIRED');
  });

  it('requires an explicit target when only the global config exists', () => {
    write(env.globalFile, { spaces: [] });

    expect(() => inVault(() => chooseWriteTarget({}))).toThrow('only the global config');
  });

  it('creates the named config with a path relative to the config folder', () => {
    const target = join(env.vault, LOCAL_CONFIG_FILE);
    setConfigPath(target);

    const result = inVault(() => addSpace({ name: 'wiki', path: 'notes', schema: 'knowledge_wiki.json' }));

    expect(result).toMatchObject({ configPath: target, created: true, space: { name: 'wiki', path: 'notes' } });
    expect(JSON.parse(readFileSync(target, 'utf-8')).spaces).toHaveLength(1);
  });

  it('adds to the nearest existing config without a flag', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), {
      spaces: [{ name: 'first', path: '.', schema: 'knowledge_wiki.json' }],
    });
    const cwd = process.cwd();
    process.chdir(join(env.vault, 'notes'));
    try {
      const result = addSpace({ name: 'second', path: 'deep', schema: 'knowledge_wiki.json' });

      expect(result.created).toBe(false);
      expect(result.space.path).toBe('notes/deep');
    } finally {
      process.chdir(cwd);
    }
  });

  it('writes the global file only with --global', () => {
    const result = inVault(() => addSpace({ name: 'wiki', path: '.', schema: 'knowledge_wiki.json', global: true }));

    expect(result.configPath).toBe(env.globalFile);
    expect(result.space.path).toBe(env.vault);
  });

  it('refuses a duplicate name, a missing path and a missing schema', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [{ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' }] });
    const code = (run: () => void) => {
      try {
        inVault(run);
      } catch (e) {
        return (e as SctxError).code;
      }
    };

    expect(code(() => addSpace({ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' }))).toBe('E_SPACE_EXISTS');
    expect(code(() => addSpace({ name: 'x', path: 'nope', schema: 'knowledge_wiki.json' }))).toBe(
      'E_SPACE_PATH_MISSING',
    );
    write(join(env.vault, LOCAL_CONFIG_FILE), { spaces: [] });
    expect(code(() => addSpace({ name: 'x', path: '.' }))).toBe('E_SCHEMA_MISSING');
    expect(code(() => addSpace({ name: 'x', path: '.', schema: 'nope.json' }))).toBe('E_SCHEMA_NOT_FOUND');
  });

  it('will not rewrite a file that uses JSON5 features, and says what to add', () => {
    write(join(env.vault, LOCAL_CONFIG_FILE), '{ // keep me\n spaces: [] }');
    const err = inVault(() => {
      try {
        addSpace({ name: 'wiki', path: '.', schema: 'knowledge_wiki.json' });
      } catch (e) {
        return e as SctxError;
      }
    });

    expect(err?.code).toBe('E_CONFIG_NEEDS_MANUAL_EDIT');
    expect(readFileSync(join(env.vault, LOCAL_CONFIG_FILE), 'utf-8')).toContain('keep me');
  });
});
