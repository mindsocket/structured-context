# Structured Context

Validates markdown content (knowledge bases, Opportunity Solution Trees and other product and strategy frameworks) against JSON schemas, with CLI tools around it.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Development

- `bun run src/index.ts --help` — list CLI commands
- `bun run typecheck` — type-check all code (`tsconfig.json`)
- `bun run lint` — biome
- `bun run build` — compile `src/` to `dist/` (`tsconfig.build.json`)
- Releases go through the `/release` skill.

Space names (e.g. `personal`, `politics`) are resolved via a config file - `$SCTX_CONFIG`, `$XDG_CONFIG_HOME/structured-context/config.json`, `--config <file>` param, or `./config.json`

The lefthook pre-commit hook syncs the plugin version (below), then runs biome (`--write`, re-staged) and the typecheck.

## Claude Code Plugin

A Claude Code plugin lives at `plugin/`. It includes skills, commands and hooks used when working with collections of Obsidian markdown content (aka a space) in a vault.

The plugin version in `plugin/.claude-plugin/plugin.json` is managed by git hooks (`lefthook.yml`, `scripts/sync-plugin-version.ts`); never edit it by hand:
- **pre-commit:** bumps the patch version for any commit touching `plugin/`, so the plugin version runs ahead of `package.json` between releases by design. It also syncs major.minor up when `package.json` moves ahead (i.e. a release).
- **pre-push:** fails if a commit since the last tag changed `plugin/` without bumping the version.

## Definition of done

There are several places that need reviewing and updating with any new feature or change added:

- README.md - overview, kept brief; detail belongs in docs/. Shown by `sctx docs`
- AGENTS.md - this file
- docs/* - `sctx docs <topic>` shows concepts.md, config.md, schemas.md (`schema`) and rules.md; also architecture.md, api.md
- plugin/* - skills, commands, hooks, and scripts; update any affected parts

## Planning & Design Principles

- **Simplicity first:** Strive for the simplest design that completely solves the problem. Prefer conventions and established filesystem patterns over adding new configuration, programmatic APIs, or abstractions.
- **Explicitly state alternatives:** When planning or making architectural decisions, do not anchor to the first familiar mechanism. Formulate and state at least one alternative approach, weighing trade-offs, complexity, and ergonomic impact.
- **Minimise blast radius:** Protect established boundaries and interfaces. Treat unnecessary ripple effects (such as making synchronous APIs asynchronous or adding dual APIs) as a design smell indicating the approach should be re-evaluated.

## Key Files

- `src/api.ts` — Public library entry point (`structured-context/api`). Re-exports the supported programmatic surface. Keep CLI-only concerns out of it.
- `schemas/` — Bundled default schema files (JSON5) using the structured-context schema dialect and top-level `$metadata`. Files starting with `_` are "partials" (fragments for `$ref`).
- `src/schema/metadata-contract.ts` — Single source of truth for the `$metadata` contract
- `schemas/generated/latest/_structured_context_schema_meta.json` — Generated metaschema for the newest dialect (generated on build or with `bun run generate:schema-meta`). `schemas/generated/<version>/` folders are frozen copies, created by the `version` script (`generate:schema-meta --release`) only when a release changes the dialect; never edit them. `src/schema/meta-schemas.ts` loads them at runtime.

## Testing
For most development only the main unit tests need re-running regularly.
- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:hook` — unit test plugin hooks (`hook-test/unit/`) - hook development only
- `bun run test:hook:e2e` — test plugin hooks in Claude Code (`hook-test/`) - hook development only
- `bun run test:smoke` — smoke tests run against locally configured spaces - only use when changes could affect compatibility.

## Debugging

- `bun run src/index.ts dump <space>` — Output parsed node data

## Hooks
Address issues related to change you made if a Stop hook reports them.
