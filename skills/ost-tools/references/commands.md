# ost-tools Command Reference

All commands use `bunx ost-tools` (or `bun run src/index.ts` in development). Always pass
`--config <path>` when the config is not in the default location.

## validate

```bash
bunx ost-tools validate <space> [--watch] [--config <path>]
```

Validates all `.md` files in the space against the JSON schema. For each file:
- Extracts YAML frontmatter
- Skips files with no frontmatter or no `type` field (after `fieldMap` remapping)
- Runs JSON schema validation
- Runs reference checks (wikilinks → known node titles)
- Runs executable rules (JSONata expressions in `$metadata.rules`)
- Checks hierarchy ordering

Exit codes: `0` = clean, `1` = validation issues found.

**Scenarios:**

```bash
# Validate after editing content
bunx ost-tools validate <space>

# Watch mode — re-validates on file changes
bunx ost-tools validate <space> --watch
```

## show

```bash
bunx ost-tools show <space> [--filter <view-or-expression>]
```

Prints a hierarchical tree of all nodes, indented by parent→child relationships. Useful for
browsing structure, verifying parent links are correct, and spotting orphaned nodes.

Uses hierarchy edge config from `$metadata.hierarchy.levels` (`field`, `fieldOn`, `multiple`).
If those are misconfigured for your content, output will appear flatter than expected.

**`--filter`** accepts either a named view from the space config (`views` key) or an inline filter
expression. Only matching nodes are shown in the tree.

```bash
# Inline expression
bunx ost-tools show <space> --filter "WHERE resolvedType='solution' and status='active'"

# Ancestor attribute filter (solutions under an active opportunity)
bunx ost-tools show <space> --filter "WHERE resolvedType='solution' and \$exists(ancestors[resolvedType='opportunity' and status='active'])"

# Named view from config
bunx ost-tools show <space> --filter my-view-name
```

**Filter expression syntax:** `WHERE {jsonata}` | `SELECT {spec} WHERE {jsonata}` | bare JSONata.
Within the predicate, node fields (e.g. `resolvedType`, `status`) are directly accessible. Two
traversal arrays are also available per node:
- `ancestors[]` — ancestor nodes nearest-first, each with `_field`, `_source`, `_selfRef` edge metadata
- `descendants[]` — descendant nodes, same structure

**Named views** are defined in the space config:
```json5
{
  views: {
    "active-solutions": { expression: "WHERE resolvedType='solution' and status='active'" }
  }
}
```

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
bunx ost-tools diagram <space> [--output <file.mmd>]
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
bunx ost-tools template-sync <space> [--create-missing] [--dry-run] [--config <path>]
```

Keeps Obsidian template files in sync with schema `examples`. For each node type:
- Finds the template file (using `templatePrefix` + type name)
- Rewrites frontmatter from schema `examples` and property `description` fields
- `--create-missing` creates template files for types that don't have one yet
- `--dry-run` previews changes without writing

Requires `templateDir` (and optionally `templatePrefix`) set in the space's `plugins.markdown` config.

```bash
# Preview template updates
bunx ost-tools template-sync <space> --dry-run

# Create missing templates
bunx ost-tools template-sync <space> --create-missing
```

## Config structure

```json5
{
  spaces: [
    {
      name: 'my-space',         // used in all CLI commands
      path: '../content',        // relative to config file, or absolute
      schema: 'my-schema.json',  // relative to config file, or absolute
      plugins: {
        markdown: {
          fieldMap: {              // optional: remap frontmatter field names
            record_type: 'type',   //   read record_type as type (entity discriminator)
          },
          templateDir: '../templates',
          templatePrefix: '',
        }
      },
      miroBoardId: 'xxx',
      miroFrameId: 'xxx',  // auto-populated by --new-frame
      views: {
        'active-solutions': { expression: "WHERE resolvedType='solution' and status='active'" },
      },
    }
  ]
}
```

All commands require a registered space name (not an arbitrary path).

Schema resolution order: space `schema` > global `schema` > bundled `general.json`.
