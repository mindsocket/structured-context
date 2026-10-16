# structured-context Command Reference

Install the CLI globally:

```bash
bun install -g structured-context
```

Then use the `sctx` command for all operations. Always pass `--config <path>` when the config is not in the default location.

## validate

```bash
sctx validate <space> [--watch] [--config <path>] [--depth <n>] [--include-gated] [--semantic [provider]] [--rule-filter <dim=values>]
```

Validates all `.md` files in the space against the JSON schema. For each file:
- Extracts YAML frontmatter
- Skips files with no frontmatter or no `type` field (after `fieldMap` remapping)
- Runs JSON schema validation
- Runs reference checks (wikilinks → known node titles)
- Runs rules from `$metadata.rules` (each rule's `expression`; its `semantic` part only with
  `--semantic`), with cascade gating: a
  schema, hierarchy, or blocking-rule failure on a node suppresses rule evaluation for its
  hierarchy subtree. Gated nodes are reported in a coverage section (and `coverageGates` in
  `--json` output) so you know what wasn't checked and why.
- Checks hierarchy ordering

`--depth <n>` restricts evaluation to hierarchy nodes within `n` breadth-first levels from
the top — useful for fixing a space level by level (fix the top, re-run with a deeper
`--depth`, repeat). `--include-gated` evaluates rules on gated nodes anyway, still reporting
them as gated — use it to surface cheap bottom-up checks even when an upstream blocker fired.
`--semantic` also evaluates the `semantic` part of rules through the configured model provider
(costly; off by default; `--semantic <provider>` uses that configured provider instead; `sctx providers`
lists them). When input for a node exceeds the per-node input cap, node bodies are trimmed and the run
summary says which rules were affected. `--rule-filter <dimension>=<values>` (repeatable; category,
severity, type, id) narrows which rules run. `--json` prints machine-readable results.

Exit codes: `0` = clean (warning and info rule violations don't fail), `1` = validation errors found.

**Scenarios:**

```bash
# Validate after editing content
sctx validate <space>

# Watch mode — re-validates on file changes
sctx validate <space> --watch
```

## validate-file

```bash
sctx validate-file <path> [--json] [--include-gated] [--semantic [provider]] [--rule-filter <dim=values>]
```

Validates one file within its space: the space is found from the configured space paths, and
the whole space is read so links, hierarchy and gating resolve as in `validate`. Reports only
that file's issues; with `--semantic`, only that file's nodes are sent to the model provider.
Takes a file path, not a space name. A file outside every space reports nothing and exits `0`.
Use it after editing a single file.

## show

```bash
sctx show <space> [--filter <view-or-expression>] [--hierarchy <name>]
```

Prints a hierarchical tree of all nodes, indented by parent→child relationships. Useful for
browsing structure, verifying parent links are correct, and spotting orphaned nodes.

Uses hierarchy edge config from `$metadata.hierarchy.levels` (`field`, `fieldOn`, `multiple`).
If those are misconfigured for your content, output will appear flatter than expected.

**`--filter`** accepts either a named view from the space config (`views` key) or an inline filter
expression. Only matching nodes are shown in the tree.

**`--hierarchy`** names the hierarchy to render when the schema imports several (default: the main
hierarchy). `schemas show --space <name>` lists the hierarchy names. `diagram` and `render` accept it too.

```bash
# Inline expression
sctx show <space> --filter "WHERE resolvedType='solution' and status='active'"

# Ancestor attribute filter (solutions under an active opportunity)
sctx show <space> --filter "WHERE resolvedType='solution' and \$exists(ancestors[resolvedType='opportunity' and status='active'])"

# Named view from config
sctx show <space> --filter my-view-name
```

**Filter expression syntax:** `WHERE {jsonata}` | `SELECT {spec} WHERE {jsonata}` | `SELECT {spec}` | bare JSONata.
Within the WHERE predicate, node fields (e.g. `resolvedType`, `status`) are directly accessible. Two
traversal arrays are also available per node:
- `ancestors[]` — ancestor nodes nearest-first, each with `_field`, `_source`, `_hierarchy` (hierarchy edges only), `_selfRef` edge metadata
- `descendants[]` — descendant nodes, same structure

The SELECT spec is a comma-separated list of directives that expand the result set:
`ancestors[(type)]`, `descendants[(type)]`, `siblings`,
`relationships[(childType | parentType:childType | parentType:field:childType)]`

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
sctx dump <space> [--filter <view-or-expression>] [--hierarchy <name>]
```

Outputs `{ nodes, source, diagnostics }` as strict JSON. Each node includes resolved fields:
- `label` — source identifier; the same key `validate --json` uses for its `errors` map
- `title`, `resolvedType` — canonical title and type after alias resolution
- `resolvedParents` — parent refs after link resolution, with the edge field and source

Unfiltered output includes schema-invalid nodes. `--filter` works the same as in `show`/`render`
(named view or inline expression, evaluated over the schema-valid graph).

Use this to debug rule violations ("why is this rule firing?"), verify `fieldMap` remapping
is working, or inspect what JSONata expressions see at evaluation time.

```bash
# Pipe through jq to inspect a specific node
sctx dump <space> | jq '.nodes[] | select(.title == "My Node Title")'

# Join nodes with their validation errors
sctx validate <space> --json > v.json
sctx dump <space> | jq --slurpfile v v.json '.nodes[] | {label, resolvedType, errors: $v[0].errors[.label]}'
```

## diagram

```bash
sctx diagram <space> [--output <file.mmd>] [--hierarchy <name>]
```

Generates a Mermaid `graph TD` diagram from space nodes. Nodes are colour-coded by type;
orphans are clustered separately. `--output` to file or stdout otherwise.

```bash
# Write diagram to file
sctx diagram <space> --output /tmp/tree.mmd
```

## miro-sync

```bash
sctx miro-sync <space> [--new-frame <title>] [--dry-run] [--verbose] [--config <path>]
```

Syncs space nodes to a Miro board. Requires:
- `MIRO_TOKEN` environment variable
- `boardId` set in `plugins.miro` for the space

First sync: use `--new-frame "Frame Title"` to create a new frame; the resulting `frameId`
is auto-saved to the miro plugin config. Subsequent syncs reuse the cached frame ID.

Sync is one-way (structured-context → Miro). Manual edits to managed cards in Miro are overwritten.

```bash
# First sync to a new frame
MIRO_TOKEN=xxx sctx miro-sync <space> --new-frame "My Frame"

# Dry run to preview changes
MIRO_TOKEN=xxx sctx miro-sync <space> --dry-run
```

## template-sync

```bash
sctx template-sync <space> [--create-missing] [--dry-run] [--config <path>]
```

Keeps Obsidian template files in sync with schema `examples`. For each node type:
- Finds the template file (using `templatePrefix` + type name)
- Rewrites frontmatter from schema `examples` and property `description` fields
- `--create-missing` creates template files for types that don't have one yet
- `--dry-run` previews changes without writing

Requires `templateDir` (and optionally `templatePrefix`) set in the space's `plugins.markdown` config.

```bash
# Preview template updates
sctx template-sync <space> --dry-run

# Create missing templates
sctx template-sync <space> --create-missing
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
        },
        miro: {
          boardId: 'xxx',
          frameId: 'xxx',  // auto-populated by --new-frame
        },
      },
      views: {
        'active-solutions': { expression: "WHERE resolvedType='solution' and status='active'" },
      },
    }
  ]
}
```

All commands except `validate-file` require a registered space name (not an arbitrary path).

Schema resolution order: space `schema` > global `schema`. Schema resolution fails if none is configured.
