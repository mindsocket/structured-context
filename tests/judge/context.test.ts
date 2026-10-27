import { describe, expect, it } from 'bun:test';
import { judgeContext, type RuleContext, relatedNodes, ruleContext } from '../../src/judge/context';
import { judgeNodes } from '../../src/judge/judge-node';
import { FakeJudgeProvider } from '../../src/judge/provider/fake';
import type { SemanticJudgeInput, SemanticJudgeProvider } from '../../src/judge/types';
import { evaluateRulesWithGating } from '../../src/schema/gating';
import { buildSpaceGraph } from '../../src/space-graph';
import type { Rule, SpaceNode } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef, makeSpaceNode } from '../test-helpers';

const hierarchy = makeHierarchy([makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')]);
const child = (title: string, type: string, parent: string, extra: Record<string, unknown> = {}) =>
  makeSpaceNode(title, type, extra, undefined, [makeParentRef(parent)]);

const goal = makeSpaceNode('Goal', 'goal', { content: 'goal body', owner: 'team' });
const opp = child('Opp', 'opportunity', 'Goal', { content: 'opp body' });
const sibling = child('Sibling', 'opportunity', 'Goal', { content: 'sibling body' });
const sol = child('Sol', 'solution', 'Opp', { content: 'sol body' });
const sol2 = child('Sol2', 'solution', 'Opp');
const subSol = child('SubSol', 'solution', 'Sol');
// Related to Opp by a non-hierarchy relationship: never in scope.
const assumption = makeSpaceNode('Assume', 'assumption', {}, undefined, [
  makeParentRef('Opp', { kind: 'relationship', hierarchy: undefined }),
]);
const nodes: SpaceNode[] = [goal, opp, sibling, sol, sol2, subSol, assumption];
const graph = buildSpaceGraph(nodes, hierarchy);

const ctx = (scope: RuleContext['scope'], content: RuleContext['content'] = 'none'): RuleContext => ({
  scope,
  content,
});
const titles = (scope: RuleContext['scope']) => relatedNodes(graph, opp, ctx(scope)).map((r) => r.title);

describe('relatedNodes', () => {
  it('selects each scope along hierarchy edges', () => {
    expect(titles(['parent'])).toEqual(['Goal']);
    expect(titles(['siblings'])).toEqual(['Sibling']);
    expect(titles(['children'])).toEqual(['Sol', 'Sol2']);
    expect(titles(['ancestors'])).toEqual(['Goal']);
    expect(titles(['descendants'])).toEqual(['Sol', 'Sol2', 'SubSol']);
  });

  it('adds scopes together, once per node, with every relation it has', () => {
    const related = relatedNodes(graph, opp, ctx(['parent', 'ancestors', 'children']));
    expect(related.map((r) => [r.title, r.relations])).toEqual([
      ['Goal', ['parent', 'ancestor']],
      ['Sol', ['child']],
      ['Sol2', ['child']],
    ]);
  });

  it('is empty for an empty scope and ignores non-hierarchy relationships', () => {
    expect(titles([])).toEqual([]);
    expect(titles(['children', 'descendants', 'siblings'])).not.toContain('Assume');
  });

  it('sends all schema data but the body, which follows the content mode', () => {
    const without = relatedNodes(graph, opp, ctx(['parent'], 'nodeOnly'))[0]!;
    expect(without.data).toEqual({ owner: 'team' });
    const withBody = relatedNodes(graph, opp, ctx(['parent'], 'fullScope'))[0]!;
    expect(withBody.data).toEqual({ owner: 'team', content: 'goal body' });
  });

  it('finds no relations in a graph without a hierarchy', () => {
    const flat = buildSpaceGraph(nodes, undefined);
    expect(relatedNodes(flat, opp, ctx(['parent', 'children', 'siblings', 'ancestors', 'descendants']))).toEqual([]);
  });
});

describe('judgeContext', () => {
  it('sends no bodies unless includeContent asks for them', () => {
    expect(judgeContext(graph, opp, ctx([])).node.schemaData).not.toHaveProperty('content');
    expect(judgeContext(graph, opp, ctx([], 'nodeOnly')).node.schemaData.content).toBe('opp body');
    expect(judgeContext(graph, opp, ctx([], 'fullScope')).node.schemaData.content).toBe('opp body');
  });

  it('omits related when the scope is empty', () => {
    expect(judgeContext(graph, opp, ctx([])).related).toBeUndefined();
  });
});

describe('ruleContext', () => {
  const rule = (semantic: object) =>
    ({ id: 'r', category: 'coherence', description: 'd', semantic }) as unknown as Rule;

  it('defaults to the evaluated node alone, with no bodies', () => {
    expect(ruleContext(rule({}))).toEqual({ scope: [], content: 'none' });
  });

  it('reads scope and includeContent, treating true as fullScope', () => {
    expect(ruleContext(rule({ scope: ['children', 'parent'], includeContent: 'nodeOnly' }))).toEqual({
      scope: ['parent', 'children'],
      content: 'nodeOnly',
    });
    expect(ruleContext(rule({ includeContent: true })).content).toBe('fullScope');
  });

  it('expands branch, and wider scopes imply the direct relation', () => {
    const all: RuleContext['scope'] = ['parent', 'children', 'ancestors', 'descendants'];
    expect(ruleContext(rule({ scope: ['branch'] })).scope).toEqual(all);
    expect(ruleContext(rule({ scope: ['branch', 'parent', 'ancestors'] })).scope).toEqual(all);
    expect(ruleContext(rule({ scope: ['ancestors'] })).scope).toEqual(['parent', 'ancestors']);
    expect(ruleContext(rule({ scope: ['descendants'] })).scope).toEqual(['children', 'descendants']);
  });
});

describe('judgeNodes with scope', () => {
  const scoped = (id: string, semantic: object) =>
    ({ id, category: 'coherence', description: id, semantic }) as unknown as Rule;

  it('shares one input between rules with the same context and splits the rest, keeping rule order', async () => {
    const inputs: SemanticJudgeInput[] = [];
    const judge: SemanticJudgeProvider = {
      name: 'spy',
      evaluate: (input) => {
        inputs.push(input);
        return Promise.resolve(Object.fromEntries(input.rules.map((r) => [r.id, { verdict: 'pass' }])));
      },
    };
    const rules = [scoped('a', { scope: ['parent'] }), scoped('b', {}), scoped('c', { scope: ['parent'] })];
    const out = await judgeNodes(judge, [{ node: opp, rules }], graph);
    expect(inputs.map((i) => i.rules.map((r) => r.id))).toEqual([['a', 'c'], ['b']]);
    expect(inputs[0]?.related?.map((r) => r.title)).toEqual(['Goal']);
    expect(inputs[1]?.related).toBeUndefined();
    expect(out[0]?.map((j) => j.rule.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('scope under gating', () => {
  it('selects related nodes whether or not a verdict or gate has touched them', async () => {
    const rules = [
      // Fails on Goal with an error, which gates Opp and everything below it.
      { id: 'goal-fails', category: 'validation', description: 'g', type: 'goal', expression: 'false' },
      {
        id: 'sol-coherent',
        category: 'coherence',
        description: 's',
        type: 'solution',
        semantic: { scope: ['parent', 'ancestors'] },
      },
    ] as unknown as Rule[];
    const fake = new FakeJudgeProvider();
    await evaluateRulesWithGating(nodes, rules, graph, [], { provider: fake, includeGated: true });
    const call = fake.callHistory.find((c) => c.node.title === 'Sol');
    expect(call?.related?.map((r) => [r.title, r.relations])).toEqual([
      ['Opp', ['parent', 'ancestor']],
      ['Goal', ['ancestor']],
    ]);
  });
});
