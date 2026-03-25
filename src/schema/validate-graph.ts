import { resolveNodeType } from '../schema/schema';
import type { GraphViolation, SchemaMetadata, SpaceNode, UnresolvedRef } from '../types';

export interface GraphValidationResult {
  violations: GraphViolation[];
  refErrors: Array<{ file: string; parent: string; error: string }>;
}

/**
 * Validate graph structure using pre-collected unresolved refs from resolveGraphEdges.
 * Assumes resolveGraphEdges has already been called to populate node.resolvedParents.
 */
export function validateGraph(
  nodes: SpaceNode[],
  metadata: SchemaMetadata,
  unresolvedRefs: UnresolvedRef[] = [],
): GraphValidationResult {
  const refErrors = unresolvedRefs.map((u) => ({ file: u.label, parent: u.ref, error: u.message }));
  const violations = validateHierarchyStructure(nodes, metadata);
  return { violations, refErrors };
}

/**
 * Validate that resolved parents follow hierarchy level rules and relationship type constraints.
 *
 * For hierarchy edges (fieldOn:'child', source:'hierarchy'): validates level ordering.
 * For relationship edges (fieldOn:'child', source:'relationship'): validates parent type.
 * For fieldOn:'parent' edges: validates child type, violation attributed to the field-owner node.
 *
 * Assumes resolveGraphEdges has already been called to populate node.resolvedParents.
 */
export function validateHierarchyStructure(nodes: SpaceNode[], metadata: SchemaMetadata): GraphViolation[] {
  const violations: GraphViolation[] = [];
  const levels = metadata.hierarchy?.levels ?? [];
  const relationships = metadata.relationships ?? [];
  const allowSkipLevels = metadata.hierarchy?.allowSkipLevels ?? false;
  const typeAliases = metadata.typeAliases;

  const hierarchy = levels.map((level) => resolveNodeType(level.type, typeAliases));

  // Build type rules: (ownerType, field) → set of valid target types.
  // For fieldOn:'child': owner=childType, target=parentType.
  // For fieldOn:'parent': owner=parentType (field owner), target=childType.
  const typeRules = new Map<string, Map<string, Set<string>>>();

  function addTypeRule(ownerType: string, field: string, targetType: string): void {
    const owner = resolveNodeType(ownerType, typeAliases);
    const target = resolveNodeType(targetType, typeAliases);
    if (!typeRules.has(owner)) typeRules.set(owner, new Map());
    const fieldMap = typeRules.get(owner)!;
    if (!fieldMap.has(field)) fieldMap.set(field, new Set());
    fieldMap.get(field)!.add(target);
  }

  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    const parentLevel = levels[i - 1]!;
    if (level.fieldOn === 'parent') {
      addTypeRule(parentLevel.type, level.field, level.type);
      if (level.selfRef) addTypeRule(level.type, level.field, level.type);
    } else {
      addTypeRule(level.type, level.field, parentLevel.type);
      if (level.selfRef) addTypeRule(level.type, level.field, level.type);
    }
  }

  for (const rel of relationships) {
    if (rel.fieldOn === 'parent') {
      addTypeRule(rel.parent, rel.field, rel.type);
    } else {
      addTypeRule(rel.type, rel.field, rel.parent);
    }
  }

  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.title;
    if (title) nodeIndex.set(title, node);
  }

  for (const node of nodes) {
    const nodeType = node.resolvedType;
    const nodeTitle = node.title;

    for (const parentRef of node.resolvedParents) {
      const parentNode = nodeIndex.get(parentRef.title);
      if (!parentNode) continue;

      const parentType = parentNode.resolvedType;
      const parentTitle = parentRef.title;

      if (parentRef.fieldOn === 'parent') {
        // Field is on the parent node; validate that this node's type matches the expected child type.
        // Violation is attributed to the field-owner (parent) node.
        const allowedChildTypes = typeRules.get(parentType)?.get(parentRef.field);
        if (allowedChildTypes && !allowedChildTypes.has(nodeType)) {
          const expected = [...allowedChildTypes].join(' or ');
          violations.push({
            file: parentNode.label,
            nodeType: parentType,
            nodeTitle: parentTitle,
            parentType: nodeType,
            parentTitle: nodeTitle,
            description: `Invalid relationship: ${parentType} "${parentTitle}" has "${nodeTitle}" in field "${parentRef.field}" which is of type ${nodeType}, expected ${expected}`,
          });
        }
      } else if (parentRef.source === 'relationship') {
        // Relationship edge (fieldOn:'child'): validate parent type matches relationship definition.
        const allowedTypes = typeRules.get(nodeType)?.get(parentRef.field);
        if (allowedTypes && !allowedTypes.has(parentType)) {
          const expected = [...allowedTypes].join(' or ');
          violations.push({
            file: node.label,
            nodeType,
            nodeTitle,
            parentType,
            parentTitle,
            description: `Invalid relationship: ${nodeType} "${nodeTitle}" has "${parentTitle}" in field "${parentRef.field}" which is of type ${parentType}, expected ${expected}`,
          });
        }
      } else {
        // Hierarchy edge (fieldOn:'child', source:'hierarchy'): validate level ordering.
        const typeIndex = hierarchy.indexOf(nodeType);
        const parentIndex = hierarchy.indexOf(parentType);

        if (typeIndex === -1 || parentIndex === -1) continue;

        const level = levels[typeIndex]!;
        const canSelfRef = level.selfRef || level.selfRefField !== undefined;

        let isValidHierarchy = false;
        if (parentIndex === typeIndex - 1) {
          isValidHierarchy = true;
        } else if (canSelfRef && parentIndex === typeIndex) {
          isValidHierarchy = true;
        } else if (allowSkipLevels && parentIndex < typeIndex) {
          isValidHierarchy = true;
        }

        if (!isValidHierarchy) {
          violations.push({
            file: node.label,
            nodeType,
            nodeTitle,
            parentType,
            parentTitle,
            description: `Invalid parent: ${nodeType} "${nodeTitle}" cannot have ${parentType} "${parentTitle}" as parent`,
          });
        }
      }
    }
  }

  return violations;
}
