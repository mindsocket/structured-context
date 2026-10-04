# Programmatic API

The package exposes a library entry point at `structured-context/api` for embedding the
tooling in other applications. It runs the same Read → Validate → Graph pipeline the CLI uses;
see [architecture.md](architecture.md#information-flow) for that flow.

## Main building blocks

| Export | Purpose |
| --- | --- |
| `loadConfig()` | Load the resolved config (spaces, schemas) from the standard config locations. |
| `createSpaceContext(spaceName, config, options?)` | Build a `SpaceContext` for a named space (resolves bundled, local, or plugin schemas). Throws `SpaceNotFoundError` on an unknown name. |
| `readSpace(context)` | Read a space into a flat `ReadSpaceResult` (`nodes`, `parseIssues`, `diagnostics`, `source`). |
| `loadSpaceGraph(spaceName, config, options?)` | Read, assemble, and optionally filter a space into a navigable `SpaceGraph`. `options.hierarchy` names the hierarchy that structures the graph (default: the main hierarchy). |
| `assembleSpaceGraph(context, options?)` | Assemble (and optionally filter) a graph from a context you already hold — reuses the context instead of rebuilding it. |
| `buildSpaceGraph(nodes, hierarchy?)` | Build a navigable `SpaceGraph` directly from an array of `SpaceNode`s and a `Hierarchy` definition. |
| `validateSpace(context, options?)` | Run full validation (schema, references, rules, duplicates) over a space. |
| `validateFile(filePath, config)` | Validate a single file within its space. |
| `formatWikilink(target, alias?)` | Format a target into an Obsidian wikilink (`[[target]]` or `[[target|alias]]`). |
| `parseWikilink(link)` | Parse a wikilink or target string into `{ target, anchor?, displayText? }`. |
| `wikilinkToTarget(link)` | Extract the plain target lookup key from a wikilink string. |
| `buildTargetIndex(nodes)` | Build a fast lookup index mapping link target strings to nodes (marking ambiguous targets as `null`). |

`ValidationResult.ruleViolations` carries each violation's effective `severity` (`error`, `warning` or `info`). Only `error` severity violations should be treated as failures; `validateFile` reports `warning` and `info` rule violations under `warnings` rather than `errors`.

## Testing utilities

Test fixture builders are available via `structured-context/testing` for plugin and integration tests:

```ts
import {
  makeNode,
  makeSpaceNode,
  makeHierarchy,
  makeLevel,
  makeRelationship,
  makeParentRef,
} from 'structured-context/testing';
```

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

`loadSpaceGraph` silently drops nodes that fail schema validation so the returned graph is
well-formed for traversal and rendering. This is *not* a validation pass — schema-valid nodes
may still have broken references, rule violations, or duplicates. Use `validateSpace` (or
`validateFile`) for a full validation report.

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

Relative paths in a space's plugin config are resolved against the directory of the config file that
defined the space. A hand-assembled `Config` has no such file, so you must pass an explicit
`configDir` to anchor them (`createSpaceContext`, `loadSpaceGraph`, and `validateFile` all accept it).
Omitting it throws rather than silently guessing the working directory — prefer absolute paths so the
anchor never matters.

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

