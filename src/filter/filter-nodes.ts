import jsonata from 'jsonata';
import type { SpaceNode } from '../types';
import { type AugmentedFlatNode, augmentNode, buildChildrenIndex } from './augment-nodes';
import { parseFilterExpression } from './parse-expression';

const expressionCache = new Map<string, ReturnType<typeof jsonata>>();

/**
 * Filter a set of nodes using a filter expression.
 *
 * The expression follows the SELECT...WHERE DSL:
 *   WHERE {jsonata}                — return nodes where the JSONata predicate is truthy
 *   SELECT {spec} WHERE {jsonata}  — as above; SELECT expansion is deferred to Phase 2
 *   {jsonata}                      — bare JSONata treated as WHERE predicate
 *
 * Each node's predicate is evaluated against an augmented context that includes
 * pre-computed ancestors[] and descendants[] arrays with edge metadata.
 *
 * @param expression - Filter DSL expression or view expression string
 * @param nodes - All nodes in the space
 * @returns Matched SpaceNode[] (original node objects, not augmented representations)
 */
export async function filterNodes(expression: string, nodes: SpaceNode[]): Promise<SpaceNode[]> {
  const { where, include } = parseFilterExpression(expression);

  if (include !== undefined) {
    console.warn(
      'Warning: SELECT clause in filter expression is not yet evaluated. ' +
        'Only the WHERE clause will be applied. SELECT expansion will be supported in a future release.',
    );
  }

  if (where === undefined) {
    // SELECT-only: no filter predicate, return all nodes (Phase 2 will expand from them)
    return nodes;
  }

  // Build lookup structures
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (title) nodeIndex.set(title, node);
  }
  const childrenIndex = buildChildrenIndex(nodes);

  // Pre-augment all nodes once (ancestors/descendants needed for cross-node predicate access)
  const augmented = new Map<string, AugmentedFlatNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    augmented.set(title, augmentNode(node, nodeIndex, childrenIndex));
  }
  const allAugmented = Array.from(augmented.values());

  // Compile and cache the JSONata expression
  let expr = expressionCache.get(where);
  if (!expr) {
    expr = jsonata(where);
    expressionCache.set(where, expr);
  }

  // Evaluate the predicate for each node
  const matched: SpaceNode[] = [];
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    const current = augmented.get(title);
    if (!current) continue;

    // Spread current node fields at root level so bare field names work in expressions
    // (e.g. `resolvedType='solution'` rather than `current.resolvedType='solution'`).
    // Also expose `ancestors` and `descendants` directly, and `nodes` for cross-node access.
    const input = { ...current, nodes: allAugmented };
    try {
      const result = await expr.evaluate(input);
      if (result) matched.push(node);
    } catch (error) {
      console.warn(`Warning: Error evaluating filter expression for node "${title}":`, error);
    }
  }

  return matched;
}
