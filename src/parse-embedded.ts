import { load as yamlLoad } from 'js-yaml';
import type { Code, Heading, List, ListItem, Paragraph, Root } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { OstNode, OstPageDiagnostics } from './types.js';

export const OST_TYPES = ['vision', 'mission', 'goal', 'opportunity', 'solution'] as const;
export type OstType = (typeof OST_TYPES)[number];

export const DEFAULT_STATUS = 'identified';

export interface StackEntry {
  depth: number;
  title: string;
  /** Empty string marks an untyped heading placeholder (hybrid mode only). */
  ostType: string;
}

/** Extract [key:: value] bracketed inline fields, return cleaned text and fields. */
export function extractBracketedFields(text: string): {
  cleanText: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  const cleanText = text
    .replace(/\[([^\]]+?):: *([^\]]*)\]/g, (_, key, value) => {
      fields[key.trim()] = value.trim();
      return '';
    })
    .trim();
  return { cleanText, fields };
}

/**
 * Extract unbracketed dataview fields (key:: value on own line).
 * Keys must be identifier-style (letters, digits, hyphens, underscores — no spaces).
 * Lines matching the pattern are consumed as fields; other lines kept as content.
 */
export function extractUnbracketedFields(text: string): {
  remainingText: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  const remaining: string[] = [];

  for (const line of text.split('\n')) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):: *(.*)$/);
    if (match) {
      fields[match[1]!.trim()] = match[2]!.trim();
    } else {
      remaining.push(line);
    }
  }

  return { remainingText: remaining.join('\n').trim(), fields };
}

/**
 * Extract a trailing Obsidian block anchor from heading text.
 * e.g. "My Title ^anchor-id" → { cleanText: "My Title", anchor: "anchor-id" }
 */
export function extractAnchor(text: string): { cleanText: string; anchor?: string } {
  const match = text.match(/\s+\^([a-zA-Z0-9][a-zA-Z0-9_-]*)$/);
  if (match) {
    return {
      cleanText: text.slice(0, text.length - match[0].length).trim(),
      anchor: match[1],
    };
  }
  return { cleanText: text };
}

/**
 * If the anchor name exactly matches an OST type (or an OST type followed by digits),
 * return that type. Otherwise return undefined.
 * Examples: "mission" → "mission", "goal1" → "goal", "myanchor" → undefined
 */
export function anchorToOstType(anchor: string): string | undefined {
  for (const type of OST_TYPES) {
    if (anchor === type || new RegExp(`^${type}\\d+$`).test(anchor)) {
      return type;
    }
  }
  return undefined;
}

/**
 * Returns the default OST type for a new heading based on its parent's effective type.
 * The first heading in a document defaults to 'vision'; each child is the next in sequence.
 */
export function defaultOstType(stack: StackEntry[]): string {
  if (stack.length === 0) return OST_TYPES[0]!;
  const parentType = stack[stack.length - 1]?.ostType;
  const idx = OST_TYPES.indexOf(parentType as OstType);
  if (idx === -1 || idx >= OST_TYPES.length - 1) {
    throw new Error(`No OST type follows "${parentType}" — cannot determine type for child heading`);
  }
  return OST_TYPES[idx + 1]!;
}

function appendContent(node: OstNode, text: string): void {
  if (!text) return;
  const existing = node.data.content as string | undefined;
  node.data.content = existing ? `${existing}\n${text}` : text;
}

