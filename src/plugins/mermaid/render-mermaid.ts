import type { SpaceGraph } from '../../space-graph';
import type { SpaceNode } from '../../types';

const LEVEL_PALETTE = [
  { fill: '#ff9999', stroke: '#ff0000' },
  { fill: '#99ccff', stroke: '#0066cc' },
  { fill: '#99ff99', stroke: '#00cc00' },
  { fill: '#ffcc99', stroke: '#cc9900' },
  { fill: '#cc99ff', stroke: '#6600cc' },
  { fill: '#ff99cc', stroke: '#cc0066' },
  { fill: '#99ffff', stroke: '#009999' },
  { fill: '#ffff99', stroke: '#cccc00' },
];

function escapeMermaidString(str: string): string {
  return str.replace(/"/g, '&quot;');
}

function safeNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function renderMermaid(graph: SpaceGraph): string {
  const { hierarchyRoots, orphans, hierarchyChildren: children, hierarchyTitles: hierarchyNodeSet, levels } = graph;

  let mmd = 'graph TD\n';

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;
    const color = LEVEL_PALETTE[i % LEVEL_PALETTE.length]!;
    mmd += `  classDef ${level.type} fill:${color.fill},stroke:${color.stroke},stroke-width:2px\n`;
  }

  const addedNodes = new Set<string>();

  function addNodeAndChildren(node: SpaceNode) {
    const nodeId = node.title;
    if (addedNodes.has(nodeId)) return;
    addedNodes.add(nodeId);

    const type = node.resolvedType;
    const priority = node.schemaData.priority as string | undefined;
    const label = priority ? `${nodeId} (${priority})` : nodeId;

    const safeId = safeNodeId(nodeId);
    const escapedLabel = escapeMermaidString(label);

    mmd += `  ${safeId}["${escapedLabel}"]:::${type}\n`;

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
