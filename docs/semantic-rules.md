# Semantic Rules

A semantic rule is a rule a model judges instead of a JSONata expression: "is this opportunity framed in the customer's voice?" rather than "does this field exist?". Semantic rules are **opt-in**. Nothing is sent to a model unless you pass `--semantic` (or enable it in config), and a space with no semantic rules is unaffected.

For expression rules, severity, gating and merge behaviour, see [Rules](rules.md).

## Quick start

1. **Declare a rule** in the schema's `$metadata.rules`:

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
       "vague": {
         "description": "A need, but too vague to act on",
         "guidance": "Say who has the need and what they are trying to do."
       },
       "solution": "A solution or business goal in disguise"
     },
     "severity": { "vague": "info", "solution": "warning" }
   }
   ```

2. **Choose a judge** in `config.json`. The judge `type` is always explicit; keys in your environment are never picked up unless you name the type:

   ```json
   { "judge": { "type": "anthropic" } }
   ```

   with `ANTHROPIC_API_KEY` set. See [Judge configuration](config.md#judge-semantic-rules) for every field.

3. **Run it**: `sctx validate <space> --semantic`. To turn it on by default, set `semantic: true` (or `judge.autoRun`) in config; `--no-semantic` overrides that for a single run.

## Rule fields

Semantic rules share `id`, `category`, `type`, `description`, `when` and `gatesDescendants` with [expression rules](rules.md#rule-shape). They differ in these fields:

| Field | Required | Description |
|---|---|---|
| `mode` | yes | `"semantic"` (the default is `"expression"`) |
| `rubric` | no | What the judge should assess. Falls back to `description` |
| `verdicts` | no | The closed set of answers: `{ "<verdict>": "<description>" }`, at least two. Default `pass` / `fail` |
| `severity` | with `verdicts` | A severity for the default `fail` verdict, or a map from verdict to severity (see below) |
| `judge` | no | Name of the [judge provider](config.md#judge-semantic-rules) to use. Default: the configured default. A `--judge` run override replaces it |

A semantic rule has no `check` and cannot be `scope: "global"`; it judges one node at a time.

### Verdicts, severity and guidance

The judge must choose exactly one verdict. A closed set keeps results comparable between runs and maps directly onto decision models, which return a choice with confidence and probabilities rather than prose.

- **A verdict is a classification, severity is the consequence.** `severity` as a map decides what each verdict means for the user: `error`, `warning` or `info`. A verdict left out of the map passes, and `ignore` states that explicitly: the rule ran and the verdict was recorded, but nothing is reported. At least one verdict must pass.
- **With the default `pass` / `fail` verdicts**, `severity` may be a single value (applied to `fail`) or omitted (the category default applies), like an expression rule.
- **A verdict's value may be a string or `{ "description", "guidance" }`.** The description tells the judge what the verdict means. The guidance is shown to the user when that verdict fires, so a failure arrives with what to do about it; it is never sent to the judge.
- **Gating follows the verdict.** A verdict mapped to `error` gates the node's subtree (unless `gatesDescendants: false`); one mapped to `warning` or `info` does not (unless `gatesDescendants: true`).

### Running a rule only where it applies

`when` is a JSONata test evaluated on each node before the rule. The rule runs only where it returns `true`, and a node where it does not is skipped silently (no judge call, nothing reported):

```json
{ "id": "due-soon-coherent", "category": "coherence", "mode": "semantic", "type": "task",
  "description": "A task due within a week has a believable plan",
  "when": "current.status = 'ready' and $toMillis(current.due) - $millis() < 604800000" }
```

`when` works on expression rules too. It saves money on semantic rules because the cheap test runs first.

## How judging works

- **Order.** For each node, expression rules run first, then all of the node's semantic rules go to the judge in one call. Chat LLMs make one request per rule; decision models answer all of a node's rules in a single request.
- **Gating.** Semantic rules follow [cascade gating](rules.md#cascade-gating). They are not judged on gated nodes (recorded as `gatedRules`). A judge *error* (network failure, unparseable output) is reported as a violation but never gates.
- **Input.** The judge sees the node's title, type, parent titles and its schema data (the fields the parser extracted for validation, including frontmatter).
- **Output.** `--json` includes `semanticEvaluations` (verdict, `pass`, confidence and evidence per node and rule) and `gatedRules`. Violations carry the judge's `evidence`, the `verdict` and any `guidance`.

### Single-file validation

`sctx validate-file <path> --semantic` computes gating over the whole space but only calls the judge for the file itself and for its hierarchy ancestors' semantic rules that can gate (top-down, so a failing ancestor stops the walk). A file costs at most one call per ancestor level plus one for the file, however large the space.

### Filtering rules

`--rule-filter <dimension>=<value>[,<value>]` (repeatable) evaluates only matching rules. Dimensions are `mode`, `category`, `severity`, `type` and `id`; different dimensions combine with AND, values within one with OR. A rule with a verdict map matches a `severity` filter on any severity it can report. For example, `--semantic --rule-filter mode=semantic` runs only the judged rules, and `--rule-filter mode=expression` skips them entirely. Gating is computed from the rules that ran.

## Choosing a judge

| Provider type | Use for | Notes |
|---|---|---|
| `anthropic` | Claude models | Default model `claude-haiku-5-5` |
| `openai` | Any OpenAI-compatible chat endpoint: OpenAI, Ollama, vLLM, Groq, OpenRouter chat models | Set `endpoint` for non-OpenAI servers; the key is optional for local ones |
| `jev` | TypeSafe's Jev decision model | Closed-set answers with calibrated probabilities, one request per node. Uses an OpenRouter key |

Prefer a decision model when you can: results are repeatable, cheap, and come with a confidence. Use a chat LLM when the rubric needs open reasoning or evidence text.

Several providers can be configured under names, for example `decision` and `llm`. A rule picks one with `judge`, and a run can override every rule with `--judge <name>` (for instance a deeper second opinion on one file: `sctx validate-file F --rule-filter id=r --judge llm`). If a rule's choice and the run override disagree, the run wins.

Semantic evaluation sends node content to the configured provider. Check that is acceptable for the space before enabling it.
