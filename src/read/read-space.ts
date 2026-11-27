import { loadPlugins } from '../plugins/loader';
import type { ParseOptions, ParseResult } from '../plugins/util';
import type { BaseNode, ReadSpaceResult, SpaceContext } from '../types';
import { resolveGraphEdges } from './resolve-graph-edges';

function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function toReadSpaceResult(
  source: string,
  result: ParseResult,
  metadata: SpaceContext['schema']['metadata'],
): ReadSpaceResult {
  const { nodes, unresolvedRefs, unresolvedContentLinks } = resolveGraphEdges(
    result.nodes,
    metadata,
    result.excludedPages,
  );
  return {
    nodes,
    source,
    parseIssues: result.parseIssues,
    diagnostics: result.diagnostics,
    unresolvedRefs,
    unresolvedContentLinks,
    ...(result.excludedPages ? { excludedPages: result.excludedPages } : {}),
  };
}

async function dispatchParse(
  context: SpaceContext,
  options?: ParseOptions,
): Promise<{ source: string; result: ParseResult }> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.parse) continue;
    const result = await plugin.parse({ ...context, pluginConfig }, options);
    if (result !== null) {
      return { source: plugin.name, result };
    }
  }

  throw new Error(`No plugin handled space at: ${context.space.path}`);
}

export async function readSpace(context: SpaceContext): Promise<ReadSpaceResult> {
  const { source, result } = await dispatchParse(context);
  return toReadSpaceResult(source, result, context.schema.metadata);
}

/**
 * Update a previous `ReadSpaceResult` for a set of changed files (paths relative to the space root, as in
 * `SourceLocation.file`). Drops nodes, parse issues and excluded pages from those files, asks the parse plugin
 * for only those files, merges the result, and resolves graph edges over the whole space.
 *
 * When a plugin ignores `files` (returns `partial !== true`), its result is treated as a full read.
 */
export async function refreshReadResult(
  context: SpaceContext,
  previous: ReadSpaceResult,
  changedFiles: string[],
): Promise<ReadSpaceResult> {
  const normalized = [...new Set(changedFiles.map(normalizeFile))];
  if (normalized.length === 0) return previous;

  const { source, result } = await dispatchParse(context, { files: normalized });
  if (!result.partial) {
    return toReadSpaceResult(source, result, context.schema.metadata);
  }

  const changedSet = new Set(normalized);
  const keptNodes: BaseNode[] = previous.nodes.filter(
    (n) => !n.source || !changedSet.has(normalizeFile(n.source.file)),
  );
  const keptParseIssues = previous.parseIssues.filter((i) => !changedSet.has(normalizeFile(i.source.file)));
  const keptExcludedPages = (previous.excludedPages ?? []).filter((p) => !changedSet.has(normalizeFile(p.source.file)));

  return toReadSpaceResult(
    source,
    {
      nodes: [...keptNodes, ...result.nodes],
      parseIssues: [...keptParseIssues, ...result.parseIssues],
      excludedPages: [...keptExcludedPages, ...(result.excludedPages ?? [])],
      diagnostics: { ...previous.diagnostics, ...result.diagnostics },
    },
    context.schema.metadata,
  );
}
