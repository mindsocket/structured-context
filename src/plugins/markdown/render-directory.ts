import { posix } from 'node:path';
import matter from 'gray-matter';
import type { SpaceGraph } from '../../space-graph';
import type { PluginContext, RenderMultiFileOutput, RenderOptions } from '../util';
import { getMarkdownConfig } from './index';
import { invertFieldMap, MATTER_OPTIONS } from './util';

/**
 * Sanitize a node title into a valid filesystem filename.
 * Strips Obsidian/OS forbidden characters: \ / : * ? " < > | # ^ [ ]
 */
export function sanitizeFilename(title: string): string {
  const sanitized = title
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return sanitized || 'untitled';
}

const PREFERRED_FIELD_ORDER = ['type', 'title', 'status', 'summary', 'status_tweet'];
const EDGE_FIELDS = new Set(['parent', 'dependsOn', 'flowsTo', 'anchors', 'pipelineOf']);

/**
 * Format frontmatter object with preferred key ordering for Obsidian notes.
 */
function sortFrontmatterKeys(data: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(data);
  const preferred: string[] = [];
  const edge: string[] = [];
  const middle: string[] = [];

  for (const k of PREFERRED_FIELD_ORDER) {
    if (keys.includes(k)) preferred.push(k);
  }
  for (const k of keys) {
    if (EDGE_FIELDS.has(k)) {
      edge.push(k);
    } else if (!PREFERRED_FIELD_ORDER.includes(k)) {
      middle.push(k);
    }
  }

  const sorted: Record<string, unknown> = {};
  for (const k of [...preferred, ...middle, ...edge]) {
    sorted[k] = data[k];
  }
  return sorted;
}

/**
 * Render a space graph as a markdown directory with one file per node.
 */
export function renderMarkdownDirectory(
  context: PluginContext,
  graph: SpaceGraph,
  options: RenderOptions,
): RenderMultiFileOutput {
  const markdownConfig = getMarkdownConfig(context.space?.plugins);
  const reverseFieldMap = markdownConfig.fieldMap ? invertFieldMap(markdownConfig.fieldMap) : {};

  const foldersOption = options.data?.folders;
  let useFolders = false;
  if (foldersOption === 'type') {
    useFolders = true;
  } else if (foldersOption === 'flat') {
    useFolders = false;
  } else if (markdownConfig.typeInference?.folderMap) {
    useFolders = true;
  }

  // Build type-to-folder mapping from typeInference.folderMap if available
  const folderMap = markdownConfig.typeInference?.folderMap;
  const typeToFolder = new Map<string, string>();
  if (folderMap) {
    for (const [folderPath, mappedType] of Object.entries(folderMap)) {
      const cleanFolder = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
      typeToFolder.set(mappedType.toLowerCase(), cleanFolder);
    }
  }

  const files: Array<{ path: string; content: string }> = [];
  const usedPaths = new Set<string>();

  for (const node of graph.nodes.values()) {
    const baseName = sanitizeFilename(node.title);

    let folder = '';
    if (useFolders) {
      const typeKey = (node.resolvedType || node.type || '').toLowerCase();
      folder = typeToFolder.get(typeKey) ?? (node.resolvedType || node.type || 'other');
    }

    let candidateName = `${baseName}.md`;
    let counter = 2;
    let relPath = folder ? posix.join(folder, candidateName) : candidateName;
    while (usedPaths.has(relPath)) {
      candidateName = `${baseName}-${counter}.md`;
      relPath = folder ? posix.join(folder, candidateName) : candidateName;
      counter++;
    }
    usedPaths.add(relPath);

    const finalBase = candidateName.slice(0, -3);

    // Prepare frontmatter data from schemaData with reverse fieldMap
    const rawData = (node.schemaData as Record<string, unknown>) ?? {};
    const frontmatterData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(rawData)) {
      // Body content is not written to frontmatter
      if (key === 'content') continue;
      // Omit title only if it matches the final filename base
      if (key === 'title' && finalBase === node.title) continue;

      const fileKey = reverseFieldMap[key] ?? key;
      frontmatterData[fileKey] = value;
    }

    // Preserve exact title if final filename differed or disambiguation occurred
    if (finalBase !== node.title && !frontmatterData.title) {
      const titleKey = reverseFieldMap.title ?? 'title';
      frontmatterData[titleKey] = node.title;
    }

    // Ensure type is in frontmatter
    const nodeType = node.type || node.resolvedType;
    if (nodeType && !frontmatterData.type) {
      const typeKey = reverseFieldMap.type ?? 'type';
      frontmatterData[typeKey] = nodeType;
    }

    const sortedData = sortFrontmatterKeys(frontmatterData);
    const body = (node.content ?? '').trim();

    let fileContent: string;
    if (Object.keys(sortedData).length > 0) {
      fileContent = matter.stringify(body ? `\n${body}\n` : '', sortedData, MATTER_OPTIONS);
    } else {
      fileContent = body ? `${body}\n` : '';
    }

    files.push({
      path: relPath,
      content: fileContent,
    });
  }

  return { files };
}
