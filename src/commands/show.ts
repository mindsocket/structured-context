import { filterNodes } from '../filter/filter-nodes';
import { readSpace } from '../read/read-space';
import type { SpaceContext, SpaceNode } from '../types';
import { classifyNodes } from '../util/graph-helpers';

export async function show(context: SpaceContext, options?: { filter?: string }) {
  const levels = context.schema.metadata.hierarchy?.levels ?? [];

  let { nodes } = await readSpace(context);

  if (options?.filter) {
    const expression = context.space.views?.[options.filter]?.expression ?? options.filter;
    nodes = await filterNodes(expression, nodes);
  }

  const { hierarchyRoots, orphans, nonHierarchy, children } = classifyNodes(nodes, levels);

  const seen = new Set<string>();

  function printNode(node: SpaceNode, depth: number) {
    const indent = '  '.repeat(depth);
    const type = node.schemaData.type as string;
    const title = node.schemaData.title as string;
    const nodeChildren = children.get(title) ?? [];

    if (seen.has(title)) {
      // Only mark (*) when there's a subtree being skipped — no marker if no children
      if (nodeChildren.length > 0) {
        console.log(`${indent}- ${type}: ${title} (*)`);
      }
      return;
    }
    seen.add(title);
    console.log(`${indent}- ${type}: ${title}`);
    for (const child of nodeChildren) {
      printNode(child, depth + 1);
    }
  }

  // Main hierarchy tree
  for (const root of hierarchyRoots) {
    printNode(root, 0);
  }

  // Orphans: in hierarchy but no parent
  if (orphans.length > 0) {
    console.log('\nOrphans (missing parent):');
    for (const node of orphans) {
      printNode(node, 0);
    }
  }

  // Non-hierarchy types: flat list at the end
  if (nonHierarchy.length > 0) {
    console.log('\nOther (not in hierarchy):');
    for (const node of nonHierarchy) {
      const type = node.schemaData.type as string;
      const title = node.schemaData.title as string;
      console.log(`  - ${type}: ${title}`);
    }
  }
}
