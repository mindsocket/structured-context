# OST Tools

Opportunity Solution Tree (OST) validation and diagram generation tooling.

## Development

Get a list of commands: `bun run src/index.ts --help`
Space aliases (e.g. `personal`, `politics`) are resolved via `config.json`.

## Project Context

This project validates OST node markdown files against a JSON schema.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Tooling

- `gray-matter` - Parse YAML frontmatter from markdown
- `ajv` - JSON Schema validation
- `glob` - File discovery
- `commander` - CLI interface
- `bun test` - testing

## Key Files

- `config.json` — Space registry (alias → absolute path)
- `schema.json` — Entity type definitions and validation rules

## Testing

- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:smoke` — smoke tests that run `validate` against every space in `config.json` (`smoke/`)

## Hooks
A Stop hook runs linting, autoformatting and unit tests. If it reports issues related to change you made, address them.