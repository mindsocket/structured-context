import { judgeNodes } from '../judge/judge-node';
import type { TrimReport } from '../judge/trim';
import type { SemanticJudgeProvider } from '../judge/types';
import { buildSpaceGraph } from '../space-graph';
import type { Rule, RuleViolation, SpaceNode } from '../types';
import {
  buildEvalContext,
  evaluateRuleExpression,
  expressionErrorViolation,
  tryEvaluateExpression,
} from './evaluate-rule';
import { ruleGatesDescendants } from './gating';
import { ruleSeverities, ruleSeverity } from './rule-severity';

export { DEFAULT_SEVERITY_BY_CATEGORY, ruleSeverity } from './rule-severity';

export interface ValidateRulesOptions {
  /** Evaluates semantic rules. Without one, a rule runs only its `expression`, and a semantic-only rule is skipped. */
  judge?: SemanticJudgeProvider;
  /** Label of the only node to judge (`validate-file`); other nodes' semantic rules are skipped. */
  judgeTarget?: string;
  /** Set of node labels that have already failed upstream structural checks. */
  gatedNodeLabels?: Set<string>;
  trimReport?: TrimReport;
}

/**
 * Validate nodes against rules metadata.
 * Evaluates expressions and (when opt-in) semantic parts.
 *
 * @param nodes - All nodes in the space
 * @param rules - Rules metadata list
 * @param options - Validation options, including the judge for semantic rules
 * @returns Rule violations
 */
export async function validateRules(
  nodes: SpaceNode[],
  rules: Rule[],
  options: ValidateRulesOptions = {},
): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = [];

  const judge = options.judge;

  // Build node index for efficient lookups
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.title;
    if (title) {
      nodeIndex.set(title, node);
    }
  }

  const sentinel = nodes[0];
  const runnable = rules.filter((r) => r.expression !== undefined || (r.semantic !== undefined && judge));

  // The nodes each per-node rule applies to: matching `type` and passing the applicability condition (`when`).
  const applicable = new Map<Rule, SpaceNode[]>();
  for (const rule of runnable) {
    if (rule.global) continue;
    const matching: SpaceNode[] = [];
    for (const node of nodes) {
      if (rule.type && rule.type !== node.resolvedType) continue;
      if (rule.when) {
        const when = await tryEvaluateExpression(rule.when, buildEvalContext(node, nodes, nodeIndex));
        if ('error' in when) {
          violations.push(expressionErrorViolation(rule, node.label, when.error));
          continue;
        }
        if (when.value !== true) continue;
      }
      matching.push(node);
    }
    applicable.set(rule, matching);
  }

  // 1. Expressions, in rule order. A global rule is evaluated once against the full node set; a sentinel node
  // provides the evaluation context (the nodes array is what matters).
  const gatedNodeLabels = new Set<string>(options.gatedNodeLabels); // nodes with a gating violation (or gated upstream)
  const notEvaluable = new Set<string>(); // `${rule.id}\0${label}` whose own expression failed or errored
  for (const rule of runnable) {
    if (rule.expression === undefined) continue;
    if (rule.global) {
      if (!sentinel) continue;
      const result = await evaluateRuleExpression(rule, sentinel, nodes, nodeIndex, '');
      if (!result.passed) violations.push(result.violation);
      continue;
    }
    for (const node of applicable.get(rule) ?? []) {
      const result = await evaluateRuleExpression(rule, node, nodes, nodeIndex);
      if (result.passed) continue;
      violations.push(result.violation);
      notEvaluable.add(`${rule.id}\0${node.label}`);
      if (result.failed && ruleGatesDescendants(rule, result.violation.severity)) gatedNodeLabels.add(node.label);
    }
  }

  // 2. Semantic parts, for nodes that passed their own expression. A node with a gating violation, or gated
  // upstream, is left out.
  if (judge) {
    const perNode: RuleViolation[][] = []; // kept in node order
    const pending: Array<{ node: SpaceNode; rules: Rule[]; found: RuleViolation[] }> = [];
    for (const node of nodes) {
      if (options.judgeTarget !== undefined && node.label !== options.judgeTarget) continue;
      const found: RuleViolation[] = [];
      perNode.push(found);
      if (gatedNodeLabels.has(node.label)) continue;
      const semantic = runnable.filter(
        (r) =>
          r.semantic !== undefined && applicable.get(r)?.includes(node) && !notEvaluable.has(`${r.id}\0${node.label}`),
      );
      if (semantic.length > 0) pending.push({ node, rules: semantic, found });
    }

    // One provider call for every node, so a provider with `evaluateNodes` can share model calls.
    const judged = await judgeNodes(judge, pending, buildSpaceGraph(nodes, undefined), options.trimReport);
    pending.forEach(({ node, found }, i) => {
      for (const j of judged[i] ?? []) {
        if (!j.violated) continue;
        found.push({
          file: node.label,
          ruleId: j.rule.id,
          category: j.rule.category,
          severity: j.severity ?? ruleSeverities(j.rule)[0] ?? ruleSeverity(j.rule),
          description: j.error ? `${j.rule.description} (Semantic evaluation error: ${j.error})` : j.rule.description,
          evidence: j.evidence,
          ...(j.verdict !== undefined && { verdict: j.verdict }),
          ...(j.guidance !== undefined && { guidance: j.guidance }),
        });
      }
    });
    for (const found of perNode) violations.push(...found);
  }

  return violations;
}
