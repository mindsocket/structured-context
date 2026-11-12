import type { JudgeSession } from '../judge/judge-node';
import type { TrimReport } from '../judge/trim';
import type { Rule } from '../schema/metadata-contract';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, SpaceNode, ValidationIssue, ValidationIssueKind } from '../types';
import { createRuleEvaluator } from './rule-evaluator';

/**
 * Nodes that failed a check before rule evaluation, by issue kind: a node whose schema check or hierarchy
 * structure failed. Gating treats such a node as a gate: its own rules and its subtree's are suppressed.
 */
export type FailedNodes = Map<NodeId, ValidationIssueKind>;

/** The result of evaluating a space's rules: its issues, and the judge inputs trimmed to fit the per-node input cap. */
export type RuleEvaluationResult = {
  issues: ValidationIssue[];
  /** Present when semantic rules ran: the inputs trimmed to fit the per-node input cap. */
  trimReport?: TrimReport;
};

export interface RuleEvaluationOptions {
  /** Evaluates `semantic` rules. Without it, a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: JudgeSession;
  /** Evaluate rules on gated nodes anyway. Gated nodes are still reported with `gated` issues. */
  includeGated?: boolean;
}

/**
 * Evaluate a space's rules with cascade gating (see docs/rules.md#cascade-gating). Gating decides which node sets
 * are evaluated, in what order, and which nodes are gated; the rule evaluator evaluates each set.
 *
 * Global rules run once. Non-hierarchy nodes are one set and are never gated. Hierarchy nodes are evaluated one
 * breadth-first level at a time, from roots and orphans, because a node's verdicts decide whether its children
 * are evaluated. A failed node (`failedNodes`) or a node with a gating violation becomes a gate, and every node
 * below it is gated by it, reported as a `gated` issue. A failed node is gated by its own gate too; a node that
 * becomes a gate through its own gating violation is not.
 *
 * Without a hierarchy, every node in `graph` is a non-hierarchy node, so nothing is gated.
 */
export async function evaluateRules(
  nodes: SpaceNode[],
  rules: Rule[],
  graph: SpaceGraph,
  failedNodes: FailedNodes = new Map(),
  options: RuleEvaluationOptions = {},
): Promise<RuleEvaluationResult> {
  const evaluator = createRuleEvaluator(nodes, rules, graph, options.judge);
  const issues = await evaluator.evaluateGlobalRules();
  const nonHierarchy = await evaluator.evaluateNodeSet(graph.nonHierarchy);
  issues.push(...nonHierarchy.issues);
  let trimReport = nonHierarchy.trimReport;

  const failureOf = new Map<NodeId, ValidationIssueKind>();
  for (const [id, kind] of failedNodes) {
    // A node with both failures reports schema.
    if (kind === 'schema' || !failureOf.has(id)) failureOf.set(id, kind);
  }

  // Each gate, as first reached: the issue kind that made it a gate, and the nodes it gated.
  type Gate = { nodeId: NodeId; kind: ValidationIssueKind; ruleId?: string; gatedNodeIds: NodeId[] };
  const gates = new Map<NodeId, Gate>();
  const visited = new Set<NodeId>();
  // Each hierarchy node, with the gate it inherits from above.
  type Entry = { node: SpaceNode; gate?: Gate };
  let level: Entry[] = [...graph.hierarchyRoots, ...graph.orphans].map((node) => ({ node }));
  while (level.length > 0) {
    // A node reached twice (a DAG) keeps the gate of the first path.
    const current = level.filter(({ node }) => !visited.has(node.id) && visited.add(node.id));
    const isGated = ({ node, gate }: Entry) => gate !== undefined || failureOf.has(node.id);
    const {
      issues: found,
      gatingRules,
      trimReport: levelTrim,
    } = await evaluator.evaluateNodeSet(current.filter((e) => options.includeGated || !isGated(e)).map((e) => e.node));
    issues.push(...found);
    if (levelTrim) {
      trimReport ??= { nodes: new Set(), ruleIds: new Set() };
      for (const nodeId of levelTrim.nodes) trimReport.nodes.add(nodeId);
      for (const ruleId of levelTrim.ruleIds) trimReport.ruleIds.add(ruleId);
    }

    level = [];
    for (const { node, gate: inherited } of current) {
      let gate = inherited;
      let failed = false;
      if (!gate) {
        const failure = failureOf.get(node.id);
        const gatingRule = gatingRules.get(node.id);
        if (failure) {
          gate = { nodeId: node.id, kind: failure, gatedNodeIds: [] };
        } else if (gatingRule !== undefined) {
          gate = { nodeId: node.id, kind: 'rule', ruleId: gatingRule, gatedNodeIds: [] };
        }
        if (gate) gates.set(node.id, gate);
        failed = failure !== undefined;
      }
      if (inherited || failed) gate!.gatedNodeIds.push(node.id);
      for (const child of graph.hierarchyChildren.get(node.id) ?? []) level.push({ node: child, gate });
    }
  }

  const gateIssues: ValidationIssue[] = [];
  for (const gate of gates.values()) {
    for (const nodeId of gate.gatedNodeIds) gateIssues.push(gatedIssue(nodeId, gate, options.includeGated === true));
  }
  return { issues: issues.concat(gateIssues), trimReport };
}

/** The `gated` issue naming the gate and the issue kind that made it, worded by whether the node's rules ran anyway. */
function gatedIssue(
  nodeId: NodeId,
  gate: { nodeId: NodeId; kind: ValidationIssueKind; ruleId?: string },
  evaluatedAnyway: boolean,
): ValidationIssue {
  const cause = gate.kind === 'rule' ? `rule "${gate.ruleId}"` : `${gate.kind} failure`;
  return {
    kind: 'gated',
    key: `gated:${gate.nodeId}`,
    severity: 'info',
    nodeId,
    gatedBy: gate.nodeId,
    message: `Rule checks ${evaluatedAnyway ? 'evaluated anyway' : 'not evaluated'}: gated by ${cause} on ${gate.nodeId}`,
  };
}
