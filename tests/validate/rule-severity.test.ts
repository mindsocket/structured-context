import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { validate } from '../../src/commands/validate';
import type { Config } from '../../src/config';
import { validateFile, validateSpace } from '../../src/validate';
import { makeSpaceContext } from '../helpers/context';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures/rule-severity');
const SCHEMA_PATH = join(FIXTURES_DIR, 'schema.json');
const CLEAN_DIR = join(FIXTURES_DIR, 'clean');
const FAILING_DIR = join(FIXTURES_DIR, 'failing');

/** Run the validate command with console output captured. */
async function runValidate(dir: string, json: boolean): Promise<{ exitCode: number; output: string }> {
  const logSpy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    const exitCode = await validate(makeSpaceContext(dir, SCHEMA_PATH), { json });
    const output = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    return { exitCode, output };
  } finally {
    logSpy.mockRestore();
  }
}

describe('rule severity', () => {
  describe('validateSpace', () => {
    it('reports the effective severity of each violation', async () => {
      const result = await validateSpace(makeSpaceContext(FAILING_DIR, SCHEMA_PATH));
      const severities = Object.fromEntries(result.ruleViolations.map((v) => [v.ruleId, v.severity]));
      expect(severities).toEqual({ 'always-info': 'info', 'always-warning': 'warning', 'not-blocked': 'error' });
    });
  });

  describe('validate command', () => {
    it('exits 0 when only warning and info rule violations are present', async () => {
      const { exitCode, output } = await runValidate(CLEAN_DIR, false);
      expect(exitCode).toBe(0);
      expect(output).toContain('WARNING');
      expect(output).toContain('INFO');
      expect(output).not.toContain('ERROR');
    });

    it('exits 1 when an error severity rule violation is present', async () => {
      const { exitCode, output } = await runValidate(FAILING_DIR, false);
      expect(exitCode).toBe(1);
      expect(output).toContain('ERROR');
    });

    it('JSON output counts only error severity rules as errors and includes severity', async () => {
      const clean = JSON.parse((await runValidate(CLEAN_DIR, true)).output);
      expect(clean.valid).toBe(true);
      expect(clean.errorCount).toBe(0);
      expect(clean.ruleViolations).toHaveLength(2);

      const { exitCode, output } = await runValidate(FAILING_DIR, true);
      const failing = JSON.parse(output);
      expect(exitCode).toBe(1);
      expect(failing.valid).toBe(false);
      expect(failing.errorCount).toBe(1);
      expect(failing.errors['Blocked goal.md']['rule:not-blocked'].severity).toBe('error');
      expect(failing.errors['Blocked goal.md']['rule:always-warning']).toBeUndefined();
      expect(failing.ruleViolations).toContainEqual({
        file: 'Blocked goal.md',
        ruleId: 'not-blocked',
        category: 'workflow',
        severity: 'error',
        description: 'Goals must not be blocked (workflow rule overridden to error)',
      });
    });
  });

  describe('validateFile', () => {
    const config: Config = {
      spaces: [
        { name: 'clean', path: CLEAN_DIR, schema: SCHEMA_PATH },
        { name: 'failing', path: FAILING_DIR, schema: SCHEMA_PATH },
      ],
    };

    it('reports warning and info rule violations as warnings, not errors', async () => {
      const result = await validateFile(join(CLEAN_DIR, 'Clean goal.md'), config, { configDir: FIXTURES_DIR });
      if (!result.inSpace) throw new Error('expected file to be in space');
      expect(result.errorCount).toBe(0);
      expect(result.warnings['rule:always-info']?.severity).toBe('info');
      expect(result.warnings['rule:always-warning']?.severity).toBe('warning');
    });

    it('reports error severity rule violations as errors', async () => {
      const result = await validateFile(join(FAILING_DIR, 'Blocked goal.md'), config, { configDir: FIXTURES_DIR });
      if (!result.inSpace) throw new Error('expected file to be in space');
      expect(result.errorCount).toBe(1);
      expect(result.errors['rule:not-blocked']).toEqual({
        kind: 'rule',
        message: '[not-blocked] Goals must not be blocked (workflow rule overridden to error)',
        severity: 'error',
      });
    });
  });
});
