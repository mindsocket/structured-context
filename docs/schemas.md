# Schemas

This document explains the schema system and the schemas included with ost-tools.

## Overview

A **schema** defines the valid structure for nodes in a `space`: the fields, types, constraints, and validation rules for each entity type. Schemas use JSON Schema format and support composability through shared definitions.

## Using Schemas

To specify a schema for a space, add the `schema` field to your space entry in `config.json`:

```json
{
  "alias": "my-space",
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
- `_metadata` — Hierarchy, type aliases, and executable rules for strict OST validation

## Schema Metadata

The `_metadata` block in `$defs` carries non-structural validation configuration. It is not a JSON Schema construct — the tooling reads it separately from the schema validator.

```json5
{
  "$defs": {
    "_metadata": {
      "hierarchy": ["outcome", "opportunity", "solution", "assumption_test"],
      "aliases": { "test": "assumption_test" },
      "allowSelfRef": ["opportunity"],
      "allowSkipLevels": false,
      "rules": { ... }
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `hierarchy` | `string[]` | Ordered list of canonical types from root to leaf |
| `aliases` | `Record<string, string>` | Maps alternative type names to canonical types |
| `allowSelfRef` | `string[]` | Types that may have a parent of the same type (e.g. nested opportunities) |
| `allowSkipLevels` | `boolean` | When `true`, a node may have any ancestor type above it, not just the immediate parent |
| `rules` | `object` | Executable validation rules — see [docs/rules.md](rules.md) |

### Hierarchy validation

The validator checks every node type and its parent type against the hierarchy order, with violations flagged.

`allowSelfRef` and `allowSkipLevels` modify the strictness. For example, `"allowSelfRef": ["opportunity"]` permits nested opportunity trees.

### Type aliases

`aliases` maps alternative type names to canonical types. A node with `type: outcome` and `"aliases": { "outcome": "goal" }` will have `resolvedType: goal` and be treated as a `goal` everywhere — in hierarchy checks, rule type filters, and output.

## Schema Composability

Schemas are designed to be composable. You can create custom schemas by:

1. Creating a new `.json` file in the `schemas/` directory
2. Using `$ref` to reference shared definitions from `_shared.json` or other schemas
3. Defining your own node types and constraints

Referencing another schema file merges its `$defs` into the compiled schema, including any `_metadata` block. If multiple referenced files each define `_metadata`, only the last one merged is used — `rules` arrays are not combined across sources.

Example of referencing shared definitions:

```json5
{
  "$schema": "http://json-schema.org/draft-07/schema#",
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