import { describe, expect, it } from 'bun:test';
import { judgeNode, type NodeJudgement } from '../../src/judge/judge-node';
import type { SemanticJudgeProvider, SemanticJudgeResult } from '../../src/judge/types';
import type { Rule } from '../../src/schema/metadata-contract';
import type { SpaceNode } from '../../src/types';
import { node, passFailRule } from './helpers';

/** Provider returning canned results keyed by rule id, bypassing response parsing. */
function canned(results: Record<string, SemanticJudgeResult>): SemanticJudgeProvider {
  return {
    name: 'canned',
    evaluate: (input) =>
      Promise.resolve(Object.fromEntries(input.rules.map((r) => [r.id, results[r.id] ?? { verdict: 'pass' }]))),
  };
}

describe('judgeNode', () => {
  it('treats an unknown verdict as a judge error, not a pass', async () => {
    const rule = {
      id: passFailRule.id,
      description: passFailRule.description,
      category: passFailRule.category,
      mode: 'semantic',
      severity: { fail: 'error' },
      verdicts: passFailRule.verdicts,
    } as unknown as Rule;
    const judgements: NodeJudgement[] = await judgeNode(
      canned({ 'customer-voice': { verdict: 'unexpected', evidence: 'hmm' } }),
      node as SpaceNode,
      [rule],
    );
    expect(judgements).toHaveLength(1);
    expect(judgements[0]).toMatchObject({
      failed: true,
      error: expect.stringContaining('unknown verdict "unexpected"'),
    });
  });
});
