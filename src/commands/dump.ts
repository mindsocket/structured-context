import { assembleSpaceGraph } from '../load-space-graph';
import { readSpace } from '../read/read-space';
import { exportSpaceGraph } from '../space-graph-data';
import type { ReadSpaceResult, SpaceContext } from '../types';

export interface DumpOptions {
  /** Named view (resolved via space.views) or a raw filter DSL expression. */
  filter?: string;
  /** Hierarchy used when evaluating the filter (default: the main hierarchy). */
  hierarchy?: string;
  /** Emit SpaceGraphData (nodes plus every hierarchy) instead of nodes, source and diagnostics. */
  graph?: boolean;
}

/**
 * Build the dump payload: every parsed node, or only nodes matched by a filter.
 *
 * Unfiltered dumps include schema-invalid nodes, since dump is a debugging aid.
 * Filtered dumps match show/render: the filter runs over the graph of schema-valid nodes.
 */
export async function buildDump(context: SpaceContext, options: DumpOptions = {}): Promise<ReadSpaceResult> {
  const readResult = await readSpace(context);
  if (!options.filter) return readResult;

  const graph = await assembleSpaceGraph(context, { ...options, readResult });
  const nodes = readResult.nodes.filter((node) => graph.nodes.get(node.id) === node);
  return { ...readResult, nodes };
}

export async function dump(context: SpaceContext, options: DumpOptions = {}) {
  const { nodes, source, diagnostics } = await buildDump(context, options);
  const output = options.graph ? exportSpaceGraph(nodes, context.schema.metadata) : { nodes, source, diagnostics };
  console.log(JSON.stringify(output, null, 2));
}
