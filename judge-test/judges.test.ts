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

const NEED = 'I cannot find my receipts at tax time.md';
const SOLUTION = 'Build an AI receipt scanner.md';
const GATED = 'Use a third-party OCR API.md';

type Output = {
  ruleViolations: Array<{ file: string; ruleId: string; severity: string; verdict?: string; guidance?: string }>;
  semanticEvaluations: Array<{ file: string; ruleId: string; verdict: string; pass: boolean }>;
  gatedRules: Array<{ file: string; ruleId: string }>;
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
        const verdict = (file: string) =>
          output.semanticEvaluations.find((e) => e.file === file && e.ruleId === 'opportunity-framing')?.verdict;

        expect(verdict(NEED)).toBe('customer-need');
        expect(verdict(SOLUTION)).toBe('solution');

        const violation = output.ruleViolations.find((v) => v.file === SOLUTION);
        expect(violation).toMatchObject({ severity: 'error', verdict: 'solution' });
        expect(violation?.guidance).toContain('customer problem');
        expect(exitCode).toBe(1);

        // The error verdict gates the solution beneath it, so it is not judged.
        expect(output.gatedRules).toContainEqual(
          expect.objectContaining({ file: GATED, ruleId: 'solution-addresses-parent' }),
        );
        expect(output.semanticEvaluations.some((e) => e.file === GATED)).toBe(false);

        // No judge errors: every evaluation has a real verdict.
        expect(output.ruleViolations.filter((v) => !v.verdict)).toEqual([]);
      },
      60_000,
    );
  }
});
