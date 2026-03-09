import type { HierarchyLevel, SpaceNode } from './types';

function addTarget(index: Map<string, SpaceNode | null>, target: string, node: SpaceNode): void {
  const normalized = target.trim();
  if (!normalized) return;

  const existing = index.get(normalized);
  if (existing === undefined) {
    index.set(normalized, node);
    return;
  }

  if (existing !== node) {
    index.set(normalized, null);
  }
}

export function buildTargetIndex(nodes: SpaceNode[]): Map<string, SpaceNode | null> {
  const index = new Map<string, SpaceNode | null>();
  for (const node of nodes) {
    for (const target of node.linkTargets) {
      addTarget(index, target, node);
    }
  }
  return index;
}

/**
 * Extract the lookup key from a wikilink string such as:
 *   [[Personal Vision]]                → "Personal Vision"
 *   [[Personal Vision#Our Mission]]    → "Personal Vision#Our Mission"
 *   [[vision_page#^ourmission]]        → "vision_page#^ourmission"
 */
export function wikilinkToTarget(wikilink: string): string {
  const cleaned = wikilink.replace(/^"|"$/g, '').trim();
  if (!cleaned.startsWith('[[') || !cleaned.endsWith(']]')) {
    return cleaned;
  }
  return cleaned.slice(2, -2).trim();
}

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
 * Resolve parent links using the levels configuration from schema metadata.
 * Supports DAG relationships via configurable edge fields per hierarchy level.
 */
export function resolveLinks(nodes: SpaceNode[], levels: HierarchyLevel[]): void {
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

    if (level.fieldOn === 'parent') {
      // Parent nodes have the field pointing to children
      // Iterate parent-type nodes
      for (const parentNode of nodesByType.get(parentLevel.type) ?? []) {
        const rawField = parentNode.schemaData[level.field];
        const refs = getRefs(rawField, level.multiple);
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
      // Iterate child-type nodes
      for (const childNode of nodesByType.get(level.type) ?? []) {
        const rawField = childNode.schemaData[level.field];
        const refs = getRefs(rawField, level.multiple);
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
}
