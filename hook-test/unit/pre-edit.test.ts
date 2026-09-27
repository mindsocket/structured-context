/**
 * Unit tests for plugin/scripts/pre-edit.ts
 *
 * Tests call runPreEdit() directly — no Claude process involved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnPrompt } from '../../plugin/scripts/on-prompt';
import { runPreEdit } from '../../plugin/scripts/pre-edit';
import { loadState, stateFilePath } from '../../plugin/scripts/state';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

let fixtures: IsolatedFixtures;
let stateDir: string;
let sessionId: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-pre-edit-state-${crypto.randomUUID()}`);
  sessionId = crypto.randomUUID();
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({ stateDir, sctxBin: SCTX_BIN, configPath: fixtures.configPath });
const stateFile = () => stateFilePath(sessionId, opts());
const edit = (file: string, tool = 'Edit') =>
  runPreEdit(
    { tool_name: tool, tool_input: { file_path: join(fixtures.vaultDir, file) }, session_id: sessionId },
    opts(),
  );

describe('Fallback baseline', () => {
  it("baselines the edited file's whole space when it has no baseline", async () => {
    await edit('valid.md');

    const { baseline, latest } = loadState(stateFile());
    expect(Object.keys(baseline)).toEqual(['test-space']);
    expect(baseline['test-space']!.issues['broken.md']).toContain('broken-link:[[Nonexistent Node]]');
    expect(latest).toEqual(baseline);
  });

  it('baselines the space before a Write creates a new file', async () => {
    await edit('new-note.md', 'Write');

    expect(Object.keys(loadState(stateFile()).baseline['test-space']!.issues)).toEqual(['broken.md']);
  });

  it('keeps the baseline from the first edit when the space is edited again', async () => {
    await edit('valid.md');
    writeFileSync(
      join(fixtures.vaultDir, 'valid.md'),
      '---\ntype: mission\nparent: "[[Ghost Node]]"\nstatus: identified\n---\n\n# Test Title\n',
    );
    await edit('valid.md');

    expect(loadState(stateFile()).baseline['test-space']!.issues['valid.md']).toBeUndefined();
  });

  it('leaves a baseline from the prompt hook alone', async () => {
    await runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
    const before = loadState(stateFile());
    writeFileSync(
      join(fixtures.vaultDir, 'valid.md'),
      '---\ntype: mission\nparent: "[[Ghost Node]]"\nstatus: identified\n---\n\n# Test Title\n',
    );

    await edit('valid.md');

    expect(loadState(stateFile())).toEqual(before);
  });
});

describe('Edge cases', () => {
  it('writes no state for a .md file not in any space', async () => {
    await runPreEdit(
      { tool_name: 'Edit', tool_input: { file_path: join(tmpdir(), 'unrelated.md') }, session_id: sessionId },
      opts(),
    );

    expect(existsSync(stateFile())).toBe(false);
  });

  it('returns without writing when file_path is missing', async () => {
    await runPreEdit({ tool_name: 'Edit', tool_input: {}, session_id: sessionId }, opts());
    await runPreEdit({ tool_name: 'Edit', session_id: sessionId }, opts());

    expect(existsSync(stateFile())).toBe(false);
  });

  it('creates the state directory if it does not exist', async () => {
    const deepStateDir = join(stateDir, 'a', 'b', 'c');

    await runPreEdit(
      { tool_name: 'Edit', tool_input: { file_path: join(fixtures.vaultDir, 'valid.md') }, session_id: sessionId },
      { ...opts(), stateDir: deepStateDir },
    );

    expect(existsSync(deepStateDir)).toBe(true);
  });
});
