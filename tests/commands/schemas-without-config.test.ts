import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const empty = mkdtempSync(join(tmpdir(), 'sctx-no-config-'));
afterAll(() => rmSync(empty, { recursive: true, force: true }));

function run(...args: string[]) {
  const { SCTX_CONFIG: _config, SCTX_BIN: _bin, ...env } = process.env;
  const result = Bun.spawnSync(['bun', 'run', join(ROOT, 'src/index.ts'), ...args], {
    cwd: empty,
    env: { ...env, XDG_CONFIG_HOME: empty, HOME: empty },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: result.exitCode, stdout: text(result.stdout), stderr: text(result.stderr) };
}

describe('schemas commands without a config', () => {
  it('list shows bundled schemas without a missing-config warning', () => {
    const r = run('schemas', 'list');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('strategy_general');
    expect(r.stderr).not.toContain('E_CONFIG_NOT_FOUND');
  });

  it('show <schema> works without a missing-config warning', () => {
    const r = run('schemas', 'show', 'strategy_general');
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('E_CONFIG_NOT_FOUND');
  });

  it('show --space still reports the missing config', () => {
    const r = run('schemas', 'show', '--space', 'nope');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('E_CONFIG_NOT_FOUND');
  });
});
