# Schemas

This document explains the schema system and the schemas included with ost-tools.

## Overview

A **schema** defines the valid structure for nodes in a `space`: the fields, types, constraints, and validation rules for each entity type. Schemas use JSON Schema format and support composability through shared definitions.

## Using Schemas

To specify a schema for a space, add the `schema` field to your space entry in `config.json`:

```json
{
  "name": "my-space",
  "path": "/path/to/space",
  "schema": "schemas/strict_ost.json"
}
```

You can also specify a schema per-command using the `--schema` flag:

```bash
bun run src/index.ts validate my-space --schema schemas/strict_ost.json
```

If no schema is specified, the default `schemas/general.json` is used.

## Available Schemas

### `general.json` (default)

A flexible, opinionated schema supporting a multi-level strategy hierarchy alongside Opportunity Solution Tree types. This schema is designed for personal and strategic planning use cases.

**Node types:**
- `vision` — Root-level vision statement (no parent)
- `mission` — Mission statement with optional vision parent
- `goal` or `outcome` — Goal or outcome node
- `opportunity` — Opportunity with optional numeric assessments (impact, feasibility, resources)
- `solution` — Solution with optional numeric assessments
- `experiment`|`assumption_test`|`test` — Experiment/assumption test

**Features:**
- Allows `vision`, `mission`, `goal` hierarchy for strategic planning
- Optional numeric assessment fields (1-5 scale) for opportunities and solutions
- Type aliases: alternative terms accepted for some types
- `additionalProperties: true` allows extensibility

**Use when:**
- You want a flexible planning tool that combines strategy hierarchy with OST concepts
- You're using ost-tools for personal planning or broader strategic work

### `strict_ost.json`

A schema following the canonical 4-level Opportunity Solution Tree structure, based on Teresa Torres' methodology as described in "Continuous Discovery Habits" (2021) and at producttalk.org.

**Node types:**
- `outcome` — Root-level outcome (product metric, no parent)
- `opportunity` — Customer pain points, desires, and needs (can be nested)
- `solution` — Solutions to explore for target opportunities
- `assumption_test` — Assumption tests for solutions

**Fields:**
- `outcome` requires a `metric` field for the product metric
- `opportunity` requires a `source` field to track research origin
- `assumption_test` requires an `assumption` field and accepts an optional `category`

**Use when:**
- You want to follow Teresa Torres' OST methodology strictly
- You're working on product discovery with a team
- You need research-grounded opportunities with source tracking

## Shared Definitions

### `_shared.json`

Common definitions used across multiple schemas:

- `baseNodeProps` — Base properties (title, content, tags)
- `ostEntityProps` — Common OST entity properties (status, summary, status_tweet)
- `status` — Lifecycle status enum
- `priority` — Priority level enum (p1-p4)
- `assessment` — Numeric assessment (1-5)
- `wikilink` — Wikilink pattern for parent references

### `_strict.json`

Shared definitions specific to the strict OST schema:

- `outcomeProps` — Outcome-specific properties (metric)
- `opportunityProps` — Opportunity properties (source)
- `assumptionTestProps` — Assumption test properties (assumption, category)
- `$metadata` — Hierarchy, type aliases, and executable rules for strict OST validation

## Schema Metadata

ost-tools uses a Draft-07-based schema dialect (`$schema: "ost-tools://_ost_tools_schema_meta"`) that adds a top-level `$metadata` block for non-structural validation configuration.

```json5
{
  "$metadata": {
    "hierarchy": ["outcome", { "type": "opportunity", "selfRef": true }, "solution", "assumption_test"],
    "aliases": { "test": "assumption_test" },
    "allowSkipLevels": false,
    "rules": { ... }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `hierarchy` | `(string \| HierarchyLevel)[]` | Ordered list of types from root to leaf; plain strings use defaults |
| `aliases` | `Record<string, string>` | Maps alternative type names to canonical types |
| `allowSkipLevels` | `boolean` | When `true`, a node may have any ancestor type above it, not just the immediate parent |
| `rules` | `object` | Executable validation rules — see [docs/rules.md](rules.md) |

### Hierarchy levels

Each entry in `hierarchy` may be a plain string (shorthand for `{ type: "..." }`) or a `HierarchyLevel` object:

```json5
"hierarchy": [
  { "type": "Outcomes" },                          // root — no edge config
  { "type": "Opportunities", "field": "outcome" },    // child has single wikilink in 'outcome' field instead of 'parent'
  {
    "type": "Solution",
    "field": "has_solutions",
    "fieldOn": "parent",   // parent (Opportunities) has the field pointing to children
    "multiple": true       // field is an array of wikilinks
  },
  {
    "type": "Experiments",
    "field": "informs",
    "multiple": true       // child (Experiments) has array of parent wikilinks instead of single
  }
]
```

| Level option | Default | Meaning |
|---|---|---|
| `type` | — | Canonical type name |
| `field` | `"parent"` | Frontmatter field holding the wikilink(s) |
| `fieldOn` | `"child"` | `"parent"` means the field is on the **parent** node and points to children |
| `multiple` | `false` | When `true`, the field is an array of wikilinks |
| `selfRef` | `false` | When `true`, a node of this type may have a parent of the same type (e.g. nested opportunities) |

Plain string entries normalize to `{ type: "...", field: "parent", fieldOn: "child", multiple: false, selfRef: false }`.

### Hierarchy validation

The validator checks every node type and its parent type(s) against the hierarchy order, with violations flagged. A node may have multiple resolved parents (layered DAG); each is checked independently.

`allowSkipLevels` and per-level `selfRef` modify the strictness. For example, `{ "type": "opportunity", "selfRef": true }` permits nested opportunity trees.

### Type aliases

`aliases` maps alternative type names to canonical types. A node with `type: outcome` and `"aliases": { "outcome": "goal" }` will have `resolvedType: goal` and be treated as a `goal` everywhere — in hierarchy checks, rule type filters, and output.

## Schema Composability

Schemas are designed to be composable. You can create custom schemas by:

1. Creating a new `.json` file in the `schemas/` directory
2. Using `$ref` to reference shared definitions from `_shared.json` or other schemas. This works transitively, including nested `allOf` compositions.
3. Defining your own node types and constraints

Metadata can be defined either directly on the target schema (`$metadata`) or in a loaded partial schema. If multiple loaded schemas define metadata, the first `$metadata` found in load order is used.

Example of referencing shared definitions:

```json5
{
  "$schema": "ost-tools://_ost_tools_schema_meta",
  "$id": "ost-tools://my-custom-schema",
  "oneOf": [
    {
      "type": "object",
      "allOf": [
        { "$ref": "ost-tools://_shared#/$defs/baseNodeProps" },
        { "$ref": "ost-tools://_shared#/$defs/ostEntityProps" }
      ],
      "properties": {
        "type": { "const": "my-custom-type" }
      },
      "required": ["type"],
      "additionalProperties": true
    }
  ]
}
```

## JSON5 Format

Schema files support JSON5 format, allowing inline documentation via `//` comments and more flexible formatting.

## Further Reading

- [Teresa Torres' work on Opportunity Solution Trees](https://producttalk.org/2021/02/using-opportunity-solution-trees/)
- "Continuous Discovery Habits" (2021) by Teresa Torres
- [JSON Schema specification](https://json-schema.org/)
