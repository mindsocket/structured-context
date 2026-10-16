# Semantic Rules

A semantic rule asks a model to evaluate a node, for example "Is this opportunity a customer need, or a solution in disguise?". Use a semantic rule for a test that an expression cannot do.

A rule is semantic when it has a `semantic` object. This page assumes you know [Rules](rules.md). A semantic rule uses the same severities, [`when`](rules.md#conditional-rules-when) and [cascade gating](rules.md#cascade-gating) as any other rule. This page gives only the differences.

## Quick start

1. Set `OPENROUTER_API_KEY` in your environment.
2. Choose Jev as the model provider in `config.json`. Jev is a decision model and the recommended provider (see [Choosing a model provider](#choosing-a-model-provider)):

   ```json
   { "semantic": { "provider": "openrouter-jev" } }
   ```

   `openrouter-jev` is a bundled provider. To use Claude instead, set `"provider": "anthropic"` and `ANTHROPIC_API_KEY`.
3. Add a rule to the schema's `$metadata.rules`:

   ```json
   {
     "id": "opportunity-customer-need",
     "category": "best-practice",
     "type": "opportunity",
     "description": "The opportunity is a customer need or pain point, not a solution or a business metric",
     "semantic": {}
   }
   ```

4. Run `sctx validate <space> --semantic`.

## Run `sctx validate` or `sctx validate-file` with semantic rules

Semantic rules cost money and send node content to the model provider. Thus they run only when you ask, on each run:

- `--semantic` runs them with the configured model provider.
- `--semantic <provider>` runs them with a specific model provider instead.

A rule's `expression` costs no model call, so it runs on every validation. Without `--semantic`, a rule with both an `expression` and a `semantic` part runs only the expression, and a rule with only a `semantic` part does not run.

## Rule fields

A semantic rule has the [common rule fields](rules.md) and a `semantic` object. `semantic: {}` takes every default.

| Field | Required | Description |
|---|---|---|
| `semantic.rubric` | no | Tells the model what to assess. Default: `description` |
| `semantic.verdicts` | no | The answers the model can give. Default: `pass` and `fail`. See [Verdicts](#verdicts) |
| `semantic.severity` | if `semantic.verdicts` is set | The severity of each verdict. See [Severity](#severity) |
| `semantic.scope` | no | The related nodes to send with the evaluated node. Default: none. See [Related nodes and content](#related-nodes-and-content) |
| `semantic.includeContent` | no | Which node bodies to send. Default: none. See [Related nodes and content](#related-nodes-and-content) |

A semantic rule cannot be `global`. A rule can also have an `expression`; see [Combining an expression](#combining-an-expression).

## Combining an expression

A rule can have both an `expression` and a `semantic` part. An `expression` costs no model call. It uses the same [expression syntax and context](rules.md#writing-expressions) as any other rule. Use it for a requirement that an expression can verify, so the model only sees nodes worth the cost:

```json
{ "id": "opportunity-customer-voice", "category": "coherence", "type": "opportunity",
  "description": "Opportunity is framed in customer voice",
  "expression": "$exists(current.source)", "semantic": {} }
```

The order is `when`, then `expression`, then the `semantic` part.

- If the `expression` returns `true`, the model runs. Without `--semantic`, nothing is reported.
- If the `expression` does not return `true`, structured-context reports a violation and does not call the model. The violation has no verdict, and its evidence reads `expression failed: <the expression>`.
- If the `expression` cannot be evaluated, structured-context reports a non-gating `error` violation and does not call the model.

A failed `expression` reports the rule's `severity`, or the default for its category. The verdict severities do not apply to it.

An `expression` violation [gates](rules.md#cascade-gating) the node's descendants as it does for any rule, and then none of the node's semantic parts run. It gates by default when it reports `error` severity. Set `gatesDescendants` to override that either way.

## Verdicts

For each node, the model gives exactly one verdict for each rule. The verdict must come from the rule's `semantic.verdicts`. A fixed set of verdicts makes results comparable between runs.

Each verdict has a purpose for one audience:

- The **description** tells the model when to choose that verdict.
- The **guidance** (optional) tells the user what to do when the model chooses that verdict. structured-context shows it with the violation and does not send it to the model.

A verdict is a description string, or an object with `description` and `guidance`:

```json
"semantic": {
  "verdicts": {
    "customer-need": "A customer need or pain point",
    "vague": {
      "description": "A need, but too vague to act on",
      "guidance": "Say who has the need and what they are trying to do."
    },
    "solution": "A solution or business goal in disguise"
  },
  "severity": { "vague": "info", "solution": "warning" }
}
```

## Severity

The verdict is a classification. The severity says what the verdict means for the user.

- With custom verdicts, `semantic.severity` is a map from verdict to `error`, `warning`, `info` or `ignore`. It is required.
- A verdict with `error`, `warning` or `info` reports a violation at that severity.
- A verdict that is not in the map reports no violation. At least one verdict must report no violation.
- `ignore` also reports no violation. Use it to show that you chose to ignore a verdict.
- With the default verdicts, `fail` takes the rule's top-level `severity`, the same as for an `expression`. `fail` must not appear in `semantic.severity`.
- With custom verdicts and no `expression`, the top-level `severity` has no failure to describe, so it is a schema error. With an `expression`, it sets the severity of the failed expression.

Gating uses the severity of the verdict. A verdict with `error` severity gates the node's subtree, as for any rule. `gatesDescendants` changes this, as for any rule.

## Related nodes and content

By default the model sees the evaluated node alone. Use `semantic.scope` to send related nodes too, so the model can judge coherence across the tree, for example whether a solution addresses its parent opportunity.

`semantic.scope` is a list. Each entry adds nodes along the edges of the schema's main hierarchy:

| Entry | Adds |
|---|---|
| `parent` | The direct parents |
| `siblings` | The other children of the node's parents |
| `children` | The direct children |
| `ancestors` | The parents, their parents, and so on |
| `descendants` | The children, their children, and so on |
| `branch` | The ancestors and the descendants |

Entries add together, and each node is sent once. An empty or absent `scope` sends the evaluated node alone. Other relationships are not followed.

A wide scope can send many nodes, and every node sends all its schema data. Prefer to attach a rule at the level where `parent`, `children` or `ancestors` covers what it needs, rather than `descendants` or `branch` on a node near the top of a large tree.

Scope sends node data only, never the verdicts of other rules, and [gating](rules.md#cascade-gating) does not change which nodes it selects.

`semantic.includeContent` chooses which node bodies (the markdown `content`) go to the model:

| Value | Sends |
|---|---|
| absent | No bodies, not even the evaluated node's |
| `nodeOnly` | The evaluated node's body |
| `fullScope` | The bodies of the evaluated node and of every related node. `true` means the same |

```json
{ "id": "solution-addresses-opportunity", "category": "coherence", "type": "solution",
  "description": "The solution addresses the opportunity it sits under",
  "semantic": { "scope": ["parent"], "includeContent": "fullScope" } }
```

A global rule cannot have a `semantic` part, so it has no scope.

## Input size and trimming

The input for one evaluated node is capped at about 32,000 estimated tokens. Over the cap, structured-context cuts node bodies, longest related bodies first, and marks each cut with `[RULE_EVALUATION_CONTENT_TRIMMED n chars]`. If the input still does not fit, the rule reports a semantic evaluation error. A run that trims content says so in its summary.

A rule with `semantic.scope` or `semantic.includeContent` can return `missing-context` when content it needs was cut. It is a `warning` by default; change it in `semantic.severity`.

## How semantic evaluation works

- **Order.** On each node, structured-context runs each rule's [`expression`](#combining-an-expression) first. It sends the semantic parts of the rules that pass to the model provider.
- **Grouping.** A model provider on a decisions API (`openrouter-decisions` or `typesafe-systemone`) evaluates nodes that share the same rules together, in as few requests as it can, to save cost. Grouping can shift verdicts and probabilities slightly compared with evaluating each node alone.
- **Gating.** structured-context does not evaluate the semantic part on a gated node. [Coverage output](rules.md#coverage-output) shows which nodes were gated.
- **Evaluation errors.** If the model provider fails (for example, a network error or output that structured-context cannot read), structured-context reports a violation with the suffix `(Semantic evaluation error: ...)`. An evaluation error does not gate.
- **Input.** The model provider gets the node's title, type, parent titles and schema data, including frontmatter. It gets the node's body, and any [related nodes](#related-nodes-and-content), only as the rule's `semantic.scope` and `semantic.includeContent` ask ([trimmed](#input-size-and-trimming) to fit).
- **Output.** A violation from a semantic verdict also includes the verdict, the model's evidence and any guidance.

`sctx validate-file` evaluates the semantic part only for the file and the rules on its ancestors that can gate it. Thus one file costs at most one model call for each ancestor level, plus one.

## Choosing a model provider

Use a decision model when you can. Its results are repeatable and cheap, and they include a confidence. Use a chat model when the rubric needs open reasoning or a written explanation.

Bundled providers give you a model with no configuration; the decision models among them speak a decisions API. Run `sctx providers` for the full list with effective models, endpoints and key variables.

structured-context uses only the provider that you configure. It does not choose a provider from the keys in your environment. To override models, endpoints or keys, add an entry of the same name to `modelProviders`, or define a new one (see [Model providers and semantic rules](config.md#model-providers-and-semantic-rules)).

A rule does not choose its model provider: that is configuration, not schema. To use a different provider for one run, name it with `--semantic <provider>`. For example, to get a second opinion from a chat model on one rule and one file:

```bash
sctx validate-file <file> --rule-filter id=<rule-id> --semantic claude
```
