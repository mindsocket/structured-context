import { statSync, writeFileSync } from 'node:fs';
import { readSpaceDirectory } from '../read-space-directory';
import { readSpaceOnAPage } from '../read-space-on-a-page';
import { createValidator } from '../schema';
import type { SpaceNode } from '../types';

interface DiagramNode {
  id: string;
  type: string;
  status: string;
  parent?: string;
  priority?: string;
}

export async function diagram(path: string, options: { schema: string; output?: string; templateDir?: string }): Promise<void> {
  const validateFunc = createValidator(options.schema);

  let spaceNodes: SpaceNode[];
  let skipped: string[] = [];
  let nonSpace: string[] = [];

  if (statSync(path).isFile()) {
    ({ nodes: spaceNodes } = readSpaceOnAPage(path, options.schema));
  } else {
    ({ nodes: spaceNodes, skipped, nonSpace } = await readSpaceDirectory(path, {
      schemaPath: options.schema,
      templateDir: options.templateDir,
    }));
  }
  const nodes: DiagramNode[] = [];
  const invalid: string[] = [];

  for (const node of spaceNodes) {
    const valid = validateFunc(node.schemaData);
    if (!valid) {
      invalid.push(node.label);
      continue;
    }

    const parent = node.resolvedParent;

    nodes.push({
      id: node.schemaData.title as string,
      type: node.schemaData.type as string,
      status: node.schemaData.status as string,
      parent,
      priority: node.schemaData.priority as string | undefined,
    });
  }

  // Build node lookup for edge validation
  const nodeMap = new Map<string, DiagramNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Generate mermaid diagram
  let mmd = 'graph TD\n';

  // Find roots (no parent) and orphans
  const roots = nodes.filter((n) => !n.parent);
  const orphans = roots.filter((n) => n.type !== 'vision');

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

  // Add nodes
  for (const node of nodes) {
    const label = node.priority ? `${node.id} (${node.priority})` : node.id;
    const className = `${node.type}_${node.status}`;
    mmd += `  "${node.id}"["${label}"]:::${className}\n`;
  }

  // Add edges
  for (const node of nodes) {
    if (node.parent && nodeMap.has(node.parent)) {
      mmd += `  "${node.parent}" --> "${node.id}"\n`;
    }
  }

  // Add orphans as a subgraph
  if (orphans.length > 0) {
    mmd += '\n  subgraph Orphans [Orphan nodes (no parent)]\n';
    for (const orphan of orphans) {
      mmd += `    "${orphan.id}"\n`;
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
  console.error(`   Total nodes: ${nodes.length}`);
  console.error(`   Orphan nodes: ${orphans.length}`);
  console.error(`   Skipped: ${skipped.length}`);
  if (nonSpace.length > 0) {
    console.error(`   Non-space (no type field): ${nonSpace.length}`);
  }
  if (invalid.length > 0) {
    console.error(`   Invalid (skipped): ${invalid.length}`);
    for (const f of invalid) console.error(`      ${f}`);
  }
}
