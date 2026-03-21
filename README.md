# ost-tools

Tools for working with Opportunity Solution Tree structures and other product management and strategy frameworks

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
bun install -g ost-tools
```

Or use directly via `bunx`:

```bash
bunx ost-tools validate <path>
```

## Setup for AI Agents

An AI agent skill is included with this project. To install it run:

```
npx skills add mindsocket/ost-tools
```

## Concepts

See [docs/concepts.md](docs/concepts.md) for the full terminology reference, including definitions of nodes, embedded nodes, spaces, schemas, rules, and more.

## Configuration

`ost-tools` looks for its config file in this order:

1. `$OST_TOOLS_CONFIG` — explicit path override
2. `~/.config/ost-tools/config.json` (or `$XDG_CONFIG_HOME/ost-tools/config.json`)
3. `./config.json` in the current working directory

See `config.example.json` for the full structure. The config maps space names to paths, with optional Miro integration fields and global defaults. Paths in config files are resolved relative to the config file.

**Including spaces from other configs:** Use `includeSpacesFrom` to import space definitions from other config files. This is useful for aggregating spaces from multiple projects into a central config, reducing the need to specify `--config` on CLI commands. Duplicate space names are not allowed.

**Plugins:** Use `plugins` to load parse plugins that read spaces from non-markdown sources. The built-in markdown plugin is always available without any declaration. Plugins are tried in order; the first to return a result wins. The `plugins` field is a map of plugin name to plugin config, and can be declared at the top level (applies to all spaces) or per-space (overrides the top level):

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

**Markdown plugin config** fields (set under `plugins.markdown` per space):
- `templateDir` — directory containing template files (used by `template-sync`)
- `templatePrefix` — filename prefix for templates (default blank)
- `fieldMap` — maps file/frontmatter field names to canonical schema field names (e.g. `{ "record_type": "type" }`)

### Spaces

A space is a named directory or single file registered in the config. Spaces let you reference content by name instead of path:

```bash
ost-tools validate ProductX
```

### Schemas

Schemas define the structure and rules for the entities in a space, allowing customisation and extension to different models.

Two schemas (`general` and `strict_ost`) are included. The general schema combines a basic vision/mission/goals hierarchy with a hierarchy loosely based on Opportunity Solution Trees. It is intentionally flexible to support rapid initial adoption. The strict OST schema has a narrower scope, and reflects Teresa Torres' specific recommendations for Opportunity Solution Trees more closely.

ost-tools schemas use a metaschema based on JSON Schema Draft-07 that adds a top-level `$metadata` block:

```json5
"$metadata": {
  "hierarchy": {
    "levels": ["outcome", { "type": "opportunity", "selfRef": true }, "solution", "assumption_test"],
    "allowSkipLevels": false
  },
  "relationships": [
    {
      "parent": "opportunity",
      "type": "assumption",
      "templateFormat": "table",
      "matchers": ["Assumptions"]
    }
  ],
  "aliases": { "experiment": "assumption_test" },
  "rules": [
    {
      "id": "active-outcome-count",
      "category": "workflow",
      "description": "Only one outcome should be active at a time",
      "scope": "global",
      "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
    }
  ]
}
```

Rules are a flat array (`rules[]`) with per-rule `category`.

Schema hierarchy levels support DAG (multi-parent) relationships via configurable edge fields. Each entry in `$metadata.hierarchy.levels` can be a plain type name string (defaults to `parent` field on child nodes) or an object:

```json5
// Example fragments for hierarchy level objects:
{ "type": "opportunity", "selfRef": true }
{ "type": "solution", "field": "fulfills", "multiple": true }
{ "type": "requirement", "field": "generates", "fieldOn": "parent", "multiple": true }
{ "type": "solution", "field": "solutions", "fieldOn": "parent", "multiple": true, "selfRefField": "parent" }
```

| Property | Default | Description |
|---|---|---|
| `type` | required | The node type at this hierarchy level |
| `field` | `"parent"` | Name of the edge field |
| `fieldOn` | `"child"` | Which side holds the field: `"child"` (child points up) or `"parent"` (parent points down) |
| `multiple` | `false` | Whether the field is an array of wikilinks (enables multi-parent DAG) |
| `selfRef` | `false` | Whether a node of this type may reference a same-type parent |
| `selfRefField` | _undefined_ | Optional field for same-type parent relationships (always on child-side and singular) |
| `templateFormat` | _undefined_ | Embedding hint (`"list"`, `"table"`, `"heading"`). When set alongside `matchers`, enables hierarchy embedding in typed pages |
| `matchers` | _undefined_ | Heading patterns (strings or `/regex/`) to match for hierarchy embedding. Case-insensitive. |
| `embeddedTemplateFields` | _undefined_ | Column names for table stubs when `template-sync` generates templates |

The `selfRefField` property enables different fields for regular vs same-type relationships. For example, requirements can list solutions via `solutions` on the requirement node, while solutions can reference parent solutions via `parent` on the solution node.

**Hierarchy embedding** — when `templateFormat` and `matchers` are set on a level, typed pages may include section headings that signal embedded content for that type without explicit `[type:: x]` annotations. Two patterns:

- **Child-level**: heading matches the child level's type/matchers → list or table items create child nodes.
- **Parent-level references**: heading matches the *parent* level's type/matchers → bare wikilink items (`- [[X]]`) populate the current node's reference field rather than creating new nodes. Useful for listing parent relationships inline.

Bare wikilink items (`- [[Existing Node]]`) in any embedding section populate a field rather than creating a new node.

**Adjacent Relationships** (`$metadata.relationships`) define connections between types outside the primary hierarchy — such as an `activity` having many `task` nodes. They drive embedded parsing (typed headings, lists, tables) and template generation.

| Property | Default | Description |
|---|---|---|
| `parent` | required | Parent canonical type |
| `type` | required | Child canonical type |
| `field` | `"parent"` | Frontmatter field holding the wikilink(s). Required when `fieldOn: "parent"`. |
| `fieldOn` | `"child"` | `"child"`: child holds a link pointing up. `"parent"`: parent holds an array of child links. |
| `templateFormat` | `"page"` | Hint for `template-sync`: `"table"`, `"list"`, or `"heading"` |
| `matchers` | `[]` | Heading text to match for embedded parsing (strings or `/regex/`). Case-insensitive. |
| `multiple` | `true` | Whether multiple children are expected |
| `embeddedTemplateFields` | `[]` | Field names to include as table columns in templates |

With `fieldOn: "parent"`, embedded child nodes (parsed from a matching heading's list or table) are appended as wikilinks to the parent's `field` array, rather than receiving a `parent` field. This matches schemas where the content model naturally lists children on the parent (e.g. `activity.tasks: ["[[Task A]]"]`).

Metadata is composable across `$ref` graphs:
- zero or one metadata provider may define `hierarchy`
- `aliases` are shallow-merged (later wins)
- `rules` merge by `id`; conflicts error unless the later rule sets `override: true`
- `$metadata.rules` supports `$ref` imports for reusable rule packs

If no provider defines `hierarchy`, hierarchy-specific checks are skipped. Reading a `space_on_a_page` file still requires `hierarchy.levels`.

**Customizing Schemas:**
- **Partial schemas**: Files starting with an underscore (like `_ost_tools_base.json`) are loaded and used to resolve references (using `$ref`).
- **No-metadata partials**: If a partial has no `$metadata`, prefer `$schema: "http://json-schema.org/draft-07/schema#"` so it validates standalone as plain JSON Schema.
- **Loading priority**: Partial schemas are loaded from both the default schema directory and the directory of your specified target schema.
- **Transitive resolution**: `$ref` chains are resolved recursively across files/schemas (including nested `allOf` usage in partials).
- **Unique IDs**: To encourage clean namespacing, local partial schemas **must** have unique `$id`s that do not collide with the default schemas. If a collision is detected, validation will fail with an error.

Schema resolution order: CLI `--schema` > space config `schema` > global config `schema` > bundled `schemas/general.json`

**⚠️ Security Notice: Only use schemas and configuration files from trusted sources.**

The tool executes JSONata expressions defined in schema files for rule validation. A maliciously crafted schema could make JSONata access JavaScript's prototype chain and execute arbitrary code. Only use schemas you've created or reviewed personally.

## Usage

### Validate nodes

```bash
ost-tools validate <space-or-dir> [--schema path/to/my-schema.json]
```

Validates markdown files against the JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Reports validation results with counts and per-file errors

### Show space tree

```bash
ost-tools show <space-or-dir>
```

Prints the space as an indented hierarchy tree. Hierarchy roots are listed first, followed by orphans (nodes in the hierarchy but with no resolved parent) and non-hierarchy nodes.

When a node appears under multiple parents (DAG hierarchy), it is printed in full under its first parent. Subsequent appearances with children show a `(*)` marker indicating the subtree is omitted.

### Generate Mermaid diagram

```bash
ost-tools diagram <space-or-dir> [--output path/to/output.mmd] [--schema path/to/my-schema.json]
```

Generates a Mermaid `graph TD` diagram from validated space nodes:
- Uses parent→child relationships from wikilinks
- Applies type-based styling (different colours per node type and status)
- Handles orphan nodes (no parent) as a separate cluster
- Outputs to file or stdout

### Show schema ERD

```bash
ost-tools schemas show <schema-file> [--mermaid-erd] [--space <name>]
```

Generates a Mermaid Entity Relationship Diagram from a schema:
- Shows all entity types and their properties
- Displays parent-child relationships based on hierarchy metadata
- Useful for visualizing schema structure during development

Example:
```bash
ost-tools schemas show general --mermaid-erd
```

### Sync space to Miro

```bash
ost-tools miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose]
```

Syncs space nodes to a Miro board as cards with connectors. Requires `MIRO_TOKEN` env var and `miroBoardId` set in the space's config entry.

- `--new-frame <title>` — create a new frame on the board and sync into it; auto-saves the resulting `miroFrameId` back to the config file
- `--dry-run` — show what would change without touching Miro
- `--verbose` / `-v` — detailed per-card and per-connector output

On subsequent runs, the cached `miroFrameId` is used automatically. Cards are colour-coded by node type and linked by parent→child connectors. A local `.miro-cache/` directory tracks Miro IDs to enable incremental updates.

Sync is one-way (OST → Miro) and scoped to a single frame. Only cards and connectors created by this tool within that frame are managed — everything else on the board is left untouched. Card content and connectors are overwritten or recreated to match the markdown source; any edits made directly in Miro to managed cards will be lost on the next sync. Existing card positions are not changed.

### Sync templates with schema

```bash
ost-tools template-sync [--space name] [--schema path/to/my-schema.json] [--create-missing] [--dry-run]
```

Keeps Obsidian template files in sync with schema examples:
- Matches markdown files in the template directory (defined in config) by `type` field
- Rewrites frontmatter using description fields and property `examples`
- `templatePrefix` in `plugins.markdown` config (default blank) sets a naming convention for templates (`{templatePrefix}{type}.md`). This will be used to check existing filenames, and create new templates with `--create-missing`.
- `--dry-run` previews changes without writing files

## Development

```bash
# Run a command against a configured space
bun run src/index.ts validate personal

# Run unit tests
bun run test

# Run smoke tests against all locally configured spaces
bun run test:smoke

# Build compiled output
bun run build

# Link built package locally so `bunx ost-tools` picks up changes
bun link
```

### Releasing
```bash
bun pm version patch   # or minor / major
git push --follow-tags
npm publish
```

## License

MIT
