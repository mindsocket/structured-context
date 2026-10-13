import { describe, expect, it } from 'bun:test';
import { FakeJudgeProvider } from '../../../src/judge/provider/fake';
import type { SemanticJudgeInput } from '../../../src/judge/types';
import { graded, node, passFailRule } from '../helpers';

const input: SemanticJudgeInput = { node, rules: [passFailRule, graded] };

describe('FakeJudgeProvider', () => {
  it("passes every rule by default using each rule's first non-failing verdict", async () => {
    const fake = new FakeJudgeProvider();
    const results = await fake.evaluate(input);
    expect(results['customer-voice']).toMatchObject({ verdict: 'pass' });
    expect(results.framing).toMatchObject({ verdict: 'good' });
    expect(fake.callHistory).toHaveLength(1);
  });

  it('maps the { pass } shorthand onto pass/fail', async () => {
    const results = await new FakeJudgeProvider({ pass: false, evidence: 'nope' }).evaluate({
      node,
      rules: [passFailRule],
    });
    expect(results['customer-voice']).toEqual({ verdict: 'fail', evidence: 'nope' });
  });

  it('returns full verdicts and errors as configured', async () => {
    const fake = new FakeJudgeProvider({
      framing: { verdict: 'solution', confidence: 0.8 },
      'customer-voice': { error: 'boom' },
    });
    const results = await fake.evaluate(input);
    expect(results.framing).toEqual({ verdict: 'solution', confidence: 0.8 });
    expect(results['customer-voice']).toEqual({ error: 'boom' });
  });

  it('prefers rule:title over rule keys, and supports Map and handler configs', async () => {
    const map = new Map([
      ['framing', { verdict: 'weak' }],
      ['framing:I cannot find my receipts', { verdict: 'solution' }],
    ]);
    expect((await new FakeJudgeProvider(map).evaluate(input)).framing).toEqual({ verdict: 'solution' });

    const handler = new FakeJudgeProvider(({ rule }) => ({ verdict: rule.id === 'framing' ? 'weak' : 'pass' }));
    expect((await handler.evaluate(input)).framing).toEqual({ verdict: 'weak' });
  });
});
