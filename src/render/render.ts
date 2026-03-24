import { filterNodes } from '../filter/filter-nodes';
import { loadPlugins } from '../plugins/loader';
import { readSpace } from '../read/read-space';
import type { SpaceContext, SpaceNode } from '../types';
import { classifyNodes } from '../util/graph-helpers';
import { buildFormatRegistry } from './registry';

export async function executeRender(
  formatName: string,
  context: SpaceContext,
  options: { filter?: string },
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

  // Filter: apply filter expression if provided
  let nodes = validNodes;
  if (options.filter) {
    const expression = context.space.views?.[options.filter]?.expression ?? options.filter;
    nodes = await filterNodes(expression, nodes);
  }

  // Classify
  const levels = context.schema.metadata.hierarchy?.levels ?? [];
  const classification = classifyNodes(nodes, levels);

  return entry.plugin.plugin.render!.render(entry.format.name, { nodes, classification, context });
}