function processListItem(
  item: ListItem,
  parentRef: string | undefined,
  contentTarget: OstNode,
  nodes: OstNode[],
  makeLabel: (title: string) => string,
  makeParentRef: (title: string) => string,
): void {
  const firstPara = item.children.find((c) => c.type === 'paragraph') as Paragraph | undefined;

  if (!firstPara) {
    appendContent(contentTarget, `- ${mdastToString(item)}`);
    return;
  }

  const rawText = mdastToString(firstPara);
  const { cleanText, fields } = extractBracketedFields(rawText);

  if (fields.type) {
    const dashIdx = cleanText.indexOf(' - ');
    const title = (dashIdx >= 0 ? cleanText.slice(0, dashIdx) : cleanText).trim();
    const summary = dashIdx >= 0 ? cleanText.slice(dashIdx + 3).trim() : undefined;

    const data: Record<string, unknown> = {
      title,
      type: fields.type,
      status: DEFAULT_STATUS,
      ...fields,
    };
    if (parentRef) data.parent = parentRef;
    if (summary) data.summary = summary;

    const newNode: OstNode = { label: makeLabel(title), data };
    nodes.push(newNode);

    const nestedParentRef = makeParentRef(title);
    for (const child of item.children) {
      if (child.type === 'list') {
        for (const subItem of (child as List).children) {
          processListItem(subItem, nestedParentRef, newNode, nodes, makeLabel, makeParentRef);
        }
      }
    }
  } else {
    appendContent(contentTarget, `- ${rawText}`);
  }
}

export interface ExtractEmbeddedOptions {
  /**
   * Title of the containing page. If provided (and pageType is non-`ost_on_a_page`),
   * the page acts as a virtual depth-0 parent for first-level embedded headings.
   */
  pageTitle?: string;
  /**
   * OST type of the containing page.
   * - If set to a real OST type (not 'ost_on_a_page'): only headings with an explicit
   *   `[type:: x]` field or an OST-type anchor become nodes (hybrid mode).
   * - If 'ost_on_a_page' or undefined: all headings become nodes with depth-based
   *   type inference (classic ost_on_a_page behaviour).
   */
  pageType?: string;
}

export interface ExtractEmbeddedResult {
  nodes: OstNode[];
  diagnostics: OstPageDiagnostics;
}

/**
 * Extract OST nodes from markdown body text.
 *
 * Shared by both readOstPage (single-file) and readSpace (directory) to find
 * embedded sub-nodes within a page's content.
 */
