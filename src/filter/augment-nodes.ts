import type { ResolvedParentRef, SpaceNode } from '../types';

/** Edge metadata merged into each ancestor/descendant entry. */
export type EdgeMetadata = {
  _field: string;
  _source: 'hierarchy' | 'relationship';
  _selfRef: boolean;
};

/** A flat node representation augmented with ancestor and descendant traversal arrays. */
export type AugmentedFlatNode = Record<string, unknown> & {
  resolvedType: string;
  resolvedParentTitles: string[];
  ancestors: Array<Record<string, unknown> & EdgeMetadata>;
  descendants: Array<Record<string, unknown> & EdgeMetadata>;
};

/**
 * Build an index from parent title → direct children, using all edges in resolvedParents.
 * Used by augmentNode for descendant traversal.
 */
export function buildChildrenIndex(nodes: SpaceNode[]): Map<string, SpaceNode[]> {
  const index = new Map<string, SpaceNode[]>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (!index.has(title)) index.set(title, []);

    for (const parentRef of node.resolvedParents) {
      if (!index.has(parentRef.title)) index.set(parentRef.title, []);
      index.get(parentRef.title)!.push(node);
    }
  }
  return index;
}

/** Flatten a SpaceNode's data fields for use in an augmented representation. */
function flattenData(node: SpaceNode): Record<string, unknown> {
  return {
    ...node.schemaData,
    resolvedType: node.resolvedType,
  };
}

/**
 * Build the augmented flat representation of a node, including pre-computed
 * ancestors[] and descendants[] arrays with edge metadata.
 *
 * - ancestors: BFS from node via resolvedParents, nearest first, deduplicated by title.
 * - descendants: BFS via childrenIndex, nearest first, deduplicated by title.
 * - Each entry merges the parent/child node's fields with edge metadata (_field, _source, _selfRef).
 */
export function augmentNode(
  node: SpaceNode,
  nodeIndex: Map<string, SpaceNode>,
  childrenIndex: Map<string, SpaceNode[]>,
): AugmentedFlatNode {
  const ancestors = buildAncestors(node, nodeIndex);
  const descendants = buildDescendants(node, childrenIndex);

  return {
    ...flattenData(node),
    resolvedType: node.resolvedType,
    resolvedParentTitles: node.resolvedParents.map((r) => r.title),
    ancestors,
    descendants,
  };
}

function buildAncestors(
  node: SpaceNode,
  nodeIndex: Map<string, SpaceNode>,
): Array<Record<string, unknown> & EdgeMetadata> {
  const visited = new Set<string>();
  const result: Array<Record<string, unknown> & EdgeMetadata> = [];

  // BFS queue holds: { parentRef that led to this node, the node itself }
  const queue: Array<{ ref: ResolvedParentRef; node: SpaceNode }> = [];

  for (const ref of node.resolvedParents) {
    const parentNode = nodeIndex.get(ref.title);
    if (parentNode) queue.push({ ref, node: parentNode });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const title = item.node.schemaData.title as string;
    if (visited.has(title)) continue;
    visited.add(title);

    result.push({
      ...flattenData(item.node),
      _field: item.ref.field,
      _source: item.ref.source,
      _selfRef: item.ref.selfRef,
    });

    // Continue BFS upward
    for (const ref of item.node.resolvedParents) {
      const parentNode = nodeIndex.get(ref.title);
      if (parentNode && !visited.has(ref.title)) {
        queue.push({ ref, node: parentNode });
      }
    }
  }

  return result;
}

function buildDescendants(
  node: SpaceNode,
  childrenIndex: Map<string, SpaceNode[]>,
): Array<Record<string, unknown> & EdgeMetadata> {
  const nodeTitle = node.schemaData.title as string;
  const visited = new Set<string>();
  const result: Array<Record<string, unknown> & EdgeMetadata> = [];

  // BFS queue holds: child node + the resolvedParents entry on that child that points to its parent
  const queue: Array<{ childNode: SpaceNode; ref: ResolvedParentRef }> = [];

  const directChildren = childrenIndex.get(nodeTitle) ?? [];
  for (const child of directChildren) {
    const ref = child.resolvedParents.find((r) => r.title === nodeTitle);
    if (ref) queue.push({ childNode: child, ref });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const title = item.childNode.schemaData.title as string;
    if (visited.has(title)) continue;
    visited.add(title);

    result.push({
      ...flattenData(item.childNode),
      _field: item.ref.field,
      _source: item.ref.source,
      _selfRef: item.ref.selfRef,
    });

    const grandchildren = childrenIndex.get(title) ?? [];
    for (const grandchild of grandchildren) {
      if (!visited.has(grandchild.schemaData.title as string)) {
        const ref = grandchild.resolvedParents.find((r) => r.title === title);
        if (ref) queue.push({ childNode: grandchild, ref });
      }
    }
  }

  return result;
}
