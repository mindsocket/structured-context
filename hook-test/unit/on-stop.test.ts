/**
 * Unit tests for plugin/scripts/on-stop.ts
 *
 * Tests call the hooks directly — no Claude process involved. Each test takes a baseline with
 * the prompt hook, changes files the way Claude would, then runs the Stop hook.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOnPrompt } from '../../plugin/scripts/on-prompt';
import { runOnStop } from '../../plugin/scripts/on-stop';
import { loadState, stateFilePath } from '../../plugin/scripts/state';
import { type IsolatedFixtures, isolateFixtures } from '../fixture-utils';

const SCTX_BIN = join(import.meta.dir, '../../src/index.ts');

const validWithParent = (parent: string) =>
  `---\ntype: mission\nparent: "[[${parent}]]"\nstatus: identified\n---\n\n# Test Title\n`;
const validWithContentLink = `${validWithParent('Root')}\nSee [[Missing Note]].\n`;

let fixtures: IsolatedFixtures;
let stateDir: string;
let sessionId: string;

beforeEach(() => {
  fixtures = isolateFixtures();
  stateDir = join(tmpdir(), `ost-on-stop-state-${crypto.randomUUID()}`);
  sessionId = crypto.randomUUID();
});

afterEach(() => {
  fixtures.cleanup();
  rmSync(stateDir, { recursive: true, force: true });
});

const opts = () => ({ stateDir, sctxBin: SCTX_BIN, configPath: fixtures.configPath });
const prompt = () => runOnPrompt({ session_id: sessionId, cwd: fixtures.fixtureDir }, opts());
const stop = (stop_hook_active = false) => runOnStop({ session_id: sessionId, stop_hook_active }, opts());
const write = (file: string, content: string) => writeFileSync(join(fixtures.vaultDir, file), content);

describe('No-op cases', () => {
  it('returns no errors when there is no state', async () => {
    expect(await stop()).toEqual({ hasNewErrors: false });
  });

  it('returns no errors and keeps the baseline when stop_hook_active is true (loop guard)', async () => {
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));

    expect(await stop(true)).toEqual({ hasNewErrors: false });
    expect(Object.keys(loadState(stateFilePath(sessionId, opts())).baseline)).toEqual(['test-space']);
  });

  it('returns no errors when nothing changed', async () => {
    await prompt();
    expect(await stop()).toEqual({ hasNewErrors: false });
  });
});

describe('Errors', () => {
  it('reports an error introduced by an edit', async () => {
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));

    const result = await stop();
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('structured-context: new validation errors');
    expect(result.errorMessage).toContain('valid.md (space: test-space)');
    expect(result.errorMessage).toContain('Ghost Node');
  });

  it('does not report errors a file already had', async () => {
    await prompt();
    write(
      'broken.md',
      '---\ntype: mission\nparent: "[[Nonexistent Node]]"\nstatus: identified\n---\n\n# Still Broken\n',
    );

    expect((await stop()).hasNewErrors).toBe(false);
  });

  it('returns no errors when a pre-existing error is fixed', async () => {
    await prompt();
    write('broken.md', '---\ntype: mission\nparent: "[[Root]]"\nstatus: identified\n---\n\n# Broken Note\n');

    expect((await stop()).hasNewErrors).toBe(false);
  });

  it('reports every issue in a new file', async () => {
    await prompt();
    write('new-note.md', validWithParent('Ghost Node').replace('Test Title', 'New Note'));

    const result = await stop();
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('new-note.md');
  });

  it('reports breakage in a file that was not edited', async () => {
    await prompt();
    // Renaming Root.md (e.g. with `mv` in Bash) breaks valid.md's parent link
    renameSync(join(fixtures.vaultDir, 'Root.md'), join(fixtures.vaultDir, 'Renamed Root.md'));

    const result = await stop();
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('valid.md (space: test-space)');
    expect(result.errorMessage).toContain('[[Root]]');
  });

  it('reports errors from edits made before an interrupted turn', async () => {
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));
    // The turn is interrupted, so Stop never runs before the next prompt
    await prompt();

    const result = await stop();
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('Ghost Node');
  });

  it('reports an issue once when overlapping spaces both contain the file', async () => {
    writeFileSync(
      fixtures.configPath,
      JSON.stringify({
        spaces: [
          { name: 'test-space', path: fixtures.vaultDir, schema: 'strategy_general.json' },
          { name: 'overlap', path: fixtures.vaultDir, schema: 'strategy_general.json' },
        ],
      }),
    );
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));

    const result = await stop();
    expect(result.errorMessage!.match(/valid\.md \(space:/g)).toHaveLength(1);
  });
});

describe('State', () => {
  it('clears the baseline and keeps the results for the next prompt', async () => {
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));

    await stop();

    const { baseline, latest } = loadState(stateFilePath(sessionId, opts()));
    expect(baseline).toEqual({});
    expect(latest['test-space']!.issues['valid.md']).toContain('broken-link:[[Ghost Node]]');
  });

  it('does not report the same error again at the next Stop', async () => {
    await prompt();
    write('valid.md', validWithParent('Ghost Node'));
    await stop();

    await prompt();
    expect((await stop()).hasNewErrors).toBe(false);
  });
});

describe('Warnings', () => {
  it('reports a new warning without blocking', async () => {
    await prompt();
    write('valid.md', validWithContentLink);

    const result = await stop();
    expect(result.hasNewErrors).toBe(false);
    expect(result.errorMessage).toBeUndefined();
    expect(result.warningMessage).toContain('structured-context: new validation warnings');
    expect(result.warningMessage).toContain('Missing Note');
  });

  it('does not report warnings already present in the baseline', async () => {
    write('valid.md', validWithContentLink);
    await prompt();
    write('valid.md', `${validWithContentLink}\nMore text.\n`);

    expect(await stop()).toEqual({ hasNewErrors: false });
  });

  it('reports both errors and warnings when both are new', async () => {
    await prompt();
    write('valid.md', validWithContentLink.replace('[[Root]]', '[[Ghost Node]]'));

    const result = await stop();
    expect(result.hasNewErrors).toBe(true);
    expect(result.errorMessage).toContain('Ghost Node');
    expect(result.warningMessage).toContain('Missing Note');
  });
});
