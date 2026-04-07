# ost-tools Configuration Reference

## Config file location

ost-tools looks for its config file in this order:

1. `$OST_TOOLS_CONFIG` — explicit path override
2. `~/.config/ost-tools/config.json` (or `$XDG_CONFIG_HOME/ost-tools/config.json`)
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
      "schema": "general.json"
    }
  ]
}
```

**`includeSpacesFrom`** — import space definitions from other config files. Useful for aggregating spaces from multiple projects into a central config. Duplicate space names are not allowed.

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
    "ost-tools-confluence": { "baseUrl": "https://example.atlassian.net" }
  }
}
```

All plugin names must start with `ost-tools-` (the prefix is optional in config and normalised on load). The special name `markdown` refers to the built-in markdown plugin. External plugins are resolved in order: config-adjacent (`{configDir}/plugins/{name}`), then npm. Each plugin must export a `configSchema` JSON Schema; config is validated against it on load. Fields annotated `format: 'path'` in a plugin's `configSchema` are resolved relative to the config file directory.

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

Use a view name with `ost-tools show <space> --filter <view-name>`.

See `ost-tools docs concepts` for full filter expression syntax.

## Security notice

**⚠️ Only use schemas and configuration files from trusted sources.**

The tool executes JSONata expressions defined in schema files for rule validation. A maliciously crafted schema could make JSONata access JavaScript's prototype chain and execute arbitrary code. Only use schemas you've created or reviewed personally.
