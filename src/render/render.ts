import { shortenPluginName } from '@/plugins/util';
import { updateSpaceField } from '../config';
import { filterNodes } from '../filter/filter-nodes';
import { loadPlugins } from '../plugins/loader';
import { readSpace } from '../read/read-space';
import { buildSpaceGraph } from '../space-graph';
import type { SpaceContext, SpaceNode } from '../types';
import { buildFormatRegistry } from './registry';

export async function executeRender(
  formatName: string,
  context: SpaceContext,
  options: { filter?: string; data?: Record<string, unknown> },
): Promise<string> {
  const pluginMap: Record<string, Record<string, unknown>> = context.space?.plugins ?? {};
  const loaded = await loadPlugins(pluginMap, context.configDir);
  const registry = buildFormatRegistry(loaded);

  const entry = registry.find((r) => r.qualifiedName === formatName);
  if (!entry) {
    const available = registry.map((r) => r.qualifiedName).join(', ');
    throw new Error(
      `Unknown render format: "${formatName}".${available ? ` Available: ${available}` : ' No formats registered.'}`,
    );
  }

  const { nodes: allNodes } = await readSpace(context);

  // Validate: drop nodes that fail schema validation
  const { schemaValidator } = context;
  const validNodes: SpaceNode[] = allNodes.filter((node) => schemaValidator(node.schemaData));

  const levels = context.schema.metadata.hierarchy?.levels ?? [];
  let graph = buildSpaceGraph(validNodes, levels);

  // Filter: apply filter expression if provided
  if (options.filter) {
    const expression = context.space.views?.[options.filter]?.expression ?? options.filter;
    graph = await filterNodes(expression, graph);
  }

  const shortName = shortenPluginName(entry.plugin.plugin.name);
  const pluginContext = {
    ...context,
    pluginConfig: entry.plugin.pluginConfig,
    callbacks: {
      persistConfig: (updates: Record<string, string>) => {
        for (const [field, value] of Object.entries(updates)) {
          updateSpaceField(context.space.name, field, value, shortName);
        }
      },
    },
  };
  return entry.plugin.plugin.render!.render(pluginContext, graph, {
    format: entry.format.name,
    data: options.data,
  });
}
