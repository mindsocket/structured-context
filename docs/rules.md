# Executable Rules

Rules are JSONata expressions embedded in a schema's `$metadata.rules` block. Each rule is evaluated against applicable nodes at validation time and must return `true` to pass. Rules encode checks that JSON Schema structural validation cannot express — cross-node consistency, quantitative thresholds, and qualitative best practices.

For how rules fit into the broader schema metadata, see [docs/schemas.md](schemas.md).

## Rule Categories

Rules are grouped into categories under `$metadata.rules`. Categories are informational — they determine how violations are labelled and grouped in output, but do not affect how the rule is evaluated. Use `scope` to control evaluation mode.

| Category | Purpose |
|---|---|
| `validation` | Structural correctness — a violation means the node is incorrect and should be fixed |
| `coherence` | Cross-node checks — for flagging conflicts or contradictions between nodes |
| `workflow` | Process discipline checks — for keeping the tree in an operational working state (active counts, status consistency) |
| `bestPractice` | Advisory guidance — signals the space may benefit from additional work |

## Rule Object Structure

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique identifier (kebab-case) |
| `description` | yes | Human-readable description of what the rule checks |
| `check` | yes | JSONata expression that must evaluate to `true` to pass |
| `type` | no | If set, only applies to nodes of this resolved type |
| `scope` | no | Set to `'global'` to evaluate the rule once against the full node set |

Rules without `scope: 'global'` are evaluated once per applicable node (all nodes, or only those matching `type`). A global rule is evaluated once and produces at most one violation for the space — use this for aggregate checks, like counts, across all nodes.

## JSONata Expression Context

Each expression is evaluated once per applicable node with the following input:

| Variable | Description |
|---|---|
| `nodes` | Array of all nodes in the space |
| `current` | The node being evaluated |
| `parent` | First resolved parent node — absent if no parent was resolved. Provided for convenience with single-parent relationships; use `parents` for DAG hierarchies. |
| `parents` | Array of all resolved parent nodes — absent if no parents were resolved |

Nodes include all node properties (title, type, status, parent wikilink, etc.) plus resolved fields: `resolvedType` (canonical type after type alias resolution), `resolvedParentTitle` (first parent title), and `resolvedParentTitles` (array of all parent titles).

Prefer `resolvedType` over `type` for type comparisons. When aliases are in use, `type` reflects the raw frontmatter value and may not match canonical names.

### Referencing `current` inside predicates

Inside a predicate (`nodes[...]`), bare names refer to fields on each item. Use `$$` (JSONata root) to reach outer-scope variables:

```jsonata
// Count solutions whose parent title matches the current node's title
$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution'])
```

### `parent` vs `current.parent`

- `parent` — the resolved parent **node object**; absent if the parent was not found in the space
- `current.parent` — the raw wikilink string from frontmatter (e.g. `[[My Outcome]]`)

Use `$exists(parent)` to test whether the current node has a resolved parent:

```jsonata
$exists(parent) = false   // true for root nodes
```

## Examples

```json
{
  "workflow": [
    {
      "id": "active-outcome-count",
      "description": "Only one outcome should be active at a time",
      "scope": "global",
      "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
    },
    {
      "id": "active-node-parent-active",
      "description": "An active node's parent should also be active",
      "check": "current.status != 'active' or $exists(parent) = false or parent.status = 'active'"
    }
  ],
  "bestPractice": [
    {
      "id": "solution-quantity",
      "description": "Explore multiple candidate solutions (aim for at least three) for the target opportunity",
      "type": "opportunity",
      "check": "(current.status != 'exploring' and current.status != 'active') or $count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution']) >= 3"
    }
  ]
}
```

The first workflow rule uses `scope: 'global'` — evaluated once against the whole space, producing at most one violation. The second runs per-node with no `type` filter, checking every node. The best-practice rule only runs against `opportunity` nodes where status is `exploring` or `active`, using `resolvedParentTitle` to count child solutions.
