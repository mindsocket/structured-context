import { readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { applyFieldMap, loadConfig, resolveSchema } from '../config';
import { loadMetadata, resolveNodeType } from '../schema/schema';
import type { SchemaMetadata, SpaceDirectoryReadResult, SpaceNode, SpaceOnAPageReadResult } from '../types';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { resolveGraphEdges } from './resolve-graph-edges';

export interface ReadSpaceDirectoryOptions {
  includeOnAPageFiles?: boolean;
  schemaPath?: string;
  templateDir?: string;
}

export type ReadSpaceResult =
  | ({ kind: 'page' } & SpaceOnAPageReadResult)
  | ({ kind: 'directory' } & SpaceDirectoryReadResult);

interface SpaceContext {
  space: ReturnType<typeof loadConfig>['spaces'][number] | undefined;
  config: ReturnType<typeof loadConfig>;
  resolvedSchemaPath: string;
  metadata: SchemaMetadata;
}

function loadSpaceContext(path: string, schemaPath?: string): SpaceContext {
  const config = loadConfig();
  const space = config.spaces.find((s) => resolve(s.path) === resolve(path));
  const resolvedSchemaPath = resolveSchema(schemaPath, config, space);
  const metadata = loadMetadata(resolvedSchemaPath);
  return { space, config, resolvedSchemaPath, metadata };
}

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

  const { resolvedSchemaPath, metadata } = loadSpaceContext(filePath, schemaPath);
  const hierarchyLevels = metadata.hierarchy?.levels;
  if (!hierarchyLevels || hierarchyLevels.length === 0) {
    throw new Error(
      `Schema at ${resolvedSchemaPath} must define "$metadata.hierarchy.levels" to read a space_on_a_page file.`,
    );
  }

  const pageTitle = basename(filePath, '.md');
  const { nodes, diagnostics } = extractEmbeddedNodes(body, {
    pageTitle,
    pageType: 'space_on_a_page',
    metadata,
  });

  resolveGraphEdges(nodes, hierarchyLevels, metadata.relationships, metadata.typeAliases);
  return { nodes, diagnostics };
}

export async function readSpaceDirectory(
  directory: string,
  options?: ReadSpaceDirectoryOptions,
): Promise<SpaceDirectoryReadResult> {
  const absoluteDirectory = resolve(directory);
  const { space, config, metadata } = loadSpaceContext(absoluteDirectory, options?.schemaPath);

  const hierarchyLevels = metadata.hierarchy?.levels ?? [];
  const fieldMap = space?.fieldMap;

  const templateDir = options?.templateDir ?? space?.templateDir ?? config.templateDir;
  const absoluteTemplateDir = templateDir ? resolve(templateDir) : undefined;

  const files = await glob('**/*.md', { cwd: directory, absolute: false, follow: true });
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
    const title = (data.title as string) ?? fileBase;

    nodes.push({
      label: file,
      schemaData: { title, ...data },
      linkTargets: [title, fileBase],
      resolvedParents: [],
      resolvedType: resolveNodeType(pageType, metadata.typeAliases),
    });

    if (!ON_A_PAGE_TYPES.includes(pageType)) {
      const { nodes: embedded } = extractEmbeddedNodes(parsed.content, {
        pageTitle: fileBase,
        pageType,
        metadata,
        fieldMap,
      });
      nodes.push(...embedded);
    }
  }

  resolveGraphEdges(nodes, hierarchyLevels, metadata.relationships, metadata.typeAliases);
  return { nodes, skipped, nonSpace };
}

export async function readSpace(path: string, options: ReadSpaceDirectoryOptions = {}): Promise<ReadSpaceResult> {
  if (statSync(path).isFile()) {
    return { kind: 'page', ...readSpaceOnAPage(path, options.schemaPath) };
  }
  return { kind: 'directory', ...(await readSpaceDirectory(path, options)) };
}
