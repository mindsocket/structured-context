# Semantic Rules

A semantic rule asks a model to judge a node, for example "Is this opportunity a customer need, or a solution in disguise?". Use a semantic rule for a check that an expression cannot do.

This page assumes you know [Rules](rules.md). Semantic rules use the same fields, severities, [`when`](rules.md#conditional-rules-when) and [cascade gating](rules.md#cascade-gating) as expression rules. This page gives only the differences.

## Quick start

1. Set `OPENROUTER_API_KEY` in your environment.
2. Choose Jev as the judge in `config.json`. Jev is a decision model and the recommended judge (see [Choosing a judge](#choosing-a-judge)):

   ```json
   { "judge": { "provider": "openrouter-jev" } }
   ```

   `openrouter-jev` is a bundled provider. To use Claude instead, set `"provider": "anthropic"` and `ANTHROPIC_API_KEY`.
3. Add a rule to the schema's `$metadata.rules`:

   ```json
   {
     "id": "opportunity-customer-need",
     "category": "best-practice",
     "mode": "semantic",
     "type": "opportunity",
     "description": "The opportunity is a customer need or pain point, not a solution or a business metric"
   }
   ```

4. Run `sctx validate <space> --semantic`.

## Run `sctx validate` or `sctx validate-file` with semantic rule checking

Semantic rules cost money and send node content to the judge's provider. Thus they run only when you ask, on each run:

- `--semantic` runs them with the configured judge.
- `--judge <provider>` runs them with a specific model provider instead.

A semantic rule's [`check`](#preconditions-check) costs no model call, so it runs on every validation. Without a judge, only that expression runs.

## Rule fields

| Field | Required | Description |
|---|---|---|
| `mode` | yes | `"semantic"` |
| `check` | no | An expression that a node must pass before the judge sees it. Runs even without a judge. See [Preconditions](#preconditions-check) |
| `rubric` | no | Tells the judge what to assess. Default: `description` |
| `verdicts` | no | The answers the judge can give. Default: `pass` and `fail`. See [Verdicts](#verdicts) |
| `severity` | if `verdicts` is set | The severity of each verdict. See [Severity](#severity) |

A semantic rule cannot have `scope: "global"`.

## Preconditions (`check`)

A `check` costs no model call. It uses the same [expression syntax and context](rules.md#writing-expressions) as an expression rule. Use it for a requirement that an expression can verify, so the judge only sees nodes worth the cost:

```json
{ "id": "opportunity-customer-voice", "category": "coherence", "type": "opportunity",
  "mode": "semantic", "description": "Opportunity is framed in customer voice",
  "check": "$exists(current.source)" }
```

The order is `when`, then `check`, then the judge. Without a judge, the order is `when`, then `check`.

- If `check` returns `true`, the judge runs. Without a judge, nothing is reported. The verdict maps to a severity as usual.
- If `check` does not return `true`, structured-context reports a violation and does not call the judge. The violation has no verdict, and its evidence reads `expression check failed: <the check expression>`.
- If `check` cannot be evaluated, structured-context reports a non-gating `error` violation and does not call the judge.

A failing `check` reports the severity that an expression rule would report: the rule's `severity`, or the default for its category. With a [severity map](#severity), it reports the most severe severity in the map. If every entry in the map is `ignore`, it reports `info`.

A failing `check` [gates](rules.md#cascade-gating) the node's descendants as an expression rule does. It gates by default when it reports `error` severity. Set `gatesDescendants` to override that either way.

`--rule-filter mode=semantic` selects these rules with or without a judge.

## Verdicts

For each node, the judge gives exactly one verdict for each rule. The verdict must come from the rule's `verdicts`. A fixed set of verdicts makes results comparable between runs.

Each verdict has a purpose for one audience:

- The **description** tells the judge when to choose that verdict.
- The **guidance** (optional) tells the user what to do when the judge chooses that verdict. structured-context shows it with the violation and does not send it to the judge.

A verdict is a description string, or an object with `description` and `guidance`:

```json
"verdicts": {
  "customer-need": "A customer need or pain point",
  "vague": {
    "description": "A need, but too vague to act on",
    "guidance": "Say who has the need and what they are trying to do."
  },
  "solution": "A solution or business goal in disguise"
},
"severity": { "vague": "info", "solution": "warning" }
```

## Severity

The verdict is a classification. The severity says what the verdict means for the user.

- With custom verdicts, `severity` is a map from verdict to `error`, `warning`, `info` or `ignore`.
- A verdict with `error`, `warning` or `info` reports a violation at that severity.
- A verdict that is not in the map reports no violation. At least one verdict must report no violation.
- `ignore` also reports no violation. Use it to show that you chose to ignore a verdict.
- With the default verdicts, `severity` is one value for `fail`, the same as for an expression rule.

Gating uses the severity of the verdict. A verdict with `error` severity gates the node's subtree, as for any rule. `gatesDescendants` changes this, as for any rule.

## How judging works

- **Order.** On each node, expression rules run first. Then structured-context applies each semantic rule's [`check`](#preconditions-check) and sends the rules that pass to the judge.
- **Grouping.** A decision model judges each NodeRulesetGroup (see [concepts](concepts.md#semantic-rules)) in as few decision requests as it can, with one decision question per node and rule. A decision request is limited to about 32,000 estimated input tokens and 40 decision questions, so a larger group is split into several decision requests, never within a node. A node that fills a decision request alone is sent whole as its own decision request. Chat models judge one node per request. Within a space, the nodes at one hierarchy depth are judged together, because their verdicts decide whether the next depth is judged. Grouping can shift probabilities slightly compared with judging each node alone.
- **Gating.** structured-context does not judge a gated node. [Coverage output](rules.md#coverage-output) shows which nodes were gated.
- **Judge errors.** If the judge fails (for example, a network error or output that structured-context cannot read), structured-context reports a violation. A judge error does not gate. If one decision request fails, only the rules on the nodes in that decision request report the error.
- **Input.** The judge gets the node's title, type, parent titles and schema data, including frontmatter.
- **Output.** A violation from a semantic rule also includes the verdict, the judge's evidence and any guidance.

`sctx validate-file` judges only the file and the rules on its ancestors that can gate it. Thus one file costs at most one judge call for each ancestor level, plus one.

## Choosing a judge

Use a decision model when you can. Its results are repeatable and cheap, and they include a confidence. Use a chat model when the rubric needs open reasoning or a written explanation.

Bundled providers give you a model with no configuration; the decision models among them speak a decisions API. Run `sctx providers` for the full list with effective models, endpoints and key variables.

structured-context uses only the provider that you configure. It does not choose a provider from the keys in your environment. To override models, endpoints or keys, add an entry of the same name to `modelProviders`, or define a new one (see [Model providers and judge](config.md#model-providers-and-judge)).

A rule does not choose its judge: that is configuration, not schema. To use a different provider for one run, name it with `--judge`. For example, to get a second opinion from a chat model on one rule and one file:

```bash
sctx validate-file <file> --rule-filter id=<rule-id> --judge claude
```
