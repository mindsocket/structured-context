# Schemas

This document explains schema usage, metadata shape, and composition semantics in `structured-context`.

## Overview

A **schema** defines the valid structure for nodes in a `space`: entity types, field constraints, hierarchy behavior, type aliases, and executable rules.

`structured-context` uses JSON Schema 2020-12 plus a custom top-level `$metadata` keyword.

## Selecting a schema

Set `schema` in the space config entry:

```json
{
  "name": "my-space",
  "path": "/path/to/space",
  "schema": "schemas/strict_ost.json"
}
```

A schema can be specified as:
- **Bundled schema**: simple filename like `strategy_general.json` or `strict_ost.json`.
- **Local file**: relative path starting with `./` or `../` (resolved against config file directory), or absolute path.
- **Plugin schema**: prefixed with the plugin name, e.g. `sctx-wardley-mapping/wardley_map.json` or `wardley-mapping/wardley_map.json`. When prefixed, structured-context automatically loads the plugin for that space. Alternatively, if the plugin is already declared under `plugins`, the simple filename (e.g. `wardley_map.json`) resolves directly from that plugin.

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

This schema reuses shared structural defs from partials via `$ref` and imports its hierarchy and rules from `_ost_strict` via `$metadata.imports`.

## Custom format annotations

`structured-context` registers the following `format` annotations beyond standard JSON Schema. All apply to `string` properties and are validated at schema validation time.

| Format | Validates | Example |
|--------|-----------|---------|
| `date` | ISO 8601 date (`YYYY-MM-DD`) | `"2026-03-31"` |
| `path` | Non-empty filesystem path — absolute, relative, or a plain name | `"notes"`, `"./subdir/file.md"`, `"/abs/path"` |
| `wikilink` | Obsidian wikilink syntax (`[[...]]`) | `"[[Parent Node]]"` |

`path` and `wikilink` are also available as shared `$ref` definitions in `_sctx_base.json`:

```json
{ "$ref": "sctx://core/_sctx_base#/$defs/wikilink" }
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

The dialect is JSON Schema 2020-12 plus the top-level `$metadata` keyword. Schemas set `$schema` to the metaschema URL:

- `https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/latest/_structured_context_schema_meta.json` follows the newest dialect.
- `https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/<version>/_structured_context_schema_meta.json` pins the dialect to the structured-context release that first shipped it. Versioned files never change once released. Releases that don't change the dialect add no folder, so a version number only appears when the dialect changed.

Because the dialect is 2020-12, keywords may sit beside `$ref`, and `unevaluatedProperties: false` can close an object composed through `allOf`.

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
| `imports` | `string[]` | Optional; `$id`s of schemas whose metadata is merged into this one. See [Composition and merge semantics](#composition-and-merge-semantics) |
| `hierarchy` | object | Optional; declares this schema's hierarchy, or (root schema only) selects the main hierarchy with `{ "$ref": "<schema $id>#/$metadata/hierarchy" }`. See [Multiple hierarchies](#multiple-hierarchies) |
| `hierarchy.name` | `string` | Optional short name; defaults to the declaring schema's file stem |
| `hierarchy.override` | `boolean` | Optional; replaces an imported hierarchy with the same name |
| `hierarchy.levels` | `(string \| HierarchyLevel)[]` | Ordered root→leaf types |
| `hierarchy.allowSkipLevels` | `boolean` | Optional; allows parent to be any ancestor level |
| `relationships` | `Relationship[]` | Optional; defines related node links outside the primary hierarchy. A relationship may set `override: true` |
| `aliases` | `Record<string, string \| { type, override }>` | Optional type alias map. Use `{ "type": "goal", "override": true }` to replace an imported alias |
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

`$ref` and `$defs` are for **validation only**: a `$ref` to another schema (or to one of its `$defs`) reuses its JSON Schema definitions but brings none of its `$metadata`.

Metadata travels only through **`$metadata.imports`**, a list of schema `$id`s:

```json5
"$metadata": {
  "imports": ["sctx://core/_strategy_general"],
  "rules": [ /* this schema's own rules */ ]
}
```

- An import brings the imported schema's whole `$metadata` (hierarchy, relationships, aliases, rules).
- Imports are transitive: an imported schema's own imports come too.
- Merge order: imports in the order listed, depth-first, then the schema's own metadata last. Each schema is merged at most once.
- An unresolvable import `$id` is an error.

One merge rule applies to every key. **A duplicate is an error unless the later entry sets `"override": true`**, in which case it replaces the earlier entry.

| Key | Identity | How to mark `override` |
|---|---|---|
| `rules` | `id` | `"override": true` on the rule |
| `relationships` | `parent` + `type` + `field` (default `"parent"`) | `"override": true` on the relationship |
| `aliases` | alias name | `{ "type": "<target>", "override": true }` as the alias value |
| `hierarchy` | `name` | `"override": true` on the hierarchy declaration |

Overriding a hierarchy by name is how a schema replaces the levels of an imported hierarchy (declare it with the same `name` and `"override": true`).

When no provider defines `hierarchy`, hierarchy-based behavior is disabled (`show` tree shape, hierarchy validation, parent-edge checks). `space_on_a_page` parsing still requires hierarchy and will error without it.

### Multiple hierarchies

A space has several hierarchies when its schema imports several schemas that each declare one. Each schema declares at most one hierarchy.

- **Every imported schema contributes its hierarchy.** Each is kept as a separate named hierarchy; levels are never merged.
- **Naming.** `hierarchy.name` defaults to the declaring schema's file stem (`_ost_strict` for `_ost_strict.json`). A duplicate name is an error unless the later hierarchy sets `"override": true`.
- **Main hierarchy.**
  - If the root schema declares a hierarchy, it is the main hierarchy.
  - If the root declares none and exactly one hierarchy is imported, that one is the main hierarchy (for example `strict_ost`, which imports `_ost_strict`).
  - If the root declares none and several are imported, the root must select one with `"hierarchy": { "$ref": "<schema $id>#/$metadata/hierarchy" }`, otherwise loading the schema fails.
  - A root that both declares a hierarchy and uses `$ref` is an error.
- **Each type belongs to at most one hierarchy.** A type claimed by two hierarchies is an error. To change an imported hierarchy's levels, override it by name.
- **Selections are not imported.** A `hierarchy: { "$ref" }` selection only applies when its schema is the root, so an imported schema stays usable standalone as another space's root.

```json5
{
  "$id": "sctx://team",
  "oneOf": [
    { "$ref": "sctx://_work#/$defs/goal" },
    { "$ref": "sctx://_work#/$defs/task" },
    { "$ref": "sctx://_skills#/$defs/skill_area" },
    { "$ref": "sctx://_skills#/$defs/skill" }
  ],
  "$metadata": {
    // _work.json and _skills.json each declare a hierarchy; select the main one.
    "imports": ["sctx://_work", "sctx://_skills"],
    "hierarchy": { "$ref": "sctx://_work#/$metadata/hierarchy" }
  }
}
```

How hierarchies are used:

| Behaviour | Hierarchies used |
|---|---|
| Layering, parent-type, skip-level and orphan checks | Each hierarchy, independently. A hierarchy edge whose parent belongs to another hierarchy is an invalid parent. |
| Relationships | Connect types across hierarchies, as before |
| `space_on_a_page` parsing, hierarchy embedding, `template-sync` | Main hierarchy |
| `show`, `diagram`, `render` | Main hierarchy by default; `--hierarchy <name>` selects another |
| `resolvedParents` | Hierarchy edges carry the `hierarchy` name |

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

## Schema `$id` namespaces

Every schema `$id` uses the `sctx://` scheme. The shape of the `$id` says where the schema comes from:

