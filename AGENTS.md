# OST Tools

Tools for working with Opportunity Solution Tree structures and other product management and strategy frameworks

## Development

Get a list of commands: `bun run src/index.ts --help`
Space names (e.g. `personal`, `politics`) are resolved via a config file - `$OST_TOOLS_CONFIG`, `$XDG_CONFIG_HOME/ost-tools/config.json`, `--config <file>` param, or `./config.json`

## Definition of done

There are several places that need reviewing and updating with any new feature or change added:

- README.md - documentation, also displayed with `ost-tools readme` command
- AGENTS.md - this file
- docs/* - includes architecture, concepts etc
- skills/ost-tools/* - skills information for AI agents

## Project Context

This project validates data in markdown files against a JSON schema representing product and strategy frameworks, including Opportunity Solution Trees.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Key Files

- config — JSON5 file with spaces registered
- `schemas/` — Bundled default schema files (json-schema with metadata extension, JSON5 format). Files starting with `_` are "partials" (fragments for `$ref`) and are loaded automatically. Local partials in a schema's directory **must** have unique `$id`s.

## Testing

- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:smoke` — smoke tests that run `validate` against every space in `config.json` (`smoke/`)

## Debugging

- `bun run src/index.ts dump <path>` — Output parsed node data with resolved parents, useful for debugging rule violations

## Hooks
A Stop hook runs linting, autoformatting and unit tests. If it reports issues related to change you made, address them.