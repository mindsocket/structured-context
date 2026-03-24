import type { SpaceNode } from '../../types';
import type { RenderInput } from '../util';

export function renderBullets({ classification }: RenderInput): string {
  const { hierarchyRoots, orphans, nonHierarchy, children } = classification;
  const lines: string[] = [];
  const seen = new Set<string>();

  function renderNode(node: SpaceNode, depth: number) {
    const indent = '  '.repeat(depth);
    const type = node.schemaData.type as string;
    const title = node.schemaData.title as string;
    const nodeChildren = children.get(title) ?? [];

    if (seen.has(title)) {
      if (nodeChildren.length > 0) {
        lines.push(`${indent}- ${type}: ${title} (*)`);
      }
      return;
    }
    seen.add(title);
    lines.push(`${indent}- ${type}: ${title}`);
    for (const child of nodeChildren) {
      renderNode(child, depth + 1);
    }
  }

  for (const root of hierarchyRoots) {
    renderNode(root, 0);
  }

  if (orphans.length > 0) {
    lines.push('');
    lines.push('Orphans (missing parent):');
    for (const node of orphans) {
      renderNode(node, 0);
    }
  }

  if (nonHierarchy.length > 0) {
    lines.push('');
    lines.push('Other (not in hierarchy):');
    for (const node of nonHierarchy) {
      const type = node.schemaData.type as string;
      const title = node.schemaData.title as string;
      lines.push(`  - ${type}: ${title}`);
    }
  }

  return lines.join('\n');
}
