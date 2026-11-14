---
title: "Programmatic API"
---

# Programmatic API

The package exposes a library entry point at `structured-context/api` for embedding the
tooling in other applications. It runs the same Read → Validate → Graph pipeline the CLI uses;
see [architecture.md](architecture.md#information-flow) for that flow.

## Main building blocks

| Export | Purpose |
| --- | --- |
| `loadConfig()` | Load the resolved config (spaces, schemas) from the standard config locations. |
| `createSpaceContext(spaceName, config, options?)` | Build a `SpaceContext` for a named space (resolves bundled, local, or plugin schemas). |
| `readSpace(context)` | Read a space into a flat `ReadSpaceResult` (`nodes`, `parseIssues`, `diagnostics`, `source`). |
| `loadSpaceGraph(spaceName, config, options?)` | Read, assemble, and optionally filter a space into a navigable `SpaceGraph`. |
| `assembleSpaceGraph(context, options?)` | Assemble (and optionally filter) a graph from a context you already hold. |
| `buildSpaceGraph(nodes, hierarchy?)` | Build a navigable `SpaceGraph` directly from an array of `SpaceNode`s and a `Hierarchy` definition. |
| `exportSpaceGraph(nodes, metadata)` | Turn nodes and the schema's hierarchies into plain JSON for another process. See [Space graph format](#space-graph-format). |
| `spaceGraphFrom(data, options?)` | Build a `SpaceGraph` from that JSON. |
| `validateSpace(context, options?)` | Run full validation (schema, references, rules, duplicates) over a space. |
| `validateFile(filePath, config)` | Validate a single file within its space. |
| `listSchemas(options?)` | List the schemas available to a config: bundled, plugin-contributed and configured. |
| `formatWikilink(target, alias?)` | Format a target into an Obsidian wikilink (`[[target]]` or `[[target|alias]]`). |
| `parseWikilink(link)` | Parse a wikilink or target string into `{ target, anchor?, displayText? }`. |
| `wikilinkToTarget(link)` | Extract the plain target lookup key from a wikilink string. |
| `buildTargetIndex(nodes)` | Build a fast lookup index mapping link target strings to nodes (marking ambiguous targets as `null`). |

Read each [validation issue](concepts.md#validation-results-and-nodes)'s `severity` rather than deriving it from `kind`.

## Space graph format

`exportSpaceGraph` returns the [space graph format](concepts.md#space-graph-format):

```jsonc
{ "formatVersion": 1, "hierarchies": [/* Hierarchy */], "mainHierarchy": "…", "nodes": [/* SpaceNode */] }
```

Edges are each node's `resolvedParents`. An exported subset keeps its edges to nodes outside the subset. The
receiver picks the hierarchy when it builds the graph.

`structured-context/browser` holds what a browser needs to load the data, and imports no Node built-ins.
Everything in it is also exported from `structured-context/api`. Derive other types from its exports, such as
`Parameters<typeof spaceGraphFrom>[0]` for the data.

```ts
// Server
const { nodes } = await readSpace(context);
const data = exportSpaceGraph(nodes, context.schema.metadata); // or graph.nodes.values() for a filtered graph

// Browser
import { spaceGraphFrom } from 'structured-context/browser';
const graph = spaceGraphFrom(data, { hierarchy: 'work' });
```

`sctx dump <space> --graph` prints the same data. The JSON Schema for each released
`formatVersion` ships in `schemas/generated/space-graph/`, named by version, and `latest.json` is the newest.

## Usage

```ts
import {
  loadConfig,
  loadSpaceGraph,
  assembleSpaceGraph,
  createSpaceContext,
  readSpace,
  validateSpace,
} from 'structured-context/api';

const config = loadConfig();

const graph = await loadSpaceGraph('my-space', config, { filter: 'my-view' });

// Read once; assemble and validate from the same read.
const context = createSpaceContext('my-space', config);
const readResult = await readSpace(context);
const sharedGraph = await assembleSpaceGraph(context, { readResult });
const validation = await validateSpace(context, { readResult });
```

## Hand-assembled config

A `Config` can be built in memory. Pass `configDir` with it, since relative paths in plugin config resolve from the
[config root](config.md#config-file-location) and an in-memory config has none:

```ts
import { loadSpaceGraph, type Config } from 'structured-context/api';

const config: Config = {
  spaces: [{ name: 'my-space', path: '/abs/path/to/space', schema: '/abs/path/to/schema.json' }],
};
const graph = await loadSpaceGraph('my-space', config, { configDir: process.cwd() });
```

## Resources

`resourceDir(root, name)` finds one kind of resource (such as `plugins` or `map-views`) for a config root, by
the [resources folder](config.md#resources-folder) layout. A tool that adds its own kind of resource uses it too.

A plugin ships its own resources in `<pluginRoot>/<kind>/`, or in the folder its `package.json` names under
`"sctx": { "<kind>": "…" }`. Plugin schemas use the `schemas` kind.

## Plugin render hooks

A plugin adds formats to `sctx render` with a `render` hook (`RenderHook`).
