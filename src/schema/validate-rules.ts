import { judgeNodes } from '../judge/judge-node';
import type { SemanticJudgeProvider } from '../judge/types';
import type { Rule, RuleViolation, SpaceNode } from '../types';
import {
  applySemanticChecks,
  buildEvalContext,
  expressionErrorViolation,
  tryEvaluateExpression,
} from './evaluate-rule';
import { ruleSeverity } from './rule-severity';

export { DEFAULT_SEVERITY_BY_CATEGORY, ruleSeverity } from './rule-severity';

export interface ValidateRulesOptions {
  /** Judge for semantic rules. Without one, a semantic rule runs only its `check`. */
  judge?: SemanticJudgeProvider;
  /** Label of the only node to judge (`validate-file`); other nodes' semantic rules are skipped. */
  judgeTarget?: string;
  /** Set of node labels that have already failed upstream structural checks. */
  gatedNodeLabels?: Set<string>;
}

/**
 * Validate nodes against rules metadata.
 * Evaluates deterministic expression rules and (when opt-in) semantic judge rules.
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
        const outcome = await tryEvaluateExpression(check, context);
        if ('error' in outcome) {
          violations.push(expressionErrorViolation(rule, '', outcome.error));
        } else if (outcome.value !== true) {
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
        if (rule.when) {
          const when = await tryEvaluateExpression(rule.when, context);
          if ('error' in when) {
            violations.push(expressionErrorViolation(rule, node.label, when.error));
            continue;
          }
          if (when.value !== true) continue;
        }
        const outcome = await tryEvaluateExpression(check, context);
        if ('error' in outcome) {
          violations.push(expressionErrorViolation(rule, node.label, outcome.error));
        } else if (outcome.value !== true) {
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

  // 2. Evaluate semantic rules. Without a judge only their `check` runs.
  const judge = options.judge;
  const runnableSemanticRules = judge ? semanticRules : semanticRules.filter((r) => r.check);
  if (runnableSemanticRules.length > 0) {
    const perNode: RuleViolation[][] = []; // kept in node order
    const pending: Array<{ node: SpaceNode; rules: Rule[]; found: RuleViolation[] }> = [];
    for (const node of nodes) {
      if (options.judgeTarget !== undefined && node.label !== options.judgeTarget) continue;
      const found: RuleViolation[] = [];
      perNode.push(found);
      const applicable: Rule[] = [];
      for (const r of runnableSemanticRules) {
        if (r.type && r.type !== node.resolvedType) continue;
        if (r.when) {
          const when = await tryEvaluateExpression(r.when, buildEvalContext(node, nodes, nodeIndex));
          if ('error' in when) {
            found.push(expressionErrorViolation(r, node.label, when.error));
            continue;
          }
          if (when.value !== true) continue;
        }
        applicable.push(r);
      }
      if (applicable.length === 0) continue;

      // Safe cascading default: gate semantic evaluation if node failed upstream checks
      if (failedNodeLabels.has(node.label)) continue;

      // A semantic rule's `check` fails fast before the judge.
      const prechecked = await applySemanticChecks(applicable, node, nodes, nodeIndex);
      found.push(...prechecked.violations);
      if (judge) pending.push({ node, rules: prechecked.judgeable, found });
    }

    // One judge call for every node, so a judge with `evaluateNodes` can share model calls.
    const judged = judge ? await judgeNodes(judge, pending) : [];
    pending.forEach(({ node, found }, i) => {
      for (const j of judged[i] ?? []) {
        if (!j.failed) continue;
        found.push({
          file: node.label,
          ruleId: j.rule.id,
          category: j.rule.category,
          severity: j.severity ?? ruleSeverity(j.rule),
          description: j.error ? `${j.rule.description} (Judge error: ${j.error})` : j.rule.description,
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
