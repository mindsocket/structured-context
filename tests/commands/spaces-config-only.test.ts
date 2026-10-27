import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sctx-spaces-')));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function spaces(config: unknown, ...args: string[]) {
  writeFileSync(join(dir, '.sctx.json'), typeof config === 'string' ? config : JSON.stringify(config));
  const { SCTX_CONFIG: _config, SCTX_BIN: _bin, ...env } = process.env;
  const result = Bun.spawnSync(['bun', 'run', join(ROOT, 'src/index.ts'), 'spaces', ...args], {
    cwd: dir,
    env: { ...env, XDG_CONFIG_HOME: dir, HOME: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('spaces reports the config, not the spaces', () => {
  const odd = {
    spaces: [
      {
        name: 'remote',
        path: 'https://example.atlassian.net/wiki/spaces/X/pages/1/Page',
        schema: 'strategy_general.json',
      },
      { name: 'moved', path: 'nowhere', schema: 'strategy_general.json' },
      { name: 'unset', path: '.' },
    ],
  };

  it('lists every space without problems or a failing exit code', () => {
    const r = spaces(odd, '--json');
    const out = JSON.parse(r.stdout);

    expect(r.code).toBe(0);
    expect(out.problems).toEqual([]);
    expect(out.spaces.map((s: { name: string }) => s.name)).toEqual(['remote', 'moved', 'unset']);
  });

  it('prints the same in text mode', () => {
    const r = spaces(odd);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('remote');
    expect(r.stdout).not.toContain('E_');
  });

  it('still fails with a code when the config itself is invalid', () => {
    const r = spaces('{ not json', '--json');

    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).problems[0].code).toBe('E_CONFIG_INVALID');
  });
});
