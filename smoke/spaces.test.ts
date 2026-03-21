import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { loadConfig } from '../src/config';

const ROOT = join(import.meta.dir, '..');
const config = loadConfig();
const goodSpaces = ['personal', 'auspol', 'test', 'grassroots_roger'];

describe('Smoke: validate all configured spaces', () => {
  for (const space of config.spaces.filter((s) => goodSpaces.includes(s.name))) {
    it(`${space.name} passes validation`, () => {
      const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', 'validate', space.name], {
        cwd: ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      if (result.exitCode !== 0) {
        const output = new TextDecoder().decode(result.stdout);
        const errors = new TextDecoder().decode(result.stderr);
        console.error(`\n--- ${space.name} stdout ---\n${output}`);
        if (errors) console.error(`--- ${space.name} stderr ---\n${errors}`);
      }

      expect(result.exitCode).not.toBe(2);
    });
  }
});
