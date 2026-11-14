import { updateSpaceField } from '../config';
import { assembleSpaceGraph } from '../load-space-graph';
import { validatePluginConfig } from '../plugins/loader';
import { type PluginContext, type RenderResult, shortenPluginName } from '../plugins/util';
import { readSpace } from '../read/read-space';
import { exportSpaceGraph } from '../space-graph-data';
import type { SpaceContext } from '../types';
import { validateSpace } from '../validate';
import { renderFormats } from './registry';

export async function executeRender(
  formatName: string,
  context: SpaceContext,
  options: { filter?: string; hierarchy?: string; data?: Record<string, unknown> },
): Promise<RenderResult> {
  const registry = await renderFormats(context);

  const entry = registry.find((r) => r.qualifiedName === formatName);
  if (!entry) {
    const available = registry.map((r) => r.qualifiedName).join(', ');
    throw new Error(
      `Unknown render format: "${formatName}".${available ? ` Available: ${available}` : ' No formats registered.'}`,
    );
  }
  const { plugin } = entry;
  const pluginConfig = validatePluginConfig(plugin, context.space?.plugins ?? {}, context.configDir);

  const readResult = await readSpace(context);
  const graph = await assembleSpaceGraph(context, { filter: options.filter, hierarchy: options.hierarchy, readResult });

  const shortName = shortenPluginName(plugin.name);
  const pluginContext: PluginContext = {
    ...context,
    pluginConfig,
    callbacks: {
      persistConfig: (updates) => {
        for (const [field, value] of Object.entries(updates)) {
          updateSpaceField(context.space.name, field, value, shortName);
        }
      },
      validate: async (validateOptions) => (await validateSpace(context, { ...validateOptions, readResult })).issues,
      exportGraph: () =>
        exportSpaceGraph(graph.nodes.values(), {
          hierarchy: graph.hierarchy,
          hierarchies: context.schema.metadata.hierarchies,
        }),
    },
  };
  return plugin.render!.render(pluginContext, graph, { format: entry.format.name, data: options.data });
}
