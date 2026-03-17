import { load as yamlLoad } from 'js-yaml';
import type { Code, Heading, List, ListItem, Paragraph, Root, Table, TableRow } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { applyFieldMap } from '../config';
import type { MetadataContractRelationship } from '../schema/metadata-contract';
import { resolveNodeType } from '../schema/schema';
import type { SchemaMetadata, SpaceNode, SpaceOnAPageDiagnostics } from '../types';

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

/** Internal unified match result for both hierarchy and relationships. */
interface UnifiedMatch extends MetadataContractRelationship {
  isHierarchy: boolean;
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
  relationships?: MetadataContractRelationship[],
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
  pendingType?: string,
  parentFieldAppend?: { node: SpaceNode; field: string },
): void {
  const firstPara = item.children.find((c) => c.type === 'paragraph') as Paragraph | undefined;

  if (!firstPara) {
    appendContent(contentTarget, `- ${mdastToString(item)}`);
    return;
  }

  const rawText = mdastToString(firstPara);
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

    const linkTargets = buildLinkTargets(title);
    const newNode: SpaceNode = {
      label: makeLabel(title),
      schemaData,
      linkTargets,
      resolvedParents: [],
      resolvedType: resolveNodeType(type, typeAliases),
    };
    nodes.push(newNode);

    if (parentFieldAppend) {
      const linkRef = `[[${linkTargets[0] ?? title}]]`;
      const fieldName = parentFieldAppend.field;
      const fieldValue = parentFieldAppend.node.schemaData[fieldName];

      if (fieldValue === undefined) {
        // Field doesn't exist yet - create new array
        parentFieldAppend.node.schemaData[fieldName] = [linkRef];
      } else if (Array.isArray(fieldValue)) {
        // Field is already an array - append to it
        fieldValue.push(linkRef);
      } else {
        // Field exists but is not an array - this is an error
        throw new Error(
          `Cannot append child link to field '${fieldName}' on node '${parentFieldAppend.node.label}': ` +
            `field exists but is not an array (found ${typeof fieldValue}). ` +
            `Child link: ${linkRef}`,
        );
      }
    }

    const nestedParentRef = `[[${linkTargets[0] ?? title}]]`;
    for (const child of item.children) {
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
          );
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
  metadata: SchemaMetadata;
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

  type ParseState = 'preamble' | 'active' | 'done';
  let parseState: ParseState = 'preamble';

  const diagnostics: SpaceOnAPageDiagnostics = {
    preambleNodeCount: 0,
    terminatedHeadings: [],
  };

  function getParentContextType(): string | undefined {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.nodeType) return stack[i]!.nodeType;
    }
    return undefined;
  }

  function matchUnified(title: string, parentType: string | undefined): UnifiedMatch | undefined {
    if (!parentType) return undefined;
    const lowerTitle = title.toLowerCase();

    // 1. Check relationships first (explicit matches)
    for (const rel of relationships) {
      if (rel.parent === parentType) {
        for (const matcher of rel.matchers || []) {
          if (matcher.startsWith('^') && matcher.endsWith('$')) {
            if (new RegExp(matcher, 'i').test(title)) return { ...rel, isHierarchy: false };
          } else if (matcher.startsWith('/') && matcher.endsWith('/')) {
            const pattern = matcher.slice(1, -1);
            if (new RegExp(pattern, 'i').test(title)) return { ...rel, isHierarchy: false };
          } else if (lowerTitle === matcher.toLowerCase()) {
            return { ...rel, isHierarchy: false };
          }
        }
        if (lowerTitle === rel.type.toLowerCase()) {
          return { ...rel, isHierarchy: false }; // fallback implicit match
        }
      }
    }

    // 2. Check hierarchy (implicit matches)
    const parentIdx = hierarchy.indexOf(parentType);
    if (parentIdx !== -1 && parentIdx < hierarchy.length - 1) {
      const nextType = hierarchy[parentIdx + 1]!;
      const level = levels[parentIdx + 1]!;
      if (lowerTitle === nextType.toLowerCase()) {
        return {
          parent: parentType,
          type: nextType,
          field: level.field,
          fieldOn: level.fieldOn,
          multiple: level.multiple,
          format: 'heading', // Default for hierarchy
          isHierarchy: true,
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

  let pendingMatch: UnifiedMatch | undefined;
  let currentActiveNode: SpaceNode = rootNode;

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

      const parentContextType = getParentContextType();
      const anchorType = anchor ? anchorToNodeType(anchor, hierarchy, relationships) : undefined;
      const unifiedMatch = matchUnified(title, parentContextType);
      const hasExplicitType = !!inlineFields.type;
      const hasImpliedType = !!anchorType || !!unifiedMatch;

      if (!isOnAPageMode && !hasExplicitType && !hasImpliedType) {
        while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
          stack.pop();
        }
        stack.push({ depth, title, nodeType: '', refTarget: title });
        pendingMatch = undefined;
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

      const type = inlineFields.type ?? anchorType ?? unifiedMatch?.type ?? defaultNodeType(stack, hierarchy);
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

      // If this match came from a relationship/hierarchy and no explicit type was given,
      // delay adding the node until we see the following content (agnostic parsing).
      if (!hasExplicitType && !anchorType && unifiedMatch) {
        pendingMatch = unifiedMatch;
        currentActiveNode = headingNode;
      } else {
        nodes.push(headingNode);
        currentActiveNode = headingNode;
        pendingMatch = undefined;
      }

      const refTarget = linkTargets[0] ?? title;
      stack.push({ depth, title, nodeType: type, refTarget });
    } else if (parseState !== 'active') {
      diagnostics.preambleNodeCount++;
    } else if (child.type === 'list') {
      const parentRef = currentParentRef();
      const list = child as List;

      if (pendingMatch) {
        // Grandparent is the true semantic parent for relationship-driven items
        let semanticParentRef = parentRef;
        let semanticParentNode: SpaceNode | undefined;
        for (let i = stack.length - 2; i >= 0; i--) {
          if (stack[i]!.nodeType !== '') {
            semanticParentRef = `[[${stack[i]!.refTarget}]]`;
            const refTarget = stack[i]!.refTarget;
            semanticParentNode = nodes.find((n) => n.linkTargets.includes(refTarget));
            break;
          }
        }

        const isParentSide = pendingMatch.fieldOn === 'parent';
        const parentFieldAppend =
          isParentSide && semanticParentNode && pendingMatch.field
            ? { node: semanticParentNode, field: pendingMatch.field }
            : undefined;

        for (const item of list.children) {
          processListItem(
            item,
            isParentSide ? undefined : semanticParentRef,
            currentActiveNode,
            nodes,
            makeLabel,
            buildListItemLinkTargets,
            typeAliases,
            fieldMap,
            pendingMatch.type,
            parentFieldAppend,
          );
        }
        pendingMatch = undefined;
      } else {
        for (const item of list.children) {
          processListItem(
            item,
            parentRef,
            currentActiveNode,
            nodes,
            makeLabel,
            buildListItemLinkTargets,
            typeAliases,
            fieldMap,
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
        let activeMatch = pendingMatch;

        if (activeMatch) {
          rowTypeStr = activeMatch.type;
        } else if (firstColName) {
          if (hierarchy.includes(firstColName) || typeAliases[firstColName]) {
            rowTypeStr = firstColName;
          } else {
            const rootRel = matchUnified(firstColName, parentContextType);
            if (rootRel) {
              rowTypeStr = rootRel.type;
              activeMatch = rootRel;
            }
          }
        }

        if (!rowTypeStr && currentActiveNode !== rootNode && currentActiveNode.schemaData.type) {
          const contextAsParentRel = matchUnified(firstColName || '', currentActiveNode.schemaData.type as string);
          if (contextAsParentRel) {
            rowTypeStr = contextAsParentRel.type;
            activeMatch = contextAsParentRel;
          }
        }

        if (rowTypeStr) {
          let semanticParentRef = parentRef;
          let semanticParentNode: SpaceNode | undefined;
          if (activeMatch || rowTypeStr === parentContextType) {
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

            const linkTargets = buildListItemLinkTargets(title);
            const rowNode: SpaceNode = {
              label: makeLabel(title),
              schemaData,
              linkTargets,
              resolvedParents: [],
              resolvedType: resolveNodeType(rowTypeStr, typeAliases),
            };
            nodes.push(rowNode);

            if (tableParentFieldAppend) {
              const linkRef = `[[${linkTargets[0] ?? title}]]`;
              const fieldName = tableParentFieldAppend.field;
              const fieldValue = tableParentFieldAppend.node.schemaData[fieldName];

              if (fieldValue === undefined) {
                // Field doesn't exist yet - create new array
                tableParentFieldAppend.node.schemaData[fieldName] = [linkRef];
              } else if (Array.isArray(fieldValue)) {
                // Field is already an array - append to it
                fieldValue.push(linkRef);
              } else {
                // Field exists but is not an array - this is an error
                throw new Error(
                  `Cannot append child link to field '${fieldName}' on node '${tableParentFieldAppend.node.label}': ` +
                    `field exists but is not an array (found ${typeof fieldValue}). ` +
                    `Child link: ${linkRef}`,
                );
              }
            }
          }
          pendingMatch = undefined;
        } else {
          appendContent(currentActiveNode, mdastToString(child));
        }
      }
    } else {
      // For any other content (paragraph, code, etc), if we had a pending match,
      // it means the heading itself is the node. Add it now.
      if (pendingMatch) {
        nodes.push(currentActiveNode);
        pendingMatch = undefined;
      }

      if (child.type === 'paragraph') {
        const rawText = mdastToString(child);
        const { cleanText: afterBracketed, fields: bracketedFields } = extractBracketedFields(rawText);
        const { remainingText, fields: unbracketedFields } = extractUnbracketedFields(afterBracketed);
        const allFields = applyFieldMap({ ...unbracketedFields, ...bracketedFields }, fieldMap);

        if ('type' in allFields) {
          throw new Error(
            `Type override via paragraph field is not supported at "${currentActiveNode.schemaData.title ?? currentActiveNode.label}". ` +
              `Put [type:: ${(allFields as Record<string, string>).type}] directly in the heading text.`,
          );
        }

        Object.assign(currentActiveNode.schemaData, allFields);
        if (remainingText) appendContent(currentActiveNode, remainingText);
      } else if (child.type === 'code' && (child as Code).lang?.trim() === 'yaml') {
        const code = child as Code;
        const parsed = yamlLoad(code.value);
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
          Object.assign(currentActiveNode.schemaData, applyFieldMap(parsed as Record<string, unknown>, fieldMap));
        } else if (Array.isArray(parsed)) {
          throw new Error(`YAML block must be an object at "${currentActiveNode.label}".`);
        } else {
          appendContent(currentActiveNode, code.value);
        }
      } else {
        appendContent(currentActiveNode, mdastToString(child));
      }
    }
  }

  return { nodes, diagnostics };
}
