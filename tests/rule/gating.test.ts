import { describe, expect, it } from 'bun:test';
import type { SemanticJudgeProvider } from '../../src/judge/types';
import {
  evaluateRules,
  type FailedNodes,
  type RuleEvaluationResult,
  ruleGatesDescendants,
} from '../../src/rule/gating';

type Gate = { nodeId: string; gatedNodeIds: string[]; message: string };

/** The gates a run reports, grouped by their `gatedBy`, from the `gated` issues. */
function gatesOf(result: RuleEvaluationResult): Gate[] {
  const byGate = new Map<string, string[]>();
  for (const issue of result.issues) {
    if (issue.kind !== 'gated') continue;
    const list = byGate.get(issue.gatedBy) ?? [];
    list.push(issue.nodeId as string);
    byGate.set(issue.gatedBy, list);
  }
  return [...byGate].map(([nodeId, gatedNodeIds]) => ({
    nodeId,
    gatedNodeIds,
    message: result.issues.find((i) => i.kind === 'gated' && i.gatedBy === nodeId)!.message,
  }));
}

import type { Rule } from '../../src/schema/metadata-contract';
import { buildSpaceGraph, computeHierarchyDepths } from '../../src/space-graph';
import type { NodeId, SpaceNode } from '../../src/types';
import { makeHierarchy, makeLevel, makeParentRef } from '../test-helpers';

const hierarchy = makeHierarchy([makeLevel('goal'), makeLevel('opportunity'), makeLevel('solution')]);

function makeSpaceNode(title: string, type: string, parent?: string): SpaceNode {
  return {
    id: title as NodeId,
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
    expect(depths.get('Goal' as NodeId)).toBe(1);
    expect(depths.get('Opp' as NodeId)).toBe(2);
    expect(depths.get('Sol' as NodeId)).toBe(3);
    expect(depths.get('Orphan Opp' as NodeId)).toBe(1);
  });
});

