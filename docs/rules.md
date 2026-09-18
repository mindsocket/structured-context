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
| `severity` | no | `error` \| `warning` \| `info`; overrides the category default (see [Severity](#severity)) |
| `description` | yes | Human-readable rule intent |
| `check` | yes, unless `mode: semantic` | JSONata expression; must evaluate to `true` |
| `mode` | no | `expression` (default) or `semantic` (judged by a model; see [Semantic rules](#semantic-rules)) |
| `rubric` | semantic only | Detailed prompt for the judge; falls back to `description` |
| `verdicts` | semantic only | Closed set of verdicts the judge must choose from: `{ "<verdict>": "<when it applies>" }`. Default `pass` / `fail`. |
| `failOn` | semantic only | Verdicts that count as a violation. Default `["fail"]`; required when `verdicts` is declared. At least one verdict must pass. |
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

This exists so that expensive or semantic downstream checks (see [Semantic rules](#semantic-rules)) aren't wasted
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

`sctx validate-file <path>` applies the same gating as `sctx validate`, so a file's rule results match its entry in a full run. Rules are evaluated for the whole space and the output is restricted to the file. If the file is gated, its rule checks are skipped and a `gated:<file>` entry (kind `gated`, severity `info`) under `warnings` names the blocker, so a gated file doesn't read as clean. `--include-gated` evaluates the file's rules anyway. `--depth` is not supported.

### Depth-limited evaluation

`--depth <n>` restricts validation to hierarchy nodes within `n` breadth-first levels from
the top (roots and orphans are depth 1). This is a manual, coarser control than cascade
gating — intended for staged workflows (e.g. an agent fixes the top level, then requests
the next). Excluded nodes are reported under `skippedByDepth`, separate from gated nodes.

## Semantic rules

A rule with `"mode": "semantic"` is judged by a model instead of a JSONata expression. Semantic rules cost money and time, so they never run unless asked: pass `--semantic` (or set `semantic: true` / `judge.autoRun` on a space or in config).

```json
{
  "id": "opportunity-customer-voice",
  "category": "best-practice",
  "mode": "semantic",
  "type": "opportunity",
  "description": "Opportunity is framed in the customer's voice",
  "rubric": "The opportunity reads as a customer need or pain point, not a solution in disguise or a business metric.",
  "verdicts": {
    "customer-need": "Clearly a customer need or pain point",
    "vague": "A need, but too vague to act on",
    "solution": "A solution or business goal in disguise"
  },
  "failOn": ["solution"]
}
```

The judge must pick exactly one verdict from `verdicts` (default `pass`/`fail`); a verdict listed in `failOn` is a violation, everything else passes. A closed set maps directly onto decision models, which return a choice with confidence and probabilities rather than prose.

- **Evaluation order.** For each node, deterministic rules run first, then all of the node's semantic rules go to the judge in one call. Providers that can only answer one question per request (chat LLMs) make one request per rule; decision models such as Jev answer all of a node's rules in a single request.
- **Gating.** Semantic rules follow [cascade gating](#cascade-gating): they are not run on gated nodes (recorded as `gatedRules`), and a failing semantic rule gates its subtree when `gatesDescendants` is true (default for `error` severity). A judge *error* (network, unparseable output) is reported as a violation but never gates.
- **Output.** `--json` includes `semanticEvaluations` (verdict, `pass`, confidence, evidence per node/rule) and `gatedRules`. Violations carry the judge's `evidence`; decision models without prose get a summary of the verdict distribution.
- **Scope.** Semantic rules judge a node in isolation, plus its parent titles. (Wider scopes such as ancestors or siblings are not yet supported.)

### Judge configuration

Set `judge` at the root of `config.json` or per space (the space wins):

```json
{ "judge": { "provider": "anthropic", "model": "claude-haiku-5-5" } }
```

| Field | Description |
|---|---|
| `provider` | `anthropic`, `openai` (any OpenAI-compatible endpoint, including Ollama and OpenRouter chat models), `jev`, or `fake` (tests). Omitted: inferred from `ANTHROPIC_API_KEY`, then `OPENAI_API_KEY`/`OPENAI_BASE_URL`. `jev` is never inferred. |
| `model` | Defaults: `claude-haiku-5-5` (anthropic), `gpt-4o-mini` (openai), `typesafe/jev-1.13` (jev). |
| `endpoint` | Override the API URL. Jev defaults to OpenRouter's `https://openrouter.ai/api/alpha/decisions`. |
| `apiKey` | Prefer environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` (jev). `SCTX_JUDGE_*` variables override provider, model, endpoint and key. |
| `autoRun` | Run semantic rules without `--semantic`. |

### Filtering rules

`--rule-filter <dimension>=<value>[,<value>]` (repeatable) evaluates only matching rules. Dimensions are `mode`, `category`, `severity` (effective severity), `type` and `id`; different dimensions combine with AND, values within one with OR. For example, `--semantic --rule-filter mode=semantic` runs only the judged rules, and `--rule-filter mode=expression` skips them entirely. Gating is computed from the rules that ran.

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
