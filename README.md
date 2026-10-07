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
  Rule violations (error)                  0
  Rule violations (warning)                1
  Rule violations (info)                   1
  Hierarchy violations                     0
  Orphans (hierarchy nodes - no parent)    1
  Unresolved content links                 0
  Excluded during parsing                  0

Orphans (hierarchy nodes - no parent):
   Solution looking for a problem.md

Broken links:
   Steal underpants.md: [[Gnome goals]] → Link target "Gnome goals" in field "related" not found

Rule violations:
  WARNING (1):
    Build Death Star.md: Opportunities should contribute to at least one Outcome [workflow: opportunity-has-outcome]
  INFO (1):
    High tech juice press.md: Explore multiple candidate solutions (aim for at least three) for the target opportunity [best-practice: solution-quantity]
```

Rule violations carry a severity (`error`, `warning` or `info`) that defaults from the rule's category. Only errors fail validation — see [docs/rules.md](docs/rules.md#categories-and-severity).

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

See [docs/concepts.md](docs/concepts.md) (`sctx docs concepts`) for terminology: spaces, nodes, embedded nodes, schemas, hierarchies, rules and more.

## Configuration

The config file maps space names to paths and schemas, with optional plugin settings. It is found from `--config`, then `$SCTX_CONFIG`, then `$XDG_CONFIG_HOME/structured-context/config.json` (default `~/.config/...`), then `./config.json`. Paths resolve relative to the config file, and `includeSpacesFrom` pulls in spaces from other config files.

See `config.example.json` and [docs/config.md](docs/config.md) (`sctx docs config`) for the full reference, including `fieldMap`, `typeInference`, templates, filter views and plugin loading.

### Schemas

Schemas define the entity types, fields, hierarchy and rules for a space. Set one per space with `schema` in config. Bundled schemas:

- `strategy_general` — flexible strategy ladder (vision, mission, goals) flowing into an OST-style opportunity → solution → experiment hierarchy.
- `strict_ost` — Teresa Torres' canonical four levels: outcome → opportunity → solution → assumption test.
- `knowledge_wiki` — flat, LLM-maintained knowledge base of sources, concepts, entities, syntheses and notes, with provenance.
- `okf` — [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2 bundles: any concept type, with provenance, trust, lifecycle and Attested Computation fields checked when present.

Partials (`_*.json`, e.g. `_strategy_general`, `_knowledge_wiki`) are reusable building blocks for your own schemas. Plugins can contribute further schemas.

Schemas are JSON Schema 2020-12 plus a top-level `$metadata` block for hierarchy, relationships, aliases, imports and executable rules, for example:

```json5
"$metadata": {
  "hierarchy": { "levels": ["outcome", { "type": "opportunity", "selfRef": true }, "solution", "assumption_test"] },
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

See [docs/schemas.md](docs/schemas.md) (`sctx docs schema`) for the dialect, composition, multiple hierarchies and `$id` namespaces; [docs/rules.md](docs/rules.md) (`sctx docs rules`) for rules; and [docs/concepts.md](docs/concepts.md) for hierarchy embedding and relationships.

**⚠️ Only use schemas and configuration from trusted sources:** rules are JSONata expressions, and a malicious schema can execute arbitrary code. See [docs/config.md](docs/config.md#security-notice).

## Usage

### Validate nodes

```bash
sctx validate <space> [--watch]
```

Validates markdown files against the JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Reports validation results with counts and per-file errors

### Render space

```bash
sctx render <space> <format> [--out <dir-or-file>] [--force] [--filter <view>] [--hierarchy <name>] [--data key=value]
```

Renders a space in a plugin-provided format. Use `sctx render list [space]` to list available formats.

- `markdown.bullets` — Indented bullet list tree (outputs to stdout or `--out <file>`).
- `markdown.directory` — Markdown space directory with one file per node. Writes to `--out <dir>` (refuses to overwrite existing files unless `--force` is passed). Flat directory by default, or organized into per-type subfolders with `--data folders=type` or when configured with `typeInference.folderMap`. Without `--out`, prints a summary of files to be written.

### Show space tree

```bash
sctx show <space> [--filter <view-or-expression>] [--hierarchy <name>]
```

Prints the space as an indented hierarchy tree. Hierarchy roots are listed first, followed by orphans (nodes in the hierarchy but with no resolved parent) and non-hierarchy nodes. The main hierarchy is shown by default; `--hierarchy <name>` selects another (see [Multiple hierarchies](docs/schemas.md#multiple-hierarchies)). `diagram` and `render` accept the same option.

When a node appears under multiple parents (DAG hierarchy), it is printed in full under its first parent. Subsequent appearances with children show a `(*)` marker indicating the subtree is omitted.

**Filtering:** `--filter` (on `show` and `render`) takes a named view from the space config or an inline expression: `WHERE {jsonata}`, optionally with `SELECT {spec}` to expand results along the graph.

```bash
sctx show <space> --filter "WHERE resolvedType='solution' and status='active'"
sctx show <space> --filter "SELECT ancestors(opportunity) WHERE resolvedType='solution'"
sctx show <space> --filter active-solutions   # named view
```

See [Filter expressions](docs/concepts.md#filter-expressions) (`sctx docs concepts`) for the full syntax.

### Generate Mermaid diagram

```bash
sctx diagram <space> [--output path/to/output.mmd] [--hierarchy <name>]
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
- Displays parent-child relationships based on the levels of each hierarchy
- Useful for visualizing schema structure during development

Example:
```bash
sctx schemas show strategy_general --mermaid-erd
```

### Sync space to Miro

```bash
sctx miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose]
```

Syncs space nodes to a Miro board as colour-coded cards with parent→child connectors. Requires a `MIRO_TOKEN` env var and `plugins.miro.boardId` in the space config. `--new-frame` creates a frame and saves its `frameId` to config; `--dry-run` previews changes.

Sync is one-way and scoped to one frame: only cards and connectors this tool created there are managed, and edits made in Miro to those cards are overwritten on the next sync. A local `.miro-cache/` tracks Miro IDs for incremental updates.

### Sync templates with schema

```bash
sctx template-sync <space> [--create-missing] [--dry-run]
```

Keeps Obsidian template files in sync with schema examples:
- Matches markdown files in the template directory (defined in config) by `type` field
- Rewrites frontmatter using description fields and property `examples`
- `templatePrefix` in `plugins.markdown` config (default blank) sets a naming convention for templates (`{templatePrefix}{type}.md`). This will be used to check existing filenames, and create new templates with `--create-missing`.
- `--dry-run` previews changes without writing files

## Programmatic API

The package exposes a library entry point at `structured-context/api` for embedding the tooling
in other applications. See
[docs/api.md](docs/api.md) for the full reference and usage examples.

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
