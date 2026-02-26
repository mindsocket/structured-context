# ost-tools

Opportunity Solution Tree validation and diagram generation tool.

## Installation

```bash
bun install
```

## Concepts

### Entities in OST

- **Vision**: The aspirational outcome at the top of a tree.
- **Mission**: Strategic direction supporting a vision.
- **Goal**: Concrete, measurable targets.
- **Opportunity**: Identified chance to make progress.
- **Solution**: Proposed approach to address an opportunity.
- **Dashboard**: Index node for organizing and displaying tree structure.

### Spaces

A space is a named OST directory registered in `config.json`. Spaces let you reference a tree by alias instead of path:

```bash
bun run src/index.ts validate personal
```

`config.json` maps aliases to absolute paths, with optional Miro integration fields and global defaults:

```json
{
  "spaces": [
    {
      "alias": "personal",
      "path": "/path/to/Personal/Opportunity Solution Tree",
      "miroBoardId": "uXjVIaBoardId",
      "miroFrameId": "3458764123456789"
    }
  ],
  "schema": "/path/to/custom/schema.json",
  "templateDir": "/path/to/Templates"
}
```

- `miroBoardId` / `miroFrameId` — required for `miro-sync` (frame ID is auto-saved after `--new-frame`)
- `schema` — overrides default schema path (`schema.json`). CLI `--schema` takes precedence
- `templateDir` — default template directory for `template-sync` (can omit the CLI argument)

## Usage

### Validate OST nodes

```bash
bun run src/index.ts validate <space-or-dir> [--schema path/to/schema.json]
```

Validates markdown files against the OST JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Validates against the resolved schema (CLI `--schema` > `config.schema` > `schema.json`)
- Reports validation results with counts and per-file errors

### Generate Mermaid diagram

```bash
bun run src/index.ts diagram <space-or-dir> [--output path/to/output.mmd] [--schema path/to/schema.json]
```

Generates Mermaid `graph TD` diagram from validated OST nodes:
- Uses parent→child relationships from wikilinks
- Applies type-based styling (different colors per node type and status)
- Handles orphan nodes (no parent) as a separate cluster
- Outputs to file or stdout

### Sync OST to Miro

```bash
bun run src/index.ts miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose]
```

Syncs OST nodes to a Miro board as cards with connectors. Requires `MIRO_TOKEN` env var and `miroBoardId` set in the space's config entry.

- `--new-frame <title>` — create a new frame on the board and sync into it; auto-saves the resulting `miroFrameId` back to `config.json`
- `--dry-run` — show what would change without touching Miro
- `--verbose` / `-v` — detailed per-card and per-connector output

On subsequent runs, the cached `miroFrameId` is used automatically. Cards are color-coded by node type and linked by parent→child connectors. A local `.miro-cache/` directory tracks Miro IDs to enable incremental updates.

Sync is one-way (OST → Miro) and scoped to a single frame. Only cards and connectors created by this tool within that frame are managed — everything else on the board is left untouched. Card content and connectors are overwritten or recreated to match the markdown source; any edits made directly in Miro to managed cards will be lost on the next sync. Existing card positions are not changed — you can freely change the tree's layout.

### Sync templates with schema

```bash
bun run src/index.ts template-sync [template-dir] [--schema path/to/schema.json] [--dry-run]
```

Keeps Obsidian template files in sync with schema examples:
- Matches `OST - *.md` files in the template directory by `type` field
- Rewrites frontmatter from the schema's `examples` entry for that type
- Adds commented hints for optional fields not in the example
- `--dry-run` previews changes without writing files
- `template-dir` can be omitted if `templateDir` is set in `config.json`

## Development

```bash
# Run validate command
bun run src/index.ts validate personal

# Run diagram command
bun run src/index.ts diagram personal
```

## Schema

The `schema.json` file contains the OST JSON Schema definition for validating node frontmatter.

## License

MIT
