/**
 * Unit tests for plugin/scripts/on-prompt.ts
 *
 * Tests call runOnPrompt() directly — no Claude process involved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnPrompt } from '../../plugin/scripts/on-prompt';
import { loadState, saveState, stateFilePath } from '../../plugin/scripts/state';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;
let sessionId: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-on-prompt-state-${crypto.randomUUID()}`);
  sessionId = crypto.randomUUID();
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({ stateDir, sctxBin: SCTX_BIN, configPath: fixtures.configPath });
const stateFile = () => stateFilePath(sessionId, opts());

describe('Baselines', () => {
  it('baselines a space inside the session directory', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    const { baseline, latest } = loadState(stateFile());
    expect(Object.keys(baseline)).toEqual(['test-space']);
    expect(baseline['test-space']!.path).toBe(fixtures.vaultDir);
    expect(Object.keys(baseline['test-space']!.issues)).toEqual(['broken.md']);
    expect(baseline['test-space']!.issues['broken.md']).toContain('broken-link:[[Nonexistent Node]]');
    expect(latest).toEqual(baseline);
  });

  it('baselines a space that contains the session directory', async () => {
    const subdir = join(fixtures.vaultDir, 'sub');
    mkdirSync(subdir);

    await runOnPrompt({ session_id: sessionId, cwd: subdir }, opts());

    expect(Object.keys(loadState(stateFile()).baseline)).toEqual(['test-space']);
  });

  it('writes no state when no space is related to the session directory', async () => {
    // A sibling of the fixture dir, not tmpdir() itself: on Linux the fixture lives under tmpdir()
    const unrelated = join(tmpdir(), `ost-on-prompt-unrelated-${crypto.randomUUID()}`);

    await runOnPrompt({ session_id: sessionId, cwd: unrelated }, opts());

    expect(existsSync(stateFile())).toBe(false);
  });

  it('does nothing without a cwd', async () => {
    await runOnPrompt({ session_id: sessionId }, opts());

    expect(existsSync(stateFile())).toBe(false);
  });
});

describe('Existing state', () => {
  it('keeps an existing baseline when the previous Stop never ran', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
    writeFileSync(
      join(fixtures.vaultDir, 'valid.md'),
      '---\ntype: mission\nparent: "[[Ghost Node]]"\nstatus: identified\n---\n\n# Test Title\n',
    );

    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(loadState(stateFile()).baseline['test-space']!.issues['valid.md']).toBeUndefined();
  });

  it('reuses the latest results without validating when the space is unchanged', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
    // Simulate a completed turn, and mark the latest results so reuse is observable
    const state = loadState(stateFile());
    const latest = state.latest['test-space']!;
    latest.issues = { 'marker.md': [] };
    saveState(stateFile(), { baseline: {}, latest: { 'test-space': latest } });

    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(Object.keys(loadState(stateFile()).baseline['test-space']!.issues)).toEqual(['marker.md']);
  });

  it('validates again when the space has changed since the latest results', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
    const state = loadState(stateFile());
    saveState(stateFile(), { baseline: {}, latest: state.latest });
    writeFileSync(
      join(fixtures.vaultDir, 'broken.md'),
      '---\ntype: mission\nparent: "[[Root]]"\nstatus: identified\n---\n\n# Broken Note\n',
    );

    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());

    expect(loadState(stateFile()).baseline['test-space']!.issues).toEqual({});
  });
});
