import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadConfig } from '../src/config';

const ROOT = join(import.meta.dir, '..');
const config = loadConfig();

function run(...args: string[]) {
  return Bun.spawnSync(['bun', 'run', 'src/index.ts', ...args], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('Smoke: spaces command', () => {
  it('spaces exits 0 and lists all names', () => {
    const result = run('spaces');
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    for (const space of config.spaces) {
      expect(out).toContain(space.name);
    }
  });
});

describe('Smoke: schemas command', () => {
  it('schemas list exits 0 and shows bundled schemas', () => {
    const result = run('schemas', 'list');
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain('Bundled schemas');
  });

  it('schemas show strategy_general exits 0', () => {
    const result = run('schemas', 'show', 'strategy_general');
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain('sctx://strategy_general');
    expect(out).toContain('Registry');
  });

  for (const space of config.spaces) {
    it(`schemas show --space ${space.name} exits 0`, () => {
      const result = run('schemas', 'show', '--space', space.name);
      expect(result.exitCode).toBe(0);
      const out = new TextDecoder().decode(result.stdout);
      expect(out).toContain('Registry');
    });
  }
});
