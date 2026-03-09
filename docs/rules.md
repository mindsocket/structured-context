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
| `description` | yes | Human-readable rule intent |
| `check` | yes | JSONata expression; must evaluate to `true` |
| `type` | no | Restrict rule to nodes of this `resolvedType` |
| `scope` | no | Use `"global"` to evaluate once for the whole space |
| `override` | no | Only for merge conflicts: allows later duplicate `id` to replace earlier |

## Categories

Categories label violations for reporting. They do not change expression execution semantics.

| Category | Typical use |
|---|---|
| `validation` | Hard correctness constraints |
| `coherence` | Cross-node consistency checks |
| `workflow` | Process/operating-discipline checks |
| `best-practice` | Advisory quality checks |

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

## Rule imports (`$ref`)

`$metadata.rules` can include `$ref` entries that import:
- one rule
- a rule-set object with `rules: []`

Example:

```json5
"rules": [
  { "$ref": "ost-tools://rule-pack#/$defs/workflowRule" },
  { "$ref": "ost-tools://rule-pack#/$defs/coreRuleSet" }
]
```

Imported entries are normalized into the same flat runtime list.

## Merge and conflict behavior

When metadata is composed across `$ref`:
- Rules are merged by `id`.
- Different payloads for the same `id` are an error by default.
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
