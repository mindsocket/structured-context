import { judgeNodes, type NodeJudgement } from '../judge/judge-node';
import type { TrimReport } from '../judge/trim';
import type { SemanticJudgeProvider } from '../judge/types';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, Rule, RuleSeverity, RuleViolation, SpaceContext, SpaceNode } from '../types';
import {
  buildEvalContext,
  evaluateRuleExpression,
  expressionErrorViolation,
  tryEvaluateExpression,
} from './evaluate-rule';
import { ruleSeverities, ruleSeverity } from './rule-severity';

/**
 * Whether a violation of this rule is a gating violation: explicit `gatesDescendants`, else true only for `error`.
 * `severity` is that of the violation: the rule's own for an expression, the verdict's for a semantic part.
 */
export function ruleGatesDescendants(rule: Rule, severity: RuleSeverity = ruleSeverity(rule)): boolean {
  return rule.gatesDescendants ?? severity === 'error';
}

/** Whether any violation this rule can report is a gating violation. */
function ruleMayGate(rule: Rule): boolean {
  return rule.gatesDescendants ?? ruleSeverities(rule).includes('error');
}

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
  judge?: SemanticJudgeProvider;
  /**
   * Id of the one node whose result is wanted (`validate-file`). The judge is consulted only for that node and
   * for its hierarchy ancestors' rules that can gate. Gating is still computed over the whole space.
   */
  judgeTarget?: string;
  /** Evaluate rules on gated nodes anyway. Gates are still reported. */
  includeGated?: boolean;
  trimReport?: TrimReport;
  /** The space's schema. The judge gets its descriptions of the node types it evaluates. */
  schemaContext?: Pick<SpaceContext, 'schema' | 'schemaRefRegistry'>;
}

/**
 * Evaluate a space's rules with cascade gating (see docs/rules.md#cascade-gating).
 *
 * Global rules run once. Non-hierarchy nodes are evaluated together and never gated. Hierarchy nodes are
 * evaluated one breadth-first level at a time, from roots and orphans, because a node's verdicts decide whether
 * its children are evaluated. A failed node (`failures`) or a node with a gating violation becomes a gate, and
 * every node below it is gated by it. A failed node is gated by its own gate too.
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
  const { judge, judgeTarget } = options;
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const violations: RuleViolation[] = [];

  // A global rule is evaluated against the whole node set; any node serves as its context.
  const contextNode = nodes[0];
  if (contextNode) {
    for (const rule of rules) {
      if (!rule.global || rule.expression === undefined) continue;
      const result = await evaluateRuleExpression(rule, contextNode, nodes, nodeIndex, null);
      if (!result.passed) violations.push(result.violation);
    }
  }

  const nodeRules = rules.filter(
    (r) => !r.global && (r.expression !== undefined || (r.semantic !== undefined && judge)),
  );
  const targetAncestors = judgeTarget === undefined ? new Set<NodeId>() : hierarchyAncestors(graph, judgeTarget);

  /** Rules that apply to the node: matching `type`, passing `when`, and (with a judge target) worth judging. */
  async function applicableRules(node: SpaceNode, found: RuleViolation[]): Promise<Rule[]> {
    const applicable: Rule[] = [];
    for (const rule of nodeRules) {
      if (rule.type && rule.type !== node.resolvedType) continue;
      if (judge && rule.semantic !== undefined && judgeTarget !== undefined && node.id !== judgeTarget) {
        // An ancestor matters only through the gates it could raise.
        if (!(targetAncestors.has(node.id) && ruleMayGate(rule))) continue;
      }
      if (rule.when) {
        const outcome = await tryEvaluateExpression(rule.when, buildEvalContext(node, nodes, nodeIndex));
        if ('error' in outcome) {
          found.push(expressionErrorViolation(rule, node.id, outcome.error));
          continue;
        }
        if (outcome.value !== true) continue;
      }
      applicable.push(rule);
    }
    return applicable;
  }

  /**
   * Evaluate a set of nodes: expressions first, then every remaining semantic part in one judge call, so a judge
   * with `evaluateNodes` can share model calls. Returns, per node, the first rule with a gating violation.
   */
  async function evaluateLevel(level: readonly SpaceNode[]): Promise<Map<NodeId, string>> {
    const gatingRules = new Map<NodeId, string>();
    const perNode: Array<{ node: SpaceNode; found: RuleViolation[]; rules: Rule[] }> = [];

    for (const node of level) {
      const found: RuleViolation[] = [];
      const semantic: Rule[] = [];
      for (const rule of await applicableRules(node, found)) {
        if (rule.expression !== undefined) {
          const result = await evaluateRuleExpression(rule, node, nodes, nodeIndex);
          if (!result.passed) {
            found.push(result.violation);
            if (result.failed && ruleGatesDescendants(rule, result.violation.severity) && !gatingRules.has(node.id)) {
              gatingRules.set(node.id, rule.id);
            }
            // A semantic part runs only when its own expression passes.
            continue;
          }
        }
        if (rule.semantic !== undefined && judge) semantic.push(rule);
      }
      // A node with a gating violation has none of its semantic parts evaluated.
      perNode.push({ node, found, rules: gatingRules.has(node.id) ? [] : semantic });
    }

    if (judge) {
      const judgements = await judgeNodes(judge, perNode, graph, options.trimReport, options.schemaContext);
      perNode.forEach(({ node, found }, i) => {
        for (const j of judgements[i] ?? []) {
          if (!j.violated) continue;
          const violation = judgementViolation(node.id, j);
          found.push(violation);
          // An evaluation error says nothing about the node, so it never gates.
          if (!j.error && ruleGatesDescendants(j.rule, violation.severity) && !gatingRules.has(node.id)) {
            gatingRules.set(node.id, j.rule.id);
          }
        }
      });
    }

    for (const { found } of perNode) violations.push(...found);
    return gatingRules;
  }

  await evaluateLevel(graph.nonHierarchy);

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
    const gatingRules = await evaluateLevel(
      current.filter((e) => options.includeGated || !isGated(e)).map((e) => e.node),
    );

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

/** The violation a semantic judgement reports. A judge error takes the rule's own severity. */
function judgementViolation(nodeId: NodeId, j: NodeJudgement): RuleViolation {
  return {
    nodeId,
    ruleId: j.rule.id,
    category: j.rule.category,
    severity: j.severity ?? ruleSeverities(j.rule)[0] ?? ruleSeverity(j.rule),
    description: j.error ? `${j.rule.description} (Semantic evaluation error: ${j.error})` : j.rule.description,
    ...(j.evidence !== undefined && { evidence: j.evidence }),
    ...(j.verdict !== undefined && { verdict: j.verdict }),
    ...(j.guidance !== undefined && { guidance: j.guidance }),
  };
}

/** Ids of the node's ancestors along the graph's hierarchy edges. */
function hierarchyAncestors(graph: SpaceGraph, id: string): Set<NodeId> {
  const parentsOf = new Map<NodeId, NodeId[]>();
  for (const [parent, children] of graph.hierarchyChildren) {
    for (const child of children) parentsOf.set(child.id, [...(parentsOf.get(child.id) ?? []), parent]);
  }
  const ancestors = new Set<NodeId>();
  const pending = graph.nodes.has(id as NodeId) ? [id as NodeId] : [];
  while (pending.length > 0) {
    for (const parent of parentsOf.get(pending.pop()!) ?? []) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        pending.push(parent);
      }
    }
  }
  return ancestors;
}
