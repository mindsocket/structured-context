---
title: "Executable Rules"
---

# Executable Rules

Rules check content after JSON Schema validation, for example cross-node checks and workflow constraints. A schema declares rules in `$metadata.rules`. A rule has an `expression`, a `semantic` part, or both:

- An **`expression`** is a JSONata test that must return `true`.
- A **`semantic`** part asks a model to evaluate a node. See [Semantic rules](semantic-rules.md).

A rule with neither is a schema error.

For metadata structure and composition behavior, see [docs/schemas.md](schemas.md).

## Rule shape

Rules are a flat array.

```json5
"rules": [
  {
    "id": "active-outcome-count",
    "category": "workflow",
    "description": "Only one outcome should be active at a time",
    "global": true,
    "expression": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
  }
]
```

Every rule has a category, which describes its intent and supplies a default severity.

| Category | Typical use | Default severity |
|---|---|---|
| `validation` | Hard correctness constraints | `error` |
| `coherence` | Cross-node consistency checks | `warning` |
| `workflow` | Process/operating-discipline checks | `warning` |
| `best-practice` | Advisory quality checks | `info` |

Severity can also be set per rule. It applies to a failed `expression` and to the default `fail` verdict of a [semantic rule](semantic-rules.md#severity).

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
  "expression": "current.status != 'blocked'"
}
```

`sctx schemas show` lists each category with its default severity and marks rules that override it.

## Selecting nodes

- A rule with `global: true` runs once for the space. It needs an `expression`, and it cannot have `when`, `type` or `semantic`.
- Other rules run once for each node.
- `type` limits a rule to nodes with that `resolvedType`.
- `when` limits a rule to nodes where the applicability condition returns `true`. See [Conditional rules](#conditional-rules-when).

### Conditional rules (`when`)

`when` is the rule's applicability condition: a JSONata test that determines whether a rule applies to a node. It has the same context as `expression` and runs before it. Use `when` when `type` cannot select the nodes a rule applies to:

```json
{ "id": "ready-has-owner", "category": "workflow", "type": "task",
  "description": "Ready tasks have an owner",
  "when": "current.status = 'ready'", "expression": "$exists(current.owner)" }
