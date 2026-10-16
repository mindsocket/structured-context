import { afterEach, describe, expect, it } from 'bun:test';
import { buildJudgeUserPrompt } from '../../src/judge/prompt';
import { JevJudgeProvider } from '../../src/judge/provider/jev';
import { OpenAIDecisionsJudgeProvider } from '../../src/judge/provider/openai-decisions';
import { trimMarker } from '../../src/judge/trim';
import type { SemanticJudgeInput } from '../../src/judge/types';
import { resolveSemanticRule } from '../../src/judge/verdicts';
import type { Rule } from '../../src/types';
import { node } from './helpers';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture the one request a provider sends and return its body as text. */
function captureRequest(answers: unknown): { body: () => string } {
  let sent = '';
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ answers }), { status: 200 });
  }) as unknown as typeof fetch;
  return { body: () => sent };
}

const scoped = resolveSemanticRule({
  id: 'coherent',
  category: 'coherence',
  description: 'The node fits its parent',
  semantic: { scope: ['parent'], includeContent: 'fullScope' },
} as unknown as Rule);

const marker = trimMarker(1234);
const input: SemanticJudgeInput = {
  node,
  related: [
    {
      relations: ['parent'],
      title: 'Faster Tax Filing',
      type: 'goal',
      data: { owner: 'finance', content: `Goal body ${marker}` },
    },
  ],
  rules: [scoped.spec],
};

/** Every renderer shows the relation, the trim marker inside a body, and the `missing-context` option. */
describe('provider renderers', () => {
  const cases: Array<[string, () => Promise<string>]> = [
    ['chat prompt', async () => buildJudgeUserPrompt(input, input.rules[0]!)],
    [
      'openai-decisions',
      async () => {
        const request = captureRequest([]);
        await new OpenAIDecisionsJudgeProvider({ api: 'openai-decisions', apiKey: 'k' }).evaluate(input);
        return request.body();
      },
    ],
    [
      'jev',
      async () => {
        const request = captureRequest({});
        await new JevJudgeProvider({ api: 'openrouter-decisions', apiKey: 'k' }).evaluate(input);
        return request.body();
      },
    ],
  ];

  for (const [name, render] of cases) {
    it(`${name} shows the relation, trim marker and missing-context option`, async () => {
      const rendered = await render();
      expect(rendered).toContain('parent');
      expect(rendered).toContain('Faster Tax Filing');
      expect(rendered).toContain(marker);
      expect(rendered).toContain('missing-context');
    });
  }
});
