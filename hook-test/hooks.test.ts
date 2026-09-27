/**
 * End-to-end tests for structured-context plugin hooks.
 *
 * These tests run real Claude Code sessions via the Agent SDK to verify that
 * PreToolUse and Stop hooks fire and behave correctly.
 *
 * They are slow (each test spawns a full Claude session) and require a valid
 * Claude API key.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, stateFilePath } from '../plugin/scripts/state';
import { type IsolatedFixtures, isolateFixtures } from './fixture-utils';
import { runClaude } from './harness';

// Claude sessions take 30-90 seconds
const TEST_TIMEOUT = 120_000;

let fixtures: IsolatedFixtures;

afterEach(() => {
  fixtures?.cleanup();
});

function makeOutputDir(): string {
  return join(tmpdir(), `ost-e2e-out-${crypto.randomUUID()}`);
}

describe('clean edit of valid file', () => {
  it(
    'baselines the space when the prompt is submitted and exits 0',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();

      const result = await runClaude({
        prompt: `Read valid.md, then change the title to "Modified Title". Only edit the file, no other output.`,
        fixtureDir: fixtures.fixtureDir,
        outputDir,
        configPath: fixtures.configPath,
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outputDir, 'stop-hook-errors.txt'))).toBe(false);
      expect(result.stateAtStop.baseline['test-space']?.path).toBe(fixtures.vaultDir);
      // The Stop hook clears the baseline and keeps the results for the next prompt
      const after = loadState(stateFilePath(result.sessionId, { stateDir: result.stateDir }));
      expect(after.baseline).toEqual({});
      expect(after.latest['test-space']).toBeDefined();
    },
    TEST_TIMEOUT,
  );
});

describe('Write', () => {
  it(
    'exits 0 when Claude writes a valid new .md file',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();

      const result = await runClaude({
        prompt: `Create a new file at the relative path vault/new-note.md (inside the current working directory) with this exact content:
---
type: mission
parent: "[[Root]]"
status: identified
---

# New Note

A new note.`,
        fixtureDir: fixtures.fixtureDir,
        outputDir,
        configPath: fixtures.configPath,
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(fixtures.vaultDir, 'new-note.md'))).toBe(true);
      expect(result.stateAtStop.baseline['test-space']?.issues['new-note.md']).toBeUndefined();
    },
    TEST_TIMEOUT,
  );
});

describe('Stop hook', () => {
  it(
    'reports errors (exitCode 2) when an edit introduces a broken parent link',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();

      const result = await runClaude({
        prompt: `Edit valid.md and change the parent field in the frontmatter to "[[Nonexistent Node]]". Only edit the file, no other output.`,
        fixtureDir: fixtures.fixtureDir,
        outputDir,
        configPath: fixtures.configPath,
      });

      expect(result.exitCode).toBe(2);

      const errorContent = readFileSync(join(outputDir, 'stop-hook-errors.txt'), 'utf-8');
      expect(errorContent).toContain('structured-context: new validation errors');
      expect(errorContent).toContain('broken-link');
      expect(errorContent).toContain('Nonexistent Node');
    },
    TEST_TIMEOUT,
  );

  it(
    'reports no errors (exitCode 0) when editing a file that already has errors',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();

      // broken.md already has a broken parent link — editing its title should not
      // introduce new errors beyond what was there at baseline
      const result = await runClaude({
        prompt: `Edit broken.md and change its title to "Still Broken". Only edit the file, no other output.`,
        fixtureDir: fixtures.fixtureDir,
        outputDir,
        configPath: fixtures.configPath,
      });

      expect(result.exitCode).toBe(0);
    },
    TEST_TIMEOUT,
  );
});
