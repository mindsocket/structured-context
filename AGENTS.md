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

The lefthook pre-commit hook syncs the plugin version, then runs biome (`--write`, re-staged) and the typecheck.

## Claude Code Plugin

`plugin/` is a Claude Code plugin for working with spaces. [docs/architecture.md](docs/architecture.md#claude-code-plugin) describes its hooks, mod and map pane. Never edit the version in `plugin/.claude-plugin/plugin.json`, because git hooks bump it.

## Definition of done

A change is done when everything it affects is updated, including files it does not touch. See [docs/definition-of-done.md](docs/definition-of-done.md).

## Planning & Design Principles

- **Simplicity first:** Strive for the simplest design that completely solves the problem. Prefer conventions and established filesystem patterns over adding new configuration, programmatic APIs, or abstractions.
- **Explicitly state alternatives:** When planning or making architectural decisions, do not anchor to the first familiar mechanism. Formulate and state at least one alternative approach, weighing trade-offs, complexity, and ergonomic impact.
- **Architecture first:** Before 1.0, choose the design that keeps the architecture right, even when it changes interfaces across modules. Replace the old way instead of keeping both.
- **Module boundaries:** Each module owns one concern ([docs/architecture.md](docs/architecture.md#module-boundaries)). Pass what you have to the owning module and let it derive what it needs, instead of building its data for it.
- **Public API surface:** Do not add exports to `src/api.ts`, `src/browser.ts` or `src/types.ts` (the `structured-context/api`, `/browser` and `/types` entry points), or add types or hooks to the plugin interface, without the maintainer's explicit agreement on that specific surface. Exporting something to make docs complete, to tidy up, or because a feature has a public-looking class is not a reason. Agreement on a function covers that function only: its option and result types are separate exports, so derive them in the consumer (`Parameters`, `ReturnType`) instead. If a change seems to need a new export, stop and propose it, with the consumer that needs it. Internal modules can change freely.
- **Where a setting lives:** Settings go in config. The environment holds only secrets and the config location. Costly or outward-facing behaviour, such as semantic judging, is opt-in on each run.
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

Run `bun run test` during development. Run the others with `bun run` when a change touches their area:

- `test:hook`, `test:hook:e2e` — plugin hooks
- `test:mod` — the mod
- `test:smoke` — compatibility with locally configured spaces
- `test:package` — the build, `tsconfig*.json` or `files`
- `test:judge` — judges; makes live provider calls, which cost money
- `test:models` — the bundled providers' models
- `eval:semantic --provider <name>` — bundled semantic rules, the schema descriptions they use, or a judge; costs money unless run with `--check`

## Debugging

- `bun run src/index.ts dump <space>` — Output parsed node data

## Hooks
Address issues related to change you made if a Stop hook reports them.
The Stop hook and pre-push block while the branch adds docs or code comments that `doc-review` has not seen (`scripts/prose-check.sh`).
