import type { Rule, RuleCategory, RuleSeverity, RuleViolation, SpaceNode } from '../types';
import { buildEvalContext, evaluateExpression } from './evaluate-rule';

/** Default severity for each rule category. A rule's own `severity` field overrides this. */
export const DEFAULT_SEVERITY_BY_CATEGORY: Record<RuleCategory, RuleSeverity> = {
  validation: 'error',
  coherence: 'warning',
  workflow: 'warning',
  'best-practice': 'info',
};

/** Effective severity of a rule: its explicit `severity`, else its category default. */
export function ruleSeverity(rule: Rule): RuleSeverity {
  return rule.severity ?? DEFAULT_SEVERITY_BY_CATEGORY[rule.category];
}

/**
 * Validate nodes against rules metadata.
 * Returns a list of rule violations found.
 *
 * @param nodes - All nodes in the space
 * @param rules - Rules metadata list
 * @returns Array of rule violations
 */
export async function validateRules(nodes: SpaceNode[], rules: Rule[]): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = [];

  // Build node index for efficient lookups
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.title;
    if (title) {
      nodeIndex.set(title, node);
    }
  }

  // Evaluate each rule against applicable nodes
  for (const rule of rules) {
    const severity = ruleSeverity(rule);
    if (rule.scope === 'global') {
      // Global rules are evaluated once against the full node set.
      // A sentinel node provides the evaluation context (nodes array is what matters).
      const sentinel = nodes[0];
      if (sentinel) {
        const context = buildEvalContext(sentinel, nodes, nodeIndex);
        const result = await evaluateExpression(rule.check, context);
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
        const result = await evaluateExpression(rule.check, context);
        if (result !== true) {
          violations.push({
            file: node.label,
            ruleId: rule.id,
            category: rule.category,
            severity,
            description: rule.description,
          });
        }
      }
    }
  }

  return violations;
}
