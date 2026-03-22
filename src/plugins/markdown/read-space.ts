import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Glob } from 'bun';
import matter from 'gray-matter';
import { resolveGraphEdges } from '../../read/resolve-graph-edges';
import { resolveNodeType } from '../../schema/schema';
import type { SpaceNode } from '../../types';
import type { ParseResult, PluginContext } from '../util';
import type { MarkdownPluginConfig } from '.';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { applyFieldMap } from './util';

type ReadSpaceDirectoryOptions = {
  includeOnAPageFiles?: boolean;
};

export function readSpaceOnAPage(context: PluginContext): ParseResult {
  const { space, resolvedSchemaPath, metadata } = context;
  const filePath = resolve(space.path);
  const raw = readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(raw);

  const pageType = frontmatter.type as string | undefined;
  if (pageType !== undefined && !ON_A_PAGE_TYPES.includes(pageType)) {
    throw new Error(
      `Expected a space_on_a_page file but got type "${pageType}" in ${filePath}. ` +
        `Use a directory path to validate a space containing typed node files.`,
    );
  }

  const hierarchyLevels = metadata.hierarchy?.levels;
  if (!hierarchyLevels || hierarchyLevels.length === 0) {
    throw new Error(
      `Schema at ${resolvedSchemaPath} must define "$metadata.hierarchy.levels" to read a space_on_a_page file.`,
    );
  }

  const pageTitle = basename(filePath, '.md');
  const { nodes, preambleNodeCount, terminatedHeadings } = extractEmbeddedNodes(body, {
    pageTitle,
    pageType: 'space_on_a_page',
    metadata,
  });

  const unresolvedRefs = resolveGraphEdges(nodes, metadata);
  return { nodes, unresolvedRefs, diagnostics: { kind: 'page', preambleNodeCount, terminatedHeadings } };
}

export async function readSpaceDirectory(
  context: PluginContext,
  options?: ReadSpaceDirectoryOptions,
): Promise<ParseResult> {
  const { space, metadata } = context;
  const directory = resolve(space.path);
  const mdCfg = context.pluginConfig as MarkdownPluginConfig;

  const fieldMap = mdCfg.fieldMap;

  const templateDir = mdCfg.templateDir;
  const absoluteTemplateDir = templateDir ? resolve(templateDir) : undefined;

  const files = await Array.fromAsync(new Glob('**/*.md').scan({ cwd: directory, followSymlinks: true }));
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

  const unresolvedRefs = resolveGraphEdges(nodes, metadata);
  return { nodes, unresolvedRefs, parseIgnored: [...skipped, ...nonSpace], diagnostics: { kind: 'directory' } };
}
