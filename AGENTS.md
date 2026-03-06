# OST Tools

Tools for working with Opportunity Solution Tree structures and other product management and strategy frameworks

## Development

Get a list of commands: `bun run src/index.ts --help`
Space aliases (e.g. `personal`, `politics`) are resolved via `config.json`.

## Project Context

This project validates data in markdown files against a JSON schema representing product and strategy frameworks, including Opportunity Solution Trees.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Tooling

- `gray-matter` - Parse YAML frontmatter from markdown
- `ajv` - JSON Schema validation
- `glob` - File discovery
- `commander` - CLI interface
- `bun test` - testing

## Key Files

- `config.json` — Space registry (alias → absolute path)
- `schemas/` — Bundled default schema files. Files starting with `_` are "partials" (fragments for `$ref`) and are loaded automatically. Local partials in a schema's directory **must** have unique `$id`s.

## Testing

- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:smoke` — smoke tests that run `validate` against every space in `config.json` (`smoke/`)

## Debugging

- `bun run src/index.ts dump <path>` — Output parsed node data with resolved parents, useful for debugging rule violations

## Hooks
A Stop hook runs linting, autoformatting and unit tests. If it reports issues related to change you made, address them.