---
title: "Configuration Reference"
---

# Configuration Reference

## Config file location

structured-context looks for its config file in this order:

1. `$SCTX_CONFIG` — explicit path override
2. `~/.config/structured-context/config.json` (or `$XDG_CONFIG_HOME/structured-context/config.json`)
3. `./config.json` in the current working directory

See `config.example.json` for the full structure. Paths in config files are resolved relative to the config file.

## Spaces

A space is a named directory or single file registered in the config. Example:

```json
{
  "spaces": [
    {
      "name": "ProductX",
      "path": "/path/to/space",
      "schema": "strategy_general.json"
    }
  ]
}
```

**`schema`** — the schema used to validate nodes in the space. Can be:
- A bundled schema name (e.g. `strategy_general.json`, `strict_ost.json`)
- A local path relative to the config file (e.g. `./schemas/custom.json`) or absolute path
- A plugin schema prefixed with the plugin name (e.g. `sctx-wardley-mapping/wardley_map.json` or `wardley-mapping/wardley_map.json`). Specifying a plugin-prefixed schema automatically loads that plugin for the space.
- A simple filename (e.g. `wardley_map.json`) provided by a plugin explicitly declared under `plugins`.

**`includeSpacesFrom`** — import space definitions from other config files. Useful for aggregating spaces from multiple projects into a central config. Duplicate space names are not allowed.

A config must define at least one of `spaces` or `includeSpacesFrom`. When using `includeSpacesFrom` alone, `spaces` can be omitted entirely.

## Plugins

Use `plugins` to load parse plugins that read spaces from non-markdown sources. The built-in markdown plugin is always available without any declaration. Plugins are tried in order; the first to return a result wins. The `plugins` field is a map of plugin name to plugin config, and can be declared at the top level (applies to all spaces) or per-space (overrides the top level):

```json
{
  "spaces": [
    {
      "name": "ProductX",
      "path": "/path/to/space",
      "plugins": {
        "markdown": { "fieldMap": { "record_type": "type" } }
      }
    }
  ],
  "plugins": {
    "sctx-confluence": { "baseUrl": "https://example.atlassian.net" }
  }
}
```

All plugin names must start with `sctx-` (the prefix is optional in config and normalised on load). The special name `markdown` refers to the built-in markdown plugin. External plugins are resolved in order: config-adjacent (`{configDir}/plugins/{name}`), then npm. Each plugin must export a `configSchema` JSON Schema; config is validated against it on load. Fields annotated `format: 'path'` in a plugin's `configSchema` are resolved relative to the config file directory.

Plugins can also contribute schemas and partials via a `<pluginRoot>/schemas/` directory (or `"sctx": { "schemas": "..." }` in `package.json`). If a space specifies a plugin-prefixed schema (e.g. `"sctx-wardley-mapping/wardley_map.json"`), schemas are resolved statically without executing plugin code, and the plugin's code hooks are loaded when parsing or rendering.

## Model providers and judge

structured-context judges [semantic rules](semantic-rules.md) with a **model provider**: a named definition that says which wire API to speak, which model to use and where. A provider definition combines an `api`, explicit values or environment-variable names, and the key source.

**Bundled providers** work without any configuration: a fixed model per vendor chosen by this project, plus `-env` variants that also read the vendor's usual model and endpoint variables (`OPENAI_MODEL`, `OPENAI_BASE_URL`, `ANTHROPIC_MODEL`), falling back to the bundle's defaults where a variable is unset. Bundles without `-env` read no environment beyond the key: they behave the same on every machine.

Run `sctx providers` for the authoritative list of bundled and configured providers with their effective API, endpoint, model and key variable. Keys are never shown. `bun run test:models` checks that each bundled model resolves on its endpoint.

### Wire APIs and bundled-provider conventions

A provider's `api` names the **request shape**, potentially supported by multiple vendors.

| API | Shape | Bundled providers |
|---|---|---|
| `openrouter-decisions` | Decisions API, closed-set `choice` questions, answers with confidence and probabilities | `openrouter-jev`, `openrouter-openai-decisions` |
| `typesafe-systemone` | Same decisions shape (currently) | `typesafe-jev` |
| `openai-decisions` | OpenAI's Decisions API: same concept, its own request/response shape | `openai-decisions` |
| `anthropic-messages` | Chat: one request per rule, structured JSON verdict | `anthropic`, `anthropic-haiku-5-5`, `anthropic-env` |
| `openai-completions` | Chat: OpenAI-compatible; works with Ollama, vLLM and OpenRouter | `openai`, `openai-env`, `openrouter-openai` |

Bundled provider names follow the pattern:

