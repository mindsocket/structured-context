import type { Image, Link, Node, Parent, Root, Text } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parseWikilink } from '../../read/wikilink-utils';
import type { ContentLink, SchemaMetadata } from '../../types';

/**
 * Extract wikilinks (and Obsidian embed wikilinks) from a plain text string.
 * Matches [[target]], ![[target]], [[target#anchor]], [[target|alias]], etc.
 */
function extractWikilinksFromText(text: string): ContentLink[] {
  const links: ContentLink[] = [];

  for (const match of text.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) {
    const isEmbed = match[1] === '!';
    const inner = match[2]!;
    const { target, anchor, displayText } = parseWikilink(inner);
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
  for (const hierarchy of metadata.hierarchies ?? []) {
    for (const level of hierarchy.levels) {
      fields.add(level.field);
      if (level.selfRefField) fields.add(level.selfRefField);
    }
  }
  for (const rel of metadata.relationships ?? []) {
    fields.add(rel.field);
  }
  return fields;
}

/**
 * Extract links from frontmatter data fields, excluding known graph edge fields.
 * Parses each string value as markdown (via mdast) to keep link extraction consistent
 * with body content parsing — handles wikilinks, markdown links, images, and bare URLs.
 */
export function extractLinksFromFrontmatter(data: Record<string, unknown>, edgeFields: Set<string>): ContentLink[] {
  const links: ContentLink[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (edgeFields.has(key)) continue;
    if (typeof value === 'string') {
      links.push(...extractLinksFromBody(value));
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          links.push(...extractLinksFromBody(item));
        }
      }
    }
  }
  return links;
}
