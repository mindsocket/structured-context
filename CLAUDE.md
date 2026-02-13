# OST Tools

Opportunity Solution Tree validation and diagram generation tooling.

## Development

Run validation or diagram commands directly:

```bash
bun run src/index.ts validate <directory>
bun run src/index.ts diagram <directory>
```

## Project Context

This project validates OST (Opportunity Solution Tree) node files against a JSON schema. The schema defines valid node types (`vision`, `mission`, `goal`, `opportunity`, `solution`) and their required/optional properties.

## Tooling

- `gray-matter` - Parse YAML frontmatter from markdown
- `ajv` - JSON Schema validation
- `glob` - File discovery
- `commander` - CLI interface

## Schema Location

The OST JSON Schema is managed in the parent vault at `../Opportunity Solution Tree/ost-schema.json`.