describe('evaluateRules', () => {
  const alwaysFailRule: Rule = {
    id: 'always-fail',
    category: 'validation',
    description: 'always fails',
    expression: 'false',
  };
  const nonGatingFailRule: Rule = {
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

  const failed = (id: string, kind: 'schema' | 'hierarchy'): FailedNodes => new Map([[id as NodeId, kind]]);

  function buildTree() {
    const goal = makeSpaceNode('Goal', 'goal');
    const opp = makeSpaceNode('Opp', 'opportunity', 'Goal');
    const sol = makeSpaceNode('Sol', 'solution', 'Opp');
    const nodes = [goal, opp, sol];
    const graph = buildSpaceGraph(nodes, hierarchy);
    return { goal, opp, sol, nodes, graph };
  }

  it('gates a node and its subtree when the node has a schema failure', async () => {
    const { nodes, graph } = buildTree();
    const failedNodes = failed('Goal', 'schema');

    const result = await evaluateRules(nodes, [alwaysFailRule], graph, failedNodes);

    // Goal itself is gated (schema failure suppresses its own rule layer) — no violation recorded for it.
    expect(result.issues.some((v) => v.kind === 'rule' && v.nodeId === 'Goal')).toBe(false);
    expect(result.issues.some((v) => v.kind === 'rule' && v.nodeId === 'Opp')).toBe(false);
    expect(result.issues.some((v) => v.kind === 'rule' && v.nodeId === 'Sol')).toBe(false);

    const gates = gatesOf(result);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.nodeId).toBe('Goal');
    expect(gates[0]!.gatedNodeIds).toEqual(['Goal', 'Opp', 'Sol']);
    expect(gates[0]!.message).toContain('gated by schema failure on Goal');
  });

  it('gates a subtree when a hierarchy violation is seeded, but not the node itself', async () => {
    const { nodes, graph } = buildTree();
    const failedNodes = failed('Opp', 'hierarchy');

    const result = await evaluateRules(nodes, [passRule], graph, failedNodes);

    expect(result.issues.filter((i) => i.kind === 'rule')).toHaveLength(0);

    const gates = gatesOf(result);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.nodeId).toBe('Opp');
    expect(gates[0]!.gatedNodeIds).toEqual(['Opp', 'Sol']);
    expect(gates[0]!.message).toContain('gated by hierarchy failure on Opp');
  });

  it('a gating violation gates descendants but not the violating node itself', async () => {
    const { nodes, graph } = buildTree();

    const result = await evaluateRules(nodes, [alwaysFailRule], graph, new Map());

    // All three nodes are evaluated (nothing gates the root); goal's failure then gates its subtree.
    expect(result.issues.filter((v) => v.kind === 'rule').map((v) => v.nodeId as string | undefined)).toEqual(['Goal']);
    const gates = gatesOf(result);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.nodeId).toBe('Goal');
    expect(gates[0]!.gatedNodeIds).toEqual(['Opp', 'Sol']);
    expect(gates[0]!.message).toContain('gated by rule "always-fail" on Goal');
  });

  it('a rule with gatesDescendants:false fails without gating descendants', async () => {
    const { nodes, graph } = buildTree();

    const result = await evaluateRules(nodes, [nonGatingFailRule], graph, new Map());

    // All nodes evaluated and all fail, since nothing gates.
    expect(result.issues.filter((i) => i.kind === 'rule').map((v) => v.nodeId as string | undefined)).toEqual([
      'Goal',
      'Opp',
      'Sol',
    ]);
    expect(gatesOf(result)).toHaveLength(0);
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
    const advisoryRun = await evaluateRules(nodes, [advisory], graph, new Map());
    expect(advisoryRun.issues.filter((i) => i.kind === 'rule').map((v) => v.nodeId as string | undefined)).toEqual([
      'Goal',
      'Opp',
      'Sol',
    ]);
    expect(gatesOf(advisoryRun)).toHaveLength(0);

    const forcedRun = await evaluateRules(nodes, [{ ...advisory, gatesDescendants: true }], graph, new Map());
    expect(forcedRun.issues.filter((i) => i.kind === 'rule').map((v) => v.nodeId as string | undefined)).toEqual([
      'Goal',
    ]);
    expect(gatesOf(forcedRun)).toHaveLength(1);
  });

  it('includeGated evaluates rules on gated nodes but still reports the gate', async () => {
    const { nodes, graph } = buildTree();
    const failedNodes = failed('Goal', 'schema');

    const result = await evaluateRules(nodes, [passRule], graph, failedNodes, {
      includeGated: true,
    });

    // passRule succeeds everywhere, so no violations — but the gate is still recorded because
    // Goal's schema failure would have suppressed evaluation by default.
    expect(result.issues.filter((i) => i.kind === 'rule')).toHaveLength(0);
    const gates = gatesOf(result);
    expect(gates).toHaveLength(1);
    expect(gates[0]!.gatedNodeIds).toEqual(['Goal', 'Opp', 'Sol']);
    expect(gates[0]!.message).toContain('evaluated anyway');
  });

  it('never gates non-hierarchy nodes', async () => {
    const { nodes } = buildTree();
    const standalone = makeSpaceNode('Standalone', 'note');
    const allNodes = [...nodes, standalone];
    const fullGraph = buildSpaceGraph(allNodes, hierarchy);
    const failedNodes = failed('Goal', 'schema');

    const result = await evaluateRules(allNodes, [alwaysFailRule], fullGraph, failedNodes);

    expect(result.issues.some((v) => v.kind === 'rule' && v.nodeId === 'Standalone')).toBe(true);
  });

  it('always evaluates global-scope rules regardless of gating', async () => {
    const { nodes, graph } = buildTree();
    const globalRule: Rule = {
      id: 'global-fail',
      category: 'workflow',
      description: 'fails globally',
      expression: 'false',
      global: true,
    };
    const failedNodes = failed('Goal', 'schema');

    const result = await evaluateRules(nodes, [globalRule], graph, failedNodes);

    expect(result.issues.some((v) => v.kind === 'rule' && v.ruleId === 'global-fail')).toBe(true);
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

      const result = await evaluateRules(nodes, [semanticRule], graph, new Map(), { judge: { provider } });
      expect(calls).toEqual([['Goal'], ['Opp A', 'Opp B'], ['Sol B']]);
      expect(result.issues.filter((i) => i.kind === 'rule').map((v) => v.nodeId as string | undefined)).toEqual([
        'Opp A',
      ]);
      expect(gatesOf(result)[0]?.gatedNodeIds).toEqual(['Sol A']);
    });
  });
});
