---
name: structured-context
description: >
  Use when working with structured-context (sctx): validating markdown content after edits, authoring or
  debugging schemas and rules, running sctx commands, or troubleshooting validation and setup errors.
---

# structured-context

`structured-context` validates Obsidian markdown frontmatter against JSON schemas. Content lives in
**spaces** (directories of `.md` files or a single "on-a-page" format); schemas define entity types, properties, and rules.
Rules are JSONata expressions, semantic rules evaluated by a model provider (only with `--semantic`), or both.

## Version compatibility

Before starting work, verify `sctx` is installed and check the version:

!`sctx --version`

The plugin version is listed in `plugin/.claude-plugin/plugin.json`. A match on **minor version** (e.g. both `0.9.*`) indicates compatibility. If the installed `sctx` minor version differs from the plugin minor version, warn the user — behaviour may differ from what the skill describes.

If not installed, run `bun install -g structured-context`

## Config

**Always read the config first** with `sctx spaces`: it shows the config in use, its spaces and any problems, each with a
code (see `references/troubleshooting.md`). `sctx docs config` covers config discovery and `sctx spaces add`. If
there is no config yet, use the setup-space skill.

## Orientation

Before working with a space, use these to understand what's configured:

```bash
sctx spaces --config <cfg>                        # per-space: path, schema, fieldMap, templates, miro
sctx schemas list --config <cfg>                  # list available schemas by name
sctx schemas show --space <name> --config <cfg>  # entity types, properties, rules, enums + registry
sctx schemas show <filename>                      # inspect a bundled partial (e.g. _sctx_base.json)
sctx docs                                         # full README
sctx docs config                                  # plugin config reference (fieldMap, typeInference, etc.)
sctx docs concepts                                # terminology reference
sctx docs semantic-rules                          # semantic rule reference
sctx providers --config <cfg>                     # model providers for --semantic
```

`spaces` is the starting point — it shows each space as a block with its schema name, `fieldMap`
mappings (if any), template config, and whether Miro is configured.

`schemas list` shows all available schema names — use this first to discover what schemas exist before inspecting one.

`schemas show --space` is the primary schema tool — it lists entity types and their properties (required marked with `*`), the hierarchy, **adjacent relationships**, all rules with descriptions, definitions with enum values, and the loaded schema registry. **Run this before authoring content or writing rules** to ensure you use the correct field names and types. The registry section
at the bottom shows which bundled and local partials are in scope for `$ref` targets.

`schemas show <filename>` (e.g. `_sctx_base.json`) reveals available definitions in bundled
partials.

## Commands for working with spaces

```
validate <space>       Validate space content against schema (--watch for live)
validate-file <path>   Validate one file within its space (after a single-file edit)
show <space>           Output the node hierarchy
dump <space>           Output parsed node data as JSON
diagram <space>        Generate Mermaid diagram (--output <file>)
render <space> <fmt>   Render a space in a given format
miro-sync <space>      Sync to Miro board (requires MIRO_TOKEN env var + miro plugin config with boardId)
template-sync <space>  Sync Obsidian templates from schema examples
plugins                List available plugins
```

All commands except `validate-file` require a registered space name. Run `sctx --help` or `sctx <command> --help` for flags.

**`dump` is the key debugging tool.** Use it to verify `fieldMap` remapping is working or to
inspect exactly what JSONata rules see when a rule fires unexpectedly.

## Embedded nodes and Relationships

Embedded nodes are nodes that live physically inside another node's file (via tables or lists) rather than as separate files.

**Adjacent Relationships** determine how these are parsed:
- **Heading matching:** When a heading matches a relationship `matcher` (case-insensitive or `/regex/`), following tables/lists are parsed as that child type.
- **Agnostic parsing:** The parser uses the semantic grandparent as the parent for items matched via a relationship heading.
- **Node content:** an embedded node's `content` is the markdown it owns; the containing page's `content` is the body outside its embedded nodes. Run `sctx docs concepts` (Node content) for the exact rules.
- **`fieldOn` direction:** Relationships support two link directions. `fieldOn: "child"` (default) sets the relationship field on each child node. `fieldOn: "parent"` instead populates the parent node's array field with `[[Child]]` wikilinks — use this when the content model lists children on the parent (e.g. `activity.tasks`). When `fieldOn: "parent"`, child nodes do not get a `parent` field from the relationship.

