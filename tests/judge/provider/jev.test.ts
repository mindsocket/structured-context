import { afterEach, describe, expect, it } from 'bun:test';
import { createModelProvider } from '../../../src/judge/factory';
import { JevJudgeProvider } from '../../../src/judge/provider/jev';
import { graded, node, passFailRule } from '../helpers';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return calls;
}

describe('JevJudgeProvider', () => {
  it('sends one request per node with a choice question per rule', async () => {
    const calls = mockFetch({
      answers: {
        'customer-voice': {
          type: 'choice',
          choice: 'pass',
          confidence: 0.9,
          probabilities: { pass: 0.95, fail: 0.05 },
        },
        framing: {
          type: 'choice',
          choice: 'solution',
          confidence: 0.6,
          probabilities: { good: 0.1, weak: 0.3, solution: 0.6 },
        },
      },
    });
    const jev = new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' });
    const results = await jev.evaluate({ node, rules: [passFailRule, graded] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/alpha/decisions');
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent.model).toBe('typesafe/jev-latest');
    expect(sent.state).toMatchObject({ title: 'I cannot find my receipts', parents: ['Faster Tax Filing'] });
    expect(sent.questions.framing).toEqual({
      type: 'choice',
      instructions: 'Framing quality',
      criteria: graded.verdicts,
    });
    expect(sent.questions['customer-voice'].instructions).toContain('customer quote');
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>).authorization).toBe('Bearer k');

    expect(results.framing).toMatchObject({ verdict: 'solution', confidence: 0.6 });
    expect((results.framing as { evidence: string }).evidence).toContain('solution 0.60');
  });

  it('reports an error for a rule with a missing or unknown choice, leaving others intact', async () => {
    mockFetch({ answers: { framing: { choice: 'nonsense' }, 'customer-voice': { choice: 'fail' } } });
    const results = await new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' }).evaluate({
      node,
      rules: [passFailRule, graded],
    });
    expect(results.framing).toHaveProperty('error');
    expect(results['customer-voice']).toMatchObject({ verdict: 'fail' });
  });

  it('throws on an HTTP error', async () => {
    mockFetch({ error: 'bad' }, 401);
    await expect(
      new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' }).evaluate({ node, rules: [passFailRule] }),
    ).rejects.toThrow('Jev API error (401)');
  });

  it('is created explicitly via a bundled provider with its key env, never auto-detected', () => {
    expect(
      createModelProvider('openrouter-jev', { api: 'openrouter-decisions' }, { OPENROUTER_API_KEY: 'k' }).name,
    ).toBe('jev');
    expect(() => createModelProvider('openrouter-jev', { api: 'openrouter-decisions' }, {})).toThrow(
      'OPENROUTER_API_KEY',
    );
  });
});
