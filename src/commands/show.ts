import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, resolveSchema } from '../config';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';
import { loadMetadata } from '../schema';
import type { SpaceNode } from '../types';

export async function show(path: string) {
  const absolutePath = resolve(path);
  const config = loadConfig();
  const space = config.spaces.find((s) => resolve(s.path) === absolutePath);
  const resolvedSchemaPath = resolveSchema(undefined, config, space);
  const { hierarchy, levels } = loadMetadata(resolvedSchemaPath);

  const rootType = levels[0]?.type;
  const hierarchyTypes = new Set(hierarchy);

  let nodes: SpaceNode[];
  if (statSync(absolutePath).isFile()) {
    ({ nodes } = readSpaceOnAPage(absolutePath));
  } else {
    ({ nodes } = await readSpaceDirectory(absolutePath));
  }

  // Build children map (parent title → child nodes in document order)
  const children = new Map<string, SpaceNode[]>();
  for (const node of nodes) {
    children.set(node.schemaData.title as string, []);
  }

  // Categorize nodes and populate children map
  const hierarchyRoots: SpaceNode[] = [];
  const orphans: SpaceNode[] = [];
  const nonHierarchy: SpaceNode[] = [];

  for (const node of nodes) {
    const nodeType = node.resolvedType;

    if (!hierarchyTypes.has(nodeType)) {
      nonHierarchy.push(node);
      continue; // non-hierarchy nodes don't participate in the tree
    }

    if (node.resolvedParents.length === 0) {
      if (nodeType === rootType) {
        hierarchyRoots.push(node);
      } else {
        orphans.push(node);
      }
    } else {
      let addedToAParent = false;
      for (const parent of node.resolvedParents) {
        const siblings = children.get(parent);
        if (siblings) {
          siblings.push(node);
          addedToAParent = true;
        }
      }
      if (!addedToAParent) {
        // All parents dangling — treat as orphan
        orphans.push(node);
      }
    }
  }

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
