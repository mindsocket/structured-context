import type { Code, Heading, List, ListItem, Paragraph, Root, Table, TableRow } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  BaseNode,
  EdgeDefinition,
  HierarchyLevel,
  Relationship,
  SchemaMetadata,
  SharedEmbeddingFields,
} from '../../api';
import { extractLinksFromAstNode } from './extract-content-links';
import { applyFieldMap, parseYaml } from './util';

/** Type values that identify a space_on_a_page container (not themselves space nodes). */
export const ON_A_PAGE_TYPES = ['ost_on_a_page', 'space_on_a_page'];

const DEFAULT_STATUS = 'identified';

type StackEntry = {
  depth: number;
  title: string;
  /** Empty string marks an untyped heading placeholder (typed-page mode, i.e. not space_on_a_page). */
  nodeType: string;
  /** Preferred wikilink key used when this heading acts as a parent. */
  refTarget: string;
  /** Node whose section this heading opens; absent for untyped placeholders and the page's own entry. */
  node?: BaseNode;
};

/**
 * Normalized embedding definition — works for both hierarchy levels and relationships.
 * Extends EdgeDefinition (required routing fields + type/parent) and SharedEmbeddingFields
 * (optional templateFormat/matchers/embeddedTemplateFields), so changes to those shared
 * schema props automatically flow here without manual wiring.
 */
interface EmbeddingDefinition extends EdgeDefinition, SharedEmbeddingFields {
  templateFormat: NonNullable<SharedEmbeddingFields['templateFormat']>;
  source: 'hierarchy' | 'relationship';
}

/** Active grouping context — replaces ad-hoc pendingMatch. */
type GroupingState = {
  definition: EmbeddingDefinition;
  semanticParent: { ref: string | undefined; node: BaseNode | undefined };
  headingNode: BaseNode;
  emitted: boolean;
};

/** Detect a bare wikilink `[[...]]` and return the inner target, or undefined. */
export function isWikilink(text: string): string | undefined {
  const match = text.match(/^\[\[(.+?)\]\]$/);
  return match ? match[1] : undefined;
}

