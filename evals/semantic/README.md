# Semantic evals

Semantic evals measure how well model providers judge the semantic rules of the bundled schemas. Each eval space is a small fixture space with a label per node and rule: the verdict the node should get.

## Run the evals

The run calls real providers, so it costs money. Name each provider to run; config `modelProviders` entries work as well as bundled providers.

```bash
bun run eval:semantic --provider openrouter-jev --provider anthropic
```

| Flag | Purpose |
|---|---|
| `--provider <name>` | The provider to judge with. Repeat it, or give a comma-separated list, to compare providers |
| `--space <name>` | Run only this eval space. Repeatable |
| `--runs <n>` | Judge each space this many times, to measure stability. Default: 3 |
| `--per-node` | Send one request per node, even to a provider that packs several nodes into one request |
| `--json` | Print every judgement and score as JSON instead of the report |

The report has one row per space, provider and rule:

| Column | Meaning |
|---|---|
| Agreement | Share of judgements, over every case and run, that match the label |
| Stable | Share of cases that got the same verdict on every run |
| p(expected) | Mean probability the provider gave the labelled verdicts. Only decision models report it |
| Reserved | Judgements with a reserved verdict, such as `missing-context` |
| Errors | Cases that got an evaluation error, or no judgement, on some run |

Each run validates the space through the same pipeline as `sctx validate --semantic`, with only the labelled rules, and evaluates gated nodes too.

## Add a case

An eval space is a directory here with a `space/` directory of nodes and an `eval.json5`:

```json5
{
  schema: 'strict_ost.json',
  expected: {
    'opportunity-customer-voice': {
      'Build a Slack integration.md': 'fail',
      // A list accepts any of its verdicts.
      'New users find the editor toolbar confusing.md': ['pass', 'fail'],
    },
  },
}
```

`expected` maps a rule id to node ids (as `sctx dump` shows them) and their verdicts. Label every node a labelled rule judges. Write a comment on a case whose label is not obvious.

`bun run test` checks each eval space for free: the space is valid, every label names a real node, semantic rule and verdict, and every node a labelled rule judges has a label.
