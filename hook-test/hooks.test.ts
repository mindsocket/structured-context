/**
 * End-to-end tests for ost-tools plugin hooks.
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
    'captures an Edit state entry, exits 0, and cleans up the state file',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();
      const validFile = join(fixtures.vaultDir, 'valid.md');

      const result = await runClaude({
        prompt: `Read valid.md, then change the title to "Modified Title". Only edit the file, no other output.`,
        fixtureDir: fixtures.fixtureDir,
        outputDir,
        configPath: fixtures.configPath,
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outputDir, 'stop-hook-errors.txt'))).toBe(false);

      const editEntry = result.stateEntries.find((e) => (e as { tool: string }).tool === 'Edit');
      expect(editEntry).toBeDefined();
      expect((editEntry as { file: string }).file).toBe(validFile);

      // State entries captured before deletion — confirms the file was written
      expect(result.stateEntries.length).toBeGreaterThan(0);
      // Stop hook must delete the state file after analysis
      expect(existsSync(join(result.stateDir, `ost-tools-hook-${result.sessionId}.jsonl`))).toBe(false);
    },
    TEST_TIMEOUT,
  );
});

describe('Write hook', () => {
  it(
    'captures a state entry with null errors when Claude writes a new .md file',
    async () => {
      fixtures = isolateFixtures();
      const outputDir = makeOutputDir();

      const result = await runClaude({
        prompt: `Create a new file called new-note.md in the current directory with this exact content:
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

      const writeEntry = result.stateEntries.find((e) => (e as { tool: string }).tool === 'Write');
      expect(writeEntry).toBeDefined();
      expect((writeEntry as { errors: null }).errors).toBeNull();
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
      expect(errorContent).toContain('ost-tools: new validation errors');
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
