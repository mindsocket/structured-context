import { buildTargetIndex, wikilinkToTarget } from '../read/wikilink-utils';
import { resolveNodeType } from '../schema/schema';
import type { GraphViolation, SchemaMetadata, SpaceNode } from '../types';

export interface GraphValidationResult {
  violations: GraphViolation[];
  refErrors: Array<{ file: string; parent: string; error: string }>;
}

/**
 * Validate all hierarchy and relationship constraints including field references.
 * Use this when you have a linkTargetIndex available.
 *
 * @param nodes The nodes to validate
 * @param metadata Schema metadata containing hierarchy and relationships configuration
 * @returns Object containing hierarchy violations and reference errors
 */
export function validateGraph(nodes: SpaceNode[], metadata: SchemaMetadata): GraphValidationResult {
  const refErrors: Array<{ file: string; parent: string; error: string }> = [];
  const violations: GraphViolation[] = [];
  const levels = metadata.hierarchy?.levels ?? [];
  const relationships = metadata.relationships ?? [];
  const linkTargetIndex = buildTargetIndex(nodes);

  // 1. Validate field references for each hierarchy level
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    const parentLevel = levels[i - 1]!;

    // Case 1: Child has field pointing to parent
    if (level.fieldOn !== 'parent') {
      validateFieldReferences(
        nodes,
        linkTargetIndex,
        level.type,
        parentLevel.type,
        level.field,
        level.multiple,
        refErrors,
        violations,
        metadata.typeAliases,
      );
    }
    // Case 2: Parent has field pointing to child
    else {
      validateFieldReferences(
        nodes,
        linkTargetIndex,
        parentLevel.type,
        level.type,
        level.field,
        level.multiple,
        refErrors,
        violations,
        metadata.typeAliases,
      );
    }
  }

  // 2. Validate selfRefField references for each hierarchy level that has it
  for (const level of levels) {
    if (!level.selfRefField) continue;

    // selfRefField is always on child-side and its multiplicity is strictly false
    validateFieldReferences(
      nodes,
      linkTargetIndex,
      level.type,
      level.type,
      level.selfRefField,
      false,
      refErrors,
      violations,
      metadata.typeAliases,
    );
  }

  // 3. Validate field references for each relationship
  for (const rel of relationships) {
    const nodeTypeWithField = rel.fieldOn === 'parent' ? rel.parent : rel.type;
    const expectedTargetType = rel.fieldOn === 'parent' ? rel.type : rel.parent;
    const { field, multiple } = rel;

    validateFieldReferences(
      nodes,
      linkTargetIndex,
      nodeTypeWithField,
      expectedTargetType,
      field,
      multiple,
      refErrors,
      violations,
      metadata.typeAliases,
    );
  }

  // 4. Validate resolved parent structure rules
  const structureViolations = validateHierarchyStructure(nodes, metadata);
  violations.push(...structureViolations);

  return { violations, refErrors };
}

/**
 * Validate that link references in a field point to valid nodes of the expected type.
 * @param nodes The nodes to check
 * @param linkTargetIndex Map of link targets to nodes
 * @param nodeTypeWithField The type of nodes that have the field
 * @param expectedTargetType The expected type of the resolved node
 * @param field The field name to validate
 * @param multiple Whether the field contains an array of refs
 * @param refErrors Array to collect reference errors (not found, ambiguous)
 * @param violations Array to collect hierarchy/type violations
 * @param typeAliases Optional type aliases for resolution
 */
