import { describe, expect, it } from 'bun:test';
import { PerRuleJudgeProvider } from '../../src/judge/provider/per-rule';
import type { SemanticJudgeResult } from '../../src/judge/types';
import { resolveSemanticRule } from '../../src/judge/verdicts';
import type { Rule } from '../../src/types';
import { graded, node, passFailRule } from './helpers';

const base: Rule = { id: 'r', category: 'best-practice', description: 'd', semantic: {} };

describe('resolveSemanticRule', () => {
  it('defaults to pass/fail with fail at the rule severity', () => {
    const resolved = resolveSemanticRule(base);
    expect(Object.keys(resolved.spec.verdicts)).toEqual(['pass', 'fail']);
    expect(resolved.severities).toEqual({ fail: 'info' }); // best-practice default
    expect(resolveSemanticRule({ ...base, severity: 'error' }).severities).toEqual({ fail: 'error' });
    expect(resolveSemanticRule({ ...base, semantic: { severity: { 'missing-context': 'info' } } }).severities).toEqual({
      fail: 'info',
      'missing-context': 'info',
    });
  });

  it('treats `semantic: true` like `semantic: {}`', () => {
    expect(resolveSemanticRule({ ...base, semantic: true }).severities).toEqual({ fail: 'info' });
  });

  it('uses the semantic rubric, falling back to nothing so the prompt can use the description', () => {
    expect(resolveSemanticRule({ ...base, semantic: { rubric: 'R' } }).spec.rubric).toBe('R');
    expect(resolveSemanticRule(base).spec.rubric).toBeUndefined();
  });

  it('maps declared verdicts to severities; unmapped and ignored verdicts pass', () => {
    const resolved = resolveSemanticRule({
      ...base,
      semantic: {
        verdicts: { ok: 'O', minor: 'M', major: 'J', skip: 'S' },
        severity: { minor: 'warning', major: 'error', skip: 'ignore' },
      },
    });
    expect(resolved.severities).toEqual({ minor: 'warning', major: 'error' });
  });

  it('splits a verdict into the judge description and user guidance', () => {
    const resolved = resolveSemanticRule({
      ...base,
      semantic: {
        verdicts: {
          ok: 'Fine',
          vague: { description: 'Too vague to act on', guidance: 'Name the customer and the pain.' },
        },
        severity: { vague: 'warning' },
      },
    });
    expect(resolved.spec.verdicts).toEqual({ ok: 'Fine', vague: 'Too vague to act on' });
    expect(resolved.guidance).toEqual({ vague: 'Name the customer and the pain.' });
  });

  it('rejects custom verdicts without a severity map, unknown verdicts, and sets with no passing verdict', () => {
    expect(() => resolveSemanticRule({ ...base, semantic: { verdicts: { a: 'A', b: 'B' } } })).toThrow(
      'must map the failing verdicts',
    );
    expect(() =>
      resolveSemanticRule({ ...base, semantic: { verdicts: { a: 'A', b: 'B' }, severity: { z: 'error' } } }),
    ).toThrow('not in its verdicts');
    expect(() =>
      resolveSemanticRule({
        ...base,
        semantic: { verdicts: { a: 'A', b: 'B' }, severity: { a: 'error', b: 'warning' } },
      }),
    ).toThrow('no passing verdict');
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
