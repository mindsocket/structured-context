import type { HierarchyLevel, SpaceNode } from '../types';

export interface NodeClassification {
  hierarchyRoots: SpaceNode[];
  orphans: SpaceNode[];
  nonHierarchy: SpaceNode[];
  children: Map<string, SpaceNode[]>;
}

/**
 * Classify nodes into hierarchy categories.
 *
 * - **hierarchyRoots**: Nodes of the hierarchy's root type with no valid parents
 * - **orphans**: Nodes of other hierarchy types with no valid parents (or all parents dangling)
 * - **nonHierarchy**: Nodes whose type is not in the hierarchy definition
 * - **children**: Map of parent title → children (only includes hierarchy nodes)
 *
 * A "valid parent" is one whose title exists in the nodes list.
 */
export function classifyNodes(nodes: SpaceNode[], hierarchyLevels: HierarchyLevel[]): NodeClassification {
  const hierarchyTypes = new Set(hierarchyLevels.map((level) => level.type));
  const rootType = hierarchyLevels[0]?.type;

  // Build children map and title lookup
  const children = new Map<string, SpaceNode[]>();
  const nodeTitles = new Set<string>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    nodeTitles.add(title);
    children.set(title, []);
  }

  // Categorize nodes
  const hierarchyRoots: SpaceNode[] = [];
  const orphans: SpaceNode[] = [];
  const nonHierarchy: SpaceNode[] = [];

  for (const node of nodes) {
    const nodeType = node.resolvedType;

    if (!hierarchyTypes.has(nodeType)) {
      nonHierarchy.push(node);
      continue; // non-hierarchy nodes don't participate in the DAG
    }

    // Only hierarchy-sourced parents determine structural position in the DAG
    const hierarchyParents = node.resolvedParents.filter((r) => r.source === 'hierarchy');

    if (hierarchyParents.length === 0) {
      if (nodeType === rootType) {
        hierarchyRoots.push(node);
      } else {
        orphans.push(node);
      }
    } else {
      let addedToAParent = false;
      for (const parentRef of hierarchyParents) {
        if (nodeTitles.has(parentRef.title)) {
          const siblings = children.get(parentRef.title);
          if (siblings) {
            siblings.push(node);
            addedToAParent = true;
          }
        }
      }
      if (!addedToAParent) {
        // All hierarchy parents dangling — treat as orphan
        orphans.push(node);
      }
    }
  }

  return { hierarchyRoots, orphans, nonHierarchy, children };
}

/**
 * Build a Set containing all hierarchy node titles.
 * Includes roots, orphans, and all their descendants.
 */
export function buildHierarchyNodeSet(classification: NodeClassification): Set<string> {
  const nodeTitles = new Set<string>();

  function addNodeAndDescendants(node: SpaceNode) {
    nodeTitles.add(node.schemaData.title as string);
    const nodeChildren = classification.children.get(node.schemaData.title as string) ?? [];
    for (const child of nodeChildren) {
      addNodeAndDescendants(child);
    }
  }

  for (const root of classification.hierarchyRoots) {
    addNodeAndDescendants(root);
  }
  for (const orphan of classification.orphans) {
    addNodeAndDescendants(orphan);
  }

  return nodeTitles;
}

/**
 * Build a depth map from hierarchy levels.
 * The position in the hierarchy array determines the depth.
 */
export function buildDepthMap(hierarchyLevels: HierarchyLevel[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  for (const [i, level] of hierarchyLevels.entries()) {
    depthMap.set(level.type, i);
  }
  return depthMap;
}
