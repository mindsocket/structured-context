import jsonata from 'jsonata';
import { buildSpaceGraph, type SpaceGraph } from '../space-graph';
import type { SpaceNode } from '../types';
import { type AugmentedFlatNode, augmentNode } from './augment-nodes';
import { expandInclude, parseIncludeSpec } from './expand-include';
import { parseFilterExpression } from './parse-expression';

const expressionCache = new Map<string, ReturnType<typeof jsonata>>();

/**
 * Filter a SpaceGraph using a filter expression, returning a new SpaceGraph.
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
 * @param graph - The full space graph
 * @returns A new SpaceGraph containing only the filtered+expanded nodes
 */
export async function filterNodes(expression: string, graph: SpaceGraph): Promise<SpaceGraph> {
  const { where, include } = parseFilterExpression(expression);

  const nodeIndex = graph.nodes;
  const childrenIndex = graph.children;

  // Pre-augment all nodes once (ancestors/descendants needed for WHERE predicates and SELECT expansion)
  const augmented = new Map<string, AugmentedFlatNode>();
  for (const node of nodeIndex.values()) {
    augmented.set(node.title, augmentNode(node, nodeIndex, childrenIndex));
  }

  // Step 1: apply WHERE clause to get the matched set
  let matched: SpaceNode[];
  if (where === undefined) {
    // SELECT-only: start from all nodes
    matched = [...nodeIndex.values()];
  } else {
    const allAugmented = Array.from(augmented.values());

    // Compile and cache the JSONata expression
    let expr = expressionCache.get(where);
    if (!expr) {
      expr = jsonata(where);
      expressionCache.set(where, expr);
    }

    matched = [];
    for (const node of nodeIndex.values()) {
      const current = augmented.get(node.title);
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
  let matchedNodes: SpaceNode[];
  if (include !== undefined) {
    const directives = parseIncludeSpec(include);
    matchedNodes = expandInclude(matched, directives, nodeIndex, childrenIndex, augmented);
  } else {
    matchedNodes = matched;
  }

  return buildSpaceGraph(matchedNodes, graph.levels);
}
