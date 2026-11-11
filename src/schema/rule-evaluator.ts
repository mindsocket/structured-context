import { type JudgeRun, judgeNodes, type NodeJudgement } from '../judge/judge-node';
import type { SpaceGraph } from '../space-graph';
import type { NodeId, Rule, RuleSeverity, RuleViolation, SpaceNode } from '../types';
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

/** The outcome of evaluating a node set: its violations, and each node's first rule with a gating violation. */
export type NodeSetEvaluation = {
  violations: RuleViolation[];
  gatingRules: Map<NodeId, string>;
};

/**
 * Evaluates a space's rules on the node sets that gating hands it. It decides which rules apply to a node,
 * evaluates their expressions, and sends the remaining semantic parts to the judge. It does not decide order
 * or suppression. Without a `judge`, a rule runs only its `expression`, and a semantic-only rule is skipped.
 */
export function createRuleEvaluator(nodes: SpaceNode[], rules: Rule[], graph: SpaceGraph, judge?: JudgeRun) {
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const nodeRules = rules.filter(
    (r) => !r.global && (r.expression !== undefined || (r.semantic !== undefined && judge)),
  );
  const target = judge?.target;
  const targetAncestors = target === undefined ? new Set<NodeId>() : hierarchyAncestors(graph, target);

  /** Rules that apply to the node: matching `type`, passing `when`, and (with a judge target) worth judging. */
  async function applicableRules(node: SpaceNode, found: RuleViolation[]): Promise<Rule[]> {
    const applicable: Rule[] = [];
    for (const rule of nodeRules) {
      if (rule.type && rule.type !== node.resolvedType) continue;
      if (judge && rule.semantic !== undefined && target !== undefined && node.id !== target) {
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

  return {
    /** Violations of the global rules, each evaluated once against the whole node set. */
    async evaluateGlobalRules(): Promise<RuleViolation[]> {
      const violations: RuleViolation[] = [];
      // Any node serves as the evaluation context; the node set is what a global rule reads.
      const contextNode = nodes[0];
      if (!contextNode) return violations;
      for (const rule of rules) {
        if (!rule.global || rule.expression === undefined) continue;
        const result = await evaluateRuleExpression(rule, contextNode, nodes, nodeIndex, null);
        if (!result.passed) violations.push(result.violation);
      }
      return violations;
    },

    /**
     * Evaluate the per-node rules on a set of nodes: expressions first, then every remaining semantic part in one
     * judge call, so a judge with `evaluateNodes` can share model calls. Violations are in node order.
     */
    async evaluateNodeSet(set: readonly SpaceNode[]): Promise<NodeSetEvaluation> {
      const gatingRules = new Map<NodeId, string>();
      const perNode: Array<{ node: SpaceNode; found: RuleViolation[]; rules: Rule[] }> = [];

      for (const node of set) {
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
        const judgements = await judgeNodes(judge, perNode, graph);
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

      return { violations: perNode.flatMap(({ found }) => found), gatingRules };
    },
  };
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
