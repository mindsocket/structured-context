import { resolveNodeType } from '../schema/schema';
import type { EdgeDefinition, ResolvedParentRef, SchemaMetadata, SpaceNode, UnresolvedRef } from '../types';
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
 * onto each child's resolvedParents array. Records unresolved refs for broken/invalid links.
 *
 * For all edges, any existing node is accepted as the target (permissive).
 * Type correctness is enforced by validateHierarchyStructure via resolvedParents, not here.
 *
 * @param nodesByType Map of node type to nodes
 * @param targetIndex Map of link targets to nodes
 * @param edge The edge definition (child type, parent type, field, fieldOn, multiple)
 * @param source Whether this edge comes from hierarchy.levels or relationships
 * @param selfRef Whether child and parent are the same node type
 * @param unresolvedRefs Array to push broken/invalid link entries into
 * @param typeAliases Optional type aliases for resolution
 */
function resolveEdge(
  nodesByType: Map<string, SpaceNode[]>,
  targetIndex: Map<string, SpaceNode | null>,
  edge: EdgeDefinition,
  source: ResolvedParentRef['source'],
  selfRef: boolean,
  unresolvedRefs: UnresolvedRef[],
  typeAliases?: Record<string, string>,
): void {
  const { type: rawChildType, parent: rawParentType, field, fieldOn, multiple } = edge;

  const childType = resolveNodeType(rawChildType, typeAliases);
  const parentType = resolveNodeType(rawParentType, typeAliases);

  function pushParentRef(childNode: SpaceNode, parentTitle: string): void {
    // Deduplicate by (field, title) — same parent via different fields is intentional
    if (!childNode.resolvedParents.some((r) => r.field === field && r.title === parentTitle)) {
      childNode.resolvedParents.push({ title: parentTitle, field, fieldOn, source, selfRef });
    }
  }

  function checkShape(ownerNode: SpaceNode, rawField: unknown): boolean {
    if (multiple && !Array.isArray(rawField)) {
      unresolvedRefs.push({
        label: ownerNode.label,
        ref: String(rawField),
        field,
        reason: 'invalid_shape',
        message: `Field "${field}" must be an array of wikilinks, got ${typeof rawField}`,
      });
      return false;
    }
    if (!multiple && typeof rawField !== 'string') {
      unresolvedRefs.push({
        label: ownerNode.label,
        ref: String(rawField),
        field,
        reason: 'invalid_shape',
        message: `Field "${field}" must be a wikilink string, got ${typeof rawField}`,
      });
      return false;
    }
    return true;
  }

  function checkAndRecordRef(ownerNode: SpaceNode, ref: string): SpaceNode | null {
    const target = wikilinkToTarget(ref);
    const resolved = targetIndex.get(target);
    if (resolved === undefined) {
      unresolvedRefs.push({
        label: ownerNode.label,
        ref,
        field,
        reason: 'not_found',
        message: `Link target "${target}" in field "${field}" not found`,
      });
      return null;
    }
    if (resolved === null) {
      unresolvedRefs.push({
        label: ownerNode.label,
        ref,
        field,
        reason: 'ambiguous',
        message: `Link target "${target}" in field "${field}" is ambiguous (matches multiple nodes)`,
      });
      return null;
    }
    return resolved;
  }

  if (fieldOn === 'parent') {
    // Parent nodes have the field pointing to children; resolve permissively (any target type).
    // Type correctness is enforced by validateHierarchyStructure, not the resolver.
    for (const parentNode of nodesByType.get(parentType) ?? []) {
      const rawField = parentNode.schemaData[field];
      if (rawField === undefined || rawField === null) continue;
      if (!checkShape(parentNode, rawField)) continue;

      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const childNode = checkAndRecordRef(parentNode, ref);
        if (!childNode) continue;
        const parentTitle = parentNode.schemaData.title;
        if (typeof parentTitle !== 'string') continue;
        pushParentRef(childNode, parentTitle);
      }
    }
  } else {
    // Child nodes have the field pointing to parents; accept any resolved target
    for (const childNode of nodesByType.get(childType) ?? []) {
      const rawField = childNode.schemaData[field];
      if (rawField === undefined || rawField === null) continue;
      if (!checkShape(childNode, rawField)) continue;

      const refs = getRefs(rawField, multiple);
      for (const ref of refs) {
        const parentNode = checkAndRecordRef(childNode, ref);
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
 *
 * Returns unresolved refs (broken/invalid wikilinks) encountered during resolution.
 */
export function resolveGraphEdges(nodes: SpaceNode[], metadata: SchemaMetadata): UnresolvedRef[] {
  const levels = metadata.hierarchy?.levels ?? [];
  const relationships = metadata.relationships ?? [];
  const typeAliases = metadata.typeAliases;
  const unresolvedRefs: UnresolvedRef[] = [];

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
        unresolvedRefs,
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
        unresolvedRefs,
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
        unresolvedRefs,
        typeAliases,
      );
    }
  }

  // 2. Process additional relationships
  for (const rel of relationships) {
    const edge: EdgeDefinition = {
      type: rel.type,
      parent: rel.parent,
      field: rel.field,
      fieldOn: rel.fieldOn,
      multiple: rel.multiple,
    };
    resolveEdge(nodesByType, targetIndex, edge, 'relationship', rel.type === rel.parent, unresolvedRefs, typeAliases);
  }

  // Deduplicate by (label, field, ref) — the same broken link may be encountered across
  // multiple resolveEdge calls (e.g. selfRef + regular hierarchy share the same field).
  const seen = new Set<string>();
  const deduped: UnresolvedRef[] = [];
  for (const u of unresolvedRefs) {
    const key = `${u.label}\0${u.field}\0${u.ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(u);
    }
  }
  return deduped;
}
