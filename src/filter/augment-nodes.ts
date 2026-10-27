import type { NodeId, ResolvedParentRef, SpaceNode } from '../types';

/** Edge metadata merged into each ancestor/descendant entry. */
export type EdgeMetadata = {
  _field: string;
  _kind: 'hierarchy' | 'relationship';
  /** Hierarchy name, present only for hierarchy edges. */
  _hierarchy?: string;
  _selfRef: boolean;
};

/** A flat node representation augmented with ancestor and descendant traversal arrays. */
export type AugmentedFlatNode = Record<string, unknown> & {
  resolvedType: string;
  resolvedParentTitles: string[];
  resolvedParentIds: NodeId[];
  ancestors: Array<Record<string, unknown> & EdgeMetadata>;
  descendants: Array<Record<string, unknown> & EdgeMetadata>;
};

/** Edge metadata for the resolvedParents entry connecting two nodes. */
function edgeMetadata(ref: ResolvedParentRef): EdgeMetadata {
  return {
    _field: ref.field,
    _kind: ref.kind,
    ...(ref.hierarchy !== undefined ? { _hierarchy: ref.hierarchy } : {}),
    _selfRef: ref.selfRef,
  };
}

/** Flatten a SpaceNode's data fields for use in an augmented representation. */
function flattenData(node: SpaceNode): Record<string, unknown> {
  return {
    ...node.schemaData,
    id: node.id,
    title: node.title,
    resolvedType: node.resolvedType,
  };
}

/**
 * Build the augmented flat representation of a node, including pre-computed
 * ancestors[] and descendants[] arrays with edge metadata.
 *
 * - ancestors: BFS from node via resolvedParents, nearest first, deduplicated by id.
 * - descendants: BFS via childrenIndex, nearest first, deduplicated by id.
 * - Each entry merges the parent/child node's fields with edge metadata (_field, _kind, _hierarchy, _selfRef).
 */
export function augmentNode(
  node: SpaceNode,
  nodeIndex: ReadonlyMap<NodeId, SpaceNode>,
  childrenIndex: ReadonlyMap<NodeId, readonly SpaceNode[]>,
): AugmentedFlatNode {
  const ancestors = buildAncestors(node, nodeIndex);
  const descendants = buildDescendants(node, childrenIndex);

  return {
    ...flattenData(node),
    resolvedType: node.resolvedType,
    resolvedParentTitles: node.resolvedParents.map((r) => nodeIndex.get(r.id)?.title ?? r.id),
    resolvedParentIds: node.resolvedParents.map((r) => r.id),
    ancestors,
    descendants,
  };
}

function buildAncestors(
  node: SpaceNode,
  nodeIndex: ReadonlyMap<NodeId, SpaceNode>,
): Array<Record<string, unknown> & EdgeMetadata> {
  const visited = new Set<NodeId>();
  const result: Array<Record<string, unknown> & EdgeMetadata> = [];

  // BFS queue holds: { parentRef that led to this node, the node itself }
  const queue: Array<{ ref: ResolvedParentRef; node: SpaceNode }> = [];

  for (const ref of node.resolvedParents) {
    const parentNode = nodeIndex.get(ref.id);
    if (parentNode) queue.push({ ref, node: parentNode });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const id = item.node.id;
    if (visited.has(id)) continue;
    visited.add(id);

    result.push({
      ...flattenData(item.node),
      ...edgeMetadata(item.ref),
    });

    // Continue BFS upward
    for (const ref of item.node.resolvedParents) {
      const parentNode = nodeIndex.get(ref.id);
      if (parentNode && !visited.has(ref.id)) {
        queue.push({ ref, node: parentNode });
      }
    }
  }

  return result;
}

function buildDescendants(
  node: SpaceNode,
  childrenIndex: ReadonlyMap<NodeId, readonly SpaceNode[]>,
): Array<Record<string, unknown> & EdgeMetadata> {
  const nodeId = node.id;
  const visited = new Set<NodeId>();
  const result: Array<Record<string, unknown> & EdgeMetadata> = [];

  // BFS queue holds: child node + the resolvedParents entry on that child that points to its parent
  const queue: Array<{ childNode: SpaceNode; ref: ResolvedParentRef }> = [];

  const directChildren = childrenIndex.get(nodeId) ?? [];
  for (const child of directChildren) {
    const ref = child.resolvedParents.find((r) => r.id === nodeId);
    if (ref) queue.push({ childNode: child, ref });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const id = item.childNode.id;
    if (visited.has(id)) continue;
    visited.add(id);

    result.push({
      ...flattenData(item.childNode),
      ...edgeMetadata(item.ref),
    });

    const grandchildren = childrenIndex.get(id) ?? [];
    for (const grandchild of grandchildren) {
      if (!visited.has(grandchild.id)) {
        const ref = grandchild.resolvedParents.find((r) => r.id === id);
        if (ref) queue.push({ childNode: grandchild, ref });
      }
    }
  }

  return result;
}