| `$id` shape | Source | Example |
|---|---|---|
| `sctx://core/<name>` | Bundled with structured-context | `sctx://core/_sctx_base` |
| `sctx://<plugin>/<name>` | Contributed by a plugin (its short name, without `sctx-`) | `sctx://wardley-mapping/_wardley` |
| `sctx://<name>` | Local to a space's schema directory — a single name, no path | `sctx://team` |

- Two schemas loaded for the same space may not share an `$id`; a collision is an error naming both sources.
- `core` is reserved: no plugin may use it as its namespace.
- **Legacy bundled ids:** before 1.0, bundled schemas used `sctx://<name>` (e.g. `sctx://_sctx_base`, `sctx://strategy_general`). References to those ids in `$ref` and `$metadata.imports` still resolve to their `sctx://core/` equivalents with a deprecation warning, and local schemas may not use them as their own `$id`. The aliases will be removed in 1.0.

## Partials and `$ref`

- Files starting with `_` are auto-loaded partials.
- Bundled partials, local schema-directory partials, and partials from loaded plugins are all registered.
- `$id` values follow the [namespace rules](#schema-id-namespaces) and must not collide across bundled, plugin and local schemas.
- `$ref` resolution is transitive across files.
- Partials with no `$metadata` should prefer `$schema: "https://json-schema.org/draft/2020-12/schema"` so they validate standalone as plain JSON Schema fragments.
- **Bundled partials as entity libraries**: `_sctx_base.json`, `_strategy_general.json`, `_knowledge_wiki.json`, and `_ost_strict.json` provide reusable entity definitions and metadata. Composing schemas can reference their entity types via `$ref` rather than redefining them.
- **Partials can carry metadata**: Partials may include `$metadata` (hierarchy, aliases, relationships, rules). A schema gets it only by listing the partial in `$metadata.imports`; `$ref` alone brings none.

## Plugin-contributed schemas

Plugins contribute schemas and partials by standard directory convention: placing schema files in `<pluginRoot>/schemas/` (or declaring `"sctx": { "schemas": "./path" }` in `package.json`).

Because schemas are resolved statically by convention from the filesystem, structured-context does not need to execute plugin JavaScript code during schema validation, context creation, or schema inspection.

When a space uses a plugin schema:
- **Registry registration**: All partials (`_*`) in the plugin's `schemas/` directory are automatically indexed in the schema registry.
- **Namespace conventions**: Schemas contributed by a plugin must use `sctx://<pluginName>/...` for their `$id` (e.g. `sctx://wardley-mapping/_wardley`), where the prefix is the plugin's short name (without the `sctx-` prefix). See [Schema `$id` namespaces](#schema-id-namespaces).
- **Collision protection**: If two plugins register schemas with the same `$id`, or a plugin or local schema collides with a bundled schema, schema loading throws an error.
- **Imports and $ref**: Plugin schemas can `$ref` or `$metadata.imports` bundled schemas (e.g. `sctx://core/_sctx_base`) as well as other partials within their own namespace. Schema composition rules from #122 apply.

## Editor expectations

Use the shipped metaschema URL in `$schema` for best cross-tool behavior; pin a `<version>` URL if you need the dialect to stay fixed.

Notes:
- `sctx://` `$id`s are resolved by the CLI registry (see [Schema `$id` namespaces](#schema-id-namespaces)).
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
