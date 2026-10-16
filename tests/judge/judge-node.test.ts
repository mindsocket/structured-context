import { describe, expect, it } from 'bun:test';
import { judgeNodes as judgeNodesIn, type NodeJudgement } from '../../src/judge/judge-node';
import type { SemanticJudgeProvider, SemanticJudgeResult } from '../../src/judge/types';
import type { Rule } from '../../src/schema/metadata-contract';
import { buildSpaceGraph } from '../../src/space-graph';
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

const graph = buildSpaceGraph([], undefined);
const judgeNodes = (j: SemanticJudgeProvider, items: Array<{ node: SpaceNode; rules: Rule[] }>) =>
  judgeNodesIn(j, items, graph);
const judgeNode = async (j: SemanticJudgeProvider, n: SpaceNode, rules: Rule[]) =>
  (await judgeNodes(j, [{ node: n, rules }]))[0] ?? [];

describe('judgeNode', () => {
  it('treats an unknown verdict as a judge error, not a pass', async () => {
    const rule = {
      id: passFailRule.id,
      description: passFailRule.description,
      category: passFailRule.category,
      semantic: { verdicts: passFailRule.verdicts, severity: { fail: 'error' } },
    } as unknown as Rule;
    const judgements: NodeJudgement[] = await judgeNode(
      canned({ 'customer-voice': { verdict: 'unexpected', evidence: 'hmm' } }),
      node as SpaceNode,
      [rule],
    );
    expect(judgements).toHaveLength(1);
    expect(judgements[0]).toMatchObject({
      violated: true,
      error: expect.stringContaining('unknown verdict "unexpected"'),
    });
  });
});

describe('judgeNodes', () => {
  const rule = {
    id: passFailRule.id,
    description: passFailRule.description,
    category: passFailRule.category,
    semantic: { verdicts: passFailRule.verdicts, severity: { fail: 'error' } },
  } as unknown as Rule;
  const other = { ...node, title: 'Other', label: 'other.md' } as SpaceNode;

  it('calls a judge without evaluateNodes once per node', async () => {
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

  it('sends every node to evaluateNodes at once and maps results back by position', async () => {
    let calls = 0;
    const judge: SemanticJudgeProvider = {
      name: 'multi-node',
      evaluate: () => Promise.reject(new Error('unused')),
      evaluateNodes: (inputs) => {
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
    expect(out[0]?.[0]).toMatchObject({ violated: false, verdict: 'pass' });
    expect(out[1]).toEqual([]);
    expect(out[2]?.[0]).toMatchObject({ violated: true, verdict: 'fail' });
  });

  it('marks every rule as an error, not a pass, when the evaluateNodes call throws', async () => {
    const judge: SemanticJudgeProvider = {
      name: 'multi-node',
      evaluate: () => Promise.reject(new Error('unused')),
      evaluateNodes: () => Promise.reject(new Error('boom')),
    };
    const out = await judgeNodes(judge, [
      { node: node as SpaceNode, rules: [rule] },
      { node: other, rules: [rule] },
    ]);
    expect(out.flat().every((j) => j.violated && j.error === 'boom')).toBe(true);
  });
});