function validateFieldReferences(
  nodes: SpaceNode[],
  linkTargetIndex: Map<string, SpaceNode | null>,
  nodeTypeWithField: string,
  expectedTargetType: string,
  field: string,
  multiple: boolean,
  refErrors: Array<{ file: string; parent: string; error: string }>,
  violations: GraphViolation[],
  typeAliases?: Record<string, string>,
): void {
  const resolvedNodeTypeWithField = resolveNodeType(nodeTypeWithField, typeAliases);
  const resolvedExpectedTargetType = resolveNodeType(expectedTargetType, typeAliases);
  const nodesToCheck = nodes.filter((n) => n.resolvedType === resolvedNodeTypeWithField);

  for (const node of nodesToCheck) {
    const rawField = node.schemaData[field];
    if (rawField === undefined || rawField === null) continue;

    if (multiple) {
      if (!Array.isArray(rawField)) {
        refErrors.push({
          file: node.label,
          parent: String(rawField),
          error: `Field "${field}" must be an array of wikilinks, got ${typeof rawField}`,
        });
        continue;
      }
      for (const ref of rawField) {
        if (typeof ref !== 'string') continue;
        const target = wikilinkToTarget(ref);
        const resolved = linkTargetIndex.get(target);
        if (resolved === undefined) {
          refErrors.push({
            file: node.label,
            parent: ref,
            error: `Link target "${target}" in field "${field}" not found`,
          });
        } else if (resolved === null) {
          refErrors.push({
            file: node.label,
            parent: ref,
            error: `Link target "${target}" in field "${field}" is ambiguous (matches multiple nodes)`,
          });
        } else if (resolved.resolvedType !== resolvedExpectedTargetType) {
          violations.push({
            file: node.label,
            nodeType: resolvedNodeTypeWithField,
            nodeTitle: node.schemaData.title as string,
            parentType: resolved.resolvedType,
            parentTitle: resolved.schemaData.title as string,
            description: `Invalid relationship field: ${nodeTypeWithField} "${node.schemaData.title}" has "${resolved.schemaData.title}" in field "${field}" which is of type ${resolved.resolvedType}, expected ${expectedTargetType}`,
          });
        }
      }
    } else {
      if (typeof rawField !== 'string') {
        refErrors.push({
          file: node.label,
          parent: String(rawField),
          error: `Field "${field}" must be a wikilink string, got ${typeof rawField}`,
        });
        continue;
      }
      const target = wikilinkToTarget(rawField);
      const resolved = linkTargetIndex.get(target);
      if (resolved === undefined) {
        refErrors.push({
          file: node.label,
          parent: rawField,
          error: `Link target "${target}" in field "${field}" not found`,
        });
      } else if (resolved === null) {
        refErrors.push({
          file: node.label,
          parent: rawField,
          error: `Link target "${target}" in field "${field}" is ambiguous (matches multiple nodes)`,
        });
      } else if (resolved.resolvedType !== resolvedExpectedTargetType) {
        // Different description for child-side parent field for backward compatibility with test expectations
        const isParentField = field === 'parent' && node.resolvedType === resolvedNodeTypeWithField;
        const description = isParentField
          ? `Invalid relationship parent: ${nodeTypeWithField} "${node.schemaData.title}" points to "${resolved.schemaData.title}" which is of type ${resolved.resolvedType}, expected ${expectedTargetType}`
          : `Invalid relationship field: ${nodeTypeWithField} "${node.schemaData.title}" has "${resolved.schemaData.title}" in field "${field}" which is of type ${resolved.resolvedType}, expected ${expectedTargetType}`;

        violations.push({
          file: node.label,
          nodeType: resolvedNodeTypeWithField,
          nodeTitle: node.schemaData.title as string,
          parentType: resolved.resolvedType,
          parentTitle: resolved.schemaData.title as string,
          description,
        });
      }
    }
  }
}

/**
 * Validate that resolved parents follow hierarchy level rules or relationship definitions.
 */
export function validateHierarchyStructure(nodes: SpaceNode[], metadata: SchemaMetadata): GraphViolation[] {
  const violations: GraphViolation[] = [];
  const levels = metadata.hierarchy?.levels ?? [];
  const allowSkipLevels = metadata.hierarchy?.allowSkipLevels ?? false;
  const typeAliases = metadata.typeAliases;

  const hierarchy = levels.map((level) => resolveNodeType(level.type, typeAliases));

  const nodeIndex = new Map<string, SpaceNode>();
  for (const node of nodes) {
    const title = node.schemaData.title as string;
    if (title) {
      nodeIndex.set(title, node);
    }
  }

  for (const node of nodes) {
    const nodeType = node.resolvedType;
    const nodeTitle = node.schemaData.title as string;

    for (const parentRef of node.resolvedParents) {
      // Relationship-sourced parents are type-validated by validateFieldReferences; skip here
      if (parentRef.source === 'relationship') continue;

      const parentNode = nodeIndex.get(parentRef.title);
      if (!parentNode) continue;

      const parentType = parentNode.resolvedType;
      const parentTitle = parentRef.title;

      const typeIndex = hierarchy.indexOf(nodeType);
      const parentIndex = hierarchy.indexOf(parentType);

      let isValidHierarchy = false;
      if (typeIndex !== -1 && parentIndex !== -1) {
        const level = levels[typeIndex]!;
        const canSelfRef = level.selfRef || level.selfRefField !== undefined;

        if (parentIndex === typeIndex - 1) {
          isValidHierarchy = true;
        } else if (canSelfRef && parentIndex === typeIndex) {
          isValidHierarchy = true;
        } else if (allowSkipLevels && parentIndex < typeIndex) {
          isValidHierarchy = true;
        }
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

  return violations;
}