**When to use sub-entities:**
- For fine-grained items like `Assumption`, `Risk`, or `Requirement` that would clutter the filesystem if separate.
- When you want to group related child nodes under a stable heading in a parent's body.
- For developing a template page with structured headings and lists or tables to fill in.

## Authoring content frontmatter

When writing or editing Obsidian markdown frontmatter:

- **Do not include `title`** — Obsidian derives the page title from the filename.
- **Tags use plain strings** — In Obsidian frontmatter, tags are listed as plain strings without a `#` prefix (e.g. `tags: [productivity, reading]`). The `#` prefix is only used for inline tags in the document body.
- **Check entity descriptions before assigning a type to an existing document** — Run `schemas show --space <name>`. The description for each entity type, as well as any rules, should be carefully considered as part of determining that a type is appropriate for an existing document.

## Non-obvious issues

**Files missing from results (low `Valid` count)** — files without a `type` field are not nodes and are skipped silently. The space may use a different field name for the entity discriminator
(e.g., `record_type`): configure `fieldMap` in the space config to remap it to `type`, or `typeInference` to infer types from folders.

**Rule violations on every node of a type** — the rule may be too strict or misconfigured. Use `dump` to verify
what the rule actually sees in the `current` object, then adjust the rule in the schema.

**`show`/`diagram` show only orphans and non-hierarchy types** — the schema's `$metadata.hierarchy` may not have edge configuration for the space's relationship fields, or the nodes may belong to another hierarchy (pass `--hierarchy <name>`). Use `schemas show --space <name>` to check the hierarchy definition. Each non-root level can define a `field` entry (overriding default `parent:` field (and optionally `fieldOn: "parent"` / `multiple: true`) to wire up the correct relationship field.

## Troubleshooting Common Errors

| Error Message | Likely Cause | Solution |
|---------------|--------------|----------|
| `Invalid type "X". Valid types are: ...` | Type not defined in the schema (or a typo) | Check `schemas show --space`; fix the type or add an alias |
| `must have required property 'X'` | Required schema property missing | Check `schemas show --space` to see required properties |
| `Link target "X" in field "parent" not found` | Broken wikilink | Fix the link, or ensure the target file exists and has that name |
| `Link target "X" in field "parent" is ambiguous (matches multiple nodes)` | Several nodes share that name, for example `Overview.md` in different folders | Link with enough of the path to be unique, such as `[[alpha/Overview]]` |
| `[rule-id] ... (Rule error: ...)` | A rule's `expression` failed to evaluate (syntax or runtime error) | Verify the expression with `dump` and a JSONata tester |
| `[rule-id] ... (Semantic evaluation error: ...)` | The model provider call failed, or input is still over the per-node input cap after trimming | Check `sctx providers` and the API key; narrow `semantic.scope` or drop `includeContent` |

## Plugins

structured-context supports **plugins** for extending capabilities. Currently, parse plugins allow reading spaces from sources other than markdown (which is a built-in plugin).

For full plugin and markdown plugin config reference (fieldMap, typeInference, folderIndex, templateDir, filter views), run:

```bash
sctx docs config
```

## References

- **`references/schema-authoring.md`** — schema file structure, `$metadata`, rules (expression and semantic) (run `sctx docs schema` for schema dialect reference)
- **`references/schema-design.md`** — process for designing a schema from existing content
- **`references/troubleshooting.md`** — error codes from `sctx spaces` and the hooks, with the fix for each

For CLI and config reference, use `sctx docs <topic>` (topics: `concepts`, `config`, `schema`, `rules`, `semantic-rules`).
