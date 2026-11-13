# Semantic evals

Semantic evals measure how well model providers judge semantic rules. A case is a node, a rule, and the verdict the node should get. An eval holds the cases on one set of nodes: a fixture, or a configured space.

## Run the evals

The run calls real providers, so it costs money. Name each provider to run. Config `modelProviders` entries work as well as bundled providers.

```bash
bun run eval:semantic --provider openrouter-jev --provider anthropic
```

From outside this repo, run `bun run <path to structured-context>/evals/run.ts` with the same flags.

| Flag | Purpose |
|---|---|
| `--provider <name>` | The provider to judge with. Repeat it, or give a comma-separated list, to compare providers |
| `--from <suite>` | The suite to run. Repeatable. Default: `core`. See [Suites](#suites) |
| `--eval <name>` | Run only this eval, as `core/opportunity-customer-voice` or `opportunity-customer-voice`. Repeatable |
| `--runs <n>` | Judge each eval this many times, to measure stability. Default: 3 |
| `--per-node` | Send one request per node, even to a provider that packs several nodes into one request |
| `--check` | Check the evals and stop, with no provider calls |
| `--json` | Print every judgement and score as JSON instead of the report |

The report has one row per eval, provider and rule:

| Column | Meaning |
|---|---|
| Agreement | Share of judgements, over every case and run, that match the label |
| Stable | Share of cases that got the same verdict on every run |
| p(expected) | Mean probability the provider gave the labelled verdicts. Only decision models report it |
| Reserved | Judgements with a reserved verdict, such as `missing-context` |
| Errors | Cases that got an evaluation error, or no judgement, on some run |

Below the table, the report lists each miss, and the agreeing cases with the lowest p(expected). Those are the cases nearest to a miss.

Each run validates through the same pipeline as `sctx validate --semantic`, with only the labelled rules, and evaluates gated nodes too. Only labelled nodes are judged. Other nodes still reach the model as related nodes, when a rule's `scope` includes them.

## Suites

A suite is a directory of evals, with their fixtures in `fixtures/`:

```
evals/semantic/
  opportunity-customer-voice.json5
  fixtures/
    strict-ost.json5
```

| `--from` | Directory | Schema names resolve from |
|---|---|---|
| `core` | `evals/semantic/` in this repo | the bundled schemas |
| `<plugin name>` | `evals/semantic/` in the plugin, found as the config finds plugins | the config that finds the plugin |
| a path | that directory | that directory |

## Add an eval

An eval is a `.json5` file in the suite. It names a `fixture` in the suite, or a configured `space`. `expected` maps a rule id to node ids and their verdicts:

```json5
{
  fixture: 'strict-ost',
  expected: {
    'opportunity-customer-voice': {
      'Build a Slack integration': 'fail',
      // A solution in disguise.
      'Add a progress bar to workspace setup': 'fail',
    },
  },
}
```

A list of verdicts accepts any of them. On a configured space, node ids are file paths: `{ space: 'work', expected: { 'opportunity-customer-voice': { 'Onboarding.md': 'fail' } } }`.

Write a comment on a case whose label is not obvious. We recommend one eval per rule, so each rule's cases are easy to find and to run alone.

## Add a fixture

A fixture is `fixtures/<name>.json5`: a `schema`, optional `plugins` as in a space config, and `nodes`. Each node holds the fields its frontmatter would, with a body in `content`. Its `title` is its node id and link target. `sctx dump <space> | jq '.nodes | map(.schemaData)'` prints notes in this shape.

Several evals can share a fixture. For a rule whose `scope` sends related nodes, such as siblings, give each scenario its own small tree, so that one case's related nodes do not change another's.

## Checks

`--check` finds the problems that would make scores meaningless: a label on a node the rule does not judge, an unknown rule or verdict, a label that accepts every verdict, and a labelled node that fails validation. Every run checks first. `bun run test` checks core's evals.
