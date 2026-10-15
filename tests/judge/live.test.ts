/**
 * Live judge tests: call real providers on one inline node. They cost money, so they run only with
 * SCTX_LIVE_JUDGE_TESTS=1 (`bun run test:judge`), and each provider only when its API key is set.
 */
import { describe, expect, it } from 'bun:test';
import { createModelProvider } from '../../src/judge/factory';
import type { SemanticJudgeInput, SemanticRuleSpec } from '../../src/judge/types';
import { node, passFailRule } from './helpers';

const CASES = [
  { type: 'jev' as const, keyEnv: 'OPENROUTER_API_KEY' },
  { type: 'anthropic' as const, keyEnv: 'ANTHROPIC_API_KEY' },
  { type: 'openai' as const, keyEnv: 'OPENAI_API_KEY' },
];

describe.skipIf(process.env.SCTX_LIVE_JUDGE_TESTS !== '1')('live judges', () => {
  for (const { type, keyEnv } of CASES) {
    it.skipIf(!process.env[keyEnv])(
      `${type}: returns a verdict from the rule's closed set`,
      async () => {
        const provider = createModelProvider(type, { type }, { [keyEnv]: process.env[keyEnv] });
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
