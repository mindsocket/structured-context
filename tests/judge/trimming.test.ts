import { describe, expect, it } from 'bun:test';
import { judgeNodes } from '../../src/judge/judge-node';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import { PER_NODE_INPUT_CAP_TOKENS, type TrimReport } from '../../src/judge/trim';
import { resolveSemanticRule } from '../../src/judge/verdicts';
import { buildSpaceGraph } from '../../src/space-graph';
import type { Rule } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef, makeSpaceNode } from '../test-helpers';

const hierarchy = makeHierarchy([makeLevel('goal'), makeLevel('opportunity')]);
const text = (tokens: number) => 'word '.repeat(tokens * 0.8);
const goal = (body: string) => makeSpaceNode('Goal', 'goal', { content: body });
const opp = (body: string) =>
  makeSpaceNode('Opp', 'opportunity', { content: body }, undefined, [makeParentRef('Goal')]);
const rule = (id: string, semantic: object) =>
  ({ id, category: 'coherence', description: `${id} desc`, semantic }) as unknown as Rule;
const report = (): TrimReport => ({ nodes: new Set(), ruleIds: new Set() });

describe('per-node input cap in judgeNodes', () => {
  it('trims related bodies, still calls the provider, and records the node and rule', async () => {
    const nodes = [goal(text(PER_NODE_INPUT_CAP_TOKENS * 2)), opp('short own body')];
    const fake = new FakeJudgeProvider();
    const trimmed = report();
    const rules = [rule('r', { scope: ['parent'], includeContent: 'fullScope' })];
    const out = await judgeNodes(fake, [{ node: nodes[1]!, rules }], buildSpaceGraph(nodes, hierarchy), trimmed);
    expect(out[0]?.[0]?.failed).toBe(false);
    expect(fake.callHistory).toHaveLength(1);
    expect(String(fake.callHistory[0]?.related?.[0]?.data.content)).toContain('[RULE_EVALUATION_CONTENT_TRIMMED');
    expect(fake.callHistory[0]?.node.schemaData.content).toBe('short own body');
    expect([...trimmed.nodes]).toEqual(['Opp.md']);
    expect([...trimmed.ruleIds]).toEqual(['r']);
  });

  it('records nothing when the input fits', async () => {
    const nodes = [goal('short'), opp('short')];
    const trimmed = report();
    const rules = [rule('r', { scope: ['parent'], includeContent: 'fullScope' })];
    await judgeNodes(new FakeJudgeProvider(), [{ node: nodes[1]!, rules }], buildSpaceGraph(nodes, hierarchy), trimmed);
    expect(trimmed.nodes.size).toBe(0);
  });

  it('reports an error under the rule id, without calling the provider, when fields alone exceed the cap', async () => {
    const huge = makeSpaceNode('Huge', 'opportunity', { notes: text(PER_NODE_INPUT_CAP_TOKENS * 2) });
    const fake = new FakeJudgeProvider();
    const out = await judgeNodes(fake, [{ node: huge, rules: [rule('r', {})] }], buildSpaceGraph([huge], hierarchy));
    expect(fake.callHistory).toHaveLength(0);
    expect(out[0]?.[0]).toMatchObject({
      failed: true,
      error: 'input over the per-node cap after trimming content',
    });
  });

  it('judges the other rules of a node whose scoped input is over the cap', async () => {
    const huge = makeSpaceNode('Huge', 'opportunity', { notes: text(PER_NODE_INPUT_CAP_TOKENS * 2) });
    const fake = new FakeJudgeProvider();
    const rules = [rule('a', { scope: ['parent'] }), rule('b', {})];
    const out = await judgeNodes(fake, [{ node: huge, rules }], buildSpaceGraph([huge], hierarchy));
    expect(out[0]?.every((j) => j.error?.includes('per-node cap'))).toBe(true);
  });
});

describe('missing-context verdict', () => {
  const resolved = (semantic: object) => resolveSemanticRule(rule('r', semantic));

  it('is offered on a rule with a scope or includeContent, as a warning by default', () => {
    for (const semantic of [{ scope: ['parent'] }, { includeContent: 'nodeOnly' }]) {
      const r = resolved(semantic);
      expect(Object.keys(r.spec.verdicts)).toEqual(['pass', 'fail', 'missing-context']);
      expect(r.severities['missing-context']).toBe('warning');
    }
  });

  it('is not offered on a rule with neither', () => {
    expect(Object.keys(resolved({}).spec.verdicts)).toEqual(['pass', 'fail']);
  });

  it('takes the severity from semantic.severity, including ignore', () => {
    expect(resolved({ scope: ['parent'], severity: { 'missing-context': 'info' } }).severities['missing-context']).toBe(
      'info',
    );
    expect(
      resolved({ scope: ['parent'], severity: { 'missing-context': 'ignore' } }).severities['missing-context'],
    ).toBeUndefined();
  });

  it('is told to the provider as a verdict about trim markers and resolves to a violation', async () => {
    const nodes = [goal('g'), opp('o')];
    const fake = new FakeJudgeProvider({ verdict: 'missing-context', evidence: 'cut' });
    const out = await judgeNodes(
      fake,
      [{ node: nodes[1]!, rules: [rule('r', { scope: ['parent'] })] }],
      buildSpaceGraph(nodes, hierarchy),
    );
    expect(fake.callHistory[0]?.rules[0]?.verdicts['missing-context']).toContain('RULE_EVALUATION_CONTENT_TRIMMED');
    expect(out[0]?.[0]).toMatchObject({ failed: true, verdict: 'missing-context', severity: 'warning' });
  });
});
