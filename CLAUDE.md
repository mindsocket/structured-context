# OST Tools

Opportunity Solution Tree (OST) validation and diagram generation tooling.

## Development

```bash
bun run src/index.ts validate <space-or-dir>
bun run src/index.ts diagram <space-or-dir>
bun run src/index.ts template-sync <template-dir>
```

Space aliases (e.g. `personal`, `politics`) are resolved via `config.json`.

## Project Context

This project validates OST node markdown files against a JSON schema. Node types: `vision`, `mission`, `goal`, `opportunity`, `solution`, `dashboard`.

As a convenience, directories can be registered as "space" aliases in `config.json`.

## Tooling

- `gray-matter` - Parse YAML frontmatter from markdown
- `ajv` - JSON Schema validation
- `glob` - File discovery
- `commander` - CLI interface

## Key Files

- `config.json` — Space registry (alias → absolute path)
- `schema.json` — Entity type definitions and validation rules
