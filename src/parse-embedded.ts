import { load as yamlLoad } from 'js-yaml';
import type { Code, Heading, List, ListItem, Paragraph, Root } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { applyFieldMap } from './config';
import { resolveNodeType } from './schema';
import type { SpaceNode, SpaceOnAPageDiagnostics } from './types';

/** Type values that identify a space_on_a_page container (not themselves space nodes). */
export const ON_A_PAGE_TYPES = ['ost_on_a_page', 'space_on_a_page'];

export const DEFAULT_STATUS = 'identified';

export interface StackEntry {
  depth: number;
  title: string;
  /** Empty string marks an untyped heading placeholder (typed-page mode, i.e. not space_on_a_page). */
  nodeType: string;
  /** Preferred wikilink key used when this heading acts as a parent. */
  refTarget: string;
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
 * Keys must be identifier-style (letters, digits, hyphens, underscores - no spaces).
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
 * e.g. "My Title ^anchor-id" -> { cleanText: "My Title", anchor: "anchor-id" }
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
 * If the anchor name exactly matches a space node type (optionally followed by digits),
 * return that type. Otherwise return undefined.
 * Examples: "mission" -> "mission", "goal1" -> "goal", "myanchor" -> undefined
 */
export function anchorToNodeType(anchor: string, hierarchy: readonly string[]): string | undefined {
  for (const type of hierarchy) {
    if (anchor === type || new RegExp(`^${type}\\d+$`).test(anchor)) {
      return type;
    }
  }
  return undefined;
}

/**
 * Turn a full heading string into an Obsidian section-target key component.
 * - normalizes observed Obsidian separators (#, ^, :, \) to spaces
 * - compresses whitespace runs to single spaces
 */
export function normalizeHeadingSectionTarget(rawHeadingText: string): string {
  return rawHeadingText
    .replace(/[#^:\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the default space node type for a new heading based on its parent's effective type.
 * The first heading in a document defaults to the first type in the hierarchy; each child is the next in sequence.
 */
export function defaultNodeType(stack: StackEntry[], hierarchy: readonly string[]): string {
  if (stack.length === 0) return hierarchy[0]!;
  const parentType = stack[stack.length - 1]!.nodeType;
  const idx = hierarchy.indexOf(parentType);
  if (idx === -1 || idx >= hierarchy.length - 1) {
    throw new Error(`No node type follows "${parentType}" - cannot determine type for child heading`);
  }
  return hierarchy[idx + 1]!;
}

function appendContent(node: SpaceNode, text: string): void {
  if (!text) return;
  const existing = node.schemaData.content as string | undefined;
  node.schemaData.content = existing ? `${existing}\n${text}` : text;
}

function processListItem(
  item: ListItem,
  parentRef: string | undefined,
  contentTarget: SpaceNode,
  nodes: SpaceNode[],
  makeLabel: (title: string) => string,
  buildLinkTargets: (title: string) => string[],
  typeAliases: Record<string, string>,
  fieldMap?: Record<string, string>,
): void {
  const firstPara = item.children.find((c) => c.type === 'paragraph') as Paragraph | undefined;

  if (!firstPara) {
    appendContent(contentTarget, `- ${mdastToString(item)}`);
    return;
  }

  const rawText = mdastToString(firstPara);
  const { cleanText, fields: rawFields } = extractBracketedFields(rawText);
  const fields = applyFieldMap(rawFields, fieldMap) as Record<string, string>;

  if (fields.type) {
    const dashIdx = cleanText.indexOf(' - ');
    const title = (dashIdx >= 0 ? cleanText.slice(0, dashIdx) : cleanText).trim();
    const summary = dashIdx >= 0 ? cleanText.slice(dashIdx + 3).trim() : undefined;

    const schemaData: Record<string, unknown> = {
      title,
      type: fields.type,
      status: DEFAULT_STATUS,
      ...fields,
    };
    if (parentRef) schemaData.parent = parentRef;
    if (summary) schemaData.summary = summary;

    const linkTargets = buildLinkTargets(title);
    const newNode: SpaceNode = {
      label: makeLabel(title),
      schemaData,
      linkTargets,
      resolvedParents: [],
      resolvedType: resolveNodeType(fields.type, typeAliases),
    };
    nodes.push(newNode);

    const nestedParentRef = `[[${linkTargets[0] ?? title}]]`;
    for (const child of item.children) {
      if (child.type === 'list') {
        for (const subItem of (child as List).children) {
          processListItem(subItem, nestedParentRef, newNode, nodes, makeLabel, buildLinkTargets, typeAliases, fieldMap);
        }
      }
    }
  } else {
    appendContent(contentTarget, `- ${rawText}`);
  }
}

export interface ExtractEmbeddedOptions {
  /**
   * Title of the containing page. If provided (and pageType is not a space_on_a_page type),
   * the page acts as a virtual depth-0 parent for first-level embedded headings.
   */
  pageTitle?: string;
  /**
   * Node type of the containing page.
   * - If set to a real node type: only headings with an explicit `[type:: x]` field or a
   *   type-named anchor become nodes (typed-page mode).
   * - If an on-a-page type (`space_on_a_page` / `ost_on_a_page`) or undefined: all headings
   *   become nodes with depth-based type inference ("space on a page" behaviour).
   */
  pageType?: string;
  /**
   * Hierarchy of node types for depth-based type inference in space-on-a-page mode.
   */
  hierarchy: readonly string[];
  /**
   * Type aliases mapping (alias -> canonical type) for resolving types.
   */
  typeAliases?: Record<string, string>;
  /**
   * Field name remapping (file field name → canonical field name).
   * Applied to all extracted inline fields, YAML blocks, and paragraph fields.
   * Example: { "record_type": "type" } renames `record_type` to `type` in extracted data.
   */
  fieldMap?: Record<string, string>;
}

export interface ExtractEmbeddedResult {
  nodes: SpaceNode[];
  diagnostics: SpaceOnAPageDiagnostics;
}

/**
 * Extract space nodes from markdown body text.
 *
 * Shared by both readSpaceOnAPage (single space_on_a_page file) and readSpaceDirectory
 * (directory) to find embedded sub-nodes within a page's content.
 */
export function extractEmbeddedNodes(body: string, options: ExtractEmbeddedOptions): ExtractEmbeddedResult {
  const { pageTitle, pageType, hierarchy, typeAliases = {}, fieldMap } = options;
  const isOnAPageMode = pageType === undefined || ON_A_PAGE_TYPES.includes(pageType);

  const nodes: SpaceNode[] = [];
  // Preamble/root content sink - never added to nodes
  const rootNode: SpaceNode = {
    label: '_root_',
    schemaData: { type: 'space_on_a_page' },
    linkTargets: [],
    resolvedParents: [],
    resolvedType: 'space_on_a_page',
  };

  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root;

  // In typed-page mode: stack starts with the page's own virtual entry (depth 0).
  // In space_on_a_page mode: stack starts empty (first heading has no parent).
  const stack: StackEntry[] =
    !isOnAPageMode && pageTitle !== undefined
      ? [{ depth: 0, title: pageTitle, nodeType: pageType, refTarget: pageTitle }]
      : [];

  let currentContextNode: SpaceNode = rootNode;

  type ParseState = 'preamble' | 'active' | 'done';
  let parseState: ParseState = 'preamble';

  const diagnostics: SpaceOnAPageDiagnostics = {
    preambleNodeCount: 0,
    terminatedHeadings: [],
  };

  function makeLabel(title: string): string {
    return title;
  }

  /**
   * Walk the stack backwards to find the deepest typed node entry (nodeType !== '').
   * Untyped-heading placeholders (nodeType === '') are skipped so that typed headings
   * beneath an untyped heading correctly inherit the last typed ancestor.
   */
  function currentParentRef(): string | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i]!;
      if (entry.nodeType === '') continue;
      return `[[${entry.refTarget}]]`;
    }
    return undefined;
  }

  function buildHeadingLinkTargets(rawHeadingText: string, title: string, anchor?: string): string[] {
    if (!pageTitle) {
      return [title];
    }

    const targets: string[] = [];

    const sectionTarget = normalizeHeadingSectionTarget(rawHeadingText);
    if (sectionTarget) {
      targets.push(`${pageTitle}#${sectionTarget}`);
    }

    if (anchor) {
      targets.push(`${pageTitle}#^${anchor}`);
    }

    return targets.length > 0 ? targets : [title];
  }

  function buildListItemLinkTargets(title: string): string[] {
    if (!pageTitle) return [title];
    const normalized = normalizeHeadingSectionTarget(title);
    return normalized ? [`${pageTitle}#${normalized}`] : [title];
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
      const { cleanText: afterBracketed, fields: rawInlineFields } = extractBracketedFields(rawText);
      const inlineFields = applyFieldMap(rawInlineFields, fieldMap) as Record<string, string>;
      const { cleanText: title, anchor } = extractAnchor(afterBracketed);

      const anchorType = anchor ? anchorToNodeType(anchor, hierarchy) : undefined;
      const hasExplicitType = !!inlineFields.type;
      const hasImpliedType = !!anchorType;

      if (!isOnAPageMode && !hasExplicitType && !hasImpliedType) {
        // Untyped heading in typed-page mode: update depth stack but don't create a node.
        while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
          stack.pop();
        }
        stack.push({ depth, title, nodeType: '', refTarget: title });
        continue;
      }

      // In space_on_a_page mode, enforce the no-level-skip rule.
      if (isOnAPageMode && stack.length > 0) {
        const topDepth = stack[stack.length - 1]!.depth;
        if (depth > topDepth + 1) {
          throw new Error(`Heading level skipped: jumped from H${topDepth} to H${depth} at "${title}"`);
        }
      }

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }

