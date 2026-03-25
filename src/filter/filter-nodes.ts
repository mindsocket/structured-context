import jsonata from 'jsonata';
import type { SpaceNode } from '../types';
import { type AugmentedFlatNode, augmentNode, buildChildrenIndex } from './augment-nodes';
import { expandInclude, parseIncludeSpec } from './expand-include';
import { parseFilterExpression } from './parse-expression';

const expressionCache = new Map<string, ReturnType<typeof jsonata>>();

/**
 * Filter a set of nodes using a filter expression.
 *
 * The expression follows the SELECT...WHERE DSL:
 *   WHERE {jsonata}                — return nodes where the JSONata predicate is truthy
 *   SELECT {spec} WHERE {jsonata}  — filter + expand result via include spec
 *   SELECT {spec}                  — expand from all nodes via include spec
 *   {jsonata}                      — bare JSONata treated as WHERE predicate
 *
 * Each node's WHERE predicate is evaluated against an augmented context that includes
 * pre-computed ancestors[] and descendants[] arrays with edge metadata.
 *
 * The SELECT spec may contain: ancestors[(type)], descendants[(type)], siblings,
 * relationships[(childType | parentType:childType | parentType:field:childType)]
 *
 * @param expression - Filter DSL expression or view expression string
 * @param nodes - All nodes in the space
 * @returns Filtered+expanded SpaceNode[] (original node objects)
 */
export async function filterNodes(expression: string, nodes: SpaceNode[]): Promise<SpaceNode[]> {
  const { where, include } = parseFilterExpression(expression);

  // Build lookup structures (always needed for SELECT expansion or WHERE evaluation)
  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (title) nodeIndex.set(title, node);
  }
  const childrenIndex = buildChildrenIndex(nodes);

  // Pre-augment all nodes once (ancestors/descendants needed for WHERE predicates and SELECT expansion)
  const augmented = new Map<string, AugmentedFlatNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    augmented.set(title, augmentNode(node, nodeIndex, childrenIndex));
  }

  // Step 1: apply WHERE clause to get the matched set
  let matched: SpaceNode[];
  if (where === undefined) {
    // SELECT-only: start from all nodes
    matched = nodes;
  } else {
    const allAugmented = Array.from(augmented.values());

    // Compile and cache the JSONata expression
    let expr = expressionCache.get(where);
    if (!expr) {
      expr = jsonata(where);
      expressionCache.set(where, expr);
    }

    matched = [];
    for (const node of nodes) {
      const title = node.schemaData.title as string;
      const current = augmented.get(title);
      if (!current) continue;

      // Spread current node fields at root level so bare field names work in expressions
      // (e.g. `resolvedType='solution'` rather than `current.resolvedType='solution'`).
      // Also expose `ancestors` and `descendants` directly, and `nodes` for cross-node access.
      const input = { ...current, nodes: allAugmented };
        const result = await expr.evaluate(input);
        if (result) matched.push(node);
    }
  }

  // Step 2: apply SELECT clause to expand the result set
  if (include !== undefined) {
    const directives = parseIncludeSpec(include);
    return expandInclude(matched, directives, nodeIndex, childrenIndex, augmented);
  }

  return matched;
}
