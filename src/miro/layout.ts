import type { OstNode } from '../types.js';

const TYPE_DEPTH: Record<string, number> = {
  vision: 0,
  mission: 1,
  goal: 2,
  opportunity: 3,
  solution: 4,
};

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
 * Compute positions for new cards only. Existing cards keep their Miro positions.
 * New cards are laid out in rows grouped by OST type depth, starting below
 * the lowest existing card (or at the origin if no existing cards).
 *
 * Returns positions and a bounding box covering all cards (for frame sizing).
 */
export function layoutNewCards(
  newNodes: OstNode[],
  existingPositions: Map<string, { x: number; y: number }>,
): LayoutResult {
  // Find the lowest y among existing cards
  let lowestY = 0;
  for (const pos of existingPositions.values()) {
    if (pos.y + CARD_HEIGHT / 2 > lowestY) {
      lowestY = pos.y + CARD_HEIGHT / 2;
    }
  }

  const startY = existingPositions.size > 0 ? lowestY + V_GAP * 2 : 0;

  // Group new nodes by depth
  const byDepth = new Map<number, OstNode[]>();
  for (const node of newNodes) {
    const depth = TYPE_DEPTH[node.data.type as string] ?? 4;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  let rowY = startY;
  for (const depth of depths) {
    const nodes = byDepth.get(depth)!;
    const totalWidth = nodes.length * CARD_WIDTH + (nodes.length - 1) * H_GAP;
    let x = -totalWidth / 2 + CARD_WIDTH / 2;

    for (const node of nodes) {
      const title = node.data.title as string;
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
    minX: Math.min(...allPositions.map(p => p.x - CARD_WIDTH / 2)) - FRAME_PADDING,
    minY: Math.min(...allPositions.map(p => p.y - CARD_HEIGHT / 2)) - FRAME_PADDING,
    maxX: Math.max(...allPositions.map(p => p.x + CARD_WIDTH / 2)) + FRAME_PADDING,
    maxY: Math.max(...allPositions.map(p => p.y + CARD_HEIGHT / 2)) + FRAME_PADDING,
  };

  return { positions, bounds };
}
