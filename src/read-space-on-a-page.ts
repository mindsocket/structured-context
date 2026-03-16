import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import matter from 'gray-matter';
import { loadConfig, resolveSchema } from './config';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { resolveHierarchyEdges } from './resolve-hierarchy-edges';
import { loadMetadata } from './schema';
import type { SpaceOnAPageReadResult } from './types';

export function readSpaceOnAPage(filePath: string, schemaPath?: string): SpaceOnAPageReadResult {
  const raw = readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(raw);

  const pageType = frontmatter.type as string | undefined;
  if (pageType !== undefined && !ON_A_PAGE_TYPES.includes(pageType)) {
    throw new Error(
      `Expected a space_on_a_page file but got type "${pageType}" in ${filePath}. ` +
        `Use a directory path to validate a space containing typed node files.`,
    );
  }

  const config = loadConfig();
  const space = config.spaces.find((s) => resolve(s.path) === resolve(filePath));
  const resolvedSchemaPath = resolveSchema(schemaPath, config, space);
  const metadata = loadMetadata(resolvedSchemaPath);
  const hierarchyLevels = metadata.hierarchy?.levels;
  if (!hierarchyLevels || hierarchyLevels.length === 0) {
    throw new Error(
      `Schema at ${resolvedSchemaPath} must define "$metadata.hierarchy.levels" to read a space_on_a_page file.`,
    );
  }
  const hierarchyTypes = hierarchyLevels.map((level) => level.type);
  const relationships = metadata.relationships ?? [];
  const { typeAliases } = metadata;

  const pageTitle = basename(filePath, '.md');
  const { nodes, diagnostics } = extractEmbeddedNodes(body, {
    pageTitle,
    pageType: 'space_on_a_page',
    hierarchy: hierarchyTypes,
    relationships: relationships,
    typeAliases,
  });
  resolveHierarchyEdges(nodes, hierarchyLevels);
  return { nodes, diagnostics };
}
