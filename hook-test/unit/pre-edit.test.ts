/**
 * Unit tests for plugin/scripts/pre-edit.ts
 *
 * Tests call runPreEdit() directly — no Claude process involved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreEdit } from '../../plugin/scripts/pre-edit';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-pre-edit-state-${crypto.randomUUID()}`);
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({
  stateDir,
  sctxBin: SCTX_BIN,
  configPath: fixtures.configPath,
});

function readState(sessionId: string): object[] {
  const file = join(stateDir, `sctx-hook-${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('Write operations', () => {
  it('records entry with null errors for a new .md file', async () => {
    const sessionId = crypto.randomUUID();
    const filePath = join(fixtures.vaultDir, 'new-note.md');

    await runPreEdit({ tool_name: 'Write', tool_input: { file_path: filePath }, session_id: sessionId }, opts());

    const entries = readState(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'Write', file: filePath, errors: null });
  });

  it('creates the state directory if it does not exist', async () => {
    const deepStateDir = join(stateDir, 'a', 'b', 'c');
    const sessionId = crypto.randomUUID();

    await runPreEdit(
      { tool_name: 'Write', tool_input: { file_path: join(fixtures.vaultDir, 'x.md') }, session_id: sessionId },
      { ...opts(), stateDir: deepStateDir },
    );

    expect(existsSync(deepStateDir)).toBe(true);
  });
});

describe('Edit operations', () => {
  it('records entry with empty errors for a valid in-space .md file', async () => {
    const sessionId = crypto.randomUUID();
    const filePath = join(fixtures.vaultDir, 'valid.md');

    await runPreEdit({ tool_name: 'Edit', tool_input: { file_path: filePath }, session_id: sessionId }, opts());

    const entries = readState(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'Edit', file: filePath });
    expect((entries[0] as { errors: object }).errors).toEqual({});
  });

  it('records pre-existing errors for a broken in-space .md file', async () => {
    const sessionId = crypto.randomUUID();
    const filePath = join(fixtures.vaultDir, 'broken.md');

    await runPreEdit({ tool_name: 'Edit', tool_input: { file_path: filePath }, session_id: sessionId }, opts());

    const entries = readState(sessionId);
    expect(entries).toHaveLength(1);
    const errors = (entries[0] as { errors: Record<string, unknown> }).errors;
    expect(Object.keys(errors)).toContain('broken-link:[[Nonexistent Node]]');
  });

  it('does not write a state entry for a .md file not in any space', async () => {
    const sessionId = crypto.randomUUID();
    // File outside the fixture vault — not registered in any space
    const filePath = join(tmpdir(), 'unrelated.md');

    await runPreEdit({ tool_name: 'Edit', tool_input: { file_path: filePath }, session_id: sessionId }, opts());

    expect(readState(sessionId)).toHaveLength(0);
  });

  it('appends separate entries for multiple edits in the same session', async () => {
    const sessionId = crypto.randomUUID();

    await runPreEdit(
      { tool_name: 'Edit', tool_input: { file_path: join(fixtures.vaultDir, 'valid.md') }, session_id: sessionId },
      opts(),
    );
    await runPreEdit(
      { tool_name: 'Edit', tool_input: { file_path: join(fixtures.vaultDir, 'broken.md') }, session_id: sessionId },
      opts(),
    );

    const entries = readState(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => (e as { file: string }).file)).toContain(join(fixtures.vaultDir, 'valid.md'));
    expect(entries.map((e) => (e as { file: string }).file)).toContain(join(fixtures.vaultDir, 'broken.md'));
  });
});

describe('Edge cases', () => {
  it('returns without writing when file_path is missing', async () => {
    const sessionId = crypto.randomUUID();

    await runPreEdit({ tool_name: 'Edit', tool_input: {}, session_id: sessionId }, opts());

    expect(readState(sessionId)).toHaveLength(0);
  });

  it('returns without writing when tool_input is missing', async () => {
    const sessionId = crypto.randomUUID();

    await runPreEdit({ tool_name: 'Edit', session_id: sessionId }, opts());

    expect(readState(sessionId)).toHaveLength(0);
  });

  it('includes session_id and timestamp in every entry', async () => {
    const sessionId = crypto.randomUUID();
    const before = Date.now();

    await runPreEdit(
      { tool_name: 'Write', tool_input: { file_path: join(fixtures.vaultDir, 'x.md') }, session_id: sessionId },
      opts(),
    );

    const [entry] = readState(sessionId) as Array<{ session_id: string; timestamp: number }>;
    expect(entry!.session_id).toBe(sessionId);
    expect(entry!.timestamp).toBeGreaterThanOrEqual(before);
  });
});
