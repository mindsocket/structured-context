/**
 * Live judge tests: call real providers on one inline node. They cost money, so they run only with
 * SCTX_LIVE_JUDGE_TESTS=1 (`bun run test:judge`), and each provider only when its API key is set.
 */
import { describe, expect, it } from 'bun:test';
import { BUNDLED_PROVIDERS, createModelProvider } from '../../src/judge/factory';
import type { SemanticJudgeInput, SemanticJudgeResult, SemanticRuleSpec } from '../../src/judge/types';
import { graded, node, passFailRule } from './helpers';

const CASES = [
  { name: 'openrouter-jev', api: 'openrouter-decisions' as const, keyEnv: 'OPENROUTER_API_KEY' },
  { name: 'anthropic', api: 'anthropic-messages' as const, keyEnv: 'ANTHROPIC_API_KEY' },
  { name: 'openai', api: 'openai-completions' as const, keyEnv: 'OPENAI_API_KEY' },
];

describe.skipIf(process.env.SCTX_LIVE_JUDGE_TESTS !== '1')('live judges', () => {
  for (const { name, api, keyEnv } of CASES) {
    it.skipIf(!process.env[keyEnv])(
      `${name}: returns a verdict from the rule's closed set`,
      async () => {
        const provider = createModelProvider(name, { api }, { [keyEnv]: process.env[keyEnv] });
        const rule: SemanticRuleSpec = {
          ...passFailRule,
          description: 'The node title names a customer need or pain point',
        };
        const input: SemanticJudgeInput = { node, rules: [rule] };
        const results = await provider.evaluate(input);
        const result = results[rule.id];
        expect(result).toBeDefined();
        if (!result || 'error' in result) {
          expect(result).not.toHaveProperty('error');
          return;
        }
        expect(result.verdict).toBeOneOf(['pass', 'fail']);
        expect(typeof result.evidence).toBe('string');
      },
      60_000,
    );
  }
});

/**
 * Drift between judging nodes one at a time (`evaluate`) and batched (`evaluateNodes`). Prints per-node, per-rule
 * verdicts and probability deltas; asserts only that both paths return a valid verdict, so the numbers are for a
 * person to read. Run with `bun test tests/judge/live.test.ts -t drift` and the env below.
 */
describe.skipIf(process.env.SCTX_LIVE_JUDGE_TESTS !== '1')('live judges: batching drift', () => {
  const titles = [
    'I cannot find my receipts when tax time comes',
    'Build a receipt scanner app',
    'Increase filing revenue by 20%',
    'Tax forms are confusing and I never know which one I need',
  ];
  const inputs: SemanticJudgeInput[] = titles.map((title, i) => ({
    node: { ...node, label: `n${i}.md`, title, schemaData: { ...node.schemaData, title } },
    rules: [passFailRule, graded],
  }));

  for (const name of ['openrouter-jev', 'openrouter-openai-decisions']) {
    it.skipIf(!process.env.OPENROUTER_API_KEY)(
      `${name}: single versus batched verdicts and probabilities`,
      async () => {
        const provider = createModelProvider(name, BUNDLED_PROVIDERS[name]!, {
          OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        });
        if (!provider.evaluateNodes) throw new Error(`${name} does not batch`);
        const single: Array<Record<string, SemanticJudgeResult>> = [];
        for (const input of inputs) single.push(await provider.evaluate(input));
        const batched = await provider.evaluateNodes(inputs);

        const lines: string[] = [];
        let flips = 0;
        let maxDelta = 0;
        inputs.forEach((input, i) => {
          for (const rule of input.rules) {
            const a = single[i]?.[rule.id];
            const b = batched[i]?.[rule.id];
            if (!a || !b || 'error' in a || 'error' in b) {
              expect(a).not.toHaveProperty('error');
              expect(b).not.toHaveProperty('error');
              continue;
            }
            const deltas = Object.keys(rule.verdicts).map((v) => {
              const d = (b.probabilities?.[v] ?? 0) - (a.probabilities?.[v] ?? 0);
              maxDelta = Math.max(maxDelta, Math.abs(d));
              return `${v} ${d >= 0 ? '+' : ''}${d.toFixed(3)}`;
            });
            if (a.verdict !== b.verdict) flips++;
            lines.push(
              `${input.node.label} ${rule.id}: single=${a.verdict} batched=${b.verdict}${a.verdict === b.verdict ? '' : ' (FLIP)'}; delta ${deltas.join(', ')}`,
            );
          }
        });
        console.log(
          `[drift ${name}] verdict flips: ${flips}; max |probability delta|: ${maxDelta.toFixed(3)}\n${lines.join('\n')}`,
        );
        for (const r of [...single, ...batched]) {
          for (const rule of [passFailRule, graded]) {
            expect(Object.keys(rule.verdicts)).toContain((r[rule.id] as { verdict: string }).verdict);
          }
        }
      },
      180_000,
    );
  }
});
