import jsonata from 'jsonata';
import type { SpaceNode } from './types';

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
 * Returns the result of the expression (boolean for rule checks).
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
    // Log warning and return false (fail safe)
    console.warn(`Warning: Error evaluating expression "${expr}":`, error);
    return false;
  }
}

/**
 * Flatten a SpaceNode for JSONata evaluation.
 * Creates a new object with schemaData properties at the top level.
 *
 * @param node - The node to flatten
 * @returns Flattened node with properties directly accessible
 */
function flattenNode(node: SpaceNode): Record<string, unknown> {
  return {
    ...node.schemaData,
    resolvedType: node.resolvedType,
    resolvedParentTitle: node.resolvedParents[0], // first parent or undefined, provided for convenience
    resolvedParentTitles: node.resolvedParents, // full array
  };
}

/**
 * Build an evaluation context for a given node.
 *
 * @param node - The node to build context for
 * @param allNodes - All nodes in the space
 * @param nodeIndex - Map of node titles to nodes for efficient lookup
 * @returns Evaluation context for the node
 */
export function buildEvalContext(
  node: SpaceNode,
  allNodes: SpaceNode[],
  nodeIndex: Map<string, SpaceNode>,
): EvalContext {
  // Flatten all nodes for JSONata access
  const flattenedNodes = allNodes.map(flattenNode);

  // Build all parent objects from resolvedParents array
  const flattenedParents: Record<string, unknown>[] = [];
  for (const parentTitle of node.resolvedParents) {
    const parentNode = nodeIndex.get(parentTitle);
    if (parentNode) {
      flattenedParents.push(flattenNode(parentNode));
    }
  }

  return {
    nodes: flattenedNodes,
    $$: flattenNode(node),
    parent: flattenedParents[0],
    parents: flattenedParents.length > 0 ? flattenedParents : undefined,
  };
}