export function extractEmbeddedNodes(body: string, options: ExtractEmbeddedOptions = {}): ExtractEmbeddedResult {
  const { pageTitle, pageType } = options;
  const isHybridMode = pageType !== undefined && pageType !== 'ost_on_a_page';

  const nodes: OstNode[] = [];
  // Preamble/root content sink — never added to nodes
  const rootNode: OstNode = { label: '_root_', data: { type: 'ost_on_a_page' } };

  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root;

  // In hybrid mode: stack starts with the page's own virtual entry (depth 0).
  // In ost_on_a_page mode: stack starts empty (first heading has no parent).
  const stack: StackEntry[] =
    isHybridMode && pageTitle !== undefined ? [{ depth: 0, title: pageTitle, ostType: pageType }] : [];

  let currentContextNode: OstNode = rootNode;

  type ParseState = 'preamble' | 'active' | 'done';
  let parseState: ParseState = 'preamble';

  const diagnostics: OstPageDiagnostics = {
    preambleNodeCount: 0,
    terminatedHeadings: [],
  };

  function makeLabel(title: string): string {
    return title;
  }

  /**
   * Walk the stack backwards to find the deepest real OST node entry (ostType !== '').
   * Untyped-heading placeholders (ostType === '') are skipped so that typed headings
   * beneath an untyped heading correctly inherit the last typed ancestor.
   */
  function currentParentRef(): string | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i]!;
      if (entry.ostType === '') continue; // untyped placeholder
      if (entry.depth === 0) {
        // The page itself is the parent
        return pageTitle ? `[[${pageTitle}]]` : undefined;
      }
      // An embedded heading is the parent
      return `[[${entry.title}]]`;
    }
    return undefined;
  }

  function makeParentRef(title: string): string {
    return `[[${title}]]`;
  }

  for (const child of tree.children) {
    if (parseState === 'done') {
      if (child.type === 'heading') {
        const rawTitle = mdastToString(child);
        const { cleanText: afterBracketed } = extractBracketedFields(rawTitle);
        const { cleanText: title } = extractAnchor(afterBracketed);
        diagnostics.terminatedHeadings.push(title);
      }
      continue;
    }

    if (child.type === 'thematicBreak') {
      if (parseState === 'active') parseState = 'done';
      continue;
    }

    if (child.type === 'heading') {
      const heading = child as Heading;
      const depth = heading.depth;
      if (depth > 5) continue;

      parseState = 'active';

      const rawText = mdastToString(heading);
      const { cleanText: afterBracketed, fields: inlineFields } = extractBracketedFields(rawText);
      const { cleanText: title, anchor } = extractAnchor(afterBracketed);

      const anchorType = anchor ? anchorToOstType(anchor) : undefined;
      const hasExplicitType = !!inlineFields.type;
      const hasImpliedType = !!anchorType;

      if (isHybridMode && !hasExplicitType && !hasImpliedType) {
        // Untyped heading in hybrid mode: update depth stack but don't create a node.
        while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
          stack.pop();
        }
        stack.push({ depth, title, ostType: '' });
        continue;
      }

      // In ost_on_a_page mode, enforce the no-level-skip rule.
      if (!isHybridMode && stack.length > 0) {
        const topDepth = stack[stack.length - 1]!.depth;
        if (depth > topDepth + 1) {
          throw new Error(`Heading level skipped: jumped from H${topDepth} to H${depth} at "${title}"`);
        }
      }

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }

      const type = inlineFields.type ?? anchorType ?? defaultOstType(stack);
      const parentRef = currentParentRef();

      const data: Record<string, unknown> = {
        title,
        type,
        status: DEFAULT_STATUS,
        ...inlineFields,
      };
      if (parentRef) data.parent = parentRef;
      if (anchor) data.anchor = anchor;

      const headingNode: OstNode = { label: makeLabel(title), data };
      nodes.push(headingNode);
      currentContextNode = headingNode;
      stack.push({ depth, title, ostType: type });
    } else if (parseState !== 'active') {
      diagnostics.preambleNodeCount++;
    } else if (child.type === 'list') {
      const parentRef = currentParentRef();
      for (const item of (child as List).children) {
        processListItem(item, parentRef, currentContextNode, nodes, makeLabel, makeParentRef);
      }
    } else if (child.type === 'paragraph') {
      const rawText = mdastToString(child);
      const { cleanText: afterBracketed, fields: bracketedFields } = extractBracketedFields(rawText);
      const { remainingText, fields: unbracketedFields } = extractUnbracketedFields(afterBracketed);

      const allFields = { ...unbracketedFields, ...bracketedFields };
      if ('type' in allFields) {
        throw new Error(
          `Type override via paragraph field is not supported at "${currentContextNode.data.title}". ` +
            `Put [type:: ${allFields.type}] directly in the heading text.`,
        );
      }

      Object.assign(currentContextNode.data, allFields);
      if (remainingText) appendContent(currentContextNode, remainingText);
    } else if (child.type === 'code') {
      const code = child as Code;
      if (code.lang?.trim() === 'yaml') {
        const parsed = yamlLoad(code.value);

        if (Array.isArray(parsed)) {
          throw new Error(
            `YAML block must be an object (key-value properties for the current node), not an array. ` +
              `Use typed bullets — e.g. "- [type:: solution] Title" — to define child nodes inline.`,
          );
        } else if (parsed && typeof parsed === 'object') {
          Object.assign(currentContextNode.data, parsed as Record<string, unknown>);
        } else {
          appendContent(currentContextNode, code.value);
        }
      } else {
        appendContent(currentContextNode, code.value);
      }
    } else {
      const text = mdastToString(child);
      appendContent(currentContextNode, text);
    }
  }

  return { nodes, diagnostics };
}
