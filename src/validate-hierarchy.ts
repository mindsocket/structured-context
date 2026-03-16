import type { HierarchyViolation, SchemaMetadata, SpaceNode } from './types';
import { buildTargetIndex, wikilinkToTarget } from './wikilink-utils';

export interface HierarchyValidationResult {
  violations: HierarchyViolation[];
  refErrors: Array<{ file: string; parent: string; error: string }>;
}

/**
 * Validate all hierarchy-related constraints including field references.
 * Use this when you have a linkTargetIndex available.
 *
 * @param nodes The nodes to validate
 * @param metadata Schema metadata containing hierarchy configuration
 * @param linkTargetIndex Map of link targets to nodes
 * @returns Object containing hierarchy violations and reference errors
 */
export function validateHierarchyWithFields(nodes: SpaceNode[], metadata: SchemaMetadata): HierarchyValidationResult {
  const refErrors: Array<{ file: string; parent: string; error: string }> = [];
  const levels = metadata.hierarchy?.levels ?? [];
  const linkTargetIndex = buildTargetIndex(nodes);

  // Validate regular field references for each hierarchy level
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    const parentLevel = levels[i - 1]!;

    // Determine which node type has the field
    const nodeTypeToCheck = level.fieldOn === 'parent' ? parentLevel.type : level.type;

    validateFieldReferences(nodes, linkTargetIndex, nodeTypeToCheck, level.field, level.multiple, refErrors);
  }

  // Validate selfRefField references for each hierarchy level that has it
  for (const level of levels) {
    if (!level.selfRefField) continue;

    // selfRefField is always on child-side and its multiplicity is strictly false
    validateFieldReferences(nodes, linkTargetIndex, level.type, level.selfRefField, false, refErrors);
  }

  // Validate hierarchy structure rules
  const violations = validateHierarchyStructure(nodes, metadata);

  return { violations, refErrors };
}

/**
 * Validate that adjacent relationship (sub-entity) link references in the `parent` field
 * point to valid nodes of the correct type.
 * Use this when you have a linkTargetIndex available.
 *
 * @param nodes The nodes to validate
 * @param metadata Schema metadata containing relationships configuration
 * @param linkTargetIndex Map of link targets to nodes
 * @returns Object containing hierarchy violations (for type errors) and reference errors
 */
export function validateRelationships(
  nodes: SpaceNode[],
  metadata: SchemaMetadata,
  linkTargetIndex?: Map<string, SpaceNode | null>,
): HierarchyValidationResult {
  const refErrors: Array<{ file: string; parent: string; error: string }> = [];
  const violations: HierarchyViolation[] = [];
  const relationships = metadata.relationships ?? [];

  if (relationships.length === 0) {
    return { violations, refErrors };
  }

  const index = linkTargetIndex ?? buildTargetIndex(nodes);

  for (const rel of relationships) {
    const parentType = rel.parent;
    const childType = rel.type;

    if (rel.fieldOn === 'parent') {
      // Parent-side: the parent node holds an array field pointing to child nodes
      if (!rel.field) continue;
      const field = rel.field;
      const parentNodes = nodes.filter((n) => n.resolvedType === parentType);
      for (const node of parentNodes) {
        const rawField = node.schemaData[field];
        if (rawField === undefined || rawField === null) continue;

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
          const resolved = index.get(target);
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
          } else if (resolved.resolvedType !== childType) {
            violations.push({
              file: node.label,
              nodeType: parentType,
              nodeTitle: node.schemaData.title as string,
              parentType: resolved.resolvedType,
              parentTitle: resolved.schemaData.title as string,
              description: `Invalid relationship field: ${parentType} "${node.schemaData.title}" has "${resolved.schemaData.title}" in field "${field}" which is of type ${resolved.resolvedType}, expected ${childType}`,
            });
          }
        }
      }
    } else {
      // Child-side (default): the child node holds a field pointing to its parent
      const field = rel.field ?? 'parent';
      const nodesToCheck = nodes.filter((n) => n.resolvedType === childType);
      for (const node of nodesToCheck) {
        const rawField = node.schemaData[field];
        if (rawField === undefined || rawField === null) continue;

        if (typeof rawField !== 'string') {
          refErrors.push({
            file: node.label,
            parent: String(rawField),
            error: `Field "${field}" must be a wikilink string, got ${typeof rawField}`,
          });
          continue;
        }

        const target = wikilinkToTarget(rawField);
        const resolved = index.get(target);

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
        } else if (resolved.resolvedType !== parentType) {
          violations.push({
            file: node.label,
            nodeType: childType,
            nodeTitle: node.schemaData.title as string,
            parentType: resolved.resolvedType,
            parentTitle: resolved.schemaData.title as string,
            description: `Invalid relationship parent: ${childType} "${node.schemaData.title}" points to "${resolved.schemaData.title}" which is of type ${resolved.resolvedType}, expected ${parentType}`,
          });
        }
      }
    }
  }

  return { violations, refErrors };
}

/**
 * Validate that link references in a field point to valid nodes.
 * @param nodes The nodes to check
 * @param linkTargetIndex Map of link targets to nodes
 * @param nodeType The type of nodes that have the field
 * @param field The field name to validate
 * @param multiple Whether the field contains an array of refs
 * @param refErrors Array to collect validation errors
 */
function validateFieldReferences(
  nodes: SpaceNode[],
  linkTargetIndex: Map<string, SpaceNode | null>,
  nodeType: string,
  field: string,
  multiple: boolean,
  refErrors: Array<{ file: string; parent: string; error: string }>,
): void {
  const nodesToCheck = nodes.filter((n) => n.resolvedType === nodeType);

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
      }
    }
  }
}

/**
 * Validate that resolved parents follow hierarchy level rules.
 */
export function validateHierarchyStructure(nodes: SpaceNode[], metadata: SchemaMetadata): HierarchyViolation[] {
  const violations: HierarchyViolation[] = [];
  const levels = metadata.hierarchy?.levels;
  if (!levels || levels.length === 0) return violations;
  const hierarchy = levels.map((level) => level.type);
  const allowSkipLevels = metadata.hierarchy?.allowSkipLevels ?? false;

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
    const typeIndex = hierarchy.indexOf(nodeType);
    if (typeIndex === -1) continue;

    for (const parentTitle of node.resolvedParents) {
      const parentNode = nodeIndex.get(parentTitle);
      if (!parentNode) continue;

      const parentType = parentNode.resolvedType;
      const parentIndex = hierarchy.indexOf(parentType);
      if (parentIndex === -1) continue;

      const canSelfRef = (levels[typeIndex]?.selfRef ?? false) || levels[typeIndex]?.selfRefField !== undefined;
      let isValid = parentIndex === typeIndex - 1;
      if (canSelfRef) isValid = isValid || parentIndex === typeIndex;
      if (allowSkipLevels && parentIndex < typeIndex) isValid = true;

      if (!isValid) {
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
