# Schema Authoring Reference

Schema files use an ost-tools-specific Draft-07-based schema dialect (`$schema: "ost-tools://_ost_tools_schema_meta"`) with a top-level `$metadata` block.
See `~/src/ost-tools/schemas/` for full examples (`general.json`, `strict_ost.json`).

## `$metadata` (top-level)

```json
"$metadata": {
  "hierarchy": [
    "outcome",
    { "type": "opportunity" },
    { "type": "solution", "field": "parent", "selfRef": true },
    { "type": "assumption_test", "field": "assumptions", "fieldOn": "parent", "multiple": true } // Solutions list assumption_tests as an array of wikilinks under `assumptions:` field
  ],
  "aliases": { "experiment": "assumption_test" },
  "allowSkipLevels": false,
  "rules": { "validation": [...], "coherence": [...], "workflow": [...], "bestPractice": [...] }
}
```

`hierarchy` is required. Plain strings are shorthand — `"outcome"` equals `{ "type": "outcome", "field": "parent", "fieldOn": "child", "multiple": false, "selfRef": false }`. Types not in `hierarchy` can still be defined and related to other types — they just won't participate in hierarchy order checks.

Use object entries to configure non-default edges: `field` changes the frontmatter field name; `fieldOn: "parent"` means the parent node has the field pointing to children (reversed direction); `multiple: true` means the field is an array of wikilinks.

Rule categories are informational labels only; they don't change how rules are evaluated.

## `fieldMap` in config

When content uses non-standard field names, remap them in the space config:

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