/** Evaluate a list of matchers against a heading title. */
function matchesPattern(title: string, lowerTitle: string, matchers: string[]): boolean {
  for (const matcher of matchers) {
    if (matcher.startsWith('^') && matcher.endsWith('$')) {
      if (new RegExp(matcher, 'i').test(title)) return true;
    } else if (matcher.startsWith('/') && matcher.endsWith('/')) {
      if (new RegExp(matcher.slice(1, -1), 'i').test(title)) return true;
    } else if (lowerTitle === matcher.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Append a wikilink reference to a field array on a node.
 * Creates the array if missing; throws if the field exists but is not an array.
 */
function appendParentField(parentNode: BaseNode, field: string, linkRef: string): void {
  const fieldValue = parentNode.schemaData[field];
  if (fieldValue === undefined) {
    parentNode.schemaData[field] = [linkRef];
  } else if (Array.isArray(fieldValue)) {
    fieldValue.push(linkRef);
  } else {
    throw new Error(
      `Cannot append child link to field '${field}' on node '${parentNode.label}': ` +
        `field exists but is not an array (found ${typeof fieldValue}). ` +
        `Child link: ${linkRef}`,
    );
  }
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
 *
 * Also checks relationship types (for parent-side relationships where child type may not be in hierarchy).
 */
export function anchorToNodeType(
  anchor: string,
  hierarchy: readonly string[],
  relationships?: Relationship[],
): string | undefined {
  for (const type of hierarchy) {
    if (anchor === type || new RegExp(`^${type}\\d+$`).test(anchor)) {
      return type;
    }
  }

  // Check relationship types (for parent-side relationships)
  if (relationships) {
    for (const rel of relationships) {
      if (anchor === rel.type || new RegExp(`^${rel.type}\\d+$`).test(anchor)) {
        return rel.type;
      }
    }
  }

  return undefined;
}

/**
 * Turn a full heading string into an Obsidian section-target key component.
 * - normalizes observed Obsidian separators (#, ^, :, \) to spaces
 * - compresses whitespace runs to single spaces
 * - does _NOT_ (and should not) manipulate anchors or inline fields
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

type Position = NonNullable<Heading['position']>;

/** A half-open `[start, end)` range of offsets into the markdown body. */
type SourceRange = { start: number; end: number };

/**
 * Tracks which parts of the body source each node owns. A node's content is its ranges sliced
 * from the body and joined, so it stays contiguous, verbatim source minus whatever other nodes
 * (or consumed field syntax) took out of it.
 */
type SourceClaims = {
  ranges: Map<BaseNode, SourceRange[]>;
  /** Nodes whose next claim starts at its block, because a consumed block already kept the blank lines before it. */
  gapKept: Set<BaseNode>;
  /** List item nodes mapped to the column where their content starts; their content is dedented by it. */
  contentIndent: Map<BaseNode, number>;
};

/** Start and end offsets of an mdast node. Throws when the parser gave no position. */
function offsetsOf(node: { type: string; position?: Position }): SourceRange {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`Markdown ${node.type} node has no source position; cannot slice its content`);
  }
  return { start, end };
}

function addRange(claims: SourceClaims, node: BaseNode, start: number, end: number): void {
  if (end <= start) return;
  const ranges = claims.ranges.get(node) ?? [];
  const last = ranges[ranges.length - 1];
  if (last && last.end === start) last.end = end;
  else ranges.push({ start, end });
  claims.ranges.set(node, ranges);
}

/**
 * Give a node a block of source, plus the blank lines between `from` and the block's `start`.
 * Those lines are skipped when a consumed block just before already kept its own.
 */
function claim(claims: SourceClaims, node: BaseNode, from: number, start: number, end: number): void {
  addRange(claims, node, claims.gapKept.delete(node) ? start : from, end);
}

/**
 * Take a block out of a node's content (it was consumed as a node, field or other syntax).
 * The blank lines before it stay, so the content on either side does not run together.
 */
function consume(claims: SourceClaims, node: BaseNode, from: number, start: number): void {
  addRange(claims, node, claims.gapKept.delete(node) ? start : from, start);
  claims.gapKept.add(node);
}

/** Sets each node's content from its claimed source. Leading blank lines and trailing whitespace are dropped. */
function applyClaims(claims: SourceClaims, body: string): void {
  for (const [node, ranges] of claims.ranges) {
    let content = ranges
      .map((r) => body.slice(r.start, r.end))
      .join('')
      .replace(/^(?:[ \t]*\r?\n)+/, '')
      .trimEnd();
    const indent = claims.contentIndent.get(node);
    if (indent) {
      const strip = new RegExp(`^[ \\t]{1,${indent}}`);
      content = content
        .split(/(?<=\n)/)
        .map((line) => line.replace(strip, ''))
        .join('');
    }
    if (!content) continue;
    node.schemaData.content = content;
    node.content = content;
  }
}

/** Source lines (with terminators) of a range, as absolute offsets. */
function sourceLines(body: string, range: SourceRange): (SourceRange & { text: string })[] {
  const lines: (SourceRange & { text: string })[] = [];
  const re = /[^\n]*\n|[^\n]+$/g;
  const text = body.slice(range.start, range.end);
  for (const m of text.matchAll(re)) {
    lines.push({
      start: range.start + m.index,
      end: range.start + m.index + m[0].length,
      text: m[0].replace(/\r?\n$/, ''),
    });
  }
  return lines;
}

/** Whether a line holds only inline fields: bracketed `[key:: value]` pieces, or one `key:: value`. */
function isFieldOnlyLine(line: string): boolean {
  const { cleanText, fields } = extractBracketedFields(line);
  const hasBracketed = Object.keys(fields).length > 0;
  if (cleanText === '') return hasBracketed;
  return /^[a-zA-Z][a-zA-Z0-9_-]*:: *.*$/.test(cleanText);
}

/** Cursor over the body while embedded list items are walked: everything before `pos` is already assigned. */
type ListWalk = { claims: SourceClaims; pos: number };

function processListItem(
  item: ListItem,
  parentRef: string | undefined,
  contentTarget: BaseNode,
  nodes: BaseNode[],
  makeLabel: (title: string) => string,
  buildLinkTargets: (title: string) => string[],
  typeAliases: Record<string, string>,
  fieldMap: Record<string, string> | undefined,
  pendingType: string | undefined,
  parentFieldAppend: { node: BaseNode; field: string } | undefined,
  activeNodeFieldAppend: { node: BaseNode; field: string } | undefined,
  file: string | undefined,
  lineOffset: number | undefined,
  walk: ListWalk,
): void {
  const itemEnd = offsetsOf(item).end;
  const firstPara = item.children.find((c) => c.type === 'paragraph') as Paragraph | undefined;

  if (!firstPara) {
    claim(walk.claims, contentTarget, walk.pos, offsetsOf(item).start, itemEnd);
    walk.pos = itemEnd;
    return;
  }

  const rawText = mdastToString(firstPara);

  // Wikilink detection: bare wikilinks populate a field without creating a node
  const wikiTarget = isWikilink(rawText.trim());
  if (wikiTarget) {
    const linkRef = `[[${wikiTarget}]]`;
    if (parentFieldAppend) {
      consume(walk.claims, contentTarget, walk.pos, offsetsOf(item).start);
      appendParentField(parentFieldAppend.node, parentFieldAppend.field, linkRef);
      walk.pos = itemEnd;
      return;
    }
    if (activeNodeFieldAppend) {
      consume(walk.claims, contentTarget, walk.pos, offsetsOf(item).start);
      appendParentField(activeNodeFieldAppend.node, activeNodeFieldAppend.field, linkRef);
      walk.pos = itemEnd;
      return;
    }
    // No field append context — fall through to node creation or content append
  }

  const { cleanText, fields: rawFields } = extractBracketedFields(rawText);
  const fields = applyFieldMap(rawFields, fieldMap) as Record<string, string>;

  const type = fields.type ?? pendingType;

  if (type) {
    const dashIdx = cleanText.indexOf(' - ');
    const title = (dashIdx >= 0 ? cleanText.slice(0, dashIdx) : cleanText).trim();
    const summary = dashIdx >= 0 ? cleanText.slice(dashIdx + 3).trim() : undefined;

    const schemaData: Record<string, unknown> = {
      title,
      type,
      status: DEFAULT_STATUS,
      ...fields,
    };
    if (parentRef && !parentFieldAppend) schemaData.parent = parentRef;
    if (summary) schemaData.summary = summary;

    const line = item.position?.start.line ? item.position.start.line + (lineOffset ?? 0) : undefined;
    const column = item.position?.start.column;
    const source = file
      ? { file, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) }
      : undefined;

    const linkTargets = buildLinkTargets(title);
    const newNode: BaseNode = {
      label: makeLabel(title),
      title,
      schemaData,
      linkTargets,
      type,
      ...(schemaData.content !== undefined ? { content: schemaData.content as string } : {}),
      contentLinks: [],
      ...(source ? { source } : {}),
    };
    nodes.push(newNode);
    const contentColumn = firstPara.position?.start.column;
    if (contentColumn !== undefined) walk.claims.contentIndent.set(newNode, contentColumn - 1);

    if (parentFieldAppend) {
      appendParentField(parentFieldAppend.node, parentFieldAppend.field, `[[${linkTargets[0] ?? title}]]`);
    }

    const nestedParentRef = `[[${linkTargets[0] ?? title}]]`;
    consume(walk.claims, contentTarget, walk.pos, offsetsOf(item).start);
    walk.pos = offsetsOf(firstPara).end;
    for (const child of item.children) {
      if (child === firstPara) continue;
      if (child.type === 'list') {
        for (const subItem of (child as List).children) {
          processListItem(
            subItem,
            nestedParentRef,
            newNode,
            nodes,
            makeLabel,
            buildLinkTargets,
            typeAliases,
            fieldMap,
            pendingType,
            undefined,
            undefined,
            file,
            lineOffset,
            walk,
          );
        }
      } else {
        const { start, end } = offsetsOf(child);
        claim(walk.claims, newNode, walk.pos, start, end);
        walk.pos = end;
      }
    }
  } else {
    claim(walk.claims, contentTarget, walk.pos, offsetsOf(item).start, itemEnd);
  }
  walk.pos = itemEnd;
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
  metadata: SchemaMetadata;
  /**
   * Field name remapping (file field name → canonical field name).
   * Applied to all extracted inline fields, YAML blocks, and paragraph fields.
   * Example: { "record_type": "type" } renames `record_type` to `type` in extracted data.
   */
  fieldMap?: Record<string, string>;
  /** File path of the containing document, for populating node.source. */
  file?: string;
  /** Line offset of the body within the source file (e.g. frontmatter lines). */
  lineOffset?: number;
}

export interface ExtractEmbeddedResult {
  nodes: BaseNode[];
  preambleNodeCount: number;
  terminatedHeadings: string[];
  preambleContent?: string;
  preambleFields?: Record<string, unknown>;
}

/**
 * Extract space nodes from markdown body text.
 *
 * Used by both readSpaceOnAPage (single space_on_a_page file) and readSpaceDirectory
 * (directory) to find embedded sub-nodes within a page's content.
 */
export function extractEmbeddedNodes(body: string, options: ExtractEmbeddedOptions): ExtractEmbeddedResult {
  const { pageTitle, pageType, metadata, fieldMap } = options;
  const levels = metadata.hierarchy?.levels ?? [];
  const hierarchy = levels.map((l) => l.type);
  const relationships = metadata.relationships ?? [];
  const typeAliases = metadata.typeAliases ?? {};
  const isOnAPageMode = pageType === undefined || ON_A_PAGE_TYPES.includes(pageType);

  const nodes: BaseNode[] = [];
  // Preamble/root content sink - never added to nodes
  const rootNode: BaseNode = {
    label: '_root_',
    title: '_root_',
    schemaData: { type: 'space_on_a_page' },
    linkTargets: [],
    type: 'space_on_a_page',
    contentLinks: [],
  };

  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root;

  // In typed-page mode: stack starts with the page's own virtual entry (depth 0).
  // In space_on_a_page mode: stack starts empty (first heading has no parent).
  const stack: StackEntry[] =
    !isOnAPageMode && pageTitle !== undefined
      ? [{ depth: 0, title: pageTitle, nodeType: pageType, refTarget: pageTitle }]
      : [];

  type ParseState = 'preamble' | 'active' | 'done';
  let parseState: ParseState = isOnAPageMode ? 'preamble' : 'active';

  let preambleNodeCount = 0;
  const terminatedHeadings: string[] = [];

  /**
   * Returns the nearest typed parent context, skipping stack entries at depth >= headingDepth
   * so that sibling headings don't masquerade as parents.
   */
  function getParentContextType(headingDepth?: number): string | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i]!;
      if (headingDepth !== undefined && entry.depth >= headingDepth) continue;
      if (entry.nodeType) return entry.nodeType;
    }
    return undefined;
  }

  /** Convert a relationship definition to a normalised EmbeddingDefinition. */
  function relationshipToEmbedding(rel: Relationship): EmbeddingDefinition {
    return {
      parent: rel.parent,
      type: rel.type,
      field: rel.field,
      fieldOn: rel.fieldOn,
      multiple: rel.multiple,
      templateFormat: (rel.templateFormat as EmbeddingDefinition['templateFormat']) ?? 'heading',
      source: 'relationship',
      matchers: rel.matchers,
      embeddedTemplateFields: rel.embeddedTemplateFields,
    };
  }

  /** Convert a hierarchy level to a normalised EmbeddingDefinition for child-level matching. */
  function hierarchyLevelToEmbedding(level: HierarchyLevel, parentType: string): EmbeddingDefinition {
    return {
      parent: parentType,
      type: level.type,
      field: level.field,
      fieldOn: level.fieldOn,
      multiple: level.multiple,
      templateFormat: level.templateFormat ?? 'heading',
      source: 'hierarchy',
      matchers: level.matchers,
      embeddedTemplateFields: level.embeddedTemplateFields,
    };
  }

  /**
   * Attempt to match a heading title to an embedding definition given the parent context type.
   *
   * Priority:
   * 1. Relationships (explicit matchers or type name fallback)
   * 2. Hierarchy child level (next level in hierarchy, using matchers or type name)
   * 3. Hierarchy parent-level matching (immediate parent type — populates current node's field)
   */
  function matchEmbedding(title: string, parentType: string | undefined): EmbeddingDefinition | undefined {
    if (!parentType) return undefined;
    const lowerTitle = title.toLowerCase();

    // 1. Check relationships first (explicit matches)
    for (const rel of relationships) {
      if (rel.parent === parentType) {
        if (rel.matchers && matchesPattern(title, lowerTitle, rel.matchers)) {
          return relationshipToEmbedding(rel);
        }
        if (lowerTitle === rel.type.toLowerCase()) {
          return relationshipToEmbedding(rel); // fallback implicit match
        }
      }
    }

    // 2. Check hierarchy child level matching
    const parentIdx = hierarchy.indexOf(parentType);
    if (parentIdx !== -1 && parentIdx < hierarchy.length - 1) {
      const nextLevel = levels[parentIdx + 1]!;
      if (nextLevel.matchers && matchesPattern(title, lowerTitle, nextLevel.matchers)) {
        return hierarchyLevelToEmbedding(nextLevel, parentType);
      }
      if (lowerTitle === nextLevel.type.toLowerCase()) {
        return hierarchyLevelToEmbedding(nextLevel, parentType);
      }
    }

    // 3. Check parent-level matching: immediate parent type referenced from current node.
    // e.g. if parentType is 'application' and heading is 'capabilities', match using
    // the 'application' level's own field definition.
    if (parentIdx > 0) {
      const immediateParentLevel = levels[parentIdx - 1]!;
      const matchesByMatchers = immediateParentLevel.matchers
        ? matchesPattern(title, lowerTitle, immediateParentLevel.matchers)
        : false;
      const matchesByType = lowerTitle === immediateParentLevel.type.toLowerCase();

      if (matchesByMatchers || matchesByType) {
        const currentLevel = levels[parentIdx]!;
        return {
          parent: parentType,
          type: immediateParentLevel.type,
          field: currentLevel.field,
          fieldOn: currentLevel.fieldOn,
          multiple: currentLevel.multiple,
          templateFormat: currentLevel.templateFormat ?? 'list',
          source: 'hierarchy',
          matchers: immediateParentLevel.matchers,
        };
      }
    }

    return undefined;
  }

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

  /**
   * Walk the stack from the second-to-last entry backwards to find the deepest typed node.
   * Must be called AFTER the new heading is pushed to the stack so stack[-2] is its parent.
   */
  function resolveSemanticParent(): { ref: string | undefined; node: BaseNode | undefined } {
    for (let i = stack.length - 2; i >= 0; i--) {
      if (stack[i]!.nodeType !== '') {
        const refTarget = stack[i]!.refTarget;
        return {
          ref: `[[${refTarget}]]`,
          node: nodes.find((n) => n.linkTargets.includes(refTarget)),
        };
      }
    }
    return { ref: undefined, node: undefined };
  }

  /**
   * Emit the grouping heading node if not already emitted.
   */
  function flushGrouping(g: GroupingState): BaseNode {
    if (!g.emitted) {
      nodes.push(g.headingNode);
      g.emitted = true;
    }
    return g.headingNode;
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

  let grouping: GroupingState | null = null;
  let activeNode: BaseNode = rootNode;

  const claims: SourceClaims = { ranges: new Map(), gapKept: new Set(), contentIndent: new Map() };
  /** End of the previous top-level block; a block's span starts here so the blank lines before it stay with it. */
  let prevEnd = 0;

  for (const child of tree.children) {
    const { start: blockStart, end: blockEnd } = offsetsOf(child);
    const spanStart = prevEnd;
    prevEnd = blockEnd;
    /** Give a node this block as source content, minus any `removed` ranges inside it. */
    const claimBlock = (node: BaseNode, removed: SourceRange[] = []): void => {
      let from = blockStart;
      let first = true;
      for (const gap of removed) {
        if (first) claim(claims, node, spanStart, blockStart, gap.start);
        else addRange(claims, node, from, gap.start);
        first = false;
        from = gap.end;
      }
      if (first) claim(claims, node, spanStart, blockStart, blockEnd);
      else addRange(claims, node, from, blockEnd);
    };
    /** Take this whole block out of a node's content, keeping the blank lines before it. */
    const consumeBlock = (node: BaseNode): void => consume(claims, node, spanStart, blockStart);

    if (parseState === 'done') {
      if (child.type === 'heading') {
        const rawTitle = mdastToString(child);
        const { cleanText: afterBracketed } = extractBracketedFields(rawTitle);
        const { cleanText: title } = extractAnchor(afterBracketed);
        terminatedHeadings.push(title);
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
      if (depth > 5) {
        if (parseState === 'active') claimBlock(activeNode);
        continue;
      }

      parseState = 'active';

      const rawText = mdastToString(heading);
      const { cleanText: afterBracketed, fields: rawInlineFields } = extractBracketedFields(rawText);
      const inlineFields = applyFieldMap(rawInlineFields, fieldMap) as Record<string, string>;
      const { cleanText: title, anchor } = extractAnchor(afterBracketed);

      const parentContextType = getParentContextType(depth);
      const anchorType = anchor ? anchorToNodeType(anchor, hierarchy, relationships) : undefined;
      const embeddingMatch = matchEmbedding(title, parentContextType);
      const hasExplicitType = !!inlineFields.type;
      const hasImpliedType = !!anchorType || !!embeddingMatch;

      if (!isOnAPageMode && !hasExplicitType && !hasImpliedType) {
        while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
          stack.pop();
        }
        stack.push({ depth, title, nodeType: '', refTarget: title });
        // Discard any pending grouping (untyped heading has no implied type)
        grouping = null;
        // An untyped heading is part of the body of the nearest enclosing node. Popping above removed every
        // node at the same or a higher level, so those sections end here; deeper nodes' sections continue.
        activeNode = stack.findLast((entry) => entry.node)?.node ?? rootNode;
        claimBlock(activeNode);
        continue;
      }

      if (isOnAPageMode && stack.length > 0) {
        const topDepth = stack[stack.length - 1]!.depth;
        if (depth > topDepth + 1) {
          throw new Error(`Heading level skipped: jumped from H${topDepth} to H${depth} at "${title}"`);
        }
      }

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }

      const type = inlineFields.type ?? anchorType ?? embeddingMatch?.type ?? defaultNodeType(stack, hierarchy);
      const parentRef = currentParentRef();

      const schemaData: Record<string, unknown> = {
        title,
        type,
        status: DEFAULT_STATUS,
        ...inlineFields,
      };
      if (parentRef) schemaData.parent = parentRef;

      const line = heading.position?.start.line ? heading.position.start.line + (options.lineOffset ?? 0) : undefined;
      const column = heading.position?.start.column;
      const source = options.file
        ? { file: options.file, ...(line !== undefined ? { line } : {}), ...(column !== undefined ? { column } : {}) }
        : undefined;

      const linkTargets = buildHeadingLinkTargets(rawText, title, anchor);
      const headingNode: BaseNode = {
        label: makeLabel(title),
        title,
        schemaData,
        linkTargets,
        type,
        ...(schemaData.content !== undefined ? { content: schemaData.content as string } : {}),
        contentLinks: [],
        ...(source ? { source } : {}),
      };

      // Push to stack BEFORE resolving semantic parent — stack[-2] is the correct parent.
      const refTarget = linkTargets[0] ?? title;
      stack.push({ depth, title, nodeType: type, refTarget, node: headingNode });

      // If this match came from a relationship/hierarchy and no explicit type was given,
      // create a grouping — delay adding the node until we see the following content.
      // Discard any previous grouping (not flushed — original agnostic-parse behaviour).
      if (!hasExplicitType && !anchorType && embeddingMatch) {
        grouping = {
          definition: embeddingMatch,
          semanticParent: resolveSemanticParent(),
          headingNode,
          emitted: false,
        };
        activeNode = headingNode;
      } else {
        // Explicit type or anchor type: discard any pending grouping and emit immediately.
        grouping = null;
        nodes.push(headingNode);
        activeNode = headingNode;
      }
    } else if (parseState !== 'active') {
      preambleNodeCount++;
    } else if (child.type === 'list') {
      const parentRef = currentParentRef();
      const list = child as List;

      if (grouping) {
        const { definition, semanticParent } = grouping;
        const isParentSide = definition.fieldOn === 'parent';

        const parentFieldAppendArg =
          isParentSide && semanticParent.node ? { node: semanticParent.node, field: definition.field } : undefined;

        // Parent-level match: definition.type is an ancestor of definition.parent in hierarchy.
        // e.g. definition.type='capabilities', definition.parent='application' → capabilities is above application.
        const typeIdx = hierarchy.indexOf(definition.type);
        const parentIdx = hierarchy.indexOf(definition.parent);
        const isParentLevelMatch =
          definition.source === 'hierarchy' && typeIdx !== -1 && parentIdx !== -1 && typeIdx < parentIdx;

        const activeNodeFieldAppendArg =
          isParentLevelMatch && semanticParent.node
            ? { node: semanticParent.node, field: definition.field }
            : undefined;

        const walk: ListWalk = { claims, pos: spanStart };
        for (const item of list.children) {
          processListItem(
            item,
            isParentSide ? undefined : semanticParent.ref,
            grouping.headingNode,
            nodes,
            makeLabel,
            buildListItemLinkTargets,
            typeAliases,
            fieldMap,
            definition.type,
            parentFieldAppendArg,
            activeNodeFieldAppendArg,
            options.file,
            options.lineOffset,
            walk,
          );
        }
        grouping = null;
      } else {
        const walk: ListWalk = { claims, pos: spanStart };
        for (const item of list.children) {
          processListItem(
            item,
            parentRef,
            activeNode,
            nodes,
            makeLabel,
            buildListItemLinkTargets,
            typeAliases,
            fieldMap,
            undefined,
            undefined,
            undefined,
            options.file,
            options.lineOffset,
            walk,
          );
        }
      }
    } else if (child.type === 'table') {
      const parentRef = currentParentRef();
      const parentContextType = getParentContextType();
      const table = child as Table;

      if (table.children && table.children.length > 0) {
        const headerRow = table.children[0] as TableRow;
        const rows = table.children.slice(1);
        const columnNames = headerRow.children.map((cell) => mdastToString(cell).trim());
        const firstColName = columnNames[0]?.toLowerCase();

        let rowTypeStr: string | undefined;
        let activeMatch: EmbeddingDefinition | undefined = grouping?.definition;

        if (activeMatch) {
          rowTypeStr = activeMatch.type;
        } else if (firstColName) {
          if (hierarchy.includes(firstColName) || typeAliases[firstColName]) {
            rowTypeStr = firstColName;
          } else {
            const rootRel = matchEmbedding(firstColName, parentContextType);
            if (rootRel) {
              rowTypeStr = rootRel.type;
              activeMatch = rootRel;
            }
          }
        }

        if (!rowTypeStr && activeNode !== rootNode && activeNode.schemaData.type) {
          const contextAsParentRel = matchEmbedding(firstColName || '', activeNode.schemaData.type as string);
          if (contextAsParentRel) {
            rowTypeStr = contextAsParentRel.type;
            activeMatch = contextAsParentRel;
          }
        }

        if (rowTypeStr) {
          let semanticParentRef = parentRef;
          let semanticParentNode: BaseNode | undefined;
          if (grouping) {
            // Use already-resolved semantic parent from grouping
            semanticParentRef = grouping.semanticParent.ref;
            semanticParentNode = grouping.semanticParent.node;
          } else if (activeMatch || rowTypeStr === parentContextType) {
            for (let i = stack.length - 2; i >= 0; i--) {
              if (stack[i]!.nodeType !== '') {
                semanticParentRef = `[[${stack[i]!.refTarget}]]`;
                const refTarget = stack[i]!.refTarget;
                semanticParentNode = nodes.find((n) => n.linkTargets.includes(refTarget));
                break;
              }
            }
          }

          const isParentSide = activeMatch?.fieldOn === 'parent';
          const tableParentFieldAppend =
            isParentSide && semanticParentNode && activeMatch?.field
              ? { node: semanticParentNode, field: activeMatch.field }
              : undefined;

          for (const row of rows) {
            const cells = row.children;
            if (!cells || cells.length === 0) continue;

            const titleRaw = mdastToString(cells[0]).trim();
            const { cleanText: title, fields: rawInlineFields } = extractBracketedFields(titleRaw);
            const inlineFields = applyFieldMap(rawInlineFields, fieldMap) as Record<string, string>;

            const schemaData: Record<string, unknown> = {
              title,
              type: rowTypeStr,
              status: DEFAULT_STATUS,
              ...inlineFields,
            };
            if (semanticParentRef && !tableParentFieldAppend) schemaData.parent = semanticParentRef;

            for (let i = 1; i < columnNames.length; i++) {
              const colName = columnNames[i]!;
              const cellContent = i < cells.length ? mdastToString(cells[i]).trim() : '';
              if (colName && cellContent) {
                const mappedColName = fieldMap?.[colName] ?? colName;
                schemaData[mappedColName] = cellContent;
              }
            }

            const line = row.position?.start.line ? row.position.start.line + (options.lineOffset ?? 0) : undefined;
            const column = row.position?.start.column;
            const source = options.file
              ? {
                  file: options.file,
                  ...(line !== undefined ? { line } : {}),
                  ...(column !== undefined ? { column } : {}),
                }
              : undefined;

            const linkTargets = buildListItemLinkTargets(title);
            const rowNode: BaseNode = {
              label: makeLabel(title),
              title,
              schemaData,
              linkTargets,
              type: rowTypeStr,
              contentLinks: [],
              ...(source ? { source } : {}),
            };
            nodes.push(rowNode);

            if (tableParentFieldAppend) {
              appendParentField(
                tableParentFieldAppend.node,
                tableParentFieldAppend.field,
                `[[${linkTargets[0] ?? title}]]`,
              );
            }
          }
          grouping = null;
        } else {
          claimBlock(activeNode);
        }
      }
    } else {
      // For any other content (paragraph, code, etc), if we had a grouping,
      // it means the heading itself is the node. Flush it now.
      if (grouping) {
        flushGrouping(grouping);
        grouping = null;
      }

      if (child.type === 'paragraph') {
        const rawText = mdastToString(child);
        const { cleanText: afterBracketed, fields: bracketedFields } = extractBracketedFields(rawText);
        const { fields: unbracketedFields } = extractUnbracketedFields(afterBracketed);
        const allFields = applyFieldMap({ ...unbracketedFields, ...bracketedFields }, fieldMap);

        if ('type' in allFields) {
          throw new Error(
            `Type override via paragraph field is not supported at "${activeNode.schemaData.title ?? activeNode.label}". ` +
              `Put [type:: ${(allFields as Record<string, string>).type}] directly in the heading text.`,
          );
        }

        Object.assign(activeNode.schemaData, allFields);
        // Lines holding only fields are consumed as fields; any other line, including prose that mentions a field, is content.
        const lines = sourceLines(body, { start: blockStart, end: blockEnd });
        const fieldLines = lines.filter((l) => isFieldOnlyLine(l.text));
        if (fieldLines.length === lines.length) {
          consumeBlock(activeNode);
        } else {
          // Each field line goes with its terminator; a last line without one takes the preceding line break instead.
          claimBlock(
            activeNode,
            fieldLines.map((l) => {
              if (/\n$/.test(body.slice(l.start, l.end))) return { start: l.start, end: l.end };
              return { start: l.start - (body[l.start - 2] === '\r' ? 2 : 1), end: l.end };
            }),
          );
        }
        activeNode.contentLinks ??= [];
        activeNode.contentLinks.push(...extractLinksFromAstNode(child));
      } else if (child.type === 'code' && (child as Code).lang?.trim() === 'yaml') {
        const code = child as Code;
        const parsed = parseYaml(code.value);
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
          Object.assign(activeNode.schemaData, applyFieldMap(parsed as Record<string, unknown>, fieldMap));
          consumeBlock(activeNode);
        } else if (Array.isArray(parsed)) {
          throw new Error(`YAML block must be an object at "${activeNode.label}".`);
        } else {
          claimBlock(activeNode);
        }
      } else {
        claimBlock(activeNode);
        activeNode.contentLinks ??= [];
        activeNode.contentLinks.push(...extractLinksFromAstNode(child));
      }
    }
  }

  applyClaims(claims, body);
  const preambleContent = rootNode.schemaData.content as string | undefined;
  const { type: _rootType, content: _rootContent, ...preambleFields } = rootNode.schemaData;
  return {
    nodes,
    preambleNodeCount,
    terminatedHeadings,
    preambleContent,
    preambleFields: Object.keys(preambleFields).length > 0 ? preambleFields : undefined,
  };
}
