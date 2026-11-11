import type { JudgeRun } from '../judge/judge-node';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, Rule, RuleViolation, SpaceNode } from '../types';
import { createRuleEvaluator } from './rule-evaluator';

/** A node that failed schema validation or hierarchy structure. Within the hierarchy, it is a gate. */
export type GatingSeed = {
  /** Id of the failed node. */
  id: NodeId;
  /** Which check it failed. */
  reason: 'schema' | 'hierarchy';
};

/**
 * A gate, as a run reports it: a node whose schema or hierarchy failure, or gating violation, stopped rule
 * evaluation below it, and for the node itself after a failure.
 */
export type CoverageGate = {
  /** Id of the gate node. */
  nodeId: NodeId;
  /** What made the node a gate. */
  reason: 'schema' | 'hierarchy' | 'rule';
  /** Id of the rule with the gating violation, when `reason` is `'rule'`. */
  ruleId?: string;
  /** Ids of the nodes it gated. */
  gatedNodeIds: NodeId[];
};

export type RuleEvaluation = {
  violations: RuleViolation[];
  gates: CoverageGate[];
};

export interface RuleEvaluationOptions {
  /** Evaluates `semantic` rules. Without it, a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: JudgeRun;
  /** Evaluate rules on gated nodes anyway. Gates are still reported. */
  includeGated?: boolean;
}

/**
 * Evaluate a space's rules with cascade gating (see docs/rules.md#cascade-gating). Gating decides which node sets
 * are evaluated, in what order, and which nodes are gated; the rule evaluator evaluates each set.
 *
 * Global rules run once. Non-hierarchy nodes are one set and are never gated. Hierarchy nodes are evaluated one
 * breadth-first level at a time, from roots and orphans, because a node's verdicts decide whether its children
 * are evaluated. A failed node (`failures`) or a node with a gating violation becomes a gate, and every node below
 * it is gated by it. A failed node is gated by its own gate too.
 *
 * Without a hierarchy, every node in `graph` is a non-hierarchy node, so nothing is gated.
 */
export async function evaluateRules(
  nodes: SpaceNode[],
  rules: Rule[],
  graph: SpaceGraph,
  failures: GatingSeed[],
  options: RuleEvaluationOptions = {},
): Promise<RuleEvaluation> {
  const evaluator = createRuleEvaluator(nodes, rules, graph, options.judge);
  const violations = await evaluator.evaluateGlobalRules();
  violations.push(...(await evaluator.evaluateNodeSet(graph.nonHierarchy)).violations);

  const failureOf = new Map<NodeId, GatingSeed['reason']>();
  for (const { id, reason } of failures) {
    // A node with both failures reports schema.
    if (reason === 'schema' || !failureOf.has(id)) failureOf.set(id, reason);
  }

  const gates: CoverageGate[] = [];
  const visited = new Set<NodeId>();
  // Each hierarchy node, with the gate it inherits from above.
  type Entry = { node: SpaceNode; gate?: CoverageGate };
  let level: Entry[] = [...graph.hierarchyRoots, ...graph.orphans].map((node) => ({ node }));
  while (level.length > 0) {
    // A node reached twice (a DAG) keeps the gate of the first path.
    const current = level.filter(({ node }) => !visited.has(node.id) && visited.add(node.id));
    const isGated = ({ node, gate }: Entry) => gate !== undefined || failureOf.has(node.id);
    const { violations: found, gatingRules } = await evaluator.evaluateNodeSet(
      current.filter((e) => options.includeGated || !isGated(e)).map((e) => e.node),
    );

    violations.push(...found);

    level = [];
    for (const { node, gate: inherited } of current) {
      let gate = inherited;
      const failure = failureOf.get(node.id);
      if (!gate && failure) {
        gate = { nodeId: node.id, reason: failure, gatedNodeIds: [] };
        gates.push(gate);
      } else if (!gate && gatingRules.has(node.id)) {
        gate = { nodeId: node.id, reason: 'rule', ruleId: gatingRules.get(node.id), gatedNodeIds: [] };
        gates.push(gate);
      }
      if (inherited || failure) gate!.gatedNodeIds.push(node.id);
      for (const child of graph.hierarchyChildren.get(node.id) ?? []) level.push({ node: child, gate });
    }
  }

  return { violations, gates: gates.filter((g) => g.gatedNodeIds.length > 0) };
}
