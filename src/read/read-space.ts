import { loadPlugins } from '../plugins/loader';
import type { ReadSpaceResult, SpaceContext } from '../types';
import { resolveGraphEdges } from './resolve-graph-edges';

export async function readSpace(context: SpaceContext): Promise<ReadSpaceResult> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.parse) continue;
    const result = await plugin.parse({ ...context, pluginConfig });
    if (result !== null) {
      const { nodes, unresolvedRefs } = resolveGraphEdges(result.nodes, context.metadata);
      return {
        nodes,
        source: plugin.name,
        parseIgnored: result.parseIgnored,
        diagnostics: result.diagnostics,
        unresolvedRefs,
      };
    }
  }

  throw new Error(`No plugin handled space at: ${context.space.path}`);
}
