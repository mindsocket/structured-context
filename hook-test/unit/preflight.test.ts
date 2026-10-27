/**
 * Unit tests for plugin/scripts/preflight.ts and safe.ts
 *
 * Tests call runPreflight() directly, with the real CLI as a subprocess.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnPrompt } from '../../plugin/scripts/on-prompt';
import { runPreflight } from '../../plugin/scripts/preflight';
import { runSafely } from '../../plugin/scripts/safe';
import { loadState, sctxCommand, stateFilePath } from '../../plugin/scripts/state';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;
let sessionId: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-preflight-state-${crypto.randomUUID()}`);
  sessionId = crypto.randomUUID();
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({ stateDir, sctxBin: SCTX_BIN, configPath: fixtures.configPath });

describe('runPreflight', () => {
  it('tells the agent which spaces apply when the config is healthy', async () => {
    const result = await runPreflight({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(result.systemMessage).toBeUndefined();
    expect(result.additionalContext).toContain('test-space');
  });

  it('says nothing when no space relates to the directory', async () => {
    const unrelated = join(tmpdir(), `ost-preflight-unrelated-${crypto.randomUUID()}`);

    const result = await runPreflight({ session_id: sessionId, cwd: unrelated }, opts());

    expect(result).toEqual({});
  });

  it('says nothing when there is no config', async () => {
    const dir = join(fixtures.fixtureDir, 'empty');
    mkdirSync(dir, { recursive: true });
    const noConfig = { stateDir, sctxBin: SCTX_BIN, configPath: undefined };
    const saved = { SCTX_CONFIG: process.env.SCTX_CONFIG, XDG: process.env.XDG_CONFIG_HOME };
    delete process.env.SCTX_CONFIG;
    process.env.XDG_CONFIG_HOME = join(fixtures.fixtureDir, 'xdg');
    try {
      const result = await runPreflight({ session_id: sessionId, cwd: dir }, noConfig);

      expect(result).toEqual({});
    } finally {
      if (saved.SCTX_CONFIG !== undefined) process.env.SCTX_CONFIG = saved.SCTX_CONFIG;
      if (saved.XDG !== undefined) process.env.XDG_CONFIG_HOME = saved.XDG;
      else delete process.env.XDG_CONFIG_HOME;
    }
  });

  it('does not switch hooks off for a space whose path is not a local file', async () => {
    const remote = 'https://example.atlassian.net/wiki/spaces/X/pages/1/Page';
    writeFileSync(
      fixtures.configPath,
      JSON.stringify({
        spaces: [
          { name: 'remote', path: remote, schema: 'strategy_general.json' },
          { name: 'test-space', path: fixtures.vaultDir, schema: 'strategy_general.json' },
        ],
      }),
    );

    const result = await runPreflight({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(result.systemMessage).toBeUndefined();
    expect(result.additionalContext).toContain('test-space');
  });

  it('reports an unreadable config', async () => {
    writeFileSync(fixtures.configPath, '{ not json');

    const result = await runPreflight({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(result.systemMessage).toContain('E_CONFIG_INVALID');
  });

  it('reports a CLI that cannot run', async () => {
    const result = await runPreflight(
      { session_id: sessionId, cwd: fixtures.fixtureDir },
      { ...opts(), sctxBin: join(fixtures.fixtureDir, 'does-not-exist.ts') },
    );

    expect(result.systemMessage).toContain('E_SCTX_UNAVAILABLE');
  });

  it('reports a CLI older than the plugin expects', async () => {
    const old = join(fixtures.fixtureDir, 'old-sctx.ts');
    writeFileSync(old, 'console.log(JSON.stringify({ configFiles: [], spaces: [] }));');

    const result = await runPreflight({ session_id: sessionId, cwd: fixtures.fixtureDir }, { ...opts(), sctxBin: old });

    expect(result.systemMessage).toContain('E_SCTX_OUTDATED');
  });
});

describe('other hooks stay quiet when setup is broken', () => {
  it('on-prompt writes no state and does not throw for a broken config', async () => {
    writeFileSync(fixtures.configPath, '{ not json');

    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(loadState(stateFilePath(sessionId, opts())).baseline).toEqual({});
  });

  it('on-prompt recovers once the config is fixed, without a new session', async () => {
    const good = await Bun.file(fixtures.configPath).text();
    writeFileSync(fixtures.configPath, '{ not json');
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    writeFileSync(fixtures.configPath, good);
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(Object.keys(loadState(stateFilePath(sessionId, opts())).baseline)).toEqual(['test-space']);
  });
});

describe('a space that cannot be validated is not reported as clean', () => {
  it('on-prompt fails with the reason when the schema does not load', async () => {
    const schema = join(fixtures.fixtureDir, 'bad.json');
    writeFileSync(schema, '{ not json');
    writeFileSync(
      fixtures.configPath,
      JSON.stringify({ spaces: [{ name: 'test-space', path: fixtures.vaultDir, schema }] }),
    );

    await expect(runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts())).rejects.toThrow(
      'E_SCHEMA_INVALID',
    );
    expect(loadState(stateFilePath(sessionId, opts())).baseline).toEqual({});
  });
});

describe('runSafely', () => {
  it('turns an error into one message per session and does not rethrow', async () => {
    const saved = process.env.SCTX_STATE_DIR;
    process.env.SCTX_STATE_DIR = stateDir;
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      const fail = async () => {
        throw new Error('boom\nstack line');
      };
      await runSafely('on-prompt', () => sessionId, fail);
      await runSafely('on-prompt', () => sessionId, fail);
    } finally {
      console.log = log;
      if (saved === undefined) delete process.env.SCTX_STATE_DIR;
      else process.env.SCTX_STATE_DIR = saved;
    }

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).systemMessage).toContain('E_HOOK_FAILED');
    expect(lines[0]).not.toContain('stack line');
  });
});

describe('sctxCommand', () => {
  const none = () => null;

  it('prefers an explicit entry point, then an installed sctx, then bunx pinned to the release line', () => {
    expect(sctxCommand({ sctxBin: '/x/index.ts' }, () => '/usr/bin/sctx')).toEqual(['bun', 'run', '/x/index.ts']);
    expect(sctxCommand({}, () => '/usr/bin/sctx')).toEqual(['/usr/bin/sctx']);
    expect(sctxCommand({}, none)).toEqual(['bunx', expect.stringMatching(/^structured-context@\d+\.\d+$/)]);
  });
});