- `<vendor>` — this project's recommended model for that vendor; can change between releases.
- `<vendor>-<model>` (e.g. `anthropic-haiku-5-5`) — pins a model id, so it does not drift when the `<vendor>` bundle's recommendation moves.
- `<vendor>-env` — hydrates model, endpoint etc from the vendor's usual environment variables.
- `openrouter-<vendor>-<purpose>` (e.g. `openrouter-openai-decisions`) — aggregating vendor's endpoint variant

**Configured providers** live in `modelProviders` at the top level, and replace a bundled provider of the same name. Fields a configured provider leaves out still take the API defaults:

```json
{
  "modelProviders": {
    "mine": { "api": "openrouter-decisions", "apiKeyEnv": "MY_JEV_KEY" },
    "local": { "api": "openai-completions", "endpoint": "http://localhost:11434/v1" }
  }
}
```

| Field | Description |
|---|---|
| `api` | **Required.** The wire API (see the table above and [Choosing a judge](semantic-rules.md#choosing-a-judge)), or `fake` (for tests). |
| `model` | A fixed model. Its default depends on the API. |
| `modelEnv` | Environment variable holding a model override. An explicit `model` wins; a variable set but empty is an error. |
| `endpoint` | A fixed API URL. |
| `endpointEnv` | Environment variable holding an endpoint override. Same precedence as `modelEnv`. |
| `apiKeyEnv` | The environment variable that holds the key. Defaults to the API's usual variable (see the table above). A local `openai-completions` endpoint can need no key. |
| `apiKey` | The key itself. Use `apiKeyEnv` instead, so that keys stay out of config files. |

Resolution per field: the explicit value wins, then the named environment variable, then the API default. Provider implementations read no environment; all hydration happens before one runs.

The environment holds only keys and the variables a `-env` bundle names. No environment variable selects a provider.

The top-level `judge` names the model provider that judges semantic rules: a bundled provider or an entry in `modelProviders`. A space can set its own `judge`, which replaces the top-level one for that space, for example to keep a private space on a local model:

```json
{
  "judge": { "provider": "openrouter-jev" },
  "spaces": [
    { "name": "private-notes", "path": "/path/to/notes", "judge": { "provider": "local" } }
  ]
}
```

Config does not turn semantic rules on. Each run asks for them with `--semantic`, or with `--judge <provider>`, which also selects a different provider for that run.

## Markdown plugin config

Set under `plugins.markdown` per space.

### `fieldMap`

Maps file/frontmatter field names to canonical schema field names:

```json
{ "fieldMap": { "record_type": "type" } }
```

### `templateDir` and `templatePrefix`

- `templateDir` — directory containing template files (used by `template-sync` and excluded when parsing)
- `templatePrefix` — filename prefix for templates (default blank)

### `typeInference`

Automatically assigns a node type based on folder structure when no `type` field is present in frontmatter. Explicit `type:` always takes precedence.

**`mode`** — controls the matching strategy:
- `"folder-name"` (default) — matches the leaf directory name case-insensitively against schema type names and alias keys
- `"off"` — disables inference entirely

```json
{
  "plugins": {
    "markdown": {
      "typeInference": { "mode": "folder-name" }
    }
  }
}
```

**`folderMap`** — explicit map from folder path (relative to space root) to type name or alias. When set, replaces auto-matching entirely; only folders listed in the map are inferred.

```json
{
  "plugins": {
    "markdown": {
      "typeInference": {
        "folderMap": {
          "Research": "source",
          "Personal": "note",
          "topics/concepts": "concept"
        }
      }
    }
  }
}
```

Longest-prefix matching is used when keys overlap (e.g. `a/b` and `a/b/c` both present). Trailing slashes in keys are normalised. Values may be type aliases (resolved to canonical type). An unresolvable value throws a hard error at parse time.

## Filter views

Named filter expressions can be defined per space under `views`. Each view has an `expression` field:

```json
{
  "spaces": [
    {
      "name": "my-space",
      "path": "/path/to/space",
      "views": {
        "active-solutions": {
          "expression": "WHERE resolvedType='solution' and status='active'"
        },
        "solutions-under-active-opportunity": {
          "expression": "WHERE resolvedType='solution' and $exists(ancestors[resolvedType='opportunity' and status='active'])"
        }
      }
    }
  ]
}
```

Use a view name with `sctx show <space> --filter <view-name>`.

See `sctx docs concepts` for full filter expression syntax.

## Security notice

**⚠️ Only use schemas and configuration files from trusted sources.**

The tool executes JSONata expressions defined in schema files for rule validation. A maliciously crafted schema could make JSONata access JavaScript's prototype chain and execute arbitrary code. Only use schemas you've created or reviewed personally.
