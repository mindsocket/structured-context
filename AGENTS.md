# OST Tools

Tools for working with Opportunity Solution Tree structures and other product management and strategy frameworks

## Development

Get a list of commands: `bun run src/index.ts --help`
Space names (e.g. `personal`, `politics`) are resolved via a config file - `$OST_TOOLS_CONFIG`, `$XDG_CONFIG_HOME/ost-tools/config.json`, `--config <file>` param, or `./config.json`

## Claude Code Plugin

A Claude Code plugin lives at `plugin/`. It includes skills, commands and hooks used when working with collections of Obsidian markdown content (aka a space) in a vault.

## Definition of done

There are several places that need reviewing and updating with any new feature or change added:

- README.md - documentation, also displayed with `ost-tools readme` command
- AGENTS.md - this file
- docs/* - includes architecture, concepts etc
- plugin/* - skills, commands, hooks, and scripts; update any affected parts

## Project Context

This project validates data in markdown files against a JSON schema representing knowledge bases, and product and strategy frameworks, including Opportunity Solution Trees.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Key Files

- config — JSON5 file with spaces registered
- `schemas/` — Bundled default schema files (JSON5) using the ost-tools schema dialect and top-level `$metadata`. Files starting with `_` are "partials" (fragments for `$ref`).
- `src/metadata-contract.ts` — Single source of truth for the `$metadata` contract
- `schemas/generated/_ost_tools_schema_meta.json` — Generated metaschema (generated on build or with `bun run generate:schema-meta`)

## Testing
For most development only the main unit tests need re-running regularly.
- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:hook` — unit test plugin hooks (`hook-test/unit/`) - hook development only
- `bun run test:hook:e2e` — test plugin hooks in Claude Code (`hook-test/`) - hook development only
- `bun run test:smoke` — smoke tests run against locally configured spaces - only use when changes could affect compatibility.

## Dual TypeScript Configuration

- **`tsconfig.json`** — Main config for type-checking across all code - use `bun run typecheck`
- **`tsconfig.build.json`** — Production build config (only compiles `src/` to `dist/`) - use `bun run build`

## Debugging

- `bun run src/index.ts dump <space>` — Output parsed node data

## Hooks
Address issues related to change you made if a Stop hook reports them.
