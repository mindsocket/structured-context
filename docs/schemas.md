# Schemas

This document explains schema usage, metadata shape, and composition semantics in `structured-context`.

## Overview

A **schema** defines the valid structure for nodes in a `space`: entity types, field constraints, hierarchy behavior, type aliases, and executable rules.

`structured-context` uses JSON Schema Draft-07 plus a custom top-level `$metadata` keyword.

## Selecting a schema

Set `schema` in the space config entry:

```json
{
  "name": "my-space",
  "path": "/path/to/space",
  "schema": "schemas/strict_ost.json"
}
```

Resolution order: space `schema` > global `schema`. Schema resolution fails if none is configured.

## Bundled schemas

### `strategy_general.json`

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

## Custom format annotations

`structured-context` registers the following `format` annotations beyond standard JSON Schema. All apply to `string` properties and are validated at schema validation time.

| Format | Validates | Example |
|--------|-----------|---------|
| `date` | ISO 8601 date (`YYYY-MM-DD`) | `"2026-03-31"` |
| `path` | Non-empty filesystem path — absolute, relative, or a plain name | `"notes"`, `"./subdir/file.md"`, `"/abs/path"` |
| `wikilink` | Obsidian wikilink syntax (`[[...]]`) | `"[[Parent Node]]"` |

`path` and `wikilink` are also available as shared `$ref` definitions in `_sctx_base.json`:

```json
{ "$ref": "sctx://_sctx_base#/$defs/wikilink" }
```

Using `format` directly is more concise when the full definition isn't needed:

```json
{ "type": "string", "format": "wikilink" }
```

### Date coercion

YAML parsers (gray-matter, js-yaml) coerce unquoted ISO dates to JavaScript `Date` objects:

```yaml
published_date: 2026-03-31   # parsed as a Date object by gray-matter
```

The markdown plugin automatically coerces `Date` objects to `YYYY-MM-DD` strings before validation, so unquoted dates in frontmatter and embedded YAML blocks work correctly with `format: "date"` fields.

## Metadata dialect

Schemas use this metaschema URL:

- `https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/_structured_context_schema_meta.json`

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
| `hierarchy` | object | Optional per provider; at most one provider may define it after composition |
| `hierarchy.levels` | `(string \| HierarchyLevel)[]` | Ordered root→leaf types |
| `hierarchy.allowSkipLevels` | `boolean` | Optional; allows parent to be any ancestor level |
| `relationships` | `Relationship[]` | Optional; defines related node links outside the primary hierarchy |
| `aliases` | `Record<string, string>` | Optional type alias map |
| `rules` | `Rule[]` | Optional flat rule array |

### Relationships

Relationships define links between node types that are not part of the primary structural hierarchy. They are handled during parsing and template generation.

| Field | Type | Default | Description |
|---|---|---|---|
| `parent` | `string` | **Required** | The parent's canonical type name |
| `type` | `string` | **Required** | The child's canonical type name |
| `field` | `string` | `"parent"` | The frontmatter field that holds the wikilink(s) for this relationship |
| `fieldOn` | `string` | `"child"` | `"child"` (child holds a link to parent) or `"parent"` (parent holds an array of child links) |
| `format` | `string` | `"page"` | Hint for `template-sync`: `"table"`, `"list"`, or `"heading"` |
| `matchers` | `string[]` | `[]` | Heading text to match (strings or `/regex/`). Case-insensitive. |
| `embeddedTemplateFields` | `string[]` | `[]` | Field names to include in templates when `format` is `"table"` |
| `multiple` | `boolean` | `true` | Whether multiple children are expected |

**`fieldOn: "child"` (default)** — child node has a field pointing to its parent. Embedded parsing sets this field on each child node; validation checks that it resolves to a node of the declared parent type.

**`fieldOn: "parent"` — parent-side array** — the parent node has an array field (`field`) holding wikilinks to child nodes. When `field` is required, it must be specified. Embedded parsing appends `[[Child]]` entries to the parent node's field array; validation checks that each entry resolves to a node of the declared child type.

**Example — child-side (default):**

```json5
"relationships": [
  {
    "parent": "opportunity",
    "type": "assumption",
    "format": "table",
    "matchers": ["Assumptions", "/assum.*/"],
    "embeddedTemplateFields": ["assumption", "status", "confidence"]
  }
]
```

**Example — parent-side array:**

```json5
"relationships": [
  {
    "parent": "activity",
    "type": "task",
    "field": "tasks",
    "fieldOn": "parent",
    "format": "list",
    "matchers": ["Tasks"],
    "multiple": true
  }
]
```

With this configuration, embedded task items under an Activity's "Tasks" heading populate `activity.tasks` as `[[Task Title]]` wikilinks, and validation confirms each entry resolves to a `task` node.

`HierarchyLevel` options:

| Option | Default | Meaning |
|---|---|---|
| `type` | required | Canonical type name |
| `field` | `"parent"` | Frontmatter field holding wikilink(s) |
| `fieldOn` | `"child"` | `"parent"` means the parent points to children |
| `multiple` | `false` | Field contains array of wikilinks |
| `selfRef` | `false` | Allows same-type parent |
| `selfRefField` | _undefined_ | Separate field for same-type parent links |
| `format` | _undefined_ | Embedding hint: `"list"`, `"table"`, or `"heading"` — enables hierarchy embedding when set |
| `matchers` | _undefined_ | Heading text patterns (strings or `/regex/`) to detect embedding sections |
| `embeddedTemplateFields` | _undefined_ | Column/field names for table stubs generated by `template-sync` |

String shorthand (`"goal"`) normalizes to:
`{ "type": "goal", "field": "parent", "fieldOn": "child", "multiple": false, "selfRef": false }`.

### Hierarchy embedding

When a hierarchy level has `format` and `matchers`, it participates in **hierarchy embedding** — the same section-based parsing used for relationships. Two patterns are supported:

**Child-level embedding** — a typed-page heading signals that following content should produce nodes of the child type (next level in hierarchy):

```json5
"levels": [
  "goal",
  {
    "type": "opportunity",
    "field": "parent",
    "fieldOn": "child",
    "format": "list",
    "matchers": ["Opportunities", "User Opportunities"]
  }
]
```

With this config, a goal page with `### Opportunities` followed by a list creates opportunity nodes without explicit `[type:: opportunity]` annotations.

**Bare wikilinks in embedded lists** — when a list item is a bare wikilink (`- [[Node Title]]`) inside an embedding section, it populates a field on the parent without creating a new node:

```markdown
### tool
- [[Zephyr]]        ← populates activity.tools = ["[[Zephyr]]"]
- New Custom Tool   ← creates a new tool node
```

This requires `fieldOn: "parent"` (the parent node holds the array field).

**Parent-level references** (`fieldOn: "child"`, child holds the field) — a heading matching the immediate parent type lets a node reference its parents by wikilink:

```json5
"levels": [
  { "type": "capability", "field": "parent", "fieldOn": "child", "multiple": false },
  {
    "type": "application",
    "field": "capabilities",   // application nodes have a capabilities field
    "fieldOn": "child",
    "multiple": true
  }
]
```

With this config, an application page may include `### capability` with wikilink items to populate `application.capabilities`:

```markdown
## My Application ^application1
### capability
- [[Task Management]]    ← populates application.capabilities
### tool
- [[Zephyr]]             ← populates application.tools (fieldOn: parent)
```

## Composition and merge semantics

Metadata is composed across the `$ref` graph with deterministic behavior:

1. Traverse external `$ref` graph in DFS order.
2. Apply root schema metadata last.

Merge rules:
- `hierarchy`: may be defined in partials; **last one wins**. This allows partials to define a default hierarchy that composing schemas can override.
- `aliases`: shallow merged; later file wins per key.
- `relationships`: collected from all files; order preserved.
- `rules`: merged by `id`.
- Duplicate rule `id` with different payload errors by default.
- A later rule may replace an earlier one only with `"override": true`.

When no provider defines `hierarchy`, hierarchy-based behavior is disabled (`show` tree shape, hierarchy validation, parent-edge checks). `space_on_a_page` parsing still requires hierarchy and will error without it.

### Rule imports via `$ref`

Inside `$metadata.rules`, entries can be inline rules or `$ref` imports:

```json5
"rules": [
  { "$ref": "sctx://my-pack#/$defs/workflowRule" },
  { "$ref": "sctx://my-pack#/$defs/ruleSet" }
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
- Partials with no `$metadata` should prefer `$schema: "http://json-schema.org/draft-07/schema#"` so they validate standalone as plain JSON Schema fragments.
- **Bundled partials as entity libraries**: `_sctx_base.json`, `_strategy_general.json`, `_knowledge_wiki.json`, and `_ost_strict.json` provide reusable entity definitions and metadata. Composing schemas can reference these via `$ref` rather than redefining common entity types.
- **Partials can carry metadata**: Partials may include `$metadata` (hierarchy, aliases, relationships, rules). This makes them self-contained units that bundle both type definitions and behavioral metadata.

## Editor expectations

Use the shipped metaschema URL in `$schema` for best cross-tool behavior.

Notes:
- Custom `$id` values like `sctx://...` are still supported by the CLI registry.
- Some generic editors may not resolve custom URI schemes for `$ref`; CLI behavior is authoritative.
- Do not rely on editor-only mappings for runtime correctness.

## Breaking migration checklist (legacy -> current)

For schemas migrating from older metadata structure:

1. Move any legacy metadata from `$defs._metadata` to top-level `$metadata`.
2. Convert `hierarchy` array to `hierarchy.levels` object shape.
3. Move `allowSkipLevels` under `hierarchy`.
4. Convert grouped rule containers to flat `rules[]` with per-rule `category`.
5. If duplicate rule IDs are intentional, mark later rules with `override: true`.
6. Re-run `sctx schemas show --space <name>` and `validate` to confirm merged metadata/rules.

## JSON5 support

Schema files are parsed as JSON5 (`//` comments and trailing commas are allowed).

## Further reading

- [Executable Rules](rules.md)
- [JSON Schema](https://json-schema.org/)
