# Schema Authoring Reference

Schema files use JSON Schema draft-07 with an ost-tools-specific `_metadata` block.
See `~/src/ost-tools/schemas/` for full examples (`general.json`, `strict_ost.json`).

## `_metadata` (in `$defs`)

```json
"_metadata": {
  "hierarchy": ["outcome", "opportunity", "solution", "assumption_test"],  // required
  "aliases": { "experiment": "assumption_test" },
  "allowSelfRef": ["opportunity"],   // types that can parent themselves
  "allowSkipLevels": false,
  "rules": { "validation": [...], "coherence": [...], "workflow": [...], "bestPractice": [...] }
}
```

`hierarchy` is required. Types not in it can still appear in `oneOf` — they just won't
participate in hierarchy order checks.

Rule categories are informational labels only; they don't change how rules are evaluated.

## `fieldMap` in config

When content uses non-standard field names, remap them in the space config:

```json5
{
  alias: 'my-space',
  path: '../content',
  schema: 'my-schema.json',
  fieldMap: {
    record_type: 'type',    // entity discriminator → "type" for ost-tools
    type: 'entity_type'     // sub-classification → renamed to avoid collision
  }
}
```

The schema always uses the **target** names after remapping. If `record_type` → `type`,
the schema uses `"type": { "const": "opportunity" }`. Document remapped fields in `$defs`
descriptions so maintainers understand the mapping.

## Schema file notes

Schema files support **JSON5** format — `//` comments and trailing commas are allowed.
This is useful for documenting enum values and property intent inline.

**Partial schemas:** files starting with `_` in the same directory as your schema are loaded
automatically and their `$defs` are available for `$ref`. Use these for reusable definition
groups. Their `$id` must be unique and must not collide with built-in partials
(`_ost_tools_base`, `_ost_strict`) — ost-tools will error on collision.

## `$ref` patterns

Run `bunx ost-tools schemas show _ost_tools_base.json` to see all available built-in definitions
and their `$id` URIs. Key ones: `baseNodeProps` (title/content/tags), `wikilink` (`[[...]]` pattern).

**Convention:** define any field that is or might become a structured concept in `$defs` and
reference it with `$ref`, even if currently a plain string. Makes it easy to add an enum or
constraints later without restructuring the `oneOf` entries.

## Key `oneOf` entry patterns

```json
{
  "not": { "required": ["parent"] },  // root types only: explicitly disallow parent field
  "additionalProperties": true,        // always use — allows future fields without schema breakage
  "examples": [{ "type": "my-type", "my_field": "example" }]  // used by template-sync
}
```

## JSONata rules

```json
{
  "id": "solution-has-assumption-test",
  "description": "Each solution should have at least one assumption test",
  "type": "solution",      // optional: only run on this resolvedType (after alias resolution)
  "scope": "local",        // default: evaluate per-node
  "check": "$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='assumption_test']) >= 1"
}
```

Each rule receives: `nodes` (all space nodes), `current` (node being evaluated), `parent`
(resolved parent node object — absent if none).

**Non-obvious:** `parent` is the resolved node object; `current.parent` is the raw wikilink
string. Use `$exists(parent)` to test whether a parent resolved.

**Non-obvious:** inside a predicate `nodes[...]`, bare names refer to the predicate's item.
Use `$$` to reach outer scope:

```jsonata
// Count child solutions of the current node (an opportunity)
$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution'])
```

Always use `resolvedType` (not `type`) in comparisons — aliases are resolved to canonical names.

### Common patterns

```jsonata
$exists(current.metric) = true                            // required field present
$count(current.sources) >= 1                              // array non-empty
$count(nodes[resolvedType='outcome' and status='active']) <= 1  // global aggregate (use scope: 'global')
current.status != 'active' or $exists(parent) = false or parent.status = 'active'  // conditional
```
