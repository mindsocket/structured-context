import { loadPlugins, resourceDirs } from '../plugins/loader';
import type { ReadSpaceResult, SpaceContext } from '../types';
import { resolveGraphEdges } from './resolve-graph-edges';

export async function readSpace(context: SpaceContext): Promise<ReadSpaceResult> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.parse) continue;
    const result = await plugin.parse({
      ...context,
      pluginConfig,
      callbacks: { resourceDirs: (kind) => resourceDirs(kind, context) },
    });
    if (result !== null) {
      const { nodes, unresolvedRefs, unresolvedContentLinks } = resolveGraphEdges(
        result.nodes,
        context.schema.metadata,
        result.excludedPages,
      );
      return {
        nodes,
        source: plugin.name,
        parseIssues: result.parseIssues,
        diagnostics: result.diagnostics,
        unresolvedRefs,
        unresolvedContentLinks,
      };
    }
  }

  throw new Error(`No plugin handled space at: ${context.space.path}`);
}
