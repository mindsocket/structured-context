import type { BaseNode } from '../types';

export interface ParsedWikilink {
  target: string;
  anchor?: string;
  displayText?: string;
}

/**
 * Format a wikilink string.
 * formatWikilink('My Goal') -> '[[My Goal]]'
 * formatWikilink('My Goal', 'Custom Display') -> '[[My Goal|Custom Display]]'
 */
export function formatWikilink(target: string, alias?: string): string {
  const trimmedTarget = target.trim();
  const trimmedAlias = alias?.trim();
  if (trimmedAlias && trimmedAlias !== trimmedTarget) {
    return `[[${trimmedTarget}|${trimmedAlias}]]`;
  }
  return `[[${trimmedTarget}]]`;
}

/**
 * Parse a wikilink or link inner string into target, anchor, and displayText.
 * Handles: [[target]], [[target#anchor]], [[target|alias]], [[target#anchor|alias]]
 * Also handles bare forms without enclosing brackets.
 */
export function parseWikilink(wikilink: string): ParsedWikilink {
  const cleaned = wikilink.replace(/^"|"$/g, '').trim();
  const inner = cleaned.startsWith('[[') && cleaned.endsWith(']]') ? cleaned.slice(2, -2).trim() : cleaned;

  // Alias: [[target|alias]] or [[target#anchor|alias]]
  const pipeIdx = inner.indexOf('|');
  let core = inner;
  let displayText: string | undefined;
  if (pipeIdx >= 0) {
    core = inner.slice(0, pipeIdx);
    const alias = inner.slice(pipeIdx + 1).trim();
    if (alias) displayText = alias;
  }

  // Anchor: [[target#anchor]] or [[target#^block]]
  const hashIdx = core.indexOf('#');
  if (hashIdx >= 0) {
    const target = core.slice(0, hashIdx).trim();
    const anchor = core.slice(hashIdx + 1).trim() || undefined;
    return { target, anchor, displayText };
  }

  return { target: core.trim(), displayText };
}

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
 * @param nodes The complete set of nodes (BaseNode, SpaceNode, or subtypes)
 * @returns Map of target strings to nodes. If a target is ambiguous (points to multiple nodes), its value is null.
 */
export function buildTargetIndex<T extends BaseNode>(nodes: T[]): Map<string, T | null> {
  const index = new Map<string, T | null>();

  for (const node of nodes) {
    for (const target of node.linkTargets) {
      const normalized = target.trim();
      if (!normalized) continue; // Skip empty strings after trimming

      const existing = index.get(normalized);
      if (existing === undefined) {
        index.set(normalized, node);
      } else if (existing !== node) {
        index.set(normalized, null); // mark as ambiguous
      }
    }
  }

  return index;
}
