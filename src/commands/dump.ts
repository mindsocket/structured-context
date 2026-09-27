import { assembleSpaceGraph } from '../load-space-graph';
import { readSpace } from '../read/read-space';
import type { ReadSpaceResult, SpaceContext } from '../types';

export interface DumpOptions {
  /** Named view (resolved via space.views) or a raw filter DSL expression. */
  filter?: string;
  /** Hierarchy used when evaluating the filter (default: the main hierarchy). */
  hierarchy?: string;
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
  const nodes = readResult.nodes.filter((node) => graph.nodes.get(node.title) === node);
  return { ...readResult, nodes };
}

export async function dump(context: SpaceContext, options: DumpOptions = {}) {
  const { nodes, source, diagnostics } = await buildDump(context, options);
  console.log(JSON.stringify({ nodes, source, diagnostics }, null, 2));
}
