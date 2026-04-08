---
name: structured-context
description: >
  Use this skill when editing structured markdown content in Obsidian to ensure it conforms to a
  schema, or when authoring or debugging schemas. Trigger when: (1) content needs validating after
  edits, (2) schema files or rules need creating or updating, (3) configuring or designing a schema
  for a space, (4) troubleshooting unexpected validation errors, (5) running structured-context CLI commands.
---

# structured-context

`structured-context` validates Obsidian markdown frontmatter against JSON schemas. Content lives in
**spaces** (directories of `.md` files or a single "on-a-page" format); schemas define entity types, properties, and rules.

## Version compatibility

Before starting work, verify `sctx` is installed and check the version:

!`sctx --version`

The plugin version is listed in `plugin/.claude-plugin/plugin.json`. A match on **minor version** (e.g. both `0.9.*`) indicates compatibility. If the installed `sctx` minor version differs from the plugin minor version, warn the user — behaviour may differ from what the skill describes.

If not installed, run `bun install -g structured-context`

## Finding the config

structured-context looks in `$XDG_CONFIG_HOME/structured-context/config.json`, unless given an explicit config, e.g.:

```bash
sctx validate <space> --config path/to/config.json
# or
SCTX_CONFIG=path/to/config.json sctx validate <space>
```

**Always read the config first** to understand available spaces and their schema locations before running other commands.

Tip: To reduce the need for `--config` flags consider, with user permission, using `includeSpacesFrom` in a central config file that's loaded by default (eg `~/.config/structured-context/config.json`).

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
show <space>           Output the node hierarchy
dump <space>           Output parsed node data as JSON
diagram <space>        Generate Mermaid diagram (--output <file>)
miro-sync <space>      Sync to Miro board (requires MIRO_TOKEN env var + miroBoardId in config)
template-sync <space>  Sync Obsidian templates from schema examples
plugins                List available plugins
```

All commands require a registered space name. Run `sctx --help` or `sctx <command> --help` for flags.

**`dump` is the key debugging tool.** Use it to verify `fieldMap` remapping is working or to
inspect exactly what JSONata rules see when a rule fires unexpectedly.

## Embedded nodes and Relationships

Embedded nodes are nodes that live physically inside another node's file (via tables or lists) rather than as separate files.

**Adjacent Relationships** determine how these are parsed:
- **Heading matching:** When a heading matches a relationship `matcher` (case-insensitive or `/regex/`), following tables/lists are parsed as that child type.
- **Agnostic parsing:** The parser uses the semantic grandparent as the parent for items matched via a relationship heading.
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

**All files appear as "Non-space (no type field)"** — the space uses a different field name for the entity discriminator
(e.g., `record_type`). Configure `fieldMap` in the space config to remap it to `type`.

**Rule violations on every node of a type** — the rule may be too strict or misconfigured. Use `dump` to verify
what the rule actually sees in the `current` object, then adjust the rule in the schema.

**`show`/`diagram` show only orphans and non-hierarchy types** — the schema's `$metadata.hierarchy` may not have edge configuration for the space's relationship fields. Use `schemas show --space <name>` to check the hierarchy definition. Each non-root level can define a `field` entry (overriding default `parent:` field (and optionally `fieldOn: "parent"` / `multiple: true`) to wire up the correct relationship field.

## Troubleshooting Common Errors

| Error Message | Likely Cause | Solution |
|---------------|--------------|----------|
| `File has no type field` | Discriminator field missing or named differently | Check `fieldMap` in config or add `type` to frontmatter |
| `must have property 'X'` | Required schema property missing | Check `schemas show --space` to see required properties |
| `could not find node '[[Title]]'` | Broken wikilink | Fix the title in the link or ensure the target file exists and has that title |
| `JSONata error: ...` | Syntax error in schema `$metadata.rules` | Verify the expression with `dump` and a JSONata tester |

## Plugins

structured-context supports **plugins** for extending capabilities. Currently, parse plugins allow reading spaces from sources other than markdown (which is a built-in plugin).

For full plugin and markdown plugin config reference (fieldMap, typeInference, templateDir, filter views), run:

```bash
sctx docs config
```

## References

- **`references/schema-authoring.md`** — schema file structure, `$metadata`, JSONata rules (run `sctx docs schema` for schema dialect reference)
- **`references/schema-design.md`** — process for designing a schema from existing content

For CLI and config reference, use `sctx docs <topic>` (topics: `concepts`, `config`, `schema`, `rules`).
