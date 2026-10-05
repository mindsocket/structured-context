import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'sctx-cli-errors-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('CLI error reporting', () => {
  it('prints a config loading error as one line with empty stdout and exit code 1', () => {
    const invalidConfig = join(tmp, 'invalid.json');
    writeFileSync(invalidConfig, '{ "spaces": 5 }');
    const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', '--config', invalidConfig, 'validate', 'nope'], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stdout)).toBe('');
    expect(new TextDecoder().decode(result.stderr).trim().split('\n')).toEqual([
      expect.stringMatching(/^Error: Invalid config in /),
    ]);
  });
});
