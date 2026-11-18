# Hill-climb: strategy_general pilot rules

You are tuning the wording that semantic judges read, so that Jev's verdicts agree with human labels on the nine strategy_general pilot rules. You work alone, in a loop, until a stop rule fires. Plan and reasoning: https://claude.ai/artifact/V9FddttVij35zUYeK92wub

## Setup (once)

1. Work in a shallow clone, so the history holds no held-out labels:
   `git clone --depth 1 -b claude/project-thread-ipaubt-hillclimb https://github.com/mindsocket/structured-context ~/src/sctx/hillclimb-run1`, then `bun install` there. Create a local branch `hillclimb/run1`. Never push.
2. Put the held-out suite in `~/src/sctx/hillclimb-holdout/`, outside the clone: `git -C ~/src/sctx/structured-context fetch origin claude/project-thread-ipaubt-holdout` then `git -C ~/src/sctx/structured-context archive FETCH_HEAD evals/semantic-holdout | tar -x --strip-components=2 -C ~/src/sctx/hillclimb-holdout`. Never open or print files in that folder. Only score it with `--json` piped to `bun hillclimb/summarise.ts <file> --aggregate-only`.
3. Logs go in `~/src/sctx/hillclimb-logs/`: `results.tsv` and one JSON file per run.
4. `R=goal-does-not-ladder-up,opportunity-does-not-ladder-up,opportunity-conflicts-with-mission,solution-does-not-address-opportunity,experiment-misses-assumption,overlapping-goals,dependent-goals,overlapping-opportunities,vague-goal`
   Train run: `bun run evals/run.ts --from core --eval $R --provider <p> --runs 3 --json > <log>.json`
   Held-out run: the same with `--from ~/src/sctx/hillclimb-holdout` in place of `--from core`.
5. Spend: `curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY"` reports `data.usage` in dollars. Record it before the baseline and after every run.

## Baseline (iteration 0)

- Jev packed on train, three times. The noise band is the spread of pooled agreement across the three (at least 1.7 points: 3 case-runs, where a case-run is one case judged in one run).
- Once each, on train and held-out: Jev packed (held-out), Jev `--per-node`, `openai`, and Haiku (`openrouter-claude`, config at `/tmp/claude-502/haiku/config.json` via `SCTX_CONFIG`).
- Log every number as iteration 0.

## What you may change

Only text the judge reads, in these places:

- `schemas/_semantic_patterns.json`: the `rubric` and verdict `description` strings of `ladders-up`, `overlapping-children` and `dependent-children`.
- `schemas/_strategy_general.json`: the `rubric`, `semantic.criterion` and verdict `description` strings of the nine rules in `$R`. You may move a sentence between a template's rubric and a rule's criterion.
- `src/judge/prompt.ts`: the strings in `JUDGE_ROLE` and `JUDGE_STANCE`.
- `src/judge/provider/jev.ts`: the sentence strings inside `withFraming`, and where that framing goes: in the state (now), as a prefix on each question's `instructions`, or both. Placement is the only code change allowed.

Everything else holds: rule ids, verdict names, severities, `when`, `scope`, `includeContent`, type descriptions, all other rules and templates, fixtures, labels, the harness, and all code logic. Text in a template must make sense for any schema; domain words belong in a rule's criterion.

## Each iteration

Start with framing placement: iterations 1 to 3 try question prefix, both, and (if neither wins) no framing at all, before any rubric rewriting. Contrasts between neighbouring verdicts ("loosely-related: the body doesn't say how") are a good early idea for the ladder-up rules, since most misses sit on that boundary.

1. Read the train misses from the last kept run (Jev gives only probabilities; OpenAI's evidence from the last checkpoint says why a reader might go either way).
2. Choose one hypothesis, stated in one line, e.g. "say a driver must be shown in the body, not assumed".
3. Edit. Run `bun hillclimb/check-words.ts <baseline commit>`; it fails if you used a word from the fixtures that the schemas don't already use. Rephrase until it passes. If you changed `src/`, run `bun test tests/judge`.
4. Commit: `iter <n>: <hypothesis>`.
5. Run Jev packed on train and summarise.
6. **Keep** if pooled agreement rises by more than the noise band and no rule loses more than 3 case-runs. Also keep if agreement is level within the noise band, p(expected) rises by 0.01 or more, and `prompt_chars` did not grow. Otherwise **discard**: `git reset --hard HEAD~1`.
7. Append to `results.tsv`: iteration, commit, status (keep, discard, blocked, crash), hypothesis, pooled agreement, p(expected), per-rule agreement, prompt_chars, minutes, spend so far.

## Checkpoint (every 5 kept changes)

- `openai` on train. If its pooled agreement is more than 3 points below baseline, revert to the last checkpoint's commit and log it.
- Jev packed on held-out, aggregate only. Log it. If held-out falls at two checkpoints in a row, stop.

## Stop

At the first of: spend reaches $8 of the $10 credit (keep $2 for the closing runs); 30 iterations; 8 discards in a row; train pooled agreement of 95% or more; 6 hours since setup.

## Close

1. Rerun the baseline set on the final commit: train and held-out for Jev packed, Jev per-node, OpenAI and Haiku.
2. Write `~/src/sctx/hillclimb-logs/summary.md`: a table of pooled and per-rule agreement before and after for each provider and split; the kept hypotheses in order; the full `git diff <baseline>..HEAD` of the editable files; spend; why it stopped.
3. Report the summary back. Do not push, merge or open a PR: a person reads the diff first.
