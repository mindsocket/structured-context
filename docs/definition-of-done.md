---
title: "Definition of done"
---

# Definition of done

A change is done when the README, AGENTS.md, docs/ and plugin/ describe what the code now does. The README stays brief; detail belongs in docs/.

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
