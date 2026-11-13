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
| `loadSpaceGraph(spaceName, config, options?)` | Read, assemble, and optionally filter a space into a navigable `SpaceGraph`. `options.hierarchy` names the hierarchy that structures the graph (default: the main hierarchy). |
| `assembleSpaceGraph(context, options?)` | Assemble (and optionally filter) a graph from a context you already hold — reuses the context instead of rebuilding it. |
| `buildSpaceGraph(nodes, hierarchy?)` | Build a navigable `SpaceGraph` directly from an array of `SpaceNode`s and a `Hierarchy` definition. |
| `exportSpaceGraph(nodes, metadata)` | Turn nodes and the schema's hierarchies into plain JSON for another process. See [Space graph format](#space-graph-format). |
| `spaceGraphFrom(data, options?)` | Build a `SpaceGraph` from that JSON. `options.hierarchy` names the hierarchy that structures it (default: the main hierarchy). |
| `validateSpace(context, options?)` | Run full validation (schema, references, rules, duplicates) over a space. Semantic rules run only when `semantic` is passed; it takes the same values as `sctx validate --semantic`, with the provider coming from config and the environment. |
| `validateFile(filePath, config)` | Validate a single file within its space. |
| `listSchemas(options?)` | List the schemas available to a config: bundled, plugin-contributed and configured. |
| `formatWikilink(target, alias?)` | Format a target into an Obsidian wikilink (`[[target]]` or `[[target|alias]]`). |
| `parseWikilink(link)` | Parse a wikilink or target string into `{ target, anchor?, displayText? }`. |
| `wikilinkToTarget(link)` | Extract the plain target lookup key from a wikilink string. |
| `buildTargetIndex(nodes)` | Build a fast lookup index mapping link target strings to nodes (marking ambiguous targets as `null`). |

`ValidationResult.issues` lists every [validation issue](concepts.md#validation-results-and-nodes) the run found, and `validateFile` returns one node's issues. Only `error` issues are failures. Read each issue's `severity` rather than deriving it from `kind`. `VALIDATION_ISSUE_KINDS` lists the kinds at runtime.

A `SpaceGraph` classifies nodes against one hierarchy, and indexes child nodes and typed edges in both
directions.

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

// Common path: read, assemble, and filter in one call.
// `filter` resolves a named view from the space config, falling back to a raw filter expression.
const graph = await loadSpaceGraph('my-space', config, { filter: 'my-view' });

// Read once, then assemble a graph and validate from the same read and context.
// Reusing the context avoids re-reading the space *and* recompiling the schema.
const context = createSpaceContext('my-space', config);
const readResult = await readSpace(context);
const sharedGraph = await assembleSpaceGraph(context, { readResult });
const validation = await validateSpace(context, { readResult });
```

## Validation vs. graph assembly

`loadSpaceGraph` keeps every node whose type the schema defines, including nodes with field errors
such as an invalid enum value. Nodes of an unknown type are left out. The graph is *not* a validation
pass: use `validateSpace` (or `validateFile`) for field errors, broken references, rule violations and
duplicates.

## Hand-assembled config

`config` does not have to come from `loadConfig()` — you can construct a `Config` in memory and pass
it to `createSpaceContext`, `loadSpaceGraph`, or `validateFile`, the same way the CLI does. Provide
each space's `path` and a resolvable `schema` (absolute paths are simplest):

```ts
import { loadSpaceGraph, type Config } from 'structured-context/api';

const config: Config = {
  spaces: [{ name: 'my-space', path: '/abs/path/to/space', schema: '/abs/path/to/schema.json' }],
};
const graph = await loadSpaceGraph('my-space', config, { configDir: process.cwd() });
```

Relative paths in a space's plugin config are resolved against the [config root](config.md#config-file-location)
of the file that defined the space. A hand-assembled `Config` has no such file, so you must pass an explicit
`configDir` to anchor them (`createSpaceContext`, `loadSpaceGraph`, and `validateFile` all accept it).
Omitting it throws rather than silently guessing the working directory — prefer absolute paths so the
anchor never matters.

## Resources

`resolveConfigPath()` returns the config's `root` along with its path. `resourceDir(root, name)` returns the
folder holding one kind of resource for that root (such as `plugins` or `map-views`), or `undefined` when
there is none. It follows the [resources folder](config.md#resources-folder) layout, so a tool that adds its
own kind of resource finds it the same way.

## Plugin render hooks

Plugins declare render formats via `render.formats` and implement `render(context, graph, options)`. The hook may return a single string or multi-file output:

```ts
import type { RenderHook, RenderResult, RenderMultiFileOutput } from 'structured-context/api';

const myRenderHook: RenderHook = {
  formats: [{ name: 'my-format', description: 'Outputs multiple files' }],
  render(context, graph, options) {
    return {
      files: [
        { path: 'section-1.md', content: '...' },
        { path: 'subfolder/section-2.md', content: '...' },
      ],
    };
  },
};
```

A render hook gets two callbacks in `context.callbacks`, so a plugin needs no runtime import of structured-context:

- `validate(options)` validates the whole space and returns every issue, of every severity. Its options are those of `validateSpace`: `includeGated`, `ruleFilter`, `semantic` and `depth`. Semantic judging runs only when a run asks for it, so pass `semantic` from the render options, not from plugin config.
- `exportGraph()` returns the graph being rendered in the [space graph format](#space-graph-format), structured by the hierarchy the render selected.

