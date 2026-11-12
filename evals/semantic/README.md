# Semantic evals

Semantic evals measure how well model providers judge semantic rules. An eval space is a space with a label per node and rule: the verdict the node should get. Core's eval spaces here cover the bundled schemas. A plugin can keep its own eval spaces for its schemas, and an eval space can label nodes of a configured space.

## Run the evals

The run calls real providers, so it costs money. Name each provider to run; config `modelProviders` entries work as well as bundled providers.

```bash
bun run eval:semantic --provider openrouter-jev --provider anthropic
```

From outside this repo, run `bun run <path to structured-context>/evals/semantic/run.ts` with the same flags.

| Flag | Purpose |
|---|---|
| `--provider <name>` | The provider to judge with. Repeat it, or give a comma-separated list, to compare providers |
| `--from <source>` | Where to find eval spaces. Repeatable. Default: `core`. See [Where eval spaces live](#where-eval-spaces-live) |
| `--space <name>` | Run only this eval space, by name (`core/strict-ost`) or directory (`strict-ost`). Repeatable |
| `--runs <n>` | Judge each space this many times, to measure stability. Default: 3 |
| `--per-node` | Send one request per node, even to a provider that packs several nodes into one request |
| `--check` | Check the eval spaces and stop, with no provider calls |
| `--json` | Print every judgement and score as JSON instead of the report |

The report has one row per space, provider and rule:

| Column | Meaning |
|---|---|
| Agreement | Share of judgements, over every case and run, that match the label |
| Stable | Share of cases that got the same verdict on every run |
| p(expected) | Mean probability the provider gave the labelled verdicts. Only decision models report it |
| Reserved | Judgements with a reserved verdict, such as `missing-context` |
| Errors | Cases that got an evaluation error, or no judgement, on some run |

Each run validates the space through the same pipeline as `sctx validate --semantic`, with only the labelled rules, and evaluates gated nodes too. Only labelled nodes go to the provider.

## Where eval spaces live

Each source is a directory of eval spaces:

| `--from` | Directory | Schema names resolve from |
|---|---|---|
| `core` | `evals/semantic/` in this repo | the bundled schemas |
| `<plugin name>` | `evals/semantic/` in the plugin, found as the config finds plugins | the config that finds the plugin |
| a path | that directory | that directory |

## Add an eval space

An eval space is a directory with an `eval.json5`. It is one of two kinds.

A **fixture** eval space has its own nodes in a `nodes.jsonl` beside `eval.json5`: one JSON object per line, with the fields frontmatter would hold. Each needs a `title`, which is also its node id, and a `type`. A body goes in `content`. JSON keeps fixtures out of the markdown that editors and spaces read. To start from markdown notes, `sctx dump <space> | jq -c '.nodes[].schemaData'` prints them in this shape. The eval space names its `schema`, and optionally `plugins`, as a space config does:

```json5
{
  schema: 'strict_ost.json',
  expected: {
    'opportunity-customer-voice': {
      'Build a Slack integration': 'fail',
      // A list accepts any of its verdicts.
      'New users find the editor toolbar confusing': ['pass', 'fail'],
    },
  },
}
```

An eval space on a **configured space** names a space from the config instead, and labels some of its nodes:

```json5
{ space: 'work', expected: { 'opportunity-customer-voice': { 'Onboarding.md': 'fail' } } }
```

`expected` maps a rule id to node ids and their verdicts. In a fixture, label every node a labelled rule judges. Write a comment on a case whose label is not obvious.

`--check` finds the problems that would make scores meaningless: a label that names an unknown node, rule or verdict; a labelled node that fails validation; and, in a fixture, a judged node with no label. A run checks this before its first provider call. `bun run test` checks core's eval spaces.
