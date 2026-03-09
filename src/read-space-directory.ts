import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { applyFieldMap, loadConfig, resolveSchema } from './config';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { resolveLinks } from './resolve-links';
import { loadMetadata, resolveNodeType } from './schema';
import type { SpaceDirectoryReadResult, SpaceNode } from './types';

export async function readSpaceDirectory(
  directory: string,
  options?: { includeOnAPageFiles?: boolean; schemaPath?: string; templateDir?: string },
): Promise<SpaceDirectoryReadResult> {
  const absoluteDirectory = resolve(directory);
  const config = loadConfig();
  const space = config.spaces.find((s) => resolve(s.path) === absoluteDirectory);

  const resolvedSchemaPath = resolveSchema(options?.schemaPath, config, space);
  const metadata = loadMetadata(resolvedSchemaPath);
  const hierarchyLevels = metadata.hierarchy?.levels ?? [];
  const hierarchyTypes = hierarchyLevels.map((level) => level.type);
  const { typeAliases } = metadata;
  const fieldMap = space?.fieldMap;

  const templateDir = options?.templateDir ?? space?.templateDir ?? config.templateDir;
  const absoluteTemplateDir = templateDir ? resolve(templateDir) : undefined;

  const files = await glob('**/*.md', { cwd: directory, absolute: false });
  const nodes: SpaceNode[] = [];
  const skipped: string[] = [];
  const nonSpace: string[] = [];

  for (const file of files) {
    const absoluteFilePath = resolve(directory, file);

    if (absoluteTemplateDir && absoluteFilePath.startsWith(absoluteTemplateDir)) {
      continue;
    }

    const content = readFileSync(join(directory, file), 'utf-8');
    const parsed = matter(content);

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      skipped.push(file);
      continue;
    }

    const data = applyFieldMap(parsed.data, fieldMap);

    if (!data.type) {
      nonSpace.push(file);
      continue;
    }

    if (ON_A_PAGE_TYPES.includes(data.type as string) && !options?.includeOnAPageFiles) {
      continue;
    }

    const pageType = data.type as string;
    const fileBase = basename(file, '.md');

    nodes.push({
      label: file,
      schemaData: { title: fileBase, ...data },
      linkTargets: [fileBase],
      resolvedParents: [],
      resolvedType: resolveNodeType(pageType, typeAliases),
    });

    // Extract embedded child nodes from the page body (typed pages with embedded nodes).
    // space_on_a_page files are already excluded above.
    if (!ON_A_PAGE_TYPES.includes(pageType)) {
      const { nodes: embedded } = extractEmbeddedNodes(parsed.content, {
        pageTitle: fileBase,
        pageType,
        hierarchy: hierarchyTypes,
        typeAliases: typeAliases,
        fieldMap,
      });
      nodes.push(...embedded);
    }
  }

  resolveLinks(nodes, hierarchyLevels);
  return { nodes, skipped, nonSpace };
}
