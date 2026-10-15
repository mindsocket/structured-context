import { afterEach, describe, expect, it } from 'bun:test';
import { createModelProvider } from '../../../src/judge/factory';
import { JEV_REQUEST_MAX_QUESTIONS, JevJudgeProvider } from '../../../src/judge/provider/jev';
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
    expect(sent.model).toBe('jev-latest');
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

  describe('evaluateBatch', () => {
    const jev = () => new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' });
    const nodeNamed = (title: string, extra: Record<string, unknown> = {}) => ({
      ...node,
      title,
      schemaData: { ...node.schemaData, title, ...extra },
    });
    /** Answers every question in the request with `pass`, or fails the request for which `fail` returns true. */
    function answering(fail: (body: { state: { nodes?: unknown } }) => boolean = () => false) {
      const bodies: Array<{ state: { nodes?: Record<string, unknown> }; questions: Record<string, unknown> }> = [];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        bodies.push(body);
        if (fail(body)) return new Response('upstream down', { status: 500 });
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((q) => [q, { choice: 'pass', probabilities: { pass: 1, fail: 0 } }]),
        );
        return new Response(JSON.stringify({ answers }), { status: 200 });
      }) as unknown as typeof fetch;
      return bodies;
    }

    it('shares one request between nodes with the same rule set, one question per node and rule', async () => {
      const bodies = answering();
      const results = await jev().evaluateBatch([
        { node: nodeNamed('A'), rules: [passFailRule, graded] },
        { node: nodeNamed('B'), rules: [passFailRule, graded] },
      ]);
      expect(bodies).toHaveLength(1);
      expect(Object.keys(bodies[0]!.state.nodes!)).toEqual(['n0', 'n1']);
      expect(Object.keys(bodies[0]!.questions).sort()).toEqual([
        'customer-voice__n0',
        'customer-voice__n1',
        'framing__n0',
        'framing__n1',
      ]);
      expect((bodies[0]!.questions.framing__n1 as { instructions: string }).instructions).toStartWith(
        'For state.nodes.n1:',
      );
      expect(results.map((r) => Object.keys(r).sort())).toEqual([
        ['customer-voice', 'framing'],
        ['customer-voice', 'framing'],
      ]);
    });

    it('sends nodes with different rule sets in separate requests', async () => {
      const bodies = answering();
      await jev().evaluateBatch([
        { node: nodeNamed('A'), rules: [passFailRule] },
        { node: nodeNamed('B'), rules: [graded] },
      ]);
      expect(bodies).toHaveLength(2);
    });

    it('sends a lone node as a plain single-node request', async () => {
      const bodies = answering();
      await jev().evaluateBatch([{ node: nodeNamed('A'), rules: [passFailRule] }]);
      expect(bodies[0]!.state.nodes).toBeUndefined();
      expect(Object.keys(bodies[0]!.questions)).toEqual(['customer-voice']);
    });

    it('splits a batch by the question cap without splitting a node', async () => {
      const bodies = answering();
      const count = JEV_REQUEST_MAX_QUESTIONS + 5;
      const results = await jev().evaluateBatch(
        Array.from({ length: count }, (_, i) => ({ node: nodeNamed(`N${i}`), rules: [passFailRule] })),
      );
      expect(bodies.map((b) => Object.keys(b.questions).length)).toEqual([JEV_REQUEST_MAX_QUESTIONS, 5]);
      expect(results).toHaveLength(count);
      expect(results.every((r) => 'verdict' in r['customer-voice']!)).toBe(true);
    });

    it('splits a batch by estimated size, and sends an oversized node alone and whole', async () => {
      const bodies = answering();
      const big = (title: string) => nodeNamed(title, { body: 'x'.repeat(60_000) }); // ~15k tokens each
      const huge = nodeNamed('Huge', { body: 'y'.repeat(200_000) }); // ~50k tokens, over the cap alone
      await jev().evaluateBatch([
        { node: big('A'), rules: [passFailRule] },
        { node: big('B'), rules: [passFailRule] },
        { node: big('C'), rules: [passFailRule] },
        { node: huge, rules: [passFailRule] },
      ]);
      expect(bodies.map((b) => (b.state.nodes ? Object.keys(b.state.nodes).length : 1))).toEqual([2, 1, 1]);
      expect(JSON.stringify(bodies[2]!.state)).toContain('y'.repeat(200_000));
    });

    it('maps a failed request to errors on its own nodes only', async () => {
      answering((body) => JSON.stringify(body).includes('"title":"A"'));
      const results = await jev().evaluateBatch([
        { node: nodeNamed('A', { body: 'x'.repeat(100_000) }), rules: [passFailRule] },
        { node: nodeNamed('B', { body: 'x'.repeat(100_000) }), rules: [passFailRule] },
      ]);
      expect(results[0]?.['customer-voice']).toMatchObject({ error: expect.stringContaining('Jev API error (500)') });
      expect(results[1]?.['customer-voice']).toMatchObject({ verdict: 'pass' });
    });
  });
});
