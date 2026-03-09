# Schemas

This document explains schema usage, metadata shape, and composition semantics in `ost-tools`.

## Overview

A **schema** defines the valid structure for nodes in a `space`: entity types, field constraints, hierarchy behavior, type aliases, and executable rules.

`ost-tools` uses JSON Schema Draft-07 plus a custom top-level `$metadata` keyword.

## Selecting a schema

Set `schema` in config:

```json
{
  "name": "my-space",
  "path": "/path/to/space",
  "schema": "schemas/strict_ost.json"
}
```

Or pass it per command:

```bash
bun run src/index.ts validate my-space --schema schemas/strict_ost.json
```

Resolution order: `--schema` CLI flag > space `schema` > global `schema` > bundled `schemas/general.json`.

## Bundled schemas

### `general.json` (default)

Flexible planning schema spanning strategy + OST-like flow.

Main types:
- `vision`
- `mission`
- `goal` (alias: `outcome`)
- `opportunity`
- `solution`
- `experiment` (aliases: `assumption_test`, `test`)

### `strict_ost.json`

Canonical 4-level OST structure.

Main types:
- `outcome`
- `opportunity`
- `solution`
- `assumption_test`

This schema composes shared structural defs and strict metadata/rules from partials.

## Metadata dialect

Schemas use this metaschema URL:

- `https://raw.githubusercontent.com/mindsocket/ost-tools/main/schemas/generated/_ost_tools_schema_meta.json`

Top-level metadata shape:

```json5
{
  "$metadata": {
    "hierarchy": {
      "levels": [
        "outcome",
        { "type": "opportunity", "selfRef": true },
        "solution",
        "assumption_test"
      ],
      "allowSkipLevels": false
    },
    "aliases": {
      "experiment": "assumption_test"
    },
    "rules": [
      {
        "id": "active-outcome-count",
        "category": "workflow",
        "description": "Only one outcome should be active at a time",
        "scope": "global",
        "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
      }
    ]
  }
}
```

### `$metadata` fields

| Field | Type | Notes |
|---|---|---|
| `hierarchy` | object | Required (exactly one provider after composition) |
| `hierarchy.levels` | `(string \| HierarchyLevel)[]` | Ordered root→leaf types |
| `hierarchy.allowSkipLevels` | `boolean` | Optional; allows parent to be any ancestor level |
| `aliases` | `Record<string, string>` | Optional type alias map |
| `rules` | `Rule[]` | Optional flat rule array |

`HierarchyLevel` options:

| Option | Default | Meaning |
|---|---|---|
| `type` | required | Canonical type name |
| `field` | `"parent"` | Frontmatter field holding wikilink(s) |
| `fieldOn` | `"child"` | `"parent"` means the parent points to children |
| `multiple` | `false` | Field contains array of wikilinks |
| `selfRef` | `false` | Allows same-type parent |

String shorthand (`"goal"`) normalizes to:
`{ "type": "goal", "field": "parent", "fieldOn": "child", "multiple": false, "selfRef": false }`.

## Composition and merge semantics

Metadata is composed across the `$ref` graph with deterministic behavior:

1. Traverse external `$ref` graph in DFS order.
2. Apply root schema metadata last.

Merge rules:
- `hierarchy`: exactly one provider allowed. Multiple providers error.
- `aliases`: shallow merged; later provider wins per key.
- `rules`: merged by `id`.
- Duplicate rule `id` with different payload errors by default.
- A later rule may replace an earlier one only with `"override": true`.

### Rule imports via `$ref`

Inside `$metadata.rules`, entries can be inline rules or `$ref` imports:

```json5
"rules": [
  { "$ref": "ost-tools://my-pack#/$defs/workflowRule" },
  { "$ref": "ost-tools://my-pack#/$defs/ruleSet" }
]
```

Import targets may be:
- a single rule object
- an object containing `rules: []`

Imported rules are normalized into one executable flat list before validation.

### Override example

```json5
{
  "$metadata": {
    "rules": [
      {
        "id": "active-outcome-count",
        "override": true,
        "category": "workflow",
        "description": "Require exactly one active outcome",
        "scope": "global",
        "check": "$count(nodes[resolvedType='outcome' and status='active']) = 1"
      }
    ]
  }
}
```

## Partials and `$ref`

- Files starting with `_` are auto-loaded partials.
- Both bundled partials and local schema-directory partials are registered.
- Local partial `$id` values must not collide with bundled IDs.
- `$ref` resolution is transitive across files.

## Editor expectations

Use the shipped metaschema URL in `$schema` for best cross-tool behavior.

Notes:
- Custom `$id` values like `ost-tools://...` are still supported by the CLI registry.
- Some generic editors may not resolve custom URI schemes for `$ref`; CLI behavior is authoritative.
- Do not rely on editor-only mappings for runtime correctness.

## Breaking migration checklist (legacy -> current)

For schemas migrating from older metadata structure:

1. Move any legacy metadata from `$defs._metadata` to top-level `$metadata`.
2. Convert `hierarchy` array to `hierarchy.levels` object shape.
3. Move `allowSkipLevels` under `hierarchy`.
4. Convert grouped rule containers to flat `rules[]` with per-rule `category`.
5. If duplicate rule IDs are intentional, mark later rules with `override: true`.
6. Re-run `bunx ost-tools schemas show --space <name>` and `validate` to confirm merged metadata/rules.

## JSON5 support

Schema files are parsed as JSON5 (`//` comments and trailing commas are allowed).

## Further reading

- [Executable Rules](rules.md)
- [JSON Schema](https://json-schema.org/)
