import type { HierarchyLevel, SpaceNode } from '../../types';

// Color palette for hierarchy levels (distinct, visually appealing colors)
const COLOR_PALETTE = [
  '#ff9999', // Light red
  '#99ccff', // Light blue
  '#99ff99', // Light green
  '#ffcc99', // Light orange
  '#cc99ff', // Light purple
  '#ffccff', // Light pink
  '#ccffcc', // Pale mint
  '#ffffcc', // Light yellow
  '#ccccff', // Light indigo
  '#ffcccc', // Pale red
];

const STATUS_ICONS: Record<string, string> = {
  active: '*',
  identified: '?',
  wondering: '~',
  exploring: '...',
  paused: '||',
  completed: 'ok',
  archived: 'x',
};

/**
 * Get card color based on type and hierarchy levels.
 * Colors are assigned from palette based on level position.
 *
 * @param type - The node's type string
 * @param hierarchyLevels - Hierarchy levels from metadata
 */
export function getCardColor(type: string, hierarchyLevels: HierarchyLevel[]): string {
  // Find the level index for this type
  const levelIndex = hierarchyLevels.findIndex((level) => level.type === type);
  if (levelIndex >= 0) {
    // Assign color from palette based on level position
    const color = COLOR_PALETTE[levelIndex % COLOR_PALETTE.length];
    if (color) return color;
  }

  // Type not found in hierarchy - return default gray
  return '#e0e0e0';
}

export function buildCardTitle(node: SpaceNode): string {
  const title = node.title;
  const status = node.schemaData.status as string | undefined;
  const priority = node.schemaData.priority as string | undefined;

  const icon = status ? (STATUS_ICONS[status] ?? status) : '';
  const prefix = icon ? `[${icon}] ` : '';
  const suffix = priority ? ` (${priority})` : '';

  return `${prefix}${title}${suffix}`;
}

export function buildCardDescription(node: SpaceNode): string {
  const parts: string[] = [];

  const type = node.schemaData.type as string;
  const status = node.schemaData.status as string | undefined;
  parts.push(`Type: ${type}`);
  if (status) parts.push(`Status: ${status}`);

  const summary = node.schemaData.summary as string | undefined;
  if (summary) parts.push(`\n${summary}`);

  const content = node.schemaData.content as string | undefined;
  if (content) parts.push(`\n${content}`);

  return parts.join('\n');
}
