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
       "vague": "A need, but too vague to act on",
       "solution": "A solution or business goal in disguise"
     },
     "failOn": ["solution"]
   }
   ```

2. **Choose a judge** in `config.json`. The provider is always explicit; keys in your environment are never picked up unless you name the provider:

   ```json
   { "judge": { "provider": "anthropic" } }
   ```

   with `ANTHROPIC_API_KEY` set. See [Judge configuration](config.md#judge-semantic-rules) for every field.

3. **Run it**: `sctx validate <space> --semantic`. To turn it on by default, set `semantic: true` (or `judge.autoRun`) in config; `--no-semantic` overrides that for a single run.

## Rule fields

Semantic rules share `id`, `category`, `severity`, `type`, `description` and `gatesDescendants` with [expression rules](rules.md#rule-shape). They differ in these fields:

| Field | Required | Description |
|---|---|---|
| `mode` | yes | `"semantic"` (the default is `"expression"`) |
| `rubric` | no | What the judge should assess. Falls back to `description` |
| `verdicts` | no | Map of verdict to description. At least two entries. Default: `pass` / `fail` |
| `failOn` | if `verdicts` is set | Verdicts that count as a violation. Default `["fail"]`. At least one verdict must pass |

A semantic rule has no `check` and cannot be `scope: "global"`; it judges one node at a time.

The judge must choose exactly one verdict. A closed set keeps results comparable between runs and maps directly onto decision models, which return a choice with confidence and probabilities rather than prose.

## How judging works

- **Order.** For each node, expression rules run first, then all of the node's semantic rules go to the judge in one call. Chat LLMs make one request per rule; decision models answer all of a node's rules in a single request.
- **Gating.** Semantic rules follow [cascade gating](rules.md#cascade-gating). They are not judged on gated nodes (recorded as `gatedRules`), and a failing semantic rule gates its subtree when `gatesDescendants` is true (the default for `error` severity). A judge *error* (network failure, unparseable output) is reported as a violation but never gates.
- **Input.** The judge sees the node's title, type, parent titles and its schema data (the fields the parser extracted for validation, including frontmatter). Wider scopes (ancestors, siblings) are not supported yet.
- **Output.** `--json` includes `semanticEvaluations` (verdict, `pass`, confidence and evidence per node and rule) and `gatedRules`. Violations carry the judge's `evidence`; decision models give a summary of the verdict distribution instead of prose.

### Single-file validation

`sctx validate-file <path> --semantic` computes gating over the whole space but only calls the judge for the file itself and for its hierarchy ancestors' semantic rules that can gate (top-down, so a failing ancestor stops the walk). A file costs at most one call per ancestor level plus one for the file, however large the space.

### Filtering rules

`--rule-filter <dimension>=<value>[,<value>]` (repeatable) evaluates only matching rules. Dimensions are `mode`, `category`, `severity` (effective severity), `type` and `id`; different dimensions combine with AND, values within one with OR. For example, `--semantic --rule-filter mode=semantic` runs only the judged rules, and `--rule-filter mode=expression` skips them entirely. Gating is computed from the rules that ran.

## Choosing a judge

| Provider | Use for | Notes |
|---|---|---|
| `anthropic` | Claude models | Default model `claude-haiku-5-5` |
| `openai` | Any OpenAI-compatible chat endpoint: OpenAI, Ollama, vLLM, Groq, OpenRouter chat models | Set `endpoint` for non-OpenAI servers; the key is optional for local ones |
| `jev` | TypeSafe's Jev decision model | Closed-set answers with calibrated probabilities, one request per node. Uses an OpenRouter key |

Prefer a decision model when you can: results are repeatable, cheap, and come with a confidence. Use a chat LLM when the rubric needs open reasoning or evidence text.

Semantic evaluation sends node content to the configured provider. Check that is acceptable for the space before enabling it.
