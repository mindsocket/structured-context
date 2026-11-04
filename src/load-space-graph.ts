import type { Config } from './config';
import { filterNodes } from './filter/filter-nodes';
import { readSpace } from './read/read-space';
import { extractSchemaTypeNames } from './schema/schema';
import { createSpaceContext } from './space-context';
import { buildSpaceGraph, type SpaceGraph, selectHierarchy } from './space-graph';
import type { ReadSpaceResult, SpaceContext, SpaceNode } from './types';

export interface AssembleSpaceGraphOptions {
  /** Named view (resolved via space.views) or a raw filter DSL expression. */
  filter?: string;
  /** Name of the hierarchy to structure the graph by. Defaults to the schema's main hierarchy. */
  hierarchy?: string;
  /** Pre-loaded read result to assemble from, avoiding a re-read of the space. */
  readResult?: ReadSpaceResult;
}

/**
 * Assemble a SpaceGraph from a space context: read the space, drop nodes whose type the schema
 * does not define, build the graph for the selected hierarchy (the main hierarchy by default),
 * and apply an optional view/filter expression.
 *
 * A node with schema field errors (for example an invalid enum value) stays in the graph, since
 * it still has a type and a place in the hierarchy. Only nodes that cannot be placed are left
 * out. This is NOT a validation pass — nodes may have field errors, broken references, rule
 * violations, or duplicates. Use validateSpace for a full validation report.
 *
 * Shared by the render pipeline and the public loadSpaceGraph API so their
 * graph-assembly behaviour cannot drift.
 */
export async function assembleSpaceGraph(
  context: SpaceContext,
  options: AssembleSpaceGraphOptions = {},
): Promise<SpaceGraph> {
  const { nodes: allNodes } = options.readResult ?? (await readSpace(context));

  const { schema, schemaRefRegistry } = context;
  const schemaTypes = Array.isArray(schema.oneOf) ? extractSchemaTypeNames(schema, schemaRefRegistry) : undefined;
  const placeableNodes: SpaceNode[] = schemaTypes
    ? allNodes.filter((node) => schemaTypes.has(String((node.schemaData as Record<string, unknown>).type)))
    : allNodes;

  let graph = buildSpaceGraph(placeableNodes, selectHierarchy(context.schema.metadata, options.hierarchy));

  if (options.filter) {
    const expression = context.space.views?.[options.filter]?.expression ?? options.filter;
    graph = await filterNodes(expression, graph);
  }

  return graph;
}

export interface LoadSpaceGraphOptions extends AssembleSpaceGraphOptions {
  /**
   * Directory to anchor relative plugin paths against. Required when config is
   * hand-assembled (has no source file); see {@link createSpaceContext}.
   */
  configDir?: string;
}

/**
 * Load a named space and return its assembled, filtered SpaceGraph.
 *
 * Convenience entry point over createSpaceContext + assembleSpaceGraph: pass a
 * space name, config, and optional filter. Pass options.readResult to reuse an
 * already-loaded read (e.g. when also calling validateSpace) and skip re-reading.
 * When you already hold a SpaceContext, call assembleSpaceGraph directly to avoid
 * rebuilding (and recompiling the schema for) the context.
 */
export async function loadSpaceGraph(
  spaceName: string,
  config: Config,
  options: LoadSpaceGraphOptions = {},
): Promise<SpaceGraph> {
  const context = createSpaceContext(spaceName, config, { configDir: options.configDir });
  return assembleSpaceGraph(context, options);
}
