# structured-context

Keep your content clean and your thinking clear.

`structured-context` provides assistive tools for working with structured content, including knowledge wikis (a la [Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)), product/strategy frameworks (like [Teresa Torres' Opportunity Solution Trees](https://www.producttalk.org/opportunity-solution-trees/) and [Martin et al's strategy cascade](https://rogerlmartin.com/thought-pillars/strategy), and more. Great for flat sets of documents, hierarchical or layered context trees, or any kind of knowledge graph.

Assign a schema to your markdown content to give humans and AI agents consistent structure and content guidelines. 

In Claude Code:
```
❯ Use /structured-context to configure 'my-research' as a knowledge wiki, then organise it

⏺ Skill(structured-context)
  ⎿  Successfully loaded skill

...

```

Command line tools:
```
> sctx validate strategy

Space Validation Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Content and structure
  Valid                                   16
  Schema validation errors                 0
  Broken links                             1
  Duplicate keys                           0
  Rule violations                          2
  Hierarchy violations                     0
  Orphans (hierarchy nodes - no parent)    1
  Ignored during parsing                   0

Orphans (hierarchy nodes - no parent):
   Solution looking for a problem.md

Broken links:
   Steal underpants.md: [[Gnome goals]] → Link target "Gnome goals" in field "related" not found

Rule violations:
  workflow (1):
    Build Death Star.md: Opportunities should contribute to at least one Outcome
  
  best-practice (1):
    High tech juice press.md: Explore multiple candidate solutions (aim for at least three) for an active target opportunity
```

## Installation

Requires [Bun](https://bun.sh) runtime.

Install globally (recommended):

```bash
bun install -g structured-context
sctx --help
```

Or use directly via `bunx`:

```bash
bunx structured-context --help
```

## Setup for AI Agents

Claude Code plugin, providing validation hooks, slash commands, and agent skills. Install it with:

```
claude plugin marketplace add mindsocket/structured-context
claude plugin install structured-context
```

Skills can also be installed standalone without the plugin:

```
npx skills add https://github.com/mindsocket/structured-context/tree/main/plugin/skills/structured-context
```

## Concepts

See [docs/concepts.md](docs/concepts.md) for the full terminology reference, including definitions of nodes, embedded nodes, spaces, schemas, rules, and more.

## Configuration

`structured-context` looks for its config file in this order:

1. `--config` command line argument
2. `$SCTX_CONFIG` env var
3. `~/.config/structured-context/config.json` (or `$XDG_CONFIG_HOME/structured-context/config.json`)
4. `./config.json` in the current working directory

See `config.example.json` for the full structure. The config maps space names to paths, with optional additional configuration options for parsing and integrations. Paths in config files are resolved relative to the config file.

**Including spaces from other configs:** Use `includeSpacesFrom` to import space definitions from other config files. This is useful for aggregating spaces from multiple projects into a central config, reducing the need to specify `--config` on CLI commands. Duplicate space names are not allowed.

**Plugins and markdown plugin config:** See `sctx docs config` for the full reference including `fieldMap`, `typeInference`, `templateDir`, filter views, and plugin loading rules.

### Schemas

Schemas define the structure and rules for the entities in a space, allowing customisation and extension to different models.

Several schemas (`strict_ost`, `knowledge_wiki` and `general`) are included. The general (strategy) schema combines a basic vision/mission/goals hierarchy with a hierarchy loosely based on Opportunity Solution Trees. It is intentionally flexible to support rapid initial adoption. The strict OST schema has a narrower scope, and reflects Teresa Torres' specific recommendations for Opportunity Solution Trees more closely. The knowledge wiki schema defines a flatter set of types used for knowledge bases.

structured-context schemas use a metaschema based on JSON Schema Draft-07 that adds a top-level `$metadata` block:

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
- `hierarchy`: multiple schema files may define a hierarchy; **last one wins** (root schema overrides partials)
- `aliases` are shallow-merged (later wins)
- `rules` merge by `id`; conflicts error unless the later rule sets `override: true`
- `$metadata.rules` supports `$ref` imports for reusable rule packs
- `relationships` are collected from all files

If no file defines `hierarchy`, hierarchy-specific checks are skipped.

**Customizing Schemas:**
- **Partial schemas**: Files starting with an underscore (like `_sctx_base.json`, `_strategy_general.json`, `_knowledge_wiki.json`) are loaded and used to resolve references (using `$ref`).
- **Partials as entity libraries**: Partials can define reusable entity types in `$defs` that composing schemas reference via `$ref`. Bundled partials like `_strategy_general` and `_knowledge_wiki` provide common entity sets for strategy and wiki content.
- **Partials can carry metadata**: Unlike plain JSON Schema, partials may include `$metadata` (hierarchy, aliases, relationships, rules). This makes them self-contained units that bundle both type definitions and behavioral metadata.
- **No-metadata partials**: If a partial has no `$metadata`, prefer `$schema: "http://json-schema.org/draft-07/schema#"` so it validates standalone as plain JSON Schema.
- **Loading priority**: Partial schemas are loaded from both the default schema directory and the directory of your specified target schema.
- **Transitive resolution**: `$ref` chains are resolved recursively across files/schemas (including nested `allOf` usage in partials).
- **Unique IDs**: To encourage clean namespacing, local partial schemas **must** have unique `$id`s that do not collide with the default schemas. If a collision is detected, validation will fail with an error.

Schema resolution order: space config `schema` > global config `schema`. Schema resolution fails if none is configured.

**⚠️ Security Notice: Only use schemas and configuration files from trusted sources.**

The tool executes JSONata expressions defined in schema files for rule validation. A maliciously crafted schema could make JSONata access JavaScript's prototype chain and execute arbitrary code. Only use schemas you've created or reviewed personally.

## Usage

### Validate nodes

```bash
sctx validate <space> [--watch]
```

Validates markdown files against the JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Reports validation results with counts and per-file errors

### Show space tree

```bash
sctx show <space> [--filter <view-or-expression>]
```

Prints the space as an indented hierarchy tree. Hierarchy roots are listed first, followed by orphans (nodes in the hierarchy but with no resolved parent) and non-hierarchy nodes.

When a node appears under multiple parents (DAG hierarchy), it is printed in full under its first parent. Subsequent appearances with children show a `(*)` marker indicating the subtree is omitted.

**Filtering:** The `--filter` flag accepts either a named view from the space config, or an inline filter expression. Only nodes matching the expression are shown.

```bash
# Inline expression
sctx show <space> --filter "WHERE resolvedType='solution' and status='active'"

# Named view from config
sctx show <space> --filter active-solutions
```

See [Filter expressions](#filter-expressions) below for expression syntax.

### Filter expressions

Filter expressions are used with `--filter` and in config `views`. They use a `SELECT ... WHERE ...` pseudo-DSL:

| Form | Meaning |
|------|---------|
| `WHERE {jsonata}` | Return nodes where the JSONata predicate is truthy |
| `SELECT {spec} WHERE {jsonata}` | Filter by WHERE, then expand result via SELECT |
| `SELECT {spec}` | Expand from all nodes via SELECT (no WHERE filter — returns all nodes, expanded per spec) |
| `{jsonata}` | Bare JSONata, treated as a WHERE predicate (convenience shorthand) |

The WHERE predicate is a [JSONata](https://docs.jsonata.org/overview) expression evaluated per node. Within the expression, each node's fields are accessible directly (e.g. `resolvedType`, `status`, any schema fields like `title`). Two built-in fields are always available regardless of schema: `label` (relative file path, e.g. `"solutions/My Solution.md"`) and `title` (node display name). Additionally, two pre-computed traversal arrays are available:

- **`ancestors[]`** — flat array of ancestor nodes, nearest first, deduplicated. Each entry includes all schema fields of the ancestor node, plus:
  - `_field` — the edge field name that connects to the ancestor
  - `_source` — `'hierarchy'` or `'relationship'`
  - `_selfRef` — whether the edge is a same-type (self-referential) link
- **`descendants[]`** — same structure, for descendant nodes

**SELECT spec** expands the result set by walking the graph from matched nodes. The spec is a comma-separated list of directives:

| Directive | Meaning |
|-----------|---------|
| `ancestors` | All ancestor nodes |
| `ancestors(type)` | Ancestors of the given resolved type |
| `descendants` | All descendant nodes |
| `descendants(type)` | Descendants of the given resolved type |
| `siblings` | Nodes sharing at least one parent with matched nodes |
| `relationships` | All nodes connected via a relationship (non-hierarchy) edge |
| `relationships(childType)` | Relationship-connected nodes of the given child type |
| `relationships(parentType:childType)` | As above, also filtering by parent type |
| `relationships(parentType:field:childType)` | Fully qualified: also filtering by edge field name |

Multiple directives may be combined: `SELECT ancestors(goal), siblings WHERE ...`

**Examples:**

```jsonata
// All solutions
WHERE resolvedType='solution'

// Active solutions only
WHERE resolvedType='solution' and status='active'

// Solutions whose nearest opportunity ancestor is active
WHERE resolvedType='solution' and $exists(ancestors[resolvedType='opportunity' and status='active'])

// Nodes that have any ancestor goal
WHERE $exists(ancestors[resolvedType='goal'])

// Bare JSONata shorthand (no WHERE keyword)
resolvedType='solution' and status='active'

// Solutions + their opportunity ancestors
SELECT ancestors(opportunity) WHERE resolvedType='solution'

// Solutions + their siblings (other solutions under same opportunity)
SELECT siblings WHERE resolvedType='solution' and status='active'

// Opportunities + their related assumptions
SELECT relationships(assumption) WHERE resolvedType='opportunity'
```

### Generate Mermaid diagram

```bash
sctx diagram <space> [--output path/to/output.mmd]
```

Generates a Mermaid `graph TD` diagram from validated space nodes:
- Uses parent→child relationships from wikilinks
- Applies type-based styling (different colours per node type and status)
- Handles orphan nodes (no parent) as a separate cluster
- Outputs to file or stdout

### Show schema ERD

```bash
sctx schemas show <schema-file> [--mermaid-erd] [--space <name>]
```

Generates a Mermaid Entity Relationship Diagram from a schema:
- Shows all entity types and their properties
- Displays parent-child relationships based on hierarchy metadata
- Useful for visualizing schema structure during development

Example:
```bash
sctx schemas show strategy_general --mermaid-erd
```

### Sync space to Miro

```bash
sctx miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose]
```

Syncs space nodes to a Miro board as cards with connectors. Requires `MIRO_TOKEN` env var and `boardId` set in the `miro` plugin config for the space.

- `--new-frame <title>` — create a new frame on the board and sync into it; auto-saves the resulting `frameId` back to the miro plugin config
- `--dry-run` — show what would change without touching Miro
- `--verbose` / `-v` — detailed per-card and per-connector output

Configure the miro plugin in the space's config entry:

```json
{
  "plugins": {
    "miro": {
      "boardId": "your-board-id",
      "frameId": "your-frame-id"
    }
  }
}
```

On subsequent runs, the cached `frameId` is used automatically. Cards are colour-coded by node type and linked by parent→child connectors. A local `.miro-cache/` directory tracks Miro IDs to enable incremental updates.

Sync is one-way (OST → Miro) and scoped to a single frame. Only cards and connectors created by this tool within that frame are managed — everything else on the board is left untouched. Card content and connectors are overwritten or recreated to match the markdown source; any edits made directly in Miro to managed cards will be lost on the next sync. Existing card positions are not changed.

### Sync templates with schema

```bash
sctx template-sync <space> [--create-missing] [--dry-run]
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

# Run type checking (checks all code including tests)
bun run typecheck

# Run core unit tests
bun run test

# Run occasional smoke tests against all locally configured spaces
bun run test:smoke

# Build compiled output
bun run build

# Link built package locally so `bunx structured-context` picks up changes
bun link
```

### Releasing
```bash
npm login             # authenticate with npm registry if needed
bun pm version patch  # or minor / major — runs lint, tests, then pushes with tags
npm publish
```

## License

MIT
