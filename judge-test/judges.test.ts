/**
 * Live judge tests: call real providers on a small fixture space. They cost money, so they run only with
 * SCTX_LIVE_JUDGE_TESTS=1 (`bun run test:judge`), and each provider only when its API key is set.
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CONFIG = join(import.meta.dir, 'fixtures', 'config.json');
const LIVE = process.env.SCTX_LIVE_JUDGE_TESTS === '1';

const PROVIDERS = [
  { name: 'jev', keyEnv: 'OPENROUTER_API_KEY' },
  { name: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY' },
  { name: 'openai', keyEnv: 'OPENAI_API_KEY' },
];

const SOLUTION = 'Build an AI receipt scanner.md';
const GATED = 'Use a third-party OCR API.md';

type Output = {
  ruleViolations: Array<{
    file: string;
    ruleId: string;
    severity: string;
    description: string;
    verdict?: string;
    guidance?: string;
  }>;
  coverageGates: Array<{ file: string; ruleId?: string; gatedFiles: string[] }>;
};

function validate(...args: string[]): { exitCode: number; output: Output } {
  const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', 'validate', 'judge-test', '--json', ...args], {
    cwd: ROOT,
    env: { ...process.env, SCTX_CONFIG: CONFIG },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = new TextDecoder().decode(result.stdout);
  if (!stdout.trim().startsWith('{')) throw new Error(new TextDecoder().decode(result.stderr) || stdout);
  return { exitCode: result.exitCode, output: JSON.parse(stdout) };
}

describe.skipIf(!LIVE)('live judges', () => {
  for (const { name, keyEnv } of PROVIDERS) {
    it.skipIf(!process.env[keyEnv])(
      `${name}: classifies clear-cut opportunities and gates below an error verdict`,
      () => {
        const { exitCode, output } = validate('--judge', name);

        // No judge errors, and the only violation is the solution in disguise.
        expect(output.ruleViolations.filter((v) => v.description.includes('Judge error'))).toEqual([]);
        expect(output.ruleViolations).toHaveLength(1);
        const violation = output.ruleViolations[0];
        expect(violation).toMatchObject({
          file: SOLUTION,
          ruleId: 'opportunity-framing',
          severity: 'error',
          verdict: 'solution',
        });
        expect(violation?.guidance).toContain('customer problem');
        expect(exitCode).toBe(1);

        // The error verdict gates the solution beneath it, so that solution is not judged.
        expect(output.coverageGates).toEqual([
          expect.objectContaining({ file: SOLUTION, ruleId: 'opportunity-framing', gatedFiles: [GATED] }),
        ]);
      },
      60_000,
    );
  }
});
