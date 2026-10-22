import jsonata from 'jsonata';
import type { NodeId, Rule, RuleViolation, SpaceNode } from '../types';
import { ruleSeverity } from './rule-severity';

const expressionCache = new Map<string, ReturnType<typeof jsonata>>();

/** Evaluation context for JSONata expressions */
export interface EvalContext {
  /** All nodes in the space (flattened) */
  nodes: Record<string, unknown>[];
  /** Current node being evaluated (flattened) */
  $$: Record<string, unknown>;
  /** First resolved parent node (undefined if no parent) (flattened) — provided as a convenience */
  parent?: Record<string, unknown>;
  /** All resolved parent nodes (flattened) */
  parents?: Record<string, unknown>[];
}

/**
 * Evaluate a JSONata expression against a context.
 * Returns the result of the expression (boolean for rule checks). Throws {@link ExpressionError} if it fails.
 *
 * @param expr - JSONata expression string
 * @param context - Evaluation context with $, $$, parent, $lookup
 * @returns Result of expression evaluation
 */
export async function evaluateExpression(expr: string, context: EvalContext): Promise<boolean | string | number> {
  // Build a structured input object for JSONata
  // This allows expressions to access nodes, current, and parent as properties
  const input: Record<string, unknown> = {
    nodes: context.nodes,
    current: context.$$,
  };

  // Only add parent if it exists (not undefined)
  if (context.parent !== undefined) {
    input.parent = context.parent;
  }

  // Add parents array if present
  if (context.parents !== undefined) {
    input.parents = context.parents;
  }

  try {
    let expression = expressionCache.get(expr);
    if (!expression) {
      expression = jsonata(expr);
      expressionCache.set(expr, expression);
    }
    // Pass the structured input - expressions access nodes, current, parent from it
    const result = await expression.evaluate(input);
    return result as boolean | string | number;
  } catch (error) {
    throw new ExpressionError(expr, error);
  }
}

/** A JSONata expression could not be compiled or evaluated. */
export class ExpressionError extends Error {
  constructor(
    readonly expression: string,
    cause: unknown,
  ) {
    // JSONata throws plain objects ({ code, message, position }), not Error instances.
    const reason = (cause as { message?: unknown } | null)?.message ?? cause;
    super(`Expression "${expression}" failed: ${String(reason)}`);
  }
}

/** Result of evaluating a rule's `expression` or `when`: a value, or the error that stopped it (never thrown). */
export type ExpressionOutcome = { value: boolean | string | number } | { error: string };

/** Like {@link evaluateExpression} but reports a failure as data, so callers can turn it into a violation. */
export async function tryEvaluateExpression(expr: string, context: EvalContext): Promise<ExpressionOutcome> {
  try {
    return { value: await evaluateExpression(expr, context) };
  } catch (error) {
    return { error: error instanceof ExpressionError ? error.message : String(error) };
  }
}

/**
 * Flatten a SpaceNode for JSONata evaluation.
 * Creates a new object with schemaData properties at the top level.
 *
 * @param node - The node to flatten
 * @returns Flattened node with properties directly accessible
 */
function flattenNode(node: SpaceNode, nodeIndex: Map<NodeId, SpaceNode>): Record<string, unknown> {
  const parentTitle = (r: SpaceNode['resolvedParents'][number]) => nodeIndex.get(r.id)?.title ?? r.id;
  return {
    ...node.schemaData,
    id: node.id,
    resolvedType: node.resolvedType,
    resolvedParentId: node.resolvedParents[0]?.id, // first parent or undefined, provided for convenience
    resolvedParentIds: node.resolvedParents.map((r) => r.id), // full array of parent ids
    resolvedParentTitle: node.resolvedParents[0] && parentTitle(node.resolvedParents[0]), // display title of the first parent
    resolvedParentTitles: node.resolvedParents.map(parentTitle), // display titles of all parents
    resolvedLinks: node.resolvedLinks,
  };
}

/**
 * Build an evaluation context for a given node.
 *
 * @param node - The node to build context for
 * @param allNodes - All nodes in the space
 * @param nodeIndex - Map of node ids to nodes for efficient lookup
 * @returns Evaluation context for the node
 */
export function buildEvalContext(
  node: SpaceNode,
  allNodes: SpaceNode[],
  nodeIndex: Map<NodeId, SpaceNode>,
): EvalContext {
  // Flatten all nodes for JSONata access
  const flattenedNodes = allNodes.map((n) => flattenNode(n, nodeIndex));

  // Build all parent objects from resolvedParents array
  const flattenedParents: Record<string, unknown>[] = [];
  for (const { id: parentId } of node.resolvedParents) {
    const parentNode = nodeIndex.get(parentId);
    if (parentNode) {
      flattenedParents.push(flattenNode(parentNode, nodeIndex));
    }
  }

  return {
    nodes: flattenedNodes,
    $$: flattenNode(node, nodeIndex),
    parent: flattenedParents[0],
    parents: flattenedParents.length > 0 ? flattenedParents : undefined,
  };
}

/** The violation reported when a rule's `expression` or `when` cannot be evaluated: an authoring error, so always `error`. */
export function expressionErrorViolation(rule: Rule, file: string, error: string): RuleViolation {
  return {
    file,
    ruleId: rule.id,
    category: rule.category,
    severity: 'error',
    description: `${rule.description} (Rule error: ${error})`,
  };
}

/** The outcome of a rule's `expression` on one node. */
export type ExpressionRuleResult =
  | { passed: true }
  /** `failed` is the expression returning something other than true; otherwise it could not be evaluated. */
  | { passed: false; violation: RuleViolation; failed: boolean };

/**
 * Evaluate a rule's `expression` against a node (`file` empty and `node` a sentinel for a global rule). A failure
 * reports the rule's severity; a rule with a semantic part names the expression in the evidence, so the
 * violation is not mistaken for a verdict. An evaluation error reports `error` and is not a `failed` result.
 */
export async function evaluateRuleExpression(
  rule: Rule,
  node: SpaceNode,
  allNodes: SpaceNode[],
  nodeIndex: Map<NodeId, SpaceNode>,
  file: string = node.id,
): Promise<ExpressionRuleResult> {
  const expression = rule.expression as string;
  const outcome = await tryEvaluateExpression(expression, buildEvalContext(node, allNodes, nodeIndex));
  if ('error' in outcome) {
    return { passed: false, failed: false, violation: expressionErrorViolation(rule, file, outcome.error) };
  }
  if (outcome.value === true) return { passed: true };
  return {
    passed: false,
    failed: true,
    violation: {
      file,
      ruleId: rule.id,
      category: rule.category,
      severity: ruleSeverity(rule),
      description: rule.description,
      ...(rule.semantic !== undefined && { evidence: `expression failed: ${expression}` }),
    },
  };
}
