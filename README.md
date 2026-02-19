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

`config.json` maps aliases to absolute paths:

```json
{
  "spaces": [
    { "alias": "personal", "path": "/path/to/Personal/Opportunity Solution Tree" }
  ]
}
```

## Usage

### Validate OST nodes

```bash
bun run src/index.ts validate <space-or-dir> [--schema path/to/schema.json]
```

Validates markdown files against the OST JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Validates against the provided schema (defaults to local `schema.json`)
- Reports validation results with counts and per-file errors

### Generate Mermaid diagram

```bash
bun run src/index.ts diagram <space-or-dir> [--output path/to/output.mmd]
```

Generates Mermaid `graph TD` diagram from validated OST nodes:
- Uses parent→child relationships from wikilinks
- Applies type-based styling (different colors per node type and status)
- Handles orphan nodes (no parent) as a separate cluster
- Outputs to file or stdout

### Sync templates with schema

```bash
bun run src/index.ts template-sync <template-dir> [--schema path/to/schema.json] [--dry-run]
```

Keeps Obsidian template files in sync with schema examples:
- Matches `OST - *.md` files in the template directory by `type` field
- Rewrites frontmatter from the schema's `examples` entry for that type
- Adds commented hints for optional fields not in the example
- `--dry-run` previews changes without writing files

## Development

```bash
# Run validate command
bun run src/index.ts validate personal

# Run diagram command
bun run src/index.ts diagram personal
```

## Schema

The `schema.json` file contains the OST JSON Schema definition for validating node frontmatter. The schema is also available in the vault at `Opportunity Solution Tree/ost-schema.json`.

## License

MIT
