/**
 * Unit tests for plugin/scripts/mod-bridge.ts, which the Claude Code mod runs to read hook state.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwdContext, readStatus, trimSchemaShow } from '../../plugin/scripts/mod-bridge';
import { runOnPrompt } from '../../plugin/scripts/on-prompt';
import { runOnStop } from '../../plugin/scripts/on-stop';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;
let sessionId: string;
let savedConfig: string | undefined;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-mod-bridge-state-${crypto.randomUUID()}`);
  sessionId = crypto.randomUUID();
  savedConfig = process.env.SCTX_CONFIG;
  process.env.SCTX_CONFIG = fixtures.configPath;
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
  if (savedConfig === undefined) delete process.env.SCTX_CONFIG;
  else process.env.SCTX_CONFIG = savedConfig;
});

const opts = () => ({ stateDir, sctxBin: SCTX_BIN, configPath: fixtures.configPath });

describe('readStatus', () => {
  it('is empty before any hook ran', () => {
    expect(readStatus(sessionId, stateDir)).toEqual({ report: null, spaces: [] });
  });

  it('gives each baselined space its counts, and the last report', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
    writeFileSync(
      join(fixtures.vaultDir, 'valid.md'),
      '---\ntype: mission\nparent: "[[Ghost Node]]"\nstatus: identified\n---\n\n# Test Title\n',
    );
    await runOnStop({ session_id: sessionId }, opts());

    const status = readStatus(sessionId, stateDir);
    expect(status.spaces.map(({ name }) => name)).toEqual(['test-space']);
    expect(status.spaces[0]!.errors).toBeGreaterThan(0);
    expect(status.report!.spaces[0]!.added[0]!.message).toContain('Ghost Node');
  });
});

describe('trimSchemaShow', () => {
  it('drops the $refs list and the registry', () => {
    expect(trimSchemaShow('title: T\n\nEntities:\n  goal\n\n$refs:\n  sctx://x\n\nRegistry (y):\n  z\n')).toBe(
      'title: T\n\nEntities:\n  goal',
    );
  });
});

describe('cwdContext', () => {
  it('summarises the schema of each space in the directory', async () => {
    const context = await cwdContext(fixtures.fixtureDir, SCTX_BIN);
    expect(context.spaces).toEqual(['test-space']);
    expect(context.digests[0]!.text).toContain('Entities:');
    expect(context.digests[0]!.text).not.toContain('$refs:');
  });

  it('finds no spaces outside the configured paths', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'ost-mod-bridge-elsewhere-'));
    try {
      expect(await cwdContext(elsewhere, SCTX_BIN)).toEqual({ spaces: [], digests: [] });
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
