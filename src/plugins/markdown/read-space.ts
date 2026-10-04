import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import type { BaseNode } from '../../api';
import { extractSchemaTypeNames } from '../../schema/schema';
import type { ParseIssue } from '../../types';
import type { ParseResult, PluginContext } from '../util';
import type { MarkdownPluginConfig } from '.';
import { extractLinksFromBody, extractLinksFromFrontmatter, getEdgeFieldNames } from './extract-content-links';
import { extractEmbeddedNodes, ON_A_PAGE_TYPES } from './parse-embedded';
import { applyFieldMap, coerceDates, inferTypeFromPath } from './util';

type ReadSpaceDirectoryOptions = {
  includeOnAPageFiles?: boolean;
};

export function readSpaceOnAPage(context: PluginContext): ParseResult {
  const {
    space,
    resolvedSchemaPath,
    schema: { metadata },
  } = context;
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
  const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const lineOffset = fmMatch ? (fmMatch[0].match(/\n/g) || []).length : 0;
  const fileName = basename(filePath);

  const { nodes, preambleNodeCount, terminatedHeadings } = extractEmbeddedNodes(body, {
    pageTitle,
    pageType: 'space_on_a_page',
    metadata,
    file: fileName,
    lineOffset,
  });

  const parseIssues: ParseIssue[] = terminatedHeadings.map((heading) => ({
    file: heading,
    severity: 'warning',
    type: 'terminated',
    message: 'Ignored headings detected beyond end of hierarchy.',
  }));
  return { nodes, parseIssues, diagnostics: { kind: 'page', preambleNodeCount } };
}

export async function readSpaceDirectory(
  context: PluginContext,
  options?: ReadSpaceDirectoryOptions,
): Promise<ParseResult> {
  const {
    space,
    schema: { metadata },
  } = context;
  const directory = resolve(space.path);
  const mdCfg = context.pluginConfig as MarkdownPluginConfig;

  const fieldMap = mdCfg.fieldMap;

  const templateDir = mdCfg.templateDir;
  const absoluteTemplateDir = templateDir ? resolve(templateDir) : undefined;

  const typeInferenceCfg = mdCfg.typeInference;
  const knownTypes =
    typeInferenceCfg?.mode !== 'off' ? extractSchemaTypeNames(context.schema, context.schemaRefRegistry) : undefined;

  const edgeFields = getEdgeFieldNames(metadata);

  const files = await fg('**/*.md', { cwd: directory, followSymbolicLinks: true });
  const nodes: BaseNode[] = [];
  const parseIssues: ParseIssue[] = [];

  for (const file of files) {
    const absoluteFilePath = resolve(directory, file);

    if (absoluteTemplateDir && absoluteFilePath.startsWith(absoluteTemplateDir)) {
      continue;
    }

    const content = readFileSync(join(directory, file), 'utf-8');

    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(content);
    } catch (err) {
      // gray-matter caches parsed YAML and has a known bug where a caught exception
      // corrupts its internal cache, causing subsequent parses to silently return {}.
      // Clear the cache after any parse error to avoid stale state.
      // See: https://github.com/jonschlinkert/gray-matter/issues/166
      (matter as unknown as { clearCache: () => void }).clearCache();
      const yamlErr = err as { mark?: { line: number; column: number } };
      const line = yamlErr.mark ? yamlErr.mark.line + 1 : undefined;
      const column = yamlErr.mark ? yamlErr.mark.column + 1 : undefined;
      parseIssues.push({
        file,
        severity: 'error',
        type: 'parse',
        message: err instanceof Error ? err.message : String(err),
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {}),
      });
      continue;
    }

    if (!parsed.data || Object.keys(parsed.data).length === 0) {
      parseIssues.push({
        file,
        severity: 'warning',
        type: 'no-type',
        message: 'No front-matter or type specified',
        line: 1,
      });
      continue;
    }

    const data = coerceDates(applyFieldMap(parsed.data, fieldMap));

    if (!data.type && typeInferenceCfg && knownTypes) {
      data.type = inferTypeFromPath(file, typeInferenceCfg, knownTypes, context.schema.metadata.typeAliases);
    }

    if (!data.type) {
      parseIssues.push({ file, severity: 'warning', type: 'no-type', line: 1 });
      continue;
    }

    if (ON_A_PAGE_TYPES.includes(data.type as string) && !options?.includeOnAPageFiles) {
      continue;
    }

    const pageType = data.type as string;
    const fileBase = basename(file, '.md');
    const title = (data.title as string) ?? fileBase;
    const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const lineOffset = fmMatch ? (fmMatch[0].match(/\n/g) || []).length : 0;

    const pageNode: BaseNode = {
      label: file,
      title,
      schemaData: { title, ...data },
      linkTargets: [title, fileBase],
      type: pageType,
      source: { file, line: 1 },
      ...(data.content !== undefined ? { content: data.content as string } : {}),
      contentLinks: [...extractLinksFromFrontmatter(data, edgeFields), ...extractLinksFromBody(parsed.content)],
    };

    if (!ON_A_PAGE_TYPES.includes(pageType)) {
      const {
        nodes: embedded,
        preambleContent,
        preambleFields,
        terminatedHeadings,
      } = extractEmbeddedNodes(parsed.content, {
        pageTitle: fileBase,
        pageType,
        metadata,
        fieldMap,
        file,
        lineOffset,
      });
      if (preambleFields) {
        Object.assign(pageNode.schemaData, preambleFields);
      }
      if (preambleContent) {
        pageNode.schemaData.content = preambleContent;
        pageNode.content = preambleContent;
      }
      nodes.push(pageNode);
      nodes.push(...embedded);
      for (const heading of terminatedHeadings) {
        parseIssues.push({
          file: `${file} > ${heading}`,
          severity: 'warning',
          type: 'terminated',
          message: 'Ignored headings detected beyond end of hierarchy.',
        });
      }
    } else {
      nodes.push(pageNode);
    }
  }

  return { nodes, parseIssues, diagnostics: { kind: 'directory' } };
}
