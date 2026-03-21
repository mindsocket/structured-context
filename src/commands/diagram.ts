import { writeFileSync } from 'node:fs';
import { readSpace } from '../read/read-space';
import { loadSchema } from '../schema/schema';
import type { SpaceNode } from '../types';
import { buildHierarchyNodeSet, classifyNodes } from '../util/graph-helpers';

/**
 * Escape strings for Mermaid diagram labels.
 * Replaces quotes with &quot; to prevent parsing errors.
 */
function escapeMermaidString(str: string): string {
  return str.replace(/"/g, '&quot;');
}

/**
 * Create a safe node ID for Mermaid diagrams.
 * Replaces special characters with underscores to prevent parsing errors.
 */
function safeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function diagram(path: string, options: { schema: string; output?: string }): Promise<void> {
  const { schema, validator } = loadSchema(options.schema);
  const hierarchyLevels = schema.metadata.hierarchy?.levels ?? [];

  const readResult = await readSpace(path, { schemaPath: options.schema });
  const spaceNodes: SpaceNode[] = readResult.nodes;
  const skipped = (readResult.diagnostics?.skipped as string[]) ?? [];
  const nonSpace = (readResult.diagnostics?.nonSpace as string[]) ?? [];

  // Validate nodes
  const validNodes: SpaceNode[] = [];
  const invalid: string[] = [];

  for (const node of spaceNodes) {
    const valid = validator(node.schemaData);
    if (!valid) {
      invalid.push(node.label);
      continue;
    }
    validNodes.push(node);
  }

  // Classify nodes using the new graph-helpers function
  const classification = classifyNodes(validNodes, hierarchyLevels);
  const { hierarchyRoots, orphans, nonHierarchy, children } = classification;

  // Build lookup for all hierarchy nodes (roots + orphans + descendants)
  const hierarchyNodeSet = buildHierarchyNodeSet(classification);

  // Generate mermaid diagram
  let mmd = 'graph TD\n';

  // Add styling
  mmd += '  classDef vision fill:#ff9999,stroke:#ff0000,stroke-width:2px\n';
  mmd += '  classDef mission fill:#99ccff,stroke:#0066cc,stroke-width:2px\n';
  mmd += '  classDef goal fill:#99ff99,stroke:#00cc00,stroke-width:2px\n';
  mmd += '  classDef opportunity fill:#ffcc99,stroke:#cc9900,stroke-width:2px\n';
  mmd += '  classDef solution fill:#cc99ff,stroke:#6600cc,stroke-width:2px\n';

  // Define styles for each status
  mmd += '  classDef identified fill:#f0f0f0,stroke:#999999,stroke-dasharray: 5 5\n';
  mmd += '  classDef wondering fill:#fff0cc,stroke:#cccc00,stroke-dasharray: 5 5\n';
  mmd += '  classDef exploring fill:#ffcc99,stroke:#cc9900,stroke-dasharray: 5 5\n';
  mmd += '  classDef active fill:#99ff99,stroke:#00cc00,stroke-width:2px\n';
  mmd += '  classDef paused fill:#ffcc99,stroke:#cc9900,stroke-width:2px\n';
  mmd += '  classDef completed fill:#ccccff,stroke:#6666cc,stroke-width:2px\n';
  mmd += '  classDef archived fill:#e0e0e0,stroke:#999999,stroke-width:2px\n';

  // Add all hierarchy nodes (roots, orphans, and their children)
  const addedNodes = new Set<string>();

  function addNodeAndChildren(node: SpaceNode) {
    const nodeId = node.schemaData.title as string;
    if (addedNodes.has(nodeId)) return;
    addedNodes.add(nodeId);

    const type = node.schemaData.type as string;
    const status = node.schemaData.status as string;
    const priority = node.schemaData.priority as string | undefined;
    const label = priority ? `${nodeId} (${priority})` : nodeId;
    const className = `${type}_${status}`;

    // Use safe node ID for Mermaid syntax (left side - no quotes)
    const safeId = safeNodeId(nodeId);
    // Escape special characters in label (right side - with quotes)
    const escapedLabel = escapeMermaidString(label);

    mmd += `  ${safeId}["${escapedLabel}"]:::${className}\n`;

    // Add edges to children using the children map
    const nodeChildren = children.get(nodeId) ?? [];
    for (const child of nodeChildren) {
      // Only add edges to hierarchy nodes
      if (hierarchyNodeSet.has(child.schemaData.title as string)) {
        const childId = child.schemaData.title as string;
        const safeChildId = safeNodeId(childId);
        mmd += `  ${safeId} --> ${safeChildId}\n`;
        addNodeAndChildren(child);
      }
    }
  }

  // Add hierarchy roots
  for (const root of hierarchyRoots) {
    addNodeAndChildren(root);
  }

  // Add orphans as a subgraph
  if (orphans.length > 0) {
    mmd += '\n  subgraph Orphans\n';
    for (const orphan of orphans) {
      addNodeAndChildren(orphan);
    }
    mmd += '  end\n';
  }

  // Output
  if (options.output) {
    writeFileSync(options.output, mmd);
    console.log(`✅ Mermaid diagram written to ${options.output}`);
  } else {
    console.log(mmd);
  }

  // Report stats
  console.error(`\n📊 Diagram Stats:`);
  console.error(`   Total hierarchy nodes: ${hierarchyRoots.length + orphans.length}`);
  console.error(`   Hierarchy roots: ${hierarchyRoots.length}`);
  console.error(`   Orphan nodes: ${orphans.length}`);
  console.error(`   Non-hierarchy nodes (not rendered): ${nonHierarchy.length}`);
  console.error(`   Skipped: ${skipped.length}`);
  if (nonSpace.length > 0) {
    console.error(`   Non-space (no type field): ${nonSpace.length}`);
  }
  if (invalid.length > 0) {
    console.error(`   Invalid (skipped): ${invalid.length}`);
    for (const f of invalid) console.error(`      ${f}`);
  }
}
