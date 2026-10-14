---
title: "Executable Rules"
---

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
| `severity` | no | `error` \| `warning` \| `info`; overrides the category default (see [Severity](#severity)). Semantic rules may instead map verdicts to severities |
| `description` | yes | Human-readable rule intent |
| `check` | yes, unless `mode: semantic` | JSONata expression; must evaluate to `true` |
| `when` | no | JSONata applicability test, evaluated per node before the rule. The rule runs only where it returns `true`; elsewhere it is skipped and not reported. Not allowed with `scope: "global"` |
| `mode` | no | `expression` (default) or `semantic` (judged by a model; see [Semantic rules](semantic-rules.md)) |
| `rubric` | semantic only | Detailed prompt for the judge; falls back to `description` |
| `verdicts` | semantic only | Closed set of verdicts the judge must choose from. Default `pass` / `fail`. See [Semantic rules](semantic-rules.md#rule-fields) |
| `judge` | semantic only | Name of the configured judge provider to use; a `--judge` run override wins |
| `type` | no | Restrict rule to nodes of this `resolvedType` |
| `scope` | no | Use `"global"` to evaluate once for the whole space |
| `override` | no | Only for merge conflicts: allows later duplicate `id` to replace earlier |
| `gatesDescendants` | no | Whether a violation gates downstream checks on the node's hierarchy subtree. Defaults to `true` for rules with `error` severity, `false` for `warning` and `info`. Set explicitly to override either way. |

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

## Conditional rules (`when`)

`when` is a JSONata test evaluated on each node before the rule, with the same context as `check`. The rule runs only where it returns `true`; on every other node it is skipped and not reported (it is neither passed nor gated). Use it when a rule applies to a subset of nodes that `type` cannot express:

```json
{ "id": "ready-has-owner", "category": "workflow", "type": "task",
  "description": "Ready tasks have an owner",
  "when": "current.status = 'ready'", "check": "$exists(current.owner)" }
```

A `when` that returns anything other than `true` means the rule does not apply. A `when` (or `check`) that cannot be evaluated, for example a syntax error, is not silently skipped: it is reported as an `error` violation on that node, with `Rule error:` in its description, and does not gate descendants. `when` needs a per-node rule, so it cannot be combined with `scope: "global"`.

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

## Cascade gating

When a schema uses `$metadata.hierarchy`, rule evaluation cascades top-down through the
hierarchy tree (breadth-first from roots and orphans). A **gate** occurs when a node fails
in a way that makes its descendants' checks untrustworthy or wasteful to run:

- **Schema validation failure** on a node — always gates. The node's own rule checks are
  suppressed too, since its data is structurally invalid.
- **Hierarchy structure violation** on a node (e.g. an invalid parent) — always gates the
  node's subtree, though the node's own rules still run.
- **A rule violation with `gatesDescendants: true`** (the default for `error`-severity rules; `warning` and `info` rules don't gate unless they set `gatesDescendants: true`) — gates the node's subtree. The
  violating node's own other rules still run (they're the same cheap deterministic layer).

Gating is per-subtree: once a node is gated, its descendants inherit the same gate (the
original blocker), rather than each generating a new one. Non-hierarchy nodes and
`scope: "global"` rules are never gated — cascade gating only applies within the hierarchy
DAG.

This exists so that expensive or semantic downstream checks (see [Semantic rules](semantic-rules.md)) aren't wasted
evaluating nodes whose ancestors are already known-bad, and so noise doesn't drown out the
actionable failure. Set `gatesDescendants: false` on an error-severity rule whose violations shouldn't suppress
checks further down the tree, or `gatesDescendants: true` on a warning/info rule that should.

### Coverage output

`sctx validate` reports gating as **coverage gates**: which node's failure (schema,
hierarchy, or a specific `ruleId`) suppressed rule evaluation, and the list of files gated
as a result. This makes the validation "edge" visible — e.g. "this blocked goal means all
opportunities beneath it were not evaluated" — for both human reading and agent consumption
(JSON output via `--json`, under `coverageGates`).

Use `--include-gated` to evaluate rules on gated nodes anyway (still reported as gated) —
useful for surfacing cheap, bottom-up checks (e.g. orphan detection, content quality) that
don't depend on an ancestor being valid.

### Single-file validation

`sctx validate-file <path>` applies the same gating as `sctx validate`, so a file's rule results match its entry in a full run. Expression rules are evaluated for the whole space and the output is restricted to the file. Semantic rules are judged only for the file and its gating ancestors (see [Semantic rules](semantic-rules.md#single-file-validation)). If the file is gated, its rule checks are skipped and a `gated:<file>` entry (kind `gated`, severity `info`) under `warnings` names the blocker, so a gated file doesn't read as clean. `--include-gated` evaluates the file's rules anyway. `--depth` is not supported.

### Depth-limited evaluation

`--depth <n>` restricts validation to hierarchy nodes within `n` breadth-first levels from
the top (roots and orphans are depth 1). This is a manual, coarser control than cascade
gating — intended for staged workflows (e.g. an agent fixes the top level, then requests
the next). Excluded nodes are reported under `skippedByDepth`, separate from gated nodes.

## Semantic rules

A rule with `"mode": "semantic"` is judged by a model (an LLM or a decision model) instead of a JSONata expression. They are opt-in (`--semantic`) because they cost money and time, and they run inside [cascade gating](#cascade-gating). See [Semantic rules](semantic-rules.md) (`sctx docs semantic`) for the rule fields, judge setup and filtering.

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

The same applies to [filter expressions](concepts.md#filter-expressions): compare dates with `$toMillis()`, not as strings.
