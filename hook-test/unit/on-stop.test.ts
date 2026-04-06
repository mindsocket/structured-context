/**
 * Unit tests for plugin/scripts/on-stop.ts
 *
 * Tests call runOnStop() directly — no Claude process involved.
 * State files are written manually to set up each scenario.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnStop } from '../../plugin/scripts/on-stop';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const OST_TOOLS_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-on-stop-state-${crypto.randomUUID()}`);
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({
  stateDir,
  ostToolsBin: OST_TOOLS_BIN,
  configPath: fixtures.configPath,
});

function writeStateFile(sessionId: string, entries: object[]): string {
  const file = join(stateDir, `ost-tools-hook-${sessionId}.jsonl`);
  writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return file;
}

function stateEntry(file: string, tool: 'Edit' | 'Write', errors: object | null = null, timestamp = Date.now()) {
  return { session_id: 'test', timestamp, tool, file, errors };
}

describe('No-op cases', () => {
  it('returns no errors when state file does not exist', async () => {
    const result = await runOnStop({ session_id: crypto.randomUUID() }, opts());
    expect(result).toEqual({ hasNewErrors: false });
  });

  it('returns no errors when stop_hook_active is true (loop guard)', async () => {
    const sessionId = crypto.randomUUID();
    writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'valid.md'), 'Edit', {})]);

    const result = await runOnStop({ session_id: sessionId, stop_hook_active: true }, opts());
    expect(result).toEqual({ hasNewErrors: false });
  });
});

describe('Write entries', () => {
  it('returns no errors for a new file that is still valid', async () => {
    const sessionId = crypto.randomUUID();
    writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'valid.md'), 'Write', null)]);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });

  it('returns errors for a new file that has validation errors', async () => {
    const sessionId = crypto.randomUUID();
    writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'broken.md'), 'Write', null)]);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('ost-tools: new validation errors');
    expect(result.errorMessage).toContain('broken-link');
  });
});

describe('Edit entries', () => {
  it('returns no errors when the file still has the same errors as the baseline', async () => {
    const sessionId = crypto.randomUUID();
    // broken.md already has broken-link error — baseline captures it
    const baseline = { 'broken-link:[[Nonexistent Node]]': { kind: 'broken-link', message: 'test' } };
    writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'broken.md'), 'Edit', baseline)]);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });

  it('returns errors when a new error is introduced by an edit', async () => {
    const sessionId = crypto.randomUUID();
    // valid.md had no errors at baseline, but now we point it at a broken parent
    const validPath = join(fixtures.vaultDir, 'valid.md');
    writeStateFile(sessionId, [stateEntry(validPath, 'Edit', {})]);

    // Simulate the edit: change parent to a non-existent node
    writeFileSync(validPath, '---\ntype: mission\nparent: "[[Ghost Node]]"\nstatus: identified\n---\n\n# Test Title\n');

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('broken-link');
    expect(result.errorMessage).toContain('Ghost Node');
  });

  it('returns no errors when a pre-existing error is fixed', async () => {
    const sessionId = crypto.randomUUID();
    const brokenPath = join(fixtures.vaultDir, 'broken.md');
    const baseline = { 'broken-link:[[Nonexistent Node]]': { kind: 'broken-link', message: 'test' } };
    writeStateFile(sessionId, [stateEntry(brokenPath, 'Edit', baseline)]);

    // Fix the file
    writeFileSync(brokenPath, '---\ntype: mission\nparent: "[[Root]]"\nstatus: identified\n---\n\n# Broken Note\n');

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });
});

describe('Multiple files', () => {
  it('reports errors only for the file that introduced them', async () => {
    const sessionId = crypto.randomUUID();
    const validPath = join(fixtures.vaultDir, 'valid.md');
    const brokenPath = join(fixtures.vaultDir, 'broken.md');

    // valid.md: clean edit, no new errors
    // broken.md: had broken-link at baseline, still has it
    const baseline = { 'broken-link:[[Nonexistent Node]]': { kind: 'broken-link', message: 'test' } };
    writeStateFile(sessionId, [stateEntry(validPath, 'Edit', {}), stateEntry(brokenPath, 'Edit', baseline)]);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });

  it('uses only the latest entry per file when there are duplicates', async () => {
    const sessionId = crypto.randomUUID();
    const validPath = join(fixtures.vaultDir, 'valid.md');

    // Two entries for same file: first has no baseline errors (clean), second was the most recent edit
    const entries = [
      stateEntry(validPath, 'Edit', {}, Date.now() - 1000),
      stateEntry(validPath, 'Edit', {}, Date.now()),
    ];
    writeStateFile(sessionId, entries);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });
});

describe('State file lifecycle', () => {
  it('deletes the state file after running, regardless of result', async () => {
    const sessionId = crypto.randomUUID();
    const stateFile = writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'valid.md'), 'Edit', {})]);

    await runOnStop({ session_id: sessionId }, opts());

    expect(existsSync(stateFile)).toBe(false);
  });

  it('deletes the state file even when new errors are found', async () => {
    const sessionId = crypto.randomUUID();
    const stateFile = writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'broken.md'), 'Write', null)]);

    await runOnStop({ session_id: sessionId }, opts());

    expect(existsSync(stateFile)).toBe(false);
  });

  it('skips files that no longer exist without crashing', async () => {
    const sessionId = crypto.randomUUID();
    writeStateFile(sessionId, [stateEntry(join(fixtures.vaultDir, 'deleted.md'), 'Edit', {})]);

    const result = await runOnStop({ session_id: sessionId }, opts());
    expect(result.hasNewErrors).toBe(false);
  });
});
