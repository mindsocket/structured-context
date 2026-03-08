# Schema Design Process

Use this guide when building a schema from scratch for a space whose content already exists
but has no schema, or when significantly restructuring an existing schema.

## 1. Inventory entity types

Sample files broadly across all directories. For each file, extract:
- The field that identifies the entity type (`type`, `record_type`, or similar)
- All frontmatter fields and their value shapes
- Which values look like wikilinks (`[[Some Title]]`) — single or array
- Which look like enums (consistent small set of values)
- Which look like free text, integers, booleans

**Approach:** Read 3–5 files per entity directory. Read more if the first few show variation.
Note fields that appear in some files but not others — these are likely optional.

Produce an inventory table:

| Field | Entity types | Value type | Required? | Notes |
|-------|-------------|-----------|----------|-------|
| `metric` | Outcome | string | yes | The metric to improve |
| `source` | Opportunity | string | yes | Research source grounding the problem |
| `parent` | Opportunity, Solution | wikilink | yes | Parent in the tree |

## 2. Identify the hierarchy

ost-tools works best with a declared `hierarchy` in `_metadata`. Identify the main chain of
parent→child relationships.

- Which entity types are "root" concepts (no natural parent)? (e.g., `outcome`)
- Which are subordinate to others, and via which field?
- Does the content use a `parent` field, or a named relationship field (`opportunity`, `solution`, etc.)?

**Note:** ost-tools' built-in hierarchy validation, `show`, and `diagram` commands rely on
nodes using a `parent` field with wikilinks. If content uses named relationship fields
(e.g. `opportunity: "[[Signup is too complex]]"`) instead of `parent`, declare the hierarchy in
`_metadata` for structural context, but tree-based commands won't traverse those relationships
automatically until ost-tools adds support for custom parent fields.

For a mixed graph (some hierarchical, some lateral entities), put the main chain in `hierarchy`
and include lateral types in `oneOf` without hierarchy constraints.

## 3. Handle naming conflicts

**Common problem:** content uses `type` as a sub-classification field AND `record_type` (or similar)
as the entity discriminator — which collides with ost-tools expecting `type` as the discriminator.

**Solution:** use `fieldMap` in the space config:
```json5
fieldMap: {
  record_type: 'type',      // entity discriminator → becomes "type" for ost-tools
  type: 'entity_type'       // sub-classification → renamed to avoid collision
}
```

Then in the schema:
- Use `"type": { "const": "Activities" }` as the entity discriminator
- Use `"entity_type"` as the property name for sub-classification (e.g. `"entity_type": { "$ref": "#/$defs/requirementCategory" }`)
- Document in `$defs` descriptions that `entity_type` comes from the content's `type` field

## 4. Decide: enum vs free-form string

Use an **enum** when:
- Values are a closed, stable set (e.g. `["Low", "Medium", "High"]`)
- Consistency matters for filtering/querying
- You want validation to catch typos

Use a **free-form string** when:
- Values are open-ended or include contextual detail (e.g. `"Per Transaction (1.75% + $0.30)"`)
- Values vary too widely to enumerate (e.g. compound frequencies like `"Weekly (Build-Up), Daily (Peak Campaign)"`)
- The field is still evolving

**Data inconsistency:** if content shows the same conceptual value in multiple forms
(e.g. `"Low–Medium"` with en-dash vs `"Low-Medium"` with hyphen), fix the content to be
consistent rather than widening the enum or making it free-form. Document the canonical form
in the schema `description`.

**Convention:** even when making a field free-form, still define it as a `$def` and use `$ref`.
This signals the field has identity and makes it easy to add an enum later:

```json
"$defs": {
  "frequency": {
    "type": "string",
    "description": "How frequently this activity occurs. Free-form — may include phase context, e.g. 'Weekly (Build-Up), Daily (Peak Campaign)'."
  }
}
```

## 5. Map wikilink relationships to rules

For each wikilink or array-of-wikilink field, consider writing a rule:

| Relationship | Rule type | Example check |
|-------------|----------|--------------|
| Required single link | workflow | `$exists(current.phase) = true` |
| Required array (min 1) | workflow | `$count(current.performed_by) >= 1` |
| Optional but recommended | bestPractice | `$count(current.generates_requirements) >= 1` |
| Bidirectional integrity | coherence | (complex; use sparingly) |

Don't write rules for relationships that are genuinely optional with no expected minimum.
Save `bestPractice` for "you probably should have filled this in" signals.

## 6. Build and iterate

Write an initial schema, run validation, and treat the output as a specification review:

- **Node errors on specific files** → check actual field values against enum; add missing values
  or fix content inconsistencies
- **All files as "Non-space (no type field)"** → `fieldMap` not configured, or wrong field name
- **0 rule violations on suspicious content** → rules may not be evaluating (check `type` filter
  matches `resolvedType`; use `dump` to inspect)
- **Rule violations on every node of a type** → rule may be too strict; recategorise or remove
- **Rule violations on a handful of nodes** → likely genuine content gaps worth flagging

Expected iteration: 2–4 rounds of validation before all genuine issues are resolved.

## 7. Express properties generously

When uncertain whether to include a property in the schema, include it. The schema is
documentation as well as validation. Properties with `additionalProperties: true` don't break
validation when extra fields exist — they just won't be type-checked.

For any field where you observe a relationship to another entity type (e.g. `performed_by`
links to Actor entities), capture it as an array of wikilinks and note the target type in the
`description`. This makes the graph structure explicit even when ost-tools can't enforce
referential integrity across entity types in a graph-shaped space.

## Example: canonical OST content

A canonical Opportunity Solution Tree uses:
- `outcome` as the root concept (e.g. "Increase trial conversion")
- `opportunity` as the next level (can be nested for sub-opportunities)
- `solution` as candidate ideas addressing opportunities
- `assumption_test` (or `experiment`) to validate solutions

Hierarchy declared as `["outcome", "opportunity", "solution", "assumption_test"]`.

The schema and config paths will vary per project — check the project's `AGENTS.md` or config file location.