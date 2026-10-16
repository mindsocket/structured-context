import { afterEach, describe, expect, it } from 'bun:test';
import { createModelProvider } from '../../../src/judge/factory';
import { OPENAI_DECISIONS_ENDPOINT, OpenAIDecisionsJudgeProvider } from '../../../src/judge/provider/openai-decisions';
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

describe('OpenAIDecisionsJudgeProvider', () => {
  it('sends one request per node with a choice question per rule', async () => {
    const calls = mockFetch({
      answers: [
        {
          type: 'choice',
          name: 'customer-voice',
          choice: 'pass',
          confidence: 0.9,
          probabilities: [
            { value: 'pass', probability: 0.95 },
            { value: 'fail', probability: 0.05 },
          ],
        },
        {
          type: 'choice',
          name: 'framing',
          choice: 'solution',
          confidence: 0.6,
          probabilities: [
            { value: 'good', probability: 0.1 },
            { value: 'weak', probability: 0.3 },
            { value: 'solution', probability: 0.6 },
          ],
        },
      ],
    });
    const provider = new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' });
    const results = await provider.evaluate({ node, rules: [passFailRule, graded] });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(OPENAI_DECISIONS_ENDPOINT);
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent.model).toBe('gpt-6-luna');
    expect(sent.input).toContain('Title: I cannot find my receipts');
    expect(sent.input).toContain('Parents: Faster Tax Filing');
    expect(sent.questions).toEqual([
      {
        type: 'choice',
        name: 'customer-voice',
        instructions: 'Needs to sound like a customer quote, not a solution or business goal',
        choices: [
          { value: 'pass', description: 'Customer voice.' },
          { value: 'fail', description: 'Not customer voice.' },
        ],
      },
      {
        type: 'choice',
        name: 'framing',
        instructions: 'Framing quality',
        choices: [
          { value: 'good', description: 'Clear need' },
          { value: 'weak', description: 'Vague need' },
          { value: 'solution', description: 'A solution in disguise' },
        ],
      },
    ]);
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>).authorization).toBe('Bearer k');

    expect(results.framing).toMatchObject({ verdict: 'solution', confidence: 0.6, probabilities: { solution: 0.6 } });
    expect((results.framing as { evidence: string }).evidence).toContain('solution 0.60');
  });

  it('reports an error for a rule with a missing, refused or unknown choice, leaving others intact', async () => {
    mockFetch({
      answers: [
        { type: 'choice', name: 'framing', choice: 'nonsense' },
        { type: 'refusal', name: 'customer-voice' },
      ],
    });
    const results = await new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' }).evaluate({
      node,
      rules: [passFailRule, graded],
    });
    expect(results.framing).toHaveProperty('error');
    expect(results['customer-voice']).toHaveProperty('error');
  });

  it('throws on an HTTP error', async () => {
    mockFetch({ error: 'bad' }, 401);
    await expect(
      new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' }).evaluate({
        node,
        rules: [passFailRule],
      }),
    ).rejects.toThrow('OpenAI Decisions API error (401)');
  });

  it('is created explicitly via a bundled provider with its key env, never auto-detected', () => {
    expect(createModelProvider('openai-decisions', { api: 'openai-decisions' }, { OPENAI_API_KEY: 'k' }).name).toBe(
      'openai-decisions',
    );
    expect(() => createModelProvider('openai-decisions', { api: 'openai-decisions' }, {})).toThrow('OPENAI_API_KEY');
  });
});

describe('OpenAIDecisionsJudgeProvider related nodes', () => {
  it('lists related nodes with their relation in the input', async () => {
    const calls = mockFetch({
      answers: [{ type: 'choice', name: 'customer-voice', choice: 'pass', probabilities: [] }],
    });
    const provider = new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' });
    await provider.evaluate({
      node,
      related: [{ relations: ['child'], title: 'Receipt scanner', type: 'solution', data: { owner: 'finance' } }],
      rules: [passFailRule],
    });
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent.input).toContain('Related node (child): Receipt scanner');
    expect(sent.input).toContain('owner: "finance"');
  });
});
