import { readFileSync } from 'fs';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import { load as yamlLoad } from 'js-yaml';
import type { Root, Heading, List, ListItem, Paragraph, Code } from 'mdast';
import type { OstNode, OstPageReadResult } from './types.js';

const OST_TYPES = ['vision', 'mission', 'goal', 'opportunity', 'solution'] as const;

/**
 * Returns the default OST type for a new heading based on its parent's effective type.
 * The first heading in a document defaults to 'vision'; each child is the next in sequence.
 */
function defaultOstType(stack: StackEntry[]): string {
  if (stack.length === 0) return OST_TYPES[0]!;
  const parentType = stack[stack.length - 1]!.ostType;
  const idx = OST_TYPES.indexOf(parentType as typeof OST_TYPES[number]);
  if (idx === -1 || idx >= OST_TYPES.length - 1) {
    throw new Error(`No OST type follows "${parentType}" — cannot determine type for child heading`);
  }
  return OST_TYPES[idx + 1]!;
}

const DEFAULT_STATUS = 'identified';

/** Extract [key:: value] bracketed inline fields, return cleaned text and fields. */
function extractBracketedFields(text: string): { cleanText: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const cleanText = text.replace(/\[([^\]]+?):: *([^\]]*)\]/g, (_, key, value) => {
    fields[key.trim()] = value.trim();
    return '';
  }).trim();
  return { cleanText, fields };
}

/**
 * Extract unbracketed dataview fields (key:: value on own line).
 * Keys must be identifier-style (letters, digits, hyphens, underscores — no spaces).
 * Lines matching the pattern are consumed as fields; other lines kept as content.
 */
