import type { SpaceGraph } from '../../space-graph';
import type { SpaceNode } from '../../types';

function escapeMermaidString(str: string): string {
  return str.replace(/"/g, '&quot;');
}

function safeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function renderMermaid(graph: SpaceGraph): string {
  const { hierarchyRoots, orphans, hierarchyChildren: children, hierarchyTitles: hierarchyNodeSet } = graph;

  let mmd = 'graph TD\n';

  mmd += '  classDef vision fill:#ff9999,stroke:#ff0000,stroke-width:2px\n';
  mmd += '  classDef mission fill:#99ccff,stroke:#0066cc,stroke-width:2px\n';
  mmd += '  classDef goal fill:#99ff99,stroke:#00cc00,stroke-width:2px\n';
  mmd += '  classDef opportunity fill:#ffcc99,stroke:#cc9900,stroke-width:2px\n';
  mmd += '  classDef solution fill:#cc99ff,stroke:#6600cc,stroke-width:2px\n';

  mmd += '  classDef identified fill:#f0f0f0,stroke:#999999,stroke-dasharray: 5 5\n';
  mmd += '  classDef wondering fill:#fff0cc,stroke:#cccc00,stroke-dasharray: 5 5\n';
  mmd += '  classDef exploring fill:#ffcc99,stroke:#cc9900,stroke-dasharray: 5 5\n';
  mmd += '  classDef active fill:#99ff99,stroke:#00cc00,stroke-width:2px\n';
  mmd += '  classDef paused fill:#ffcc99,stroke:#cc9900,stroke-width:2px\n';
  mmd += '  classDef completed fill:#ccccff,stroke:#6666cc,stroke-width:2px\n';
  mmd += '  classDef archived fill:#e0e0e0,stroke:#999999,stroke-width:2px\n';

  const addedNodes = new Set<string>();

  function addNodeAndChildren(node: SpaceNode) {
    const nodeId = node.title;
    if (addedNodes.has(nodeId)) return;
    addedNodes.add(nodeId);

    const type = node.resolvedType;
    const status = node.schemaData.status as string;
    const priority = node.schemaData.priority as string | undefined;
    const label = priority ? `${nodeId} (${priority})` : nodeId;
    const className = `${type}_${status}`;

    const safeId = safeNodeId(nodeId);
    const escapedLabel = escapeMermaidString(label);

    mmd += `  ${safeId}["${escapedLabel}"]:::${className}\n`;

    const nodeChildren = children.get(nodeId) ?? [];
    for (const child of nodeChildren) {
      const childTitle = child.title;
      if (hierarchyNodeSet.has(childTitle)) {
        const safeChildId = safeNodeId(childTitle);
        mmd += `  ${safeId} --> ${safeChildId}\n`;
        addNodeAndChildren(child);
      }
    }
  }

  for (const root of hierarchyRoots) {
    addNodeAndChildren(root);
  }

  if (orphans.length > 0) {
    mmd += '\n  subgraph Orphans\n';
    for (const orphan of orphans) {
      addNodeAndChildren(orphan);
    }
    mmd += '  end\n';
  }

  return mmd;
}
