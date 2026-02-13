# ost-tools

Opportunity Solution Tree validation and diagram generation tool.

## Installation

```bash
bun install
```

## Usage

### Validate OST nodes

```bash
bunx ost-tools validate <directory> [--schema path/to/schema.json]
```

Validates markdown files against the OST JSON schema:
- Extracts YAML frontmatter from each `.md` file
- Skips files without frontmatter or without a `type` field
- Validates against the provided schema (defaults to local `schema.json`)
- Reports validation results with counts and per-file errors

### Generate Mermaid diagram

```bash
bunx ost-tools diagram <directory> [--output path/to/output.mmd]
```

Generates Mermaid `graph TD` diagram from validated OST nodes:
- Uses parent→child relationships from wikilinks
- Applies type-based styling (different colors per node type and status)
- Handles orphan nodes (no parent) as a separate cluster
- Outputs to file or stdout

## Development

```bash
# Run validate command
bun run src/index.ts validate <directory>

# Run diagram command
bun run src/index.ts diagram <directory>
```

## Schema

The `schema.json` file contains the OST JSON Schema definition for validating node frontmatter. The schema is also available in the vault at `Opportunity Solution Tree/ost-schema.json`.

## License

MIT
