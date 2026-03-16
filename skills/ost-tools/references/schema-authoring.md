# Schema Authoring Reference

Schema files use a Draft-07-based dialect with top-level `$metadata`.
See `~/src/ost-tools/schemas/` for examples (`general.json`, `strict_ost.json`, `_ost_strict.json`).

## `$metadata` (top-level)

```json5
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
  "relationships": [
    {
      "parent": "opportunity",
      "type": "assumption",
      "format": "table",
      "matchers": ["Assumptions"]
    }
  ],
  "aliases": { "experiment": "assumption_test" },
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
```

`hierarchy.levels` is required only when the schema needs hierarchy-based behavior (tree rendering, hierarchy validation, `space_on_a_page` parsing). String entries are shorthand for default edge settings:
`{ "type": "...", "field": "parent", "fieldOn": "child", "multiple": false, "selfRef": false }`.

Use object entries to override defaults:
- `field` for relationship field name
- `fieldOn: "parent"` when parent points to children
- `multiple: true` for array wikilinks
- `selfRef: true` for same-type parent links

### Adjacent Relationships (`$metadata.relationships`)

Adjacent relationships define how sub-entities (nodes inside other files) are parsed and generated.

| Field | Default | Description |
|---|---|---|
| `parent` | required | Parent canonical type |
| `type` | required | Child canonical type |
| `field` | `"parent"` | Frontmatter field holding the wikilink(s). Must be explicit when `fieldOn: "parent"`. |
| `fieldOn` | `"child"` | `"child"`: child has the field pointing up. `"parent"`: parent has an array field pointing down to children. |
| `format` | | Hint for `template-sync`: `"table"`, `"list"`, or `"heading"` |
| `matchers` | | Heading text to match (strings or `/regex/`). Case-insensitive. |
| `multi` | `true` | Whether multiple children are expected |
| `embeddedTemplateFields` | | Field names for table columns |

**`fieldOn: "parent"` pattern** — use when the content model lists children on the parent (e.g. `activity.tasks: ["[[Task A]]"]`). Embedded parsing appends child wikilinks to the parent's `field` array rather than setting a `parent` field on each child. Validation checks each array entry resolves to a node of `type`.

Rules are a flat array. Categories are labels only (`validation`, `coherence`, `workflow`, `best-practice`).

## Metadata composition semantics

Across `$ref` graphs:
- metadata providers are traversed DFS, root metadata applied last
- zero or one provider may define `hierarchy`
- `aliases` shallow-merge (later wins)
- `rules` merge by `id`
- duplicate rule IDs with different payloads error unless later rule sets `override: true`

## Rule imports in `$metadata.rules`

Rule entries may be inline or `$ref` imports:

```json5
"rules": [
  { "$ref": "ost-tools://my-rule-pack#/$defs/workflowRule" },
  { "$ref": "ost-tools://my-rule-pack#/$defs/ruleSet" }
]
```

Import targets can be:
- single rule object
- object with `rules: []`

## `fieldMap` in config

When content uses different field names, remap in space config:

```json5
{
  name: 'my-space',
  path: '../content',
  schema: 'my-schema.json',
  fieldMap: {
    record_type: 'type',    // entity discriminator → "type" for ost-tools
    type: 'entity_type'     // sub-classification → renamed to avoid collision
  }
}
```

Schema definitions use the mapped target names.

## Schema file notes

- Schema files are parsed as JSON5.
- Files starting with `_` in the same directory are auto-loaded partials.
- Local partial `$id` values must be unique and must not collide with bundled IDs.
- If a partial has no `$metadata`, use `$schema: "http://json-schema.org/draft-07/schema#"` so it remains a standalone-valid JSON Schema fragment.

## `$ref` patterns

Use `bunx ost-tools schemas show _ost_tools_base.json` to inspect built-in defs.

Convention:
- define reusable concepts in `$defs`
- reference via `$ref` from `oneOf` entries

## `oneOf` authoring pattern

```json5
{
  "type": "object",
  "allOf": [
    { "$ref": "ost-tools://_ost_tools_base#/$defs/baseNodeProps" },
    { "$ref": "ost-tools://_ost_tools_base#/$defs/ostEntityProps" }
  ],
  "properties": {
    "type": { "const": "opportunity" }
  },
  "required": ["type"],
  "additionalProperties": true,
  "examples": [{ "type": "opportunity", "status": "identified" }]
}
```

## JSONata rules

Each rule evaluation receives: `nodes`, `current`, `parent`, `parents`.

Use `resolvedType` in comparisons (not raw `type`) so aliases are respected.

```jsonata
$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution'])
```
