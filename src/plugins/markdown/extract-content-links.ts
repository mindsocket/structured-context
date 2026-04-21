import type { Image, Link, Node, Parent, Root, Text } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { ContentLink, SchemaMetadata } from '../../types';

/**
 * Parse an Obsidian wikilink inner string into its components.
 * Handles: [[target]], [[target#anchor]], [[target|alias]], [[target#anchor|alias]]
 */
function parseWikilinkInner(inner: string): { target: string; anchor?: string; displayText?: string } {
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
 * Extract wikilinks (and Obsidian embed wikilinks) from a plain text string.
 * Matches [[target]], ![[target]], [[target#anchor]], [[target|alias]], etc.
 */
function extractWikilinksFromText(text: string): ContentLink[] {
  const links: ContentLink[] = [];

  for (const match of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
    const isEmbed = match[1] === '!';
    const inner = match[2]!;
    const { target, anchor, displayText } = parseWikilinkInner(inner);
    if (!target) continue;

    links.push({
      text: displayText ?? target,
      target,
      action: isEmbed ? 'embed' : 'link',
      ...(anchor !== undefined ? { anchor } : {}),
      linkSyntax: 'wikilink',
    });
  }

  return links;
}

/**
 * Extract bare URLs (http/https) from a plain text string.
 * Skips URLs that are already inside a markdown link `[text](url)` to avoid duplication.
 */
function extractBareUrlsFromText(text: string): ContentLink[] {
  const links: ContentLink[] = [];
  // Negative lookbehind: skip URLs immediately preceded by `](` (already a markdown link target)
  for (const match of text.matchAll(/(?<!\]\()https?:\/\/[^\s\])"<>]+/g)) {
    links.push({ text: match[0], target: match[0], action: 'link', linkSyntax: 'markdown' });
  }
  return links;
}

/**
 * Extract standard markdown links and images from a plain text string.
 * Used for scanning frontmatter string values.
 */
function extractMarkdownLinksFromText(text: string): ContentLink[] {
  const links: ContentLink[] = [];

  for (const match of text.matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)) {
    const isEmbed = match[1] === '!';
    const linkText = match[2]!;
    const url = match[3]!.trim();
    if (!url) continue;

    links.push({
      text: linkText,
      target: url,
      action: isEmbed ? 'embed' : 'link',
      linkSyntax: 'markdown',
    });
  }

  return links;
}

/**
 * Extract all links (wikilinks, markdown links, and bare URLs) from a plain text string.
 * Used for scanning frontmatter string field values.
 */
export function extractLinksFromText(text: string): ContentLink[] {
  return [...extractWikilinksFromText(text), ...extractMarkdownLinksFromText(text), ...extractBareUrlsFromText(text)];
}

/**
 * Recursively walk an mdast subtree and collect all links.
 * Handles standard markdown link/image nodes and scans text nodes for wikilinks.
 */
export function extractLinksFromAstNode(node: Node): ContentLink[] {
  const links: ContentLink[] = [];

  function walk(n: Node): void {
    switch (n.type) {
      case 'link': {
        const linkNode = n as Link;
        links.push({
          text: mdastToString(linkNode),
          target: linkNode.url,
          action: 'link',
          linkSyntax: 'markdown',
        });
        // Don't recurse into children — they are display text, not link targets
        break;
      }
      case 'image': {
        const imgNode = n as Image;
        links.push({
          text: imgNode.alt ?? '',
          target: imgNode.url,
          action: 'embed',
          linkSyntax: 'markdown',
        });
        break;
      }
      case 'text': {
        // Remark does not parse wikilinks natively; scan text nodes for [[...]] patterns
        links.push(...extractWikilinksFromText((n as Text).value));
        break;
      }
      default: {
        if ('children' in n) {
          for (const child of (n as Parent).children) {
            walk(child);
          }
        }
        break;
      }
    }
  }

  walk(node);
  return links;
}

/**
 * Extract all links from a raw markdown body string.
 * Parses the full document and collects links from every node in the tree.
 */
export function extractLinksFromBody(body: string): ContentLink[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root;
  return extractLinksFromAstNode(tree);
}

/**
 * Build the set of field names that serve as graph edges (hierarchy + relationship fields).
 * Used to exclude edge fields from frontmatter link extraction.
 */
export function getEdgeFieldNames(metadata: SchemaMetadata): Set<string> {
  const fields = new Set<string>();
  for (const level of metadata.hierarchy?.levels ?? []) {
    fields.add(level.field);
    if (level.selfRefField) fields.add(level.selfRefField);
  }
  for (const rel of metadata.relationships ?? []) {
    fields.add(rel.field);
  }
  return fields;
}

/**
 * Extract links from frontmatter data fields, excluding known graph edge fields.
 * Scans string values and string array elements for both wikilinks and markdown links.
 */
export function extractLinksFromFrontmatter(data: Record<string, unknown>, edgeFields: Set<string>): ContentLink[] {
  const links: ContentLink[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (edgeFields.has(key)) continue;
    if (typeof value === 'string') {
      links.push(...extractLinksFromText(value));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          links.push(...extractLinksFromText(item));
        }
      }
    }
  }
  return links;
}
