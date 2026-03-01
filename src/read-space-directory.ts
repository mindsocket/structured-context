import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { loadConfig, resolveSchema } from './config';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { resolveParentLinks } from './resolve-links';
import { loadMetadata, resolveNodeType } from './schema';
import type { SpaceDirectoryReadResult, SpaceNode } from './types';

export async function readSpaceDirectory(
  directory: string,
  options?: { includeOnAPageFiles?: boolean; schemaPath?: string },
): Promise<SpaceDirectoryReadResult> {
  const files = await glob('**/*.md', { cwd: directory, absolute: false });
  const nodes: SpaceNode[] = [];
  const skipped: string[] = [];
  const nonSpace: string[] = [];

  const config = loadConfig();
  const resolvedSchemaPath = resolveSchema(options?.schemaPath, config);
  const { hierarchy, aliases } = loadMetadata(resolvedSchemaPath);

  for (const file of files) {
    const content = readFileSync(join(directory, file), 'utf-8');
    const parsed = matter(content);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      skipped.push(file);
      continue;
    }

    if (!parsed.data.type) {
      nonSpace.push(file);
      continue;
    }

    if (ON_A_PAGE_TYPES.includes(parsed.data.type) && !options?.includeOnAPageFiles) {
      continue;
    }

    const pageType = parsed.data.type as string;
    const fileBase = basename(file, '.md');

    nodes.push({
      label: file,
      schemaData: { title: fileBase, ...parsed.data },
      linkTargets: [fileBase],
      resolvedType: resolveNodeType(pageType, aliases),
    });

    // Extract embedded child nodes from the page body (typed pages with embedded nodes).
    // space_on_a_page files are already excluded above.
    if (!ON_A_PAGE_TYPES.includes(pageType)) {
      const { nodes: embedded } = extractEmbeddedNodes(parsed.content, {
        pageTitle: fileBase,
        pageType,
        hierarchy,
        aliases,
      });
      nodes.push(...embedded);
    }
  }

  resolveParentLinks(nodes);
  return { nodes, skipped, nonSpace };
}
