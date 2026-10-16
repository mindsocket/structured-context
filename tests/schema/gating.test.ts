import { describe, expect, it } from 'bun:test';
import type { SemanticJudgeProvider } from '../../src/judge/types';
import {
  computeHierarchyDepths,
  evaluateRulesWithGating,
  type GatingSeed,
  ruleGatesDescendants,
} from '../../src/schema/gating';
import { buildSpaceGraph } from '../../src/space-graph';
import type { Rule, SpaceNode } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef } from '../test-helpers';

const hierarchy = makeHierarchy([makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')]);

function makeSpaceNode(title: string, type: string, parent?: string): SpaceNode {
  return {
    label: `${title}.md`,
    title,
    type,
    schemaData: { title, type, status: 'active' },
    linkTargets: [title],
    resolvedType: type,
    resolvedParents: parent ? [makeParentRef(parent)] : [],
    resolvedLinks: [],
  };
}

describe('computeHierarchyDepths', () => {
  it('assigns depth 1 to roots and orphans, incrementing per hierarchy level', () => {
    const goal = makeSpaceNode('Goal', 'goal');
    const opp = makeSpaceNode('Opp', 'opportunity', 'Goal');
    const sol = makeSpaceNode('Sol', 'solution', 'Opp');
    const orphanOpp = makeSpaceNode('Orphan Opp', 'opportunity');
    const graph = buildSpaceGraph([goal, opp, sol, orphanOpp], hierarchy);

    const depths = computeHierarchyDepths(graph);
    expect(depths.get('Goal')).toBe(1);
    expect(depths.get('Opp')).toBe(2);
    expect(depths.get('Sol')).toBe(3);
    expect(depths.get('Orphan Opp')).toBe(1);
  });
});

describe('evaluateRulesWithGating', () => {
  const alwaysFailRule: Rule = {
    id: 'always-fail',
    category: 'validation',
    description: 'always fails',
    expression: 'false',
  };
  const nonBlockingFailRule: Rule = {
    id: 'non-gating',
    category: 'validation',
    description: 'fails but does not block',
    expression: 'false',
    gatesDescendants: false,
  };
  const passRule: Rule = {
    id: 'always-pass',
    category: 'validation',
    description: 'always passes',
    expression: 'true',
  };

  function buildTree() {
    const goal = makeSpaceNode('Goal', 'goal');
    const opp = makeSpaceNode('Opp', 'opportunity', 'Goal');
    const sol = makeSpaceNode('Sol', 'solution', 'Opp');
    const nodes = [goal, opp, sol];
    const graph = buildSpaceGraph(nodes, hierarchy);
    return { goal, opp, sol, nodes, graph };
  }

  it('gates a node and its subtree when the node has a schema failure', async () => {
    const { goal, nodes, graph } = buildTree();
    const seeds: GatingSeed[] = [{ file: goal.label, title: goal.title, reason: 'schema' }];

    const { violations, gates } = await evaluateRulesWithGating(nodes, [alwaysFailRule], graph, seeds);

    // Goal itself is gated (schema failure suppresses its own rule layer) — no violation recorded for it.
    expect(violations.find((v) => v.file === 'Goal.md')).toBeUndefined();
    expect(violations.find((v) => v.file === 'Opp.md')).toBeUndefined();
    expect(violations.find((v) => v.file === 'Sol.md')).toBeUndefined();

    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ file: 'Goal.md', nodeTitle: 'Goal', reason: 'schema' });
    expect(gates[0]!.gatedFiles).toEqual(['Goal.md', 'Opp.md', 'Sol.md']);
  });

  it('gates a subtree when a hierarchy violation is seeded, but not the node itself', async () => {
    const { nodes, graph, opp } = buildTree();
    const seeds: GatingSeed[] = [{ file: opp.label, title: opp.title, reason: 'hierarchy' }];

    const { violations, gates } = await evaluateRulesWithGating(nodes, [passRule], graph, seeds);

    expect(violations).toHaveLength(0);
    expect(violations.find((v) => v.file === 'Opp.md')).toBeUndefined();
    expect(violations.find((v) => v.file === 'Sol.md')).toBeUndefined();

    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ file: 'Opp.md', nodeTitle: 'Opp', reason: 'hierarchy' });
    expect(gates[0]!.gatedFiles).toEqual(['Opp.md', 'Sol.md']);
  });

  it('a blocking rule violation gates descendants but not the violating node itself', async () => {
    const { nodes, graph } = buildTree();

    const { violations, gates } = await evaluateRulesWithGating(nodes, [alwaysFailRule], graph, []);

    // All three nodes are evaluated (nothing gates the root); goal's failure then gates its subtree.
    expect(violations.map((v) => v.file)).toEqual(['Goal.md']);
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ file: 'Goal.md', nodeTitle: 'Goal', reason: 'rule', ruleId: 'always-fail' });
    expect(gates[0]!.gatedFiles).toEqual(['Opp.md', 'Sol.md']);
  });

  it('a rule with gatesDescendants:false fails without gating descendants', async () => {
    const { nodes, graph } = buildTree();

    const { violations, gates } = await evaluateRulesWithGating(nodes, [nonBlockingFailRule], graph, []);

    // All nodes evaluated and all fail, since nothing gates.
    expect(violations.map((v) => v.file)).toEqual(['Goal.md', 'Opp.md', 'Sol.md']);
    expect(gates).toHaveLength(0);
  });

  it('gatesDescendants defaults from severity: error gates, warning and info do not, explicit value overrides', async () => {
    const advisory: Rule = { id: 'advisory', category: 'best-practice', description: 'info', expression: 'false' };
    const warning: Rule = { id: 'warn', category: 'coherence', description: 'warning', expression: 'false' };
    expect(ruleGatesDescendants(alwaysFailRule)).toBe(true);
    expect(ruleGatesDescendants(advisory)).toBe(false);
    expect(ruleGatesDescendants(warning)).toBe(false);
    expect(ruleGatesDescendants({ ...advisory, gatesDescendants: true })).toBe(true);
    expect(ruleGatesDescendants({ ...alwaysFailRule, gatesDescendants: false })).toBe(false);
    expect(ruleGatesDescendants({ ...alwaysFailRule, severity: 'warning' })).toBe(false);

    const { nodes, graph } = buildTree();
    const advisoryRun = await evaluateRulesWithGating(nodes, [advisory], graph, []);
    expect(advisoryRun.violations.map((v) => v.file)).toEqual(['Goal.md', 'Opp.md', 'Sol.md']);
    expect(advisoryRun.gates).toHaveLength(0);

    const forcedRun = await evaluateRulesWithGating(nodes, [{ ...advisory, gatesDescendants: true }], graph, []);
    expect(forcedRun.violations.map((v) => v.file)).toEqual(['Goal.md']);
    expect(forcedRun.gates).toHaveLength(1);
  });

  it('includeGated evaluates rules on gated nodes but still reports the gate', async () => {
    const { goal, nodes, graph } = buildTree();
    const seeds: GatingSeed[] = [{ file: goal.label, title: goal.title, reason: 'schema' }];

    const { violations, gates } = await evaluateRulesWithGating(nodes, [passRule], graph, seeds, {
      includeGated: true,
    });

    // passRule succeeds everywhere, so no violations — but the gate is still recorded because
    // Goal's schema failure would have suppressed evaluation by default.
    expect(violations).toHaveLength(0);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.gatedFiles).toEqual(['Goal.md', 'Opp.md', 'Sol.md']);
  });

  it('never gates non-hierarchy nodes', async () => {
    const { goal, nodes } = buildTree();
    const standalone = makeSpaceNode('Standalone', 'note');
    const allNodes = [...nodes, standalone];
    const fullGraph = buildSpaceGraph(allNodes, hierarchy);
    const seeds: GatingSeed[] = [{ file: goal.label, title: goal.title, reason: 'schema' }];

    const { violations } = await evaluateRulesWithGating(allNodes, [alwaysFailRule], fullGraph, seeds);

    expect(violations.find((v) => v.file === 'Standalone.md')).toBeDefined();
  });

  it('always evaluates global-scope rules regardless of gating', async () => {
    const { goal, nodes, graph } = buildTree();
    const globalRule: Rule = {
      id: 'global-fail',
      category: 'workflow',
      description: 'fails globally',
      expression: 'false',
      global: true,
    };
    const seeds: GatingSeed[] = [{ file: goal.label, title: goal.title, reason: 'schema' }];

    const { violations } = await evaluateRulesWithGating(nodes, [globalRule], graph, seeds);

    expect(violations.find((v) => v.ruleId === 'global-fail')).toBeDefined();
  });

  describe('judging by depth', () => {
    const semanticRule = {
      id: 'sem',
      category: 'best-practice',
      description: 'semantic',
      semantic: { verdicts: { pass: 'ok', fail: 'not ok' }, severity: { fail: 'error' } },
    } as unknown as Rule;

    it('judges each depth in one evaluateNodes call and still gates children of a failing node', async () => {
      const goal = makeSpaceNode('Goal', 'goal');
      const oppA = makeSpaceNode('Opp A', 'opportunity', 'Goal');
      const oppB = makeSpaceNode('Opp B', 'opportunity', 'Goal');
      const solA = makeSpaceNode('Sol A', 'solution', 'Opp A');
      const solB = makeSpaceNode('Sol B', 'solution', 'Opp B');
      const nodes = [goal, oppA, oppB, solA, solB];
      const graph = buildSpaceGraph(nodes, hierarchy);

      const calls: string[][] = [];
      const provider: SemanticJudgeProvider = {
        name: 'multi-node',
        evaluate: () => Promise.reject(new Error('expected evaluateNodes')),
        evaluateNodes: async (inputs) => {
          calls.push(inputs.map((i) => i.node.title));
          return inputs.map((i) =>
            Object.fromEntries(i.rules.map((r) => [r.id, { verdict: i.node.title === 'Opp A' ? 'fail' : 'pass' }])),
          );
        },
      };

      const { violations, gates } = await evaluateRulesWithGating(nodes, [semanticRule], graph, [], { provider });
      expect(calls).toEqual([['Goal'], ['Opp A', 'Opp B'], ['Sol B']]);
      expect(violations.map((v) => v.file)).toEqual(['Opp A.md']);
      expect(gates).toHaveLength(1);
      expect(gates[0]?.gatedFiles).toEqual(['Sol A.md']);
    });
  });
});
