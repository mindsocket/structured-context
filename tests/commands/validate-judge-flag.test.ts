import { afterAll, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempSpace } from '../helpers/temp-space';

const ROOT = join(import.meta.dir, '..', '..');
const space = makeTempSpace(
  [{ id: 'step-fit', type: 'step', mode: 'semantic', category: 'coherence', description: 'Step fits its task' }],
  { judge: { providers: { f: { type: 'fake' } } } },
);
const configPath = join(space.dir, 'config.json');
writeFileSync(configPath, JSON.stringify(space.config));
afterAll(() => space.cleanup());

function spawn(...args: string[]) {
  const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', ...args, '--json'], {
    cwd: ROOT,
    env: { ...process.env, SCTX_CONFIG: configPath },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { ...result, stderr: new TextDecoder().decode(result.stderr) };
}

describe('--judge on the CLI', () => {
  // An unknown name fails only if the flag reaches the judge.
  for (const args of [
    ['validate', 'ts'],
    ['validate-file', space.file('S.md')],
  ]) {
    it(`${args[0]} passes --judge to the judge`, () => {
      const result = spawn(...args, '--judge', 'missing');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('missing');
    });
  }

  it('--no-semantic wins over --judge', () => {
    expect(spawn('validate', 'ts', '--judge', 'missing', '--no-semantic').exitCode).toBe(0);
  });
});
