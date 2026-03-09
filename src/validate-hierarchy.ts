import type { HierarchyViolation, SchemaMetadata, SpaceNode } from './types';

export function validateHierarchy(nodes: SpaceNode[], metadata: SchemaMetadata): HierarchyViolation[] {
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

      const canSelfRef = levels[typeIndex]?.selfRef ?? false;
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
