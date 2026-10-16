# Structured Context

Validates markdown content (knowledge bases, Opportunity Solution Trees and other product and strategy frameworks) against JSON schemas, with CLI tools around it.

Before starting new work, review [docs/concepts.md](docs/concepts.md) for canonical terminology. Use and maintain the definitions there as the source of truth when naming things in code, tests, comments, and documentation.

## Development

- `bun run src/index.ts --help` — list CLI commands
- `bun run typecheck` — type-check all code (`tsconfig.json`)
- `bun run lint` — biome
- `bun run lint:fix` — biome with fixes
- `bun run build` — compile `src/` to `dist/` (`tsconfig.build.json`)
- see `package.json` 
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
- docs/* - `sctx docs <topic>` shows concepts.md, config.md, schemas.md (`schema`), rules.md and semantic-rules.md; also architecture.md, api.md
- plugin/* - skills, commands, hooks, and scripts; update any affected parts

"Affected" includes files the change does not touch. Search for old names, then reread each file below for meaning, not only for renamed words:

| Change | Check |
|---|---|
| CLI command, flag or output | `docs/*` for the command; `plugin/skills/structured-context/references/commands.md`; the command list in `plugin/skills/structured-context/SKILL.md`; `plugin/commands/*` |
| Rule, schema or `$metadata` shape | `docs/schemas.md`, `docs/rules.md`, `docs/semantic-rules.md`; `references/schema-authoring.md`, `references/schema-design.md`; bundled `schemas/` |
| User-visible error or warning message | the troubleshooting table in `SKILL.md` |
| Config key or space config | `docs/config.md`; the config example in `references/commands.md` |
| `validate --json` output | `plugin/scripts/state.ts` (the hooks parse it) and `bun run test:hook` |
| Parsing or node content | `docs/concepts.md`; the embedded nodes section in `SKILL.md` |
| New term | `docs/concepts.md` |

## Planning & Design Principles

- **Simplicity first:** Strive for the simplest design that completely solves the problem. Prefer conventions and established filesystem patterns over adding new configuration, programmatic APIs, or abstractions.
- **Explicitly state alternatives:** When planning or making architectural decisions, do not anchor to the first familiar mechanism. Formulate and state at least one alternative approach, weighing trade-offs, complexity, and ergonomic impact.
- **Minimise blast radius:** Protect established boundaries and interfaces. Treat unnecessary ripple effects (such as making synchronous APIs asynchronous or adding dual APIs) as a design smell indicating the approach should be re-evaluated.
- **Public API surface:** Do not add exports to `src/api.ts`, `src/types.ts` or `src/testing.ts` (the `structured-context/api`, `/types` and `/testing` entry points), or add types or hooks to the plugin interface, without the maintainer's explicit agreement on that specific surface. Exporting something to make docs complete, to tidy up, or because a feature has a public-looking class is not a reason. If a change seems to need a new export, stop and propose it, with the consumer that needs it. Internal modules can change freely.
- **Where a setting lives:** Config says *what* to use, CLI flags override it for one run, and the environment holds secrets and the config location only (`apiKeyEnv` names a secret; `SCTX_CONFIG` locates the config). Do not add env vars that set config values, and never infer a choice (such as a judge provider) from a variable that happens to be set: a key present for another tool must not be spent silently. Config also never switches on costly or outward-facing behaviour (such as semantic judging): each run asks for it, through a flag or an API option.
- **Failures are visible:** A rule or expression that cannot be evaluated is reported as a violation, never skipped or treated as a pass. Likewise a misconfiguration fails before any work or spend.

## Documentation Principles

- **One idea lives in one place:** Decide which doc owns each concept, document it there once, and link instead of repeating. Small, non-obvious tidbits may be repeated; explanations may not.
- **Document what it does, not what it doesn't:** Describe behaviour and purpose. State a limit only when a new user would realistically assume otherwise. Specification and decision history do not leak into docs.
- **Proper name in docs:** `structured-context` is the project name for prose; `sctx` is only the CLI command in command examples.
- **Approachability:** Write short, declarative sentences in active voice, one idea per sentence — about 80% of the way to ASD-STE100. Introduce a concept once, before sections that need it. Frame options by purpose (what each is for, and for whom).
- **Front-load the happy path:** Quick starts give the fewest steps that run. Tuning, alternatives and edge cases come after.

## Key Files

- `src/api.ts` — Public library entry point (`structured-context/api`). Re-exports the supported programmatic surface. Keep CLI-only concerns out of it. Do not extend it without agreement (see **Public API surface** above).
- `schemas/` — Bundled default schema files (JSON5) using the structured-context schema dialect and top-level `$metadata`. Files starting with `_` are "partials" (fragments for `$ref`).
- `src/schema/metadata-contract.ts` — Single source of truth for the `$metadata` contract
- `schemas/generated/latest/_structured_context_schema_meta.json` — Generated metaschema for the newest dialect (generated on build or with `bun run generate:schema-meta`). `schemas/generated/<version>/` folders are frozen copies, created by the `version` script (`generate:schema-meta --release`) only when a release changes the dialect; never edit them. `src/schema/meta-schemas.ts` loads them at runtime.
- `src/schema/gating.ts` — Cascade gating: computes hierarchy depth and evaluates rules with subtree gating (schema/hierarchy/blocking-rule failures suppress downstream rule evaluation). See [docs/rules.md](docs/rules.md#cascade-gating).
- `src/judge/` — Semantic rule evaluation (the "judge" is its internal name): provider interface and types (`types.ts`), verdict resolution (`verdicts.ts`), per-node and grouped dispatch (`judge-node.ts`), related-node selection for `semantic.scope` (`context.ts`), the per-node input cap and body trimming (`trim.ts`), and providers (`provider/anthropic.ts`, `provider/openai.ts`, `provider/jev.ts`, `provider/fake.ts`), provider hydration and the bundled catalogue (`factory.ts`), and `sctx providers` (`src/commands/providers.ts`). See [docs/semantic-rules.md](docs/semantic-rules.md).
- `src/schema/rule-filter.ts` — `--rule-filter` parsing and rule filtering by category, severity, type or id.

## Testing
For most development only the main unit tests need re-running regularly.
- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:hook` — unit test plugin hooks (`hook-test/unit/`) - hook development only
- `bun run test:hook:e2e` — test plugin hooks in Claude Code (`hook-test/`) - hook development only
- `bun run test:smoke` — smoke tests run against locally configured spaces - only use when changes could affect compatibility.
- `bun run test:judge` — live judge tests (`tests/judge/live.test.ts`): one real provider call per provider whose API key is set. Costs money; use sparingly when changing judges or semantic rule behaviour.
- `bun run test:models` — check that every bundled provider's configured model exists (no API keys)

## Debugging

- `bun run src/index.ts dump <space>` — Output parsed node data

## Hooks
Address issues related to change you made if a Stop hook reports them.
