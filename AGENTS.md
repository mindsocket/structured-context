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
- Releases go through the `/release` skill. Its tag push runs `.github/workflows/release.yml`, which publishes to npm.

Space names (e.g. `personal`, `politics`) are resolved via a config file - `$SCTX_CONFIG`, `$XDG_CONFIG_HOME/structured-context/config.json`, `--config <file>` param, or the nearest `.sctx.json` or `.sctx/config.json` walking up from the working directory. Relative paths resolve from the config root, and local plugins, schemas and map views sit in `.sctx/` (`src/config/layout.ts`)

The lefthook pre-commit hook syncs the plugin version (below), then runs biome (`--write`, re-staged) and the typecheck.

## Claude Code Plugin

A Claude Code plugin lives at `plugin/`. It includes skills, commands and hooks used when working with collections of Obsidian markdown content (aka a space) in a vault.

The command hooks in `plugin/hooks/hooks.json` baseline each turn and gate it at Stop. The mod (`plugin/hooks/register.tsx`, a hooks module) adds to them: a line under the answer and a band above the prompt for the turn's new issues, a status line, the schemas of the spaces in the working directory in the system prompt, and `spaces`, `validate` and `schema` tools. It never validates per tool call, because a space can be invalid partway through a multi-file change. A mod has no Node, so it reaches the hooks' state and the CLI through `plugin/scripts/mod-bridge.ts`. `plugin/types/index.d.ts` declares the mod's `$.state`.

The map pane (`plugin/hooks/map-pane.tsx`, `/sctx-map`) draws a space's hierarchy with each node's validation results. A mod can't import packages, so the code it runs from core and `structured-context-map-views` is bundled into the committed `plugin/hooks/projection.js` by `bun run build:mod-projection`. The same command inlines the core types the mod shares (`scripts/mod-contract.ts`) into `plugin/types/index.d.ts`, which must be self-contained.

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
| Bundled semantic rule | its eval in `evals/semantic/` |
| User-visible error or warning message | the troubleshooting table in `SKILL.md` |
| Config key or space config | `docs/config.md`; the config example in `references/commands.md` |
| `validate --json` output | `plugin/scripts/state.ts` (the hooks parse it), `scripts/mod-contract.ts` and `bun run test:hook` |
| Hook state or `schemas show` output | `plugin/scripts/mod-bridge.ts`, `plugin/types/index.d.ts` and `bun run test:mod` |
| `src/browser.ts`, the space graph format, the types in `scripts/mod-contract.ts`, or the `structured-context-map-views` version | `bun run build:mod-projection` |
| Parsing or node content | `docs/concepts.md`; the embedded nodes section in `SKILL.md` |
| New term | `docs/concepts.md` |
| New module, or a module taking on another's concern | Module Boundaries in `docs/architecture.md`; `tests/module-boundaries.test.ts` |

## Planning & Design Principles

