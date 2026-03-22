import { loadPlugins } from '../plugins/loader';
import type { ReadSpaceResult, SpaceContext } from '../types';

export async function readSpace(context: SpaceContext): Promise<ReadSpaceResult> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);

  for (const { plugin, pluginConfig } of loaded) {
    if (!plugin.parse) continue;
    const result = await plugin.parse({ ...context, pluginConfig });
    if (result !== null) {
      return {
        nodes: result.nodes,
        source: plugin.name,
        diagnostics: result.diagnostics,
        unresolvedRefs: result.unresolvedRefs,
      };
    }
  }

  throw new Error(`No plugin handled space at: ${context.space.path}`);
}