      const type = inlineFields.type ?? anchorType ?? defaultNodeType(stack, hierarchy);
      const parentRef = currentParentRef();

      const schemaData: Record<string, unknown> = {
        title,
        type,
        status: DEFAULT_STATUS,
        ...inlineFields,
      };
      if (parentRef) schemaData.parent = parentRef;

      const linkTargets = buildHeadingLinkTargets(rawText, title, anchor);
      const headingNode: SpaceNode = {
        label: makeLabel(title),
        schemaData,
        linkTargets,
        resolvedParents: [],
        resolvedType: resolveNodeType(type, typeAliases),
      };
      nodes.push(headingNode);
      currentContextNode = headingNode;

      const refTarget = linkTargets[0] ?? title;
      stack.push({ depth, title, nodeType: type, refTarget });
    } else if (parseState !== 'active') {
      diagnostics.preambleNodeCount++;
    } else if (child.type === 'list') {
      const parentRef = currentParentRef();
      for (const item of (child as List).children) {
        processListItem(
          item,
          parentRef,
          currentContextNode,
          nodes,
          makeLabel,
          buildListItemLinkTargets,
          typeAliases,
          fieldMap,
        );
      }
    } else if (child.type === 'paragraph') {
      const rawText = mdastToString(child);
      const { cleanText: afterBracketed, fields: bracketedFields } = extractBracketedFields(rawText);
      const { remainingText, fields: unbracketedFields } = extractUnbracketedFields(afterBracketed);

      const allFields = applyFieldMap({ ...unbracketedFields, ...bracketedFields }, fieldMap);
      if ('type' in allFields) {
        const title = currentContextNode.schemaData.title as string | undefined;
        throw new Error(
          `Type override via paragraph field is not supported at "${title ?? currentContextNode.label}". ` +
            `Put [type:: ${(allFields as Record<string, string>).type}] directly in the heading text.`,
        );
      }

      Object.assign(currentContextNode.schemaData, allFields);
      if (remainingText) appendContent(currentContextNode, remainingText);
    } else if (child.type === 'code') {
      const code = child as Code;
      if (code.lang?.trim() === 'yaml') {
        const parsed = yamlLoad(code.value);

        if (Array.isArray(parsed)) {
          throw new Error(
            `YAML block must be an object (key-value properties for the current node), not an array. ` +
              `Use typed bullets - e.g. "- [type:: solution] Title" - to define child nodes inline.`,
          );
        }

        if (parsed && typeof parsed === 'object') {
          Object.assign(currentContextNode.schemaData, applyFieldMap(parsed as Record<string, unknown>, fieldMap));
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
