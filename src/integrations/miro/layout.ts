import type { HierarchyLevel, SpaceNode } from '../../types';

export const CARD_WIDTH = 320;
const CARD_HEIGHT = 160;
const H_GAP = 40;
const V_GAP = 60;
const FRAME_PADDING = 60;

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  /** Bounding box of all cards (new + existing) — useful for sizing the containing frame. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * DEPRECATED - likely not needed after migration to render plugin and SpaceGraph
 * Build a depth map from hierarchy levels.
 * The position in the hierarchy array determines the depth.
 */
function buildDepthMap(hierarchyLevels: HierarchyLevel[]): Map<string, number> {
  const depthMap = new Map<string, number>();
  for (const [i, level] of hierarchyLevels.entries()) {
    depthMap.set(level.type, i);
  }
  return depthMap;
}

/**
 * Compute positions for new cards only. Existing cards keep their Miro positions.
 * New cards are laid out in rows grouped by OST type depth, starting below
 * the lowest existing card (or at the origin if no existing cards).
 *
 * @param hierarchyLevels - Hierarchy levels from metadata. Depths are computed from level position.
 *
 * Returns positions and a bounding box covering all cards (for frame sizing).
 */
export function layoutNewCards(
  newNodes: SpaceNode[],
  existingPositions: Map<string, { x: number; y: number }>,
  hierarchyLevels: HierarchyLevel[],
): LayoutResult {
  // Build depth map from hierarchy levels (position in hierarchy = depth)
  const depthMap = buildDepthMap(hierarchyLevels);

  // Find the lowest y among existing cards
  let lowestY = 0;
  for (const pos of existingPositions.values()) {
    if (pos.y + CARD_HEIGHT / 2 > lowestY) {
      lowestY = pos.y + CARD_HEIGHT / 2;
    }
  }

  const startY = existingPositions.size > 0 ? lowestY + V_GAP * 2 : 0;

  // Group new nodes by depth
  const byDepth = new Map<number, SpaceNode[]>();
  for (const node of newNodes) {
    const depth = depthMap.get(node.schemaData.type as string) ?? depthMap.size;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)?.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  let rowY = startY;
  for (const depth of depths) {
    const nodes = byDepth.get(depth)!;
    const totalWidth = nodes.length * CARD_WIDTH + (nodes.length - 1) * H_GAP;
    let x = -totalWidth / 2 + CARD_WIDTH / 2;

    for (const node of nodes) {
      const title = node.title;
      positions.set(title, { x, y: rowY });
      x += CARD_WIDTH + H_GAP;
    }

    rowY += CARD_HEIGHT + V_GAP;
  }

  // Compute bounding box across all card positions (existing + new)
  const allPositions = [...existingPositions.values(), ...positions.values()];
  if (allPositions.length === 0) {
    return { positions, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  const bounds = {
    minX: Math.min(...allPositions.map((p) => p.x - CARD_WIDTH / 2)) - FRAME_PADDING,
    minY: Math.min(...allPositions.map((p) => p.y - CARD_HEIGHT / 2)) - FRAME_PADDING,
    maxX: Math.max(...allPositions.map((p) => p.x + CARD_WIDTH / 2)) + FRAME_PADDING,
    maxY: Math.max(...allPositions.map((p) => p.y + CARD_HEIGHT / 2)) + FRAME_PADDING,
  };

  return { positions, bounds };
}
