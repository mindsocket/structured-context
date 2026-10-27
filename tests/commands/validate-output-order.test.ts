import { afterAll, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempSpace } from '../helpers/temp-space';

const ROOT = join(import.meta.dir, '..', '..');
const space = makeTempSpace([]);
const configPath = join(space.dir, 'config.json');
writeFileSync(configPath, JSON.stringify(space.config));
for (let i = 0; i < 30; i++) writeFileSync(join(dirname(space.file('G.md')), `untyped-${i}.md`), 'No frontmatter\n');
afterAll(() => space.cleanup());

describe('validate text output', () => {
  it('prints the summary table after the per-file details, so a tail keeps the counts', () => {
    const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', 'validate', 'ts'], {
      cwd: ROOT,
      env: { ...process.env, SCTX_CONFIG: configPath },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const lines = new TextDecoder().decode(result.stdout).split('\n');
    const lastExcluded = lines.findLastIndex((l) => l.includes('untyped-'));
    const summary = lines.findIndex((l) => l.includes('Space Validation Results'));
    expect(lastExcluded).toBeGreaterThan(0);
    expect(summary).toBeGreaterThan(lastExcluded);
    expect(lines.slice(-20).join('\n')).toContain('Excluded during parsing');
  });
});
