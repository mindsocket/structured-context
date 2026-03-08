# ost-tools Command Reference

All commands use `bunx ost-tools` (or `bun run src/index.ts` in development). Always pass
`--config <path>` when the config is not in the default location.

## validate

```bash
bunx ost-tools validate <space-or-dir> [--schema <path>] [--config <path>]
```

Validates all `.md` files in the space against the JSON schema. For each file:
- Extracts YAML frontmatter
- Skips files with no frontmatter or no `type` field (after `fieldMap` remapping)
- Runs JSON schema validation
- Runs reference checks (wikilinks → known node titles)
- Runs executable rules (JSONata expressions in `_metadata.rules`)
- Checks hierarchy ordering

**Scenarios:**

```bash
# Validate after editing content
bunx ost-tools validate <space>

# Validate against a different schema (for testing)
bunx ost-tools validate <space> --schema /tmp/experimental-schema.json
```

## show

```bash
bunx ost-tools show <space>
```

Prints a hierarchical tree of all nodes, indented by parent→child relationships. Useful for
browsing structure, verifying parent links are correct, and spotting orphaned nodes.

Requires nodes to use the `parent` field with wikilinks. Spaces that express relationships
via other fields (e.g. `opportunity`, `solution`) will show a flat list.

## dump

```bash
bunx ost-tools dump <space>
```

Outputs the full parsed node data as JSON, including resolved fields:
- `resolvedType` — canonical type after alias resolution
- `resolvedParentTitle` — parent title after link resolution

Use this to debug rule violations ("why is this rule firing?"), verify `fieldMap` remapping
is working, or inspect what JSONata expressions see at evaluation time.

```bash
# Pipe through jq to inspect a specific node
bunx ost-tools dump <space> | jq '.[] | select(.title == "My Node Title")'
```

## diagram

```bash
bunx ost-tools diagram <space> [--output <file.mmd>] [--schema <path>]
```

Generates a Mermaid `graph TD` diagram from space nodes. Nodes are colour-coded by type;
orphans are clustered separately. `--output` to file or stdout otherwise.

```bash
# Write diagram to file
bunx ost-tools diagram <space> --output /tmp/tree.mmd
```

## miro-sync

```bash
bunx ost-tools miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose] [--config <path>]
```

Syncs space nodes to a Miro board. Requires:
- `MIRO_TOKEN` environment variable
- `miroBoardId` in the space's config entry

First sync: use `--new-frame "Frame Title"` to create a new frame; the resulting `miroFrameId`
is auto-saved to config. Subsequent syncs reuse the cached frame ID.

Sync is one-way (ost-tools → Miro). Manual edits to managed cards in Miro are overwritten.

```bash
# First sync to a new frame
MIRO_TOKEN=xxx bunx ost-tools miro-sync <space> --new-frame "My Frame"

# Dry run to preview changes
MIRO_TOKEN=xxx bunx ost-tools miro-sync <space> --dry-run
```

## template-sync

```bash
bunx ost-tools template-sync [--space <alias>] [--schema <path>] [--create-missing] [--dry-run] [--config <path>]
```

Keeps Obsidian template files in sync with schema `examples`. For each node type:
- Finds the template file (using `templatePrefix` + type name)
- Rewrites frontmatter from schema `examples` and property `description` fields
- `--create-missing` creates template files for types that don't have one yet
- `--dry-run` previews changes without writing

Requires `templateDir` (and optionally `templatePrefix`) set in the space config.

```bash
# Preview template updates
bunx ost-tools template-sync --space <space> --dry-run

# Create missing templates
bunx ost-tools template-sync --space <space> --create-missing
```

## Config structure

```json5
// ost-tools-config.json
{
  spaces: [
    {
      alias: 'my-space',         // used in all CLI commands
      path: '../content',        // relative to config file, or absolute
      schema: 'my-schema.json',  // relative to config file, or absolute
      fieldMap: {                // optional: remap frontmatter field names
        record_type: 'type',     //   read record_type as type (entity discriminator)
        type: 'entity_type'      //   read type as entity_type (avoid collision)
      },
      templateDir: '../templates',
      templatePrefix: '',
      miroBoardId: 'xxx',
      miroFrameId: 'xxx',  // auto-populated by --new-frame
    }
  ]
}
```

Schema resolution order: `--schema` CLI flag > space `schema` > global `schema` > bundled `general.json`.