- **Simplicity first:** Strive for the simplest design that completely solves the problem. Prefer conventions and established filesystem patterns over adding new configuration, programmatic APIs, or abstractions.
- **Explicitly state alternatives:** When planning or making architectural decisions, do not anchor to the first familiar mechanism. Formulate and state at least one alternative approach, weighing trade-offs, complexity, and ergonomic impact.
- **Minimise blast radius:** Protect established boundaries and interfaces. Treat unnecessary ripple effects (such as making synchronous APIs asynchronous or adding dual APIs) as a design smell indicating the approach should be re-evaluated.
- **Module boundaries:** Each module owns one concern ([docs/architecture.md](docs/architecture.md#module-boundaries)). Pass what you have to the owning module and let it derive what it needs, instead of building its data for it.
- **Public API surface:** Do not add exports to `src/api.ts`, `src/browser.ts` or `src/types.ts` (the `structured-context/api`, `/browser` and `/types` entry points), or add types or hooks to the plugin interface, without the maintainer's explicit agreement on that specific surface. Exporting something to make docs complete, to tidy up, or because a feature has a public-looking class is not a reason. Agreement on a function covers that function only: its option and result types are separate exports, so derive them in the consumer (`Parameters`, `ReturnType`) instead. If a change seems to need a new export, stop and propose it, with the consumer that needs it. Internal modules can change freely.
- **Where a setting lives:** Config says *what* to use, CLI flags override it for one run, and the environment holds secrets and the config location only (`apiKeyEnv` names a secret; `SCTX_CONFIG` locates the config). Do not add env vars that set config values, and never infer a choice (such as a judge provider) from a variable that happens to be set: a key present for another tool must not be spent silently. Config also never switches on costly or outward-facing behaviour (such as semantic judging): each run asks for it, through a flag or an API option.
- **Reuse types:** Derive a type from the real one (`Pick`, `Partial`) instead of restating its shape. Keep CLI wording (flags, commands) out of library errors and the public API; the CLI adds its own hint. Once a feature has many files, give it a directory. Comments explain why, never restate the code.
- **Failures are visible:** A rule or expression that cannot be evaluated is reported as a violation, never skipped or treated as a pass. Likewise a misconfiguration fails before any work or spend.

## Documentation Principles

- **One idea lives in one place:** Decide which doc owns each concept, document it there once, and link instead of repeating. Small, non-obvious tidbits may be repeated; explanations may not.
- **Document what it does, not what it doesn't:** Describe behaviour and purpose. State a limit only when a new user would realistically assume otherwise. Specification and decision history do not leak into docs.
- **Proper name in docs:** `structured-context` is the project name for prose; `sctx` is only the CLI command in command examples.
- **Approachability:** Write short, declarative sentences in active voice, one idea per sentence — about 80% of the way to ASD-STE100. Introduce a concept once, before sections that need it. Frame options by purpose (what each is for, and for whom).
- **Plain language:** Say what happens. Leave out decision history and internal jargon ("never merged by location"), error codes the output already shows, restatements of the sentence before, and "implications" the reader can work out. Label a recommendation as a recommendation.
- **README stays short:** A README section is a sentence or two that points to docs/. Setup mechanics, failure behaviour and edge cases go in docs/.
- **Skills and references:** Every line is an action or a fact the agent lacks. Cut instructions the next command makes redundant, and do not state what command output already says. Do not over-constrain capable models with rules for situations they handle. The `description` uses the words a user or agent would use, naming structured-context (sctx) and the task in plain terms. `SKILL.md` holds the common path; detail goes in `references/` or `sctx docs`. Prefer a skill to a slash command, since the two are interchangeable.
- **Front-load the happy path:** Quick starts give the fewest steps that run. Tuning, alternatives and edge cases come after.

## Key Files

- `src/api.ts`, `src/browser.ts`, `src/types.ts` — the public entry points (see **Public API surface** above). Nothing `browser.ts` imports may use Node built-ins.
- `src/space-graph-data.ts` — the space graph format.
- `src/schema/metadata-contract.ts` — the `$metadata` contract.
- `schemas/` — bundled schemas; `_` files are partials. Never edit the frozen `schemas/generated/<version>/` folders.
- `src/rule/gating.ts` — rule evaluation and cascade gating ([docs/rules.md](docs/rules.md#cascade-gating)).
- `src/judge/` — semantic rules ([docs/semantic-rules.md](docs/semantic-rules.md)).

## Testing
For most development only the main unit tests need re-running regularly.
- `bun run test` — unit tests (fixtures in `tests/`)
- `bun run test:hook` — unit test plugin hooks (`hook-test/unit/`) - hook development only
- `bun run test:mod` — test the mod (`plugin/hooks/*.test.tsx`, with `claude plugin test`) - mod development only. CI runs it, and `claude plugin validate plugin`
- `bun run test:hook:e2e` — test plugin hooks in Claude Code (`hook-test/`) - hook development only
- `bun run test:smoke` — smoke tests run against locally configured spaces - only use when changes could affect compatibility.
- `bun run test:package` — builds and packs the package, installs the tarball, and runs the installed CLI. Runs in CI and before every version bump; run it after changing the build, `tsconfig*.json` or `files`.
- `bun run test:judge` — live judge tests (`tests/judge/live.test.ts`): one real provider call per provider whose API key is set. Costs money; use sparingly when changing judges or semantic rule behaviour.
- `bun run test:models` — check that every bundled provider's configured model exists (no API keys)
- `bun run eval:semantic --provider <name>` — semantic evals (`evals/`): how often a provider's verdicts match labelled cases. Costs money (`--check` doesn't). Run it when changing a bundled semantic rule, the schema descriptions it draws on, or a judge.

## Debugging

- `bun run src/index.ts dump <space>` — Output parsed node data

## Hooks
Address issues related to change you made if a Stop hook reports them.
The Stop hook and pre-push block while the branch adds docs or code comments that `doc-review` has not seen (`scripts/prose-check.sh`).
