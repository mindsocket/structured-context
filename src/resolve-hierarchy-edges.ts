import type { HierarchyLevel, SpaceNode } from './types';
import { buildTargetIndex, wikilinkToTarget } from './wikilink-utils';

/**
 * Extract wikilink refs from a field value.
 * If multiple=true: expects an array; returns string elements.
 * If multiple=false: expects a single string; returns it in a one-element array.
 */
function getRefs(rawField: unknown, multiple: boolean): string[] {
  if (multiple) {
    return Array.isArray(rawField) ? rawField.filter((v): v is string => typeof v === 'string') : [];
  }
  return typeof rawField === 'string' ? [rawField] : [];
}

/**
 * Resolves hierarchy parent-child links for a specific child/parent type pair.
 *
 * NOTE: This handles primary structural hierarchy links defined in `$metadata.hierarchy`.
 * It is distinct from "Adjacent Relationships" defined in `$metadata.relationships`.
 *
 * @param nodesByType Map of node type to nodes
 * @param targetIndex Map of link targets to nodes
 * @param childType The type of child nodes
 * @param parentType The type of parent nodes
 * @param field The field name in frontmatter that contains the wikilink(s)
 * @param fieldOn 'parent' if parent nodes have the field pointing to children, 'child' if child nodes have the field pointing to parents
 * @param multiple Whether the field contains an array of refs
 */
function resolveHierarchyLink(
  nodesByType: Map<string, SpaceNode[]>,
  targetIndex: Map<string, SpaceNode | null>,
  childType: string,
  parentType: string,
  field: string,
  fieldOn: 'child' | 'parent',
  multiple: boolean,
): void {
  if (fieldOn === 'parent') {
    // Parent nodes have the field pointing to children
    for (const parentNode of nodesByType.get(parentType) ?? []) {
      const rawField = parentNode.schemaData[field];
      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const target = wikilinkToTarget(ref);
        const childNode = targetIndex.get(target);
        if (!childNode) continue;
        const parentTitle = parentNode.schemaData.title;
        if (typeof parentTitle !== 'string') continue;
        childNode.resolvedParents.push(parentTitle);
      }
    }
  } else {
    // Child nodes have the field pointing to parents
    for (const childNode of nodesByType.get(childType) ?? []) {
      const rawField = childNode.schemaData[field];
      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const target = wikilinkToTarget(ref);
        const parentNode = targetIndex.get(target);
        if (!parentNode) continue;
        const parentTitle = parentNode.schemaData.title;
        if (typeof parentTitle !== 'string') continue;
        childNode.resolvedParents.push(parentTitle);
      }
    }
  }
}

/**
 * Resolve parent links using the levels configuration from schema metadata.
 * Supports DAG relationships via configurable edge fields per hierarchy level.
 * Also supports same-type parent relationships via the selfRefField property.
 */
export function resolveHierarchyEdges(nodes: SpaceNode[], levels: HierarchyLevel[]): void {
  // Initialize all nodes' resolvedParents to empty array
  for (const node of nodes) {
    node.resolvedParents = [];
  }

  const targetIndex = buildTargetIndex(nodes);

  // Build nodesByType map
  const nodesByType = new Map<string, SpaceNode[]>();
  for (const node of nodes) {
    const type = node.resolvedType;
    if (!nodesByType.has(type)) {
      nodesByType.set(type, []);
    }
    nodesByType.get(type)!.push(node);
  }

  // Process non-root levels (i >= 1)
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    const parentLevel = levels[i - 1]!;

    // Regular relationship (child type → parent type)
    resolveHierarchyLink(
      nodesByType,
      targetIndex,
      level.type,
      parentLevel.type,
      level.field,
      level.fieldOn,
      level.multiple,
    );

    // Same-type relationship (child type → same type) if selfRefField is set
    if (level.selfRefField) {
      resolveHierarchyLink(
        nodesByType,
        targetIndex,
        level.type,
        level.type,
        level.selfRefField,
        'child', // always child-side for self-ref
        false, // never multiple for self-ref
      );
    }
  }
}
