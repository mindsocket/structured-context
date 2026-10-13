import { describe, expect, it } from 'bun:test';
import { PerRuleJudgeProvider } from '../../src/judge/provider/per-rule';
import type { SemanticJudgeResult } from '../../src/judge/types';
import { semanticRuleSpec } from '../../src/judge/verdicts';
import type { Rule } from '../../src/types';
import { graded, node, passFailRule } from './helpers';

const base: Rule = { id: 'r', category: 'best-practice', description: 'd', mode: 'semantic' };

describe('semanticRuleSpec', () => {
  it('defaults to pass/fail with fail as the violation', () => {
    const spec = semanticRuleSpec(base);
    expect(Object.keys(spec.verdicts)).toEqual(['pass', 'fail']);
    expect(spec.failOn).toEqual(['fail']);
  });

  it('uses declared verdicts and failOn', () => {
    const spec = semanticRuleSpec({ ...base, verdicts: { a: 'A', b: 'B', c: 'C' }, failOn: ['b', 'c'] });
    expect(spec.failOn).toEqual(['b', 'c']);
  });

  it('rejects declared verdicts without failOn, unknown failOn, and all-failing sets', () => {
    expect(() => semanticRuleSpec({ ...base, verdicts: { a: 'A', b: 'B' } })).toThrow('no failOn');
    expect(() => semanticRuleSpec({ ...base, verdicts: { a: 'A', b: 'B' }, failOn: ['z'] })).toThrow(
      'not in its verdicts',
    );
    expect(() => semanticRuleSpec({ ...base, verdicts: { a: 'A', b: 'B' }, failOn: ['a', 'b'] })).toThrow(
      'no passing verdict',
    );
  });
});

describe('PerRuleJudgeProvider', () => {
  class Stub extends PerRuleJudgeProvider {
    readonly name = 'stub';
    protected async judgeRule(_n: unknown, rule: { id: string }): Promise<SemanticJudgeResult> {
      if (rule.id === 'framing') throw new Error('network down');
      return { verdict: 'pass' };
    }
  }

  it('isolates a failing rule from the others', async () => {
    const results = await new Stub().evaluate({ node, rules: [passFailRule, graded] });
    expect(results['customer-voice']).toEqual({ verdict: 'pass' });
    expect(results.framing).toEqual({ error: 'network down' });
  });
});
