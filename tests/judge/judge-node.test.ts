import { describe, expect, it } from 'bun:test';
import { judgeNode, judgeNodes, type NodeJudgement } from '../../src/judge/judge-node';
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

describe('judgeNodes', () => {
  const rule = {
    id: passFailRule.id,
    description: passFailRule.description,
    category: passFailRule.category,
    mode: 'semantic',
    severity: { fail: 'error' },
    verdicts: passFailRule.verdicts,
  } as unknown as Rule;
  const other = { ...node, title: 'Other', label: 'other.md' } as SpaceNode;

  it('calls a judge without evaluateBatch once per node', async () => {
    const seen: string[] = [];
    const judge: SemanticJudgeProvider = {
      name: 'single',
      evaluate: (input) => {
        seen.push(input.node.title);
        return Promise.resolve({ [passFailRule.id]: { verdict: 'pass' } });
      },
    };
    const out = await judgeNodes(judge, [
      { node: node as SpaceNode, rules: [rule] },
      { node: other, rules: [rule] },
    ]);
    expect(seen).toEqual([node.title, 'Other']);
    expect(out.map((o) => o.length)).toEqual([1, 1]);
  });

  it('sends every node to evaluateBatch at once and maps results back by position', async () => {
    let calls = 0;
    const judge: SemanticJudgeProvider = {
      name: 'batch',
      evaluate: () => Promise.reject(new Error('unused')),
      evaluateBatch: (inputs) => {
        calls++;
        return Promise.resolve(
          inputs.map((i) => ({
            [passFailRule.id]: i.node.title === 'Other' ? { verdict: 'fail' } : { verdict: 'pass' },
          })),
        );
      },
    };
    const out = await judgeNodes(judge, [
      { node: node as SpaceNode, rules: [rule] },
      { node: other, rules: [] },
      { node: other, rules: [rule] },
    ]);
    expect(calls).toBe(1);
    expect(out[0]?.[0]).toMatchObject({ failed: false, verdict: 'pass' });
    expect(out[1]).toEqual([]);
    expect(out[2]?.[0]).toMatchObject({ failed: true, verdict: 'fail' });
  });

  it('marks every rule as an error, not a pass, when the batch call throws', async () => {
    const judge: SemanticJudgeProvider = {
      name: 'batch',
      evaluate: () => Promise.reject(new Error('unused')),
      evaluateBatch: () => Promise.reject(new Error('boom')),
    };
    const out = await judgeNodes(judge, [
      { node: node as SpaceNode, rules: [rule] },
      { node: other, rules: [rule] },
    ]);
    expect(out.flat().every((j) => j.failed && j.error === 'boom')).toBe(true);
  });
});
