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

structured-context judges [semantic rules](semantic-rules.md) with a **model provider**: a named definition that says which model to use and how to reach it. The bundled providers `jev`, `anthropic` and `openai` take their type defaults; an entry in `modelProviders` replaces a bundled provider of the same name, and fields it leaves out still take the defaults. Set `modelProviders` at the top level when the bundled defaults do not suit.

```json
{
  "modelProviders": {
    "jev": { "type": "jev" },
    "claude": { "type": "anthropic", "model": "claude-haiku-5-5" },
    "local": { "type": "openai", "endpoint": "http://localhost:11434/v1" }
  }
}
```

| Field | Description |
|---|---|
| `type` | **Required.** `jev`, `anthropic` or `openai` (see [Choosing a judge](semantic-rules.md#choosing-a-judge)), or `fake` (for tests). |
| `model` | Defaults: `typesafe/jev-1.13` (jev), `claude-haiku-5-5` (anthropic), `gpt-4o-mini` (openai). |
| `endpoint` | Override the API URL. Jev defaults to `https://openrouter.ai/api/alpha/decisions`. |
| `apiKeyEnv` | The environment variable that holds the key. Defaults: `OPENROUTER_API_KEY` (jev), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. A local `openai` endpoint can need no key. |
| `apiKey` | The key itself. Use `apiKeyEnv` instead, so that keys stay out of config files. |

The environment holds only keys: no environment variable selects or configures a provider.

The top-level `judge` names the model provider that judges semantic rules: a bundled provider or an entry in `modelProviders`. A space can set its own `judge`, which replaces the top-level one for that space, for example to keep a private space on a local model:

```json
{
  "modelProviders": {
    "jev": { "type": "jev" },
    "local": { "type": "openai", "endpoint": "http://localhost:11434/v1" }
  },
  "judge": { "provider": "jev" },
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
