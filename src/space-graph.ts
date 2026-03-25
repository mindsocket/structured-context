import type { HierarchyLevel, ResolvedParentRef, SpaceNode } from './types';

/**
 * A navigable graph over a set of SpaceNodes.
 *
 * Built once from SpaceNode[] + hierarchy levels via buildSpaceGraph().
 * Provides typed access to nodes, edges, traversal, and classification
 * so consumers don't need to build their own indexes.
 */
export type SpaceGraph = {
  /** All nodes, keyed by title. Preserves insertion order. */
  readonly nodes: ReadonlyMap<string, SpaceNode>;

  /** Hierarchy roots: nodes of the root type with no valid hierarchy parents. */
  readonly hierarchyRoots: readonly SpaceNode[];

  /** Orphans: hierarchy-typed nodes with no valid hierarchy parents in the node set. */
  readonly orphans: readonly SpaceNode[];

  /** Non-hierarchy nodes: type not in the hierarchy levels definition. */
  readonly nonHierarchy: readonly SpaceNode[];

  /** Hierarchy children map: parent title → direct children connected via hierarchy edges only. */
  readonly hierarchyChildren: ReadonlyMap<string, readonly SpaceNode[]>;

  /** All-edges children map: parent title → direct children connected via any edge (hierarchy + relationship). */
  readonly children: ReadonlyMap<string, readonly SpaceNode[]>;

  /** Set of all node titles that are part of the hierarchy (roots + their descendants + orphans). */
  readonly hierarchyTitles: ReadonlySet<string>;

  /** Hierarchy levels used to build this graph. */
  readonly levels: readonly HierarchyLevel[];
};

/** Build a SpaceGraph from a flat list of SpaceNodes and hierarchy level definitions. */
export function buildSpaceGraph(nodes: SpaceNode[], levels: readonly HierarchyLevel[]): SpaceGraph {
  const hierarchyTypes = new Set(levels.map((l) => l.type));
  const rootType = levels[0]?.type;

  const nodesMap = new Map<string, SpaceNode>();
  const hierarchyChildrenMap = new Map<string, SpaceNode[]>();
  const childrenMap = new Map<string, SpaceNode[]>();

  const hierarchyRoots: SpaceNode[] = [];
  const orphans: SpaceNode[] = [];
  const nonHierarchy: SpaceNode[] = [];

  // First pass: register all nodes and init adjacency lists
  for (const node of nodes) {
    nodesMap.set(node.title, node);
    hierarchyChildrenMap.set(node.title, []);
    childrenMap.set(node.title, []);
  }

  // Second pass: build children maps (inverted from resolvedParents)
  for (const node of nodes) {
    for (const parentRef of node.resolvedParents) {
      // All-edges map
      if (!childrenMap.has(parentRef.title)) childrenMap.set(parentRef.title, []);
      childrenMap.get(parentRef.title)!.push(node);

      // Hierarchy-only map
      if (parentRef.source === 'hierarchy') {
        if (!hierarchyChildrenMap.has(parentRef.title)) hierarchyChildrenMap.set(parentRef.title, []);
        hierarchyChildrenMap.get(parentRef.title)!.push(node);
      }
    }
  }

  // Third pass: classify each node
  for (const node of nodes) {
    const nodeType = node.resolvedType;

    if (!hierarchyTypes.has(nodeType)) {
      nonHierarchy.push(node);
      continue;
    }

    // Only hierarchy-sourced parents determine structural position in the DAG
    const hierarchyParents = node.resolvedParents.filter((r: ResolvedParentRef) => r.source === 'hierarchy');

    if (hierarchyParents.length === 0) {
      if (nodeType === rootType) {
        hierarchyRoots.push(node);
      } else {
        orphans.push(node);
      }
    } else {
      // Check if at least one hierarchy parent is actually in the node set
      const hasValidParent = hierarchyParents.some((r: ResolvedParentRef) => nodesMap.has(r.title));
      if (!hasValidParent) {
        // All hierarchy parents are dangling — treat as orphan
        orphans.push(node);
      }
    }
  }

  // Build hierarchyTitles: BFS from roots + orphans through hierarchyChildren
  const hierarchyTitles = new Set<string>();

  function addHierarchySubtree(node: SpaceNode) {
    if (hierarchyTitles.has(node.title)) return;
    hierarchyTitles.add(node.title);
    for (const child of hierarchyChildrenMap.get(node.title) ?? []) {
      addHierarchySubtree(child);
    }
  }

  for (const root of hierarchyRoots) addHierarchySubtree(root);
  for (const orphan of orphans) addHierarchySubtree(orphan);

  return {
    nodes: nodesMap,
    hierarchyRoots,
    orphans,
    nonHierarchy,
    hierarchyChildren: hierarchyChildrenMap,
    children: childrenMap,
    hierarchyTitles,
    levels,
  };
}
