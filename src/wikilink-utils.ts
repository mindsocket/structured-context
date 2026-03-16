import type { SpaceNode } from './types';

/**
 * Extract the lookup key from a wikilink string such as:
 *   [[Personal Vision]]                → "Personal Vision"
 *   [[Personal Vision#Our Mission]]    → "Personal Vision#Our Mission"
 *   [[vision_page#^ourmission]]        → "vision_page#^ourmission"
 */
export function wikilinkToTarget(wikilink: string): string {
  const cleaned = wikilink.replace(/^"|"$/g, '').trim();
  if (!cleaned.startsWith('[[') || !cleaned.endsWith(']]')) {
    return cleaned;
  }
  return cleaned.slice(2, -2).trim();
}

/**
 * Builds a fast lookup index mapping link targets to nodes.
 * Used for both hierarchy and relationship validation.
 *
 * @param nodes The complete set of SpaceNodes
 * @returns Map of target strings to nodes. If a target is ambiguous (points to multiple nodes), its value is null.
 */
export function buildTargetIndex(nodes: SpaceNode[]): Map<string, SpaceNode | null> {
  const index = new Map<string, SpaceNode | null>();

  for (const node of nodes) {
    for (const target of node.linkTargets) {
      if (index.has(target)) {
        index.set(target, null); // mark as ambiguous
      } else {
        index.set(target, node);
      }
    }
  }

  return index;
}
