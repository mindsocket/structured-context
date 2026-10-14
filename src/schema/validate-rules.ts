import { judgeNode } from '../judge/judge-node';
import type { GatedRuleRecord, SemanticEvaluationRecord, SemanticJudgeProvider } from '../judge/types';
import type { Rule, RuleViolation, SpaceNode } from '../types';
import { buildEvalContext, evaluateExpression } from './evaluate-rule';
import { ruleSeverity } from './rule-severity';

export { DEFAULT_SEVERITY_BY_CATEGORY, ruleSeverity } from './rule-severity';

export interface ValidateRulesOptions {
  /** Whether to run semantic rules (default: false). */
  semantic?: boolean;
  /** The semantic judge provider to use if semantic is true. */
  judgeProvider?: SemanticJudgeProvider;
  /** Label of the only node to judge (`validate-file`); other nodes' semantic rules are skipped. */
  judgeTarget?: string;
  /** Set of node labels that have already failed upstream structural checks. */
  gatedNodeLabels?: Set<string>;
}

export type ValidatedRulesResult = RuleViolation[] & {
  semanticEvaluations: SemanticEvaluationRecord[];
  gatedRules: GatedRuleRecord[];
};

/**
 * Validate nodes against rules metadata.
 * Evaluates deterministic expression rules and (when opt-in) semantic judge rules.
 *
 * @param nodes - All nodes in the space
 * @param rules - Rules metadata list
 * @param options - Validation options including semantic opt-in and judge provider
 * @returns Array of rule violations with semanticEvaluations and gatedRules metadata attached
 */
export async function validateRules(
  nodes: SpaceNode[],
  rules: Rule[],
  options: ValidateRulesOptions = {},
): Promise<ValidatedRulesResult> {
  const violations: RuleViolation[] = [];
  const semanticEvaluations: SemanticEvaluationRecord[] = [];
  const gatedRules: GatedRuleRecord[] = [];

  // Track nodes that have failed checks (for cascading gating)
  const failedNodeLabels = new Set<string>(options.gatedNodeLabels || []);

  // Build node index for efficient lookups
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.title;
    if (title) {
      nodeIndex.set(title, node);
    }
  }

  // Separate rules into expression rules and semantic rules
  const expressionRules: Rule[] = [];
  const semanticRules: Rule[] = [];

  for (const rule of rules) {
    if (rule.mode === 'semantic') {
      semanticRules.push(rule);
    } else if (rule.check) {
      expressionRules.push(rule);
    }
  }

  // 1. Evaluate deterministic expression rules first
  for (const rule of expressionRules) {
    const check = rule.check as string;
    const severity = ruleSeverity(rule);

    if (rule.scope === 'global') {
      // Global rules are evaluated once against the full node set.
      // A sentinel node provides the evaluation context (nodes array is what matters).
      const sentinel = nodes[0];
      if (sentinel) {
        const context = buildEvalContext(sentinel, nodes, nodeIndex);
        const result = await evaluateExpression(check, context);
        if (result !== true) {
          violations.push({
            file: '',
            ruleId: rule.id,
            category: rule.category,
            severity,
            description: rule.description,
          });
        }
      }
    } else {
      const targetNodes = rule.type ? nodes.filter((n) => n.resolvedType === rule.type) : nodes;
      for (const node of targetNodes) {
        const context = buildEvalContext(node, nodes, nodeIndex);
        if (rule.when && (await evaluateExpression(rule.when, context)) !== true) continue;
        const result = await evaluateExpression(check, context);
        if (result !== true) {
          violations.push({
            file: node.label,
            ruleId: rule.id,
            category: rule.category,
            severity,
            description: rule.description,
          });
          failedNodeLabels.add(node.label);
        }
      }
    }
  }

  // 2. Evaluate semantic rules only if explicitly requested
  if (options.semantic) {
    const judgeProvider = options.judgeProvider;
    if (!judgeProvider) {
      throw new Error('Semantic evaluation was requested but no judgeProvider was provided to validateRules.');
    }

    for (const node of nodes) {
      if (options.judgeTarget !== undefined && node.label !== options.judgeTarget) continue;
      const applicable: Rule[] = [];
      for (const r of semanticRules) {
        if (r.type && r.type !== node.resolvedType) continue;
        if (r.when && (await evaluateExpression(r.when, buildEvalContext(node, nodes, nodeIndex))) !== true) continue;
        applicable.push(r);
      }
      if (applicable.length === 0) continue;

      // Safe cascading default: gate semantic evaluation if node failed upstream checks
      if (failedNodeLabels.has(node.label)) {
        for (const rule of applicable) {
          gatedRules.push({ file: node.label, ruleId: rule.id, reason: 'Gated by upstream error on node' });
        }
        continue;
      }

      for (const j of await judgeNode(judgeProvider, node, applicable)) {
        if (j.record) semanticEvaluations.push(j.record);
        if (!j.failed) continue;
        violations.push({
          file: node.label,
          ruleId: j.rule.id,
          category: j.rule.category,
          severity: j.severity ?? ruleSeverity(j.rule),
          description: j.error ? `${j.rule.description} (Judge error: ${j.error})` : j.rule.description,
          evidence: j.evidence,
          ...(j.verdict !== undefined && { verdict: j.verdict }),
          ...(j.guidance !== undefined && { guidance: j.guidance }),
        });
        if (!j.error) failedNodeLabels.add(node.label);
      }
    }
  }

  const result = violations as ValidatedRulesResult;
  result.semanticEvaluations = semanticEvaluations;
  result.gatedRules = gatedRules;
  return result;
}
