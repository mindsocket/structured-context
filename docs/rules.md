# Executable Rules

Rules are JSONata expressions in schema metadata (`$metadata.rules`). They run after structural JSON Schema validation and let you enforce cross-node checks and workflow constraints.

For metadata structure and composition behavior, see [docs/schemas.md](schemas.md).

## Rule shape

Rules are a flat array.

```json5
"rules": [
  {
    "id": "active-outcome-count",
    "category": "workflow",
    "description": "Only one outcome should be active at a time",
    "scope": "global",
    "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
  }
]
```

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique rule identifier |
| `category` | yes | `validation` \| `coherence` \| `workflow` \| `best-practice` |
| `severity` | no | `error` \| `warning` \| `info`; overrides the category default (see [Severity](#severity)) |
| `description` | yes | Human-readable rule intent |
| `check` | yes | JSONata expression; must evaluate to `true` |
| `type` | no | Restrict rule to nodes of this `resolvedType` |
| `scope` | no | Use `"global"` to evaluate once for the whole space |
| `override` | no | Only for merge conflicts: allows later duplicate `id` to replace earlier |

## Categories and severity

Categories describe a rule's intent and supply its default severity. They do not change expression execution semantics.

| Category | Typical use | Default severity |
|---|---|---|
| `validation` | Hard correctness constraints | `error` |
| `coherence` | Cross-node consistency checks | `warning` |
| `workflow` | Process/operating-discipline checks | `warning` |
| `best-practice` | Advisory quality checks | `info` |

### Severity

Every rule violation is reported with a severity:

| Severity | Meaning | Fails validation |
|---|---|---|
| `error` | Content is wrong | yes |
| `warning` | Content is likely inconsistent or incomplete | no |
| `info` | Content could be better | no |

Only `error` violations fail validation: `sctx validate` and `sctx validate-file` exit non-zero, and JSON output reports `valid: false`. Warnings and info violations are reported but don't fail, so a work-in-progress space can still pass while advisory checks remain visible.

Prefer choosing the right category and relying on its default. Set `severity` on an individual rule only when that rule genuinely differs from the rest of its category:

```json5
{
  "id": "goal-not-blocked",
  "category": "workflow",
  "severity": "error",
  "description": "Goals must not be left blocked",
  "type": "goal",
  "check": "current.status != 'blocked'"
}
```

`sctx schemas show` lists each category with its default severity and marks rules that override it.

### Output

- **`sctx validate`** — the summary counts rule violations per severity, and details are grouped by severity with each line showing the rule's category and id.
- **`sctx validate --json`** — `errors` includes only `error` severity rule violations (keyed `rule:<id>`, with a `severity` field). A `ruleViolations` array lists every violation with `file`, `ruleId`, `category`, `severity` and `description` (`file` is empty for global rules).
- **`sctx validate-file`** — `error` severity violations appear under `errors`; `warning` and `info` violations appear under `warnings`. Rule entries carry a `severity` field.

## Evaluation model

- Rules with `scope: "global"` run once.
- Other rules run per applicable node.
- If `type` is set, only nodes with matching `resolvedType` are evaluated.

## Expression context

Each evaluation receives:

| Variable | Description |
|---|---|
| `nodes` | All nodes in the space |
| `current` | Current node for this evaluation |
| `parent` | First resolved parent node (if any) |
| `parents` | All resolved parent nodes (if any) |

Useful resolved fields on nodes:
- `resolvedType`
- `resolvedParentTitle`
- `resolvedParentTitles`

Prefer `resolvedType` over raw `type` so aliases are handled correctly.

## Predicate scoping (`$$`)

Inside `nodes[...]`, bare names refer to each candidate node. Use `$$` to reference outer variables:

```jsonata
$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution'])
```

## Reusing rules

To share rules, put them in a schema's `$metadata.rules` and list that schema's `$id` in `$metadata.imports`. An import brings the whole schema's metadata, including its own imports:

```json5
"$metadata": {
  "imports": ["sctx://_rule-pack"]
}
```

## Merge and conflict behavior

When metadata is merged from imports (imports in order, then the schema's own metadata):
- Rules are merged by `id`.
- A duplicate `id` is an error.
- A later rule may replace an earlier one only with `override: true`.

Example override:

```json5
{
  "id": "active-outcome-count",
  "override": true,
  "category": "workflow",
  "description": "Require exactly one active outcome",
  "scope": "global",
  "check": "$count(nodes[resolvedType='outcome' and status='active']) = 1"
}
```

## Common patterns

```jsonata
$exists(current.metric) = true
$count(current.sources) >= 1
$count(nodes[resolvedType='outcome' and status='active']) <= 1
current.status != 'active' or $exists(parent) = false or parent.status = 'active'
```

### Dates and times

Dates and datetimes reach rules as ISO 8601 strings. Convert with `$toMillis()` to compare them, including date against datetime, and use `$millis()` for the current time:

```jsonata
$not($exists(current.due)) or $toMillis(current.due) > $millis()
$toMillis(current.stale_after) > $toMillis(current.generated.at)
```

A datetime without an offset (`2026-07-01T00:00:00`) is read in the machine's local time zone, so require an offset with `format: "date-time"` when results must not depend on where validation runs. `$toMillis()` also needs seconds: it cannot parse a minute-precision datetime such as `2026-07-01T09:15`, which `format: "date-or-date-time"` accepts. A value `$toMillis()` cannot parse makes the rule fail.

The same applies to [filter expressions](../README.md#filter-expressions): compare dates with `$toMillis()`, not as strings.
