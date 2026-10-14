# Semantic Rules

A semantic rule asks a model to judge a node, for example "Is this opportunity a customer need, or a solution in disguise?". Use a semantic rule for a check that an expression cannot do.

This page assumes you know [Rules](rules.md). Semantic rules use the same fields, severities, [`when`](rules.md#conditional-rules-when) and [cascade gating](rules.md#cascade-gating) as expression rules. This page gives only the differences.

## Quick start

1. Set `OPENROUTER_API_KEY` in your environment.
2. Add a model provider and choose it as the judge in `config.json`:

   ```json
   {
     "modelProviders": { "jev": { "type": "jev" } },
     "judge": { "provider": "jev" }
   }
   ```

   Jev is a decision model and the recommended judge (see [Choosing a judge](#choosing-a-judge)). To use Claude instead, add a provider with `"type": "anthropic"` and set `ANTHROPIC_API_KEY`.
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

## Turning semantic rules on

Semantic rules cost money and send node content to the judge's provider. Thus they run only when you ask, on each run:

- `--semantic` runs them with the configured judge.
- `--judge <provider>` runs them with that model provider instead.

Both work on `sctx validate` and `sctx validate-file`. Config cannot turn semantic rules on.

## Rule fields

| Field | Required | Description |
|---|---|---|
| `mode` | yes | `"semantic"` |
| `rubric` | no | Tells the judge what to assess. Default: `description` |
| `verdicts` | no | The answers the judge can give. Default: `pass` and `fail`. See [Verdicts](#verdicts) |
| `severity` | if `verdicts` is set | The severity of each verdict. See [Severity](#severity) |

A semantic rule cannot have `check` or `scope: "global"`.

## Verdicts

For each node, the judge gives exactly one verdict for each rule. The verdict must come from the rule's `verdicts`. A fixed set of verdicts makes results comparable between runs.

Each verdict has a purpose for one audience:

- The **description** tells the judge when to choose that verdict.
- The **guidance** (optional) tells the user what to do when the judge chooses that verdict. sctx shows it with the violation. sctx does not send it to the judge.

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

- **Order.** On each node, expression rules run first. Then sctx sends all of the node's semantic rules to the judge in one call.
- **Gating.** sctx does not judge a gated node. [Coverage output](rules.md#coverage-output) shows which nodes were gated.
- **Judge errors.** If the judge fails (for example, a network error or output that sctx cannot read), sctx reports a violation. A judge error does not gate.
- **Input.** The judge gets the node's title, type, parent titles and schema data, including frontmatter.
- **Output.** A violation from a semantic rule also includes the verdict, the judge's evidence and any guidance.

`sctx validate-file` judges only the file and the rules on its ancestors that can gate it. Thus one file costs at most one judge call for each ancestor level, plus one.

## Choosing a judge

Use a decision model when you can. Its results are repeatable and cheap, and they include a confidence. Use a chat model when the rubric needs open reasoning or a written explanation.

| Provider type | Model | Default key variable |
|---|---|---|
| `jev` | TypeSafe's Jev decision model, through OpenRouter. One request for each node | `OPENROUTER_API_KEY` |
| `anthropic` | Claude. Default model: `claude-haiku-5-5` | `ANTHROPIC_API_KEY` |
| `openai` | Any OpenAI-compatible chat endpoint, for example OpenAI, Ollama or vLLM. Set `endpoint` for servers other than OpenAI. Local servers do not need a key | `OPENAI_API_KEY` |

sctx uses only the provider that you configure. It does not choose a provider from the keys in your environment. See [Model providers](config.md#model-providers) and [Judge](config.md#judge-semantic-rules) for all fields.

A rule does not choose its judge: that is configuration, not schema. To use a different provider for one run, name it with `--judge`. For example, to get a second opinion from a chat model on one rule and one file:

```bash
sctx validate-file <file> --rule-filter id=<rule-id> --judge claude
```
