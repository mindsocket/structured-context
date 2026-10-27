import type { Hierarchy, NodeId, ResolvedParentRef, SchemaMetadata, SpaceNode } from './types';

/** A typed edge between two nodes: a node's resolvedParents entry, with both ends named. */
export type SpaceEdge = Omit<ResolvedParentRef, 'id'> & {
  parent: NodeId;
  child: NodeId;
};

/**
 * A navigable graph over a set of SpaceNodes.
 *
 * Built once from SpaceNode[] + one selected hierarchy via buildSpaceGraph().
 * The hierarchy-specific views (roots, orphans, hierarchyChildren, ...) cover only that hierarchy;
 * nodes of other hierarchies' types are non-hierarchy nodes in this graph.
 * Provides typed access to nodes, edges, traversal, and classification
 * so consumers don't need to build their own indexes.
 */
export type SpaceGraph = {
  /** All nodes, keyed by id. Preserves insertion order. */
  readonly nodes: ReadonlyMap<NodeId, SpaceNode>;

  /** Hierarchy roots: nodes of the root type with no valid hierarchy parents. */
  readonly hierarchyRoots: readonly SpaceNode[];

  /** Orphans: hierarchy-typed nodes with no valid hierarchy parents in the node set. */
  readonly orphans: readonly SpaceNode[];

  /** Non-hierarchy nodes: type not in the hierarchy levels definition. */
  readonly nonHierarchy: readonly SpaceNode[];

  /** Hierarchy children map: parent id → direct children connected via this hierarchy's edges only. */
  readonly hierarchyChildren: ReadonlyMap<NodeId, readonly SpaceNode[]>;

  /** All-edges children map: parent id → direct children connected via any edge (hierarchy + relationship). */
  readonly children: ReadonlyMap<NodeId, readonly SpaceNode[]>;

  /** Parent edges: child id → edges to its parents (hierarchy + relationship), in resolvedParents order. */
  readonly parentEdges: ReadonlyMap<NodeId, readonly SpaceEdge[]>;

  /** Child edges: parent id → edges to its children (hierarchy + relationship). */
  readonly childEdges: ReadonlyMap<NodeId, readonly SpaceEdge[]>;

  /** Set of all node ids that are part of the hierarchy (roots + their descendants + orphans). */
  readonly hierarchyIds: ReadonlySet<NodeId>;

  /** The hierarchy used to build this graph, if the schema has one. */
  readonly hierarchy: Hierarchy | undefined;
};

/** Build a SpaceGraph from a flat list of SpaceNodes and the hierarchy to structure it by. */
export function buildSpaceGraph(nodes: SpaceNode[], hierarchy: Hierarchy | undefined): SpaceGraph {
  const levels = hierarchy?.levels ?? [];
  const hierarchyTypes = new Set(levels.map((l) => l.type));
  const rootType = levels[0]?.type;
  const isHierarchyEdge = (r: ResolvedParentRef) => r.kind === 'hierarchy' && r.hierarchy === hierarchy?.name;

  const nodesMap = new Map<NodeId, SpaceNode>();
  const hierarchyChildrenMap = new Map<NodeId, SpaceNode[]>();
  const childrenMap = new Map<NodeId, SpaceNode[]>();
  const parentEdgesMap = new Map<NodeId, SpaceEdge[]>();
  const childEdgesMap = new Map<NodeId, SpaceEdge[]>();

  const hierarchyRoots: SpaceNode[] = [];
  const orphans: SpaceNode[] = [];
  const nonHierarchy: SpaceNode[] = [];

  // First pass: register all nodes and init adjacency lists
  for (const node of nodes) {
    nodesMap.set(node.id, node);
    hierarchyChildrenMap.set(node.id, []);
    childrenMap.set(node.id, []);
    parentEdgesMap.set(node.id, []);
    childEdgesMap.set(node.id, []);
  }

  // Second pass: build children maps (inverted from resolvedParents)
  for (const node of nodes) {
    for (const parentRef of node.resolvedParents) {
      const { id: parentId, ...edgeFields } = parentRef;
      const edge: SpaceEdge = { parent: parentId, child: node.id, ...edgeFields };
      parentEdgesMap.get(node.id)!.push(edge);
      if (!childEdgesMap.has(parentId)) childEdgesMap.set(parentId, []);
      childEdgesMap.get(parentId)!.push(edge);

      // All-edges map
      if (!childrenMap.has(parentRef.id)) childrenMap.set(parentRef.id, []);
      childrenMap.get(parentRef.id)!.push(node);

      // Hierarchy-only map
      if (isHierarchyEdge(parentRef)) {
        if (!hierarchyChildrenMap.has(parentRef.id)) hierarchyChildrenMap.set(parentRef.id, []);
        hierarchyChildrenMap.get(parentRef.id)!.push(node);
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
    const hierarchyParents = node.resolvedParents.filter(isHierarchyEdge);

    if (hierarchyParents.length === 0) {
      if (nodeType === rootType) {
        hierarchyRoots.push(node);
      } else {
        orphans.push(node);
      }
    } else {
      // Check if at least one hierarchy parent is actually in the node set
      const hasValidParent = hierarchyParents.some((r: ResolvedParentRef) => nodesMap.has(r.id));
      if (!hasValidParent) {
        // All hierarchy parents are dangling — treat as orphan
        orphans.push(node);
      }
    }
  }

  // Build hierarchyIds: BFS from roots + orphans through hierarchyChildren
  const hierarchyIds = new Set<NodeId>();

  function addHierarchySubtree(node: SpaceNode) {
    if (hierarchyIds.has(node.id)) return;
    hierarchyIds.add(node.id);
    for (const child of hierarchyChildrenMap.get(node.id) ?? []) {
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
    parentEdges: parentEdgesMap,
    childEdges: childEdgesMap,
    hierarchyIds,
    hierarchy,
  };
}

/** Resolve a hierarchy by name, or the main hierarchy when no name is given. */
export function selectHierarchy(
  metadata: Pick<SchemaMetadata, 'hierarchy' | 'hierarchies'>,
  name: string | undefined,
): Hierarchy | undefined {
  if (name === undefined) return metadata.hierarchy;
  const hierarchies = metadata.hierarchies ?? [];
  const hierarchy = hierarchies.find((h) => h.name === name);
  if (!hierarchy) {
    const available = hierarchies.map((h) => h.name).join(', ');
    throw new Error(
      `Unknown hierarchy: "${name}".${available ? ` Available: ${available}` : ' The schema defines no hierarchies.'}`,
    );
  }
  return hierarchy;
}
