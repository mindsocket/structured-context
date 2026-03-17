import type { MetadataContractRelationship } from '../schema/metadata-contract';
import { resolveNodeType } from '../schema/schema';
import type { EdgeDefinition, HierarchyLevel, ResolvedParentRef, SpaceNode } from '../types';
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
 * Resolves parent-child links for a specific edge definition, pushing a ResolvedParentRef
 * onto each child's resolvedParents array.
 *
 * For fieldOn:'child' edges, any existing node is accepted as the parent target (permissive).
 * Type correctness is enforced by the validator, not the resolver.
 *
 * For fieldOn:'parent' edges, only nodes of the expected child type are updated, since the
 * parent explicitly enumerates its children and filtering is necessary to target the right nodes.
 *
 * @param nodesByType Map of node type to nodes
 * @param targetIndex Map of link targets to nodes
 * @param edge The edge definition (child type, parent type, field, fieldOn, multiple)
 * @param source Whether this edge comes from hierarchy.levels or relationships
 * @param selfRef Whether child and parent are the same node type
 * @param typeAliases Optional type aliases for resolution
 */
function resolveEdge(
  nodesByType: Map<string, SpaceNode[]>,
  targetIndex: Map<string, SpaceNode | null>,
  edge: EdgeDefinition,
  source: ResolvedParentRef['source'],
  selfRef: boolean,
  typeAliases?: Record<string, string>,
): void {
  const { type: rawChildType, parent: rawParentType, field, fieldOn, multiple } = edge;

  const childType = resolveNodeType(rawChildType, typeAliases);
  const parentType = resolveNodeType(rawParentType, typeAliases);

  function pushParentRef(childNode: SpaceNode, parentTitle: string): void {
    // Deduplicate by (field, title) — same parent via different fields is intentional
    if (!childNode.resolvedParents.some((r) => r.field === field && r.title === parentTitle)) {
      childNode.resolvedParents.push({ title: parentTitle, field, source, selfRef });
    }
  }

  if (fieldOn === 'parent') {
    // Parent nodes have the field pointing to children; filter by expected child type
    for (const parentNode of nodesByType.get(parentType) ?? []) {
      const rawField = parentNode.schemaData[field];
      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const target = wikilinkToTarget(ref);
        const childNode = targetIndex.get(target);
        if (!childNode || childNode.resolvedType !== childType) continue;
        const parentTitle = parentNode.schemaData.title;
        if (typeof parentTitle !== 'string') continue;
        pushParentRef(childNode, parentTitle);
      }
    }
  } else {
    // Child nodes have the field pointing to parents; accept any resolved target
    for (const childNode of nodesByType.get(childType) ?? []) {
      const rawField = childNode.schemaData[field];
      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const target = wikilinkToTarget(ref);
        const parentNode = targetIndex.get(target);
        if (!parentNode) continue;
        const parentTitle = parentNode.schemaData.title;
        if (typeof parentTitle !== 'string') continue;
        pushParentRef(childNode, parentTitle);
      }
    }
  }
}

/**
 * Resolve parent links using the hierarchy levels and relationships configuration from schema metadata.
 * Supports DAG relationships via configurable edge fields.
 */
export function resolveGraphEdges(
  nodes: SpaceNode[],
  levels: HierarchyLevel[],
  relationships: MetadataContractRelationship[] = [],
  typeAliases?: Record<string, string>,
): void {
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

  // 1. Process hierarchy levels
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;

    // Regular relationship (child type → parent type)
    if (i > 0) {
      const parentLevel = levels[i - 1]!;
      resolveEdge(
        nodesByType,
        targetIndex,
        {
          type: level.type,
          parent: parentLevel.type,
          field: level.field,
          fieldOn: level.fieldOn,
          multiple: level.multiple,
        },
        'hierarchy',
        false,
        typeAliases,
      );
    }

    // Same-type relationship (child type → same type) via primary field
    if (level.selfRef) {
      resolveEdge(
        nodesByType,
        targetIndex,
        { type: level.type, parent: level.type, field: level.field, fieldOn: level.fieldOn, multiple: level.multiple },
        'hierarchy',
        true,
        typeAliases,
      );
    }

    // Same-type relationship via explicit selfRefField
    if (level.selfRefField) {
      resolveEdge(
        nodesByType,
        targetIndex,
        { type: level.type, parent: level.type, field: level.selfRefField, fieldOn: 'child', multiple: false },
        'hierarchy',
        true,
        typeAliases,
      );
    }
  }

  // 2. Process additional relationships
  for (const rel of relationships) {
    const edge: EdgeDefinition = {
      type: rel.type,
      parent: rel.parent,
      field: rel.field ?? 'parent',
      fieldOn: rel.fieldOn ?? 'child',
      multiple: rel.multiple ?? false,
    };
    resolveEdge(nodesByType, targetIndex, edge, 'relationship', rel.type === rel.parent, typeAliases);
  }
}
