// Public entry point: do not add exports without the maintainer's agreement (AGENTS.md, "Public API surface").
/**
 * Browser-safe API for structured-context: nothing here imports Node built-ins.
 *
 * Rebuild a graph that a server exported with exportSpaceGraph (or `sctx dump --graph`):
 *
 *   import { spaceGraphFrom } from 'structured-context/browser';
 *   const graph = spaceGraphFrom(await (await fetch('/graph.json')).json());
 *
 * Everything here is also exported from `structured-context/api`. Derive other types from these, e.g.
 * `Parameters<typeof spaceGraphFrom>[0]` for the exported data or `SpaceNode['id']` for a node id.
 */

export type { SpaceGraph } from './space-graph';
export { spaceGraphFrom } from './space-graph-data';
export type { SpaceNode } from './types';