```

`when` costs almost nothing, so use it to stop an expensive rule from running where it does not apply. For a semantic rule, this saves a model call on each node that `when` excludes.

### Order within a rule

A rule runs its parts in this order: `when`, then `expression`, then the `semantic` part. If the `expression` does not return `true`, the `semantic` part does not run on that node.

A node with a [gating](#cascade-gating) violation from an `expression` has none of its `semantic` parts evaluated. A non-gating violation, such as `info`, does not stop them.

An error in a `when` or `expression` is reported as a non-gating `error` violation.

## Writing expressions

An `expression` (and `when`) is JSONata. This section covers what an expression can see and how to write expressions.

### Expression context

Each evaluation receives:

| Variable | Description |
|---|---|
| `nodes` | All nodes in the space |
| `current` | Current node for this evaluation |
| `parent` | First resolved parent node (if any) |
| `parents` | All resolved parent nodes (if any) |

Useful resolved fields on nodes:
- `resolvedType`
- `id`: the node's unique key. Compare nodes by `id`, since titles may repeat.
- `resolvedParentId`, `resolvedParentIds`: the `id` of the first parent, and of all parents
- `resolvedParentTitle`, `resolvedParentTitles`: the display titles of the same parents

Prefer `resolvedType` over raw `type` so aliases are handled correctly.

### Predicate scoping (`$$`)

Inside `nodes[...]`, bare names refer to each candidate node. Use `$$` to reference outer variables:

```jsonata
$count(nodes[resolvedParentId=$$.current.id and resolvedType='solution'])
```

### Common patterns

```jsonata
$exists(current.metric) = true
$count(current.sources) >= 1
$count(nodes[resolvedType='outcome' and status='active']) <= 1
current.status != 'active' or $exists(parent) = false or parent.status = 'active'
```

#### Dates and times

Dates and datetimes reach rules as ISO 8601 strings. Convert with `$toMillis()` to compare them, including date against datetime, and use `$millis()` for the current time:

```jsonata
$not($exists(current.due)) or $toMillis(current.due) > $millis()
$toMillis(current.stale_after) > $toMillis(current.generated.at)
```

A datetime without an offset (`2026-07-01T00:00:00`) is read in the machine's local time zone, so require an offset with `format: "date-time"` when results must not depend on where validation runs. `$toMillis()` also needs seconds: it cannot parse a minute-precision datetime such as `2026-07-01T09:15`, which `format: "date-or-date-time"` accepts. A value `$toMillis()` cannot parse makes the expression fail.

The same applies to [filter expressions](concepts.md#filter-expressions): compare dates with `$toMillis()`, not as strings.

## Sharing rules

To share rules, put them in a schema's `$metadata.rules` and list that schema's `$id` in `$metadata.imports`. An import brings the whole schema's metadata, including its own imports. Merged rules combine by `id`; a duplicate `id` is an error, and a later rule replaces an earlier one only with `override: true`.

### Overriding rules

```json5
"$metadata": {
  "imports": ["sctx://_rule-pack"]
}
```

Example override:

```json5
{
  "id": "active-outcome-count",
  "override": true,
  "category": "workflow",
  "description": "Require exactly one active outcome",
  "global": true,
  "expression": "$count(nodes[resolvedType='outcome' and status='active']) = 1"
}
```

### Rule templates

A rule can reuse a rule template with `extends`. See [Rule templates](semantic-rules.md#rule-templates).

## Cascade gating

When a schema uses `$metadata.hierarchy`, rule evaluation cascades down the hierarchy, one level at a time from roots and orphans. A node becomes a **gate** when it fails in a way that makes its descendants' rules untrustworthy or wasteful to run. The nodes below a gate are **gated**: their rules are not evaluated.

A node becomes a gate when it has one of these:

- **A schema validation error.** The node's own rules are gated too, because its data is invalid.
- **A hierarchy structure violation**, such as an invalid parent. The node's own rules are gated too.
- **A gating violation**: a rule violation with `error` severity, or any violation of a rule with `gatesDescendants: true`. The node's other expressions still run, but none of its semantic parts do.

Gating keeps costly checks, such as [semantic rules](semantic-rules.md), from running below a node that has errors. It also keeps the actionable violation from being lost in noise. A gated node does not start a new gate: everything below a gate is gated by that one node. Gating applies only to hierarchy nodes. Global rules and nodes outside the hierarchy are always evaluated.

A rule has one `gatesDescendants` setting. It applies to whichever part reported the violation, the `expression` or the `semantic` part. Its default comes from the severity of that violation: `true` for `error`, and `false` for `warning` and `info`. Set it explicitly when that default doesn't fit.

### Reporting gated nodes

Each gated node gets a `gated` validation issue at `info` severity, so a gated node does not read as clean. `--json` output lists them under `issues` like every other finding; grouping them by `gatedBy` shows which nodes each gate suppressed.

Use `--include-gated` to evaluate rules on gated nodes anyway. They are still reported as gated. This is useful for cheap, bottom-up checks, such as content quality, that don't depend on an ancestor being valid.

### Single-file validation

`sctx validate-file <path>` applies the same gating as `sctx validate`, so a file's rule results match its entry in a full run.

- Expressions are evaluated for the whole space; the output is restricted to the file.
- Semantic parts are evaluated only for the file and its gating ancestors (see [Semantic rules](semantic-rules.md#how-semantic-evaluation-works)).
- If the file is gated, its rules are skipped and a `gated:<file>` issue at `info` severity names the gate, so a gated file doesn't read as clean. `--include-gated` evaluates the file's rules anyway.

## Controlling validation runs

These options restrict which rules run, without changing rule definitions.

### Filtering rules

`--rule-filter <dimension>=<value>[,<value>]` runs only the rules that match. It works on `sctx validate` and `sctx validate-file`.

- Dimensions: `category`, `severity`, `type` and `id`.
- Values in one dimension combine with OR. Repeat the option to add a dimension; dimensions combine with AND.
- A rule matches each severity that it can report, including the severities in a semantic verdict map.
- Gating comes only from the rules that ran.

For example, `--rule-filter category=workflow,coherence --rule-filter severity=error` runs only workflow and coherence rules that can report an error.

### Depth-limited evaluation

`--depth <n>` restricts validation to hierarchy nodes within `n` breadth-first levels from
the top (roots and orphans are depth 1). This is a manual, coarser control than cascade
gating — intended for staged workflows (e.g. an agent fixes the top level, then requests
the next). Excluded nodes are reported under `skippedByDepth`, separate from gated nodes.

## Output

- **`sctx validate`** — the summary counts rule violations per severity, and details are grouped by severity with each line showing the rule's category and id.
- **`sctx validate --json`** — prints the run's [`ValidationResult`](api.md#main-building-blocks), with `space`, `valid` and `errorCount`. A violation from a failed `expression` has the evidence `expression failed: <expression>` when the rule also has a `semantic` part, and no verdict.
- **`sctx validate-file --json`** — prints the file's issues, with `errorCount`.

Gated files: see [Single-file validation](#single-file-validation).

