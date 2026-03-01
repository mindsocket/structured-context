import { buildEvalContext, evaluateExpression } from './evaluate-rule';
import type { Rule, RuleCategory, RulesMetadata, RuleViolation, SpaceNode } from './types';

/**
 * Validate nodes against rules metadata.
 * Returns a list of rule violations found.
 *
 * @param nodes - All nodes in the space
 * @param rules - Rules metadata with categorized rules
 * @returns Array of rule violations
 */
export async function validateRules(nodes: SpaceNode[], rules: RulesMetadata): Promise<RuleViolation[]> {
  const violations: RuleViolation[] = [];

  // Build node index for efficient lookups
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (title) {
      nodeIndex.set(title, node);
    }
  }

  // Collect all rules from each category
  const allCategories: Array<{ category: RuleCategory; rules: Rule[] }> = [
    { category: 'validation', rules: rules.validation ?? [] },
    { category: 'coherence', rules: rules.coherence ?? [] },
    { category: 'workflow', rules: rules.workflow ?? [] },
    { category: 'best-practice', rules: rules.bestPractice ?? [] },
  ];

  // Evaluate each rule against applicable nodes
  for (const { category, rules: categoryRules } of allCategories) {
    for (const rule of categoryRules) {
      if (rule.scope === 'global') {
        // Global rules are evaluated once against the full node set.
        // A sentinel node provides the evaluation context (nodes array is what matters).
        const sentinel = nodes[0];
        if (sentinel) {
          const context = buildEvalContext(sentinel, nodes, nodeIndex);
          const result = await evaluateExpression(rule.check, context);
          if (result !== true) {
            violations.push({ file: '', ruleId: rule.id, category, description: rule.description });
          }
        }
      } else {
        const targetNodes = rule.type ? nodes.filter((n) => n.resolvedType === rule.type) : nodes;
        for (const node of targetNodes) {
          const context = buildEvalContext(node, nodes, nodeIndex);
          const result = await evaluateExpression(rule.check, context);
          if (result !== true) {
            violations.push({ file: node.label, ruleId: rule.id, category, description: rule.description });
          }
        }
      }
    }
  }

  return violations;
}
