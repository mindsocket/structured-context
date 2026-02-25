import { readFileSync, writeFileSync } from 'fs';
import Ajv from 'ajv';
import { readSpace } from './read-space.js';

interface DiagramNode {
  id: string;
  type: string;
  status: string;
  parent?: string;
  priority?: string;
}

// Parse [[wikilink]] to just the text inside
function parseWikilink(wikilink: string): string {
  const match = wikilink.match(/^\[\[(.+)\]\]$/);
  return match ? match[1]! : wikilink;
}

export async function diagram(directory: string, options: { schema?: string; output?: string }) {
  const schemaPath = options.schema || 'schema.json';
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv();
  const validateFunc = ajv.compile(schema);

  const { nodes: spaceNodes, skipped, nonOst } = await readSpace(directory);
  const nodes: DiagramNode[] = [];
  const invalid: string[] = [];

  for (const node of spaceNodes) {
    const valid = validateFunc(node.data);
    if (!valid) {
      invalid.push(node.label);
      continue;
    }

    const parent = node.data.parent
      ? parseWikilink(node.data.parent as string)
      : undefined;

    nodes.push({
      id: node.data.title as string,
      type: node.data.type as string,
      status: node.data.status as string,
      parent,
      priority: node.data.priority as string | undefined,
    });
  }

  // Build parent-child relationships
  const parentMap = new Map<string, DiagramNode[]>();
  const nodeMap = new Map<string, DiagramNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    if (node.parent) {
      if (!parentMap.has(node.parent)) {
        parentMap.set(node.parent, []);
      }
      parentMap.get(node.parent)!.push(node);
    }
  }

  // Generate mermaid diagram
  let mmd = 'graph TD\n';

  // Find roots (no parent) and orphans
  const roots = nodes.filter(n => !n.parent);
  const orphans = roots.filter(n => n.type !== 'vision');

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
  if (nonOst.length > 0) {
    console.error(`   Non-OST (no type field): ${nonOst.length}`);
  }
  if (invalid.length > 0) {
    console.error(`   Invalid (skipped): ${invalid.length}`);
    invalid.forEach(f => console.error(`      ${f}`));
  }
}