function extractUnbracketedFields(text: string): { remainingText: string; fields: Record<string, string> } {
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

function appendContent(node: OstNode, text: string): void {
  if (!text) return;
  const existing = node.data.content as string | undefined;
  node.data.content = existing ? `${existing}\n${text}` : text;
}

/**
 * Process a list item. Reads only the item's own paragraph (not nested lists)
 * to extract the type and text. Typed items become nodes; untyped items append
 * to contentTarget. Nested lists are processed recursively.
 */
function processListItem(
  item: ListItem,
  parentTitle: string | undefined,
  contentTarget: OstNode,
  nodes: OstNode[]
): void {
  const firstPara = item.children.find(c => c.type === 'paragraph') as Paragraph | undefined;

  if (!firstPara) {
    // No paragraph child (e.g. a list that starts directly with a nested list).
    // Recover by appending whatever text we can extract.
    appendContent(contentTarget, `- ${mdastToString(item as any)}`);
    return;
  }

  const rawText = mdastToString(firstPara as any);
  const { cleanText, fields } = extractBracketedFields(rawText);

  if (fields.type) {
    // Typed bullet → child node
    const dashIdx = cleanText.indexOf(' - ');
    const title = (dashIdx >= 0 ? cleanText.slice(0, dashIdx) : cleanText).trim();
    const summary = dashIdx >= 0 ? cleanText.slice(dashIdx + 3).trim() : undefined;

    const data: Record<string, unknown> = {
      title,
      type: fields.type,
      status: DEFAULT_STATUS,
      ...fields,
    };
    if (parentTitle) data.parent = `[[${parentTitle}]]`;
    if (summary) data.summary = summary;

    const newNode: OstNode = { label: title, data };
    nodes.push(newNode);

    // Recursively process nested lists with newNode as both parent and content target
    for (const child of item.children) {
      if (child.type === 'list') {
        for (const subItem of (child as List).children) {
          processListItem(subItem, title, newNode, nodes);
        }
      }
    }
  } else {
    // Untyped bullet → append to content target
    appendContent(contentTarget, `- ${rawText}`);
  }
}

interface StackEntry {
  depth: number;
  title: string;
  ostType: string;
}

export function readOstPage(filePath: string): OstPageReadResult {
  const raw = readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(raw);

  const nodes: OstNode[] = [];

  const rootNode: OstNode = {
    label: filePath,
    data: { ...frontmatter, type: 'ost_on_a_page' },
  };
  nodes.push(rootNode);

  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(body) as Root;

  // Heading ancestry stack
  const stack: StackEntry[] = [];

  // Tracks the most recent heading node; paragraphs and untyped bullets target this,
  // not nodes[last] which may be a typed bullet child.
  let currentContextNode: OstNode = rootNode;

  // 'preamble': before the first OST heading — non-heading content is ignored.
  // 'active': inside the OST tree — content is parsed normally.
  // 'done': after a thematic break (---) during active parsing — everything ignored.
  type ParseState = 'preamble' | 'active' | 'done';
  let parseState: ParseState = 'preamble';

  const diagnostics = {
    preambleNodeCount: 0,
    terminatedHeadings: [] as string[],
  };

  function currentParentTitle(): string | undefined {
    return stack.length > 0 ? stack[stack.length - 1]!.title : undefined;
  }

  for (const child of tree.children) {
    if (parseState === 'done') {
      if (child.type === 'heading') {
        const rawTitle = mdastToString(child as any);
        const { cleanText: title } = extractBracketedFields(rawTitle);
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

      if (stack.length > 0) {
        const topDepth = stack[stack.length - 1]!.depth;
        if (depth > topDepth + 1) {
          const rawTitle = mdastToString(heading as any);
          throw new Error(
            `Heading level skipped: jumped from H${topDepth} to H${depth} at "${rawTitle}"`
          );
        }
      }

      while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }

      const rawText = mdastToString(heading as any);
      const { cleanText: title, fields: inlineFields } = extractBracketedFields(rawText);
      const type = inlineFields.type ?? defaultOstType(stack);
      const parentTitle = currentParentTitle();

      const data: Record<string, unknown> = {
        title,
        type,
        status: DEFAULT_STATUS,
        ...inlineFields,
      };
      if (parentTitle) data.parent = `[[${parentTitle}]]`;

      const headingNode: OstNode = { label: title, data };
      nodes.push(headingNode);
      currentContextNode = headingNode;
      stack.push({ depth, title, ostType: type });

    } else if (parseState !== 'active') {
      // Preamble content — ignore
      diagnostics.preambleNodeCount++;
    } else if (child.type === 'list') {
      const parentTitle = currentParentTitle();
      for (const item of (child as List).children) {
        processListItem(item, parentTitle, currentContextNode, nodes);
      }

    } else if (child.type === 'paragraph') {
      const rawText = mdastToString(child as any);

      // Extract bracketed fields first, then unbracketed fields from remaining text
      const { cleanText: afterBracketed, fields: bracketedFields } = extractBracketedFields(rawText);
      const { remainingText, fields: unbracketedFields } = extractUnbracketedFields(afterBracketed);

      const allFields = { ...unbracketedFields, ...bracketedFields };
      if ('type' in allFields) {
        throw new Error(
          `Type override via paragraph field is not supported at "${currentContextNode.data.title}". ` +
          `Put [type:: ${allFields.type}] directly in the heading text.`
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
            `Use typed bullets — e.g. "- [type:: solution] Title" — to define child nodes inline.`
          );
        } else if (parsed && typeof parsed === 'object') {
          // Object dict → merge as properties into current node
          Object.assign(currentContextNode.data, parsed as Record<string, unknown>);
        } else {
          // Scalar or null YAML — preserve raw value as content
          appendContent(currentContextNode, code.value);
        }
      } else {
        // Non-YAML code block — treat as content
        appendContent(currentContextNode, code.value);
      }

    } else {
      // Any other node type (blockquote, table, html, image, etc.) —
      // extract whatever text is available and preserve it as content
      const text = mdastToString(child as any);
      appendContent(currentContextNode, text);
    }
  }

  return { nodes, diagnostics };
}
