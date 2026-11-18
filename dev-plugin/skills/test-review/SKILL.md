---
name: test-review
description: Review new or changed tests in a structured-context (sctx) repo for tests that duplicate others, re-test a schema, or assert what their own setup makes true, then fix what it finds. Use after adding or changing tests, before committing or opening a PR.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/review-check.sh --mark tests)
---

## Task

Review the tests in the target named by `$ARGUMENTS`: a PR number, branch, commit, or list of files. With no
argument, use uncommitted changes, or if there are none, the branch against `main` (`git diff main...HEAD`).
Apply the test principles in the repo's `AGENTS.md`, then fix the findings. Read the code under test and the
neighbouring test files before judging a test: coverage is a property of the whole suite.

## Checks

For every added or changed test, ask:

1. **Does it prove something no other test does?** Search the suite for a test that already covers the
   behaviour. Flag the newer or weaker one.
2. **Does it re-test a JSON Schema?** A schema's own constraints (types, required keys, enums, patterns) are the
   validator's job. Test only the checks the schema can't express.
3. **Is it a second input down a covered code path?** One input per path. Flag cases, `each` rows or fixtures
   that take a branch another case already takes.
4. **Does it assert what its own setup makes true?** Flag assertions that hold because of the test's config,
   fixture or mock, whatever the code under test does.
5. **Are expected values derived?** Expected values come from the fixture or the code under test, not from a
   copy of the output pasted in.
6. **Will it grow with the code?** Flag hard-coded lists (layouts, exports, files, schema keys) that a new entry
   elsewhere makes stale.
7. **Does it assert the behaviour its name states?** Flag names that promise more or other than the assertions
   check, and assertions on things that only happen to be true.

For the change as a whole:

8. **Did it make a test redundant?** When a change moves or narrows behaviour, flag the tests it leaves proving
   nothing new, including ones the diff doesn't touch.

## Output

List findings as `file:line, check number, proposed change` (a rewrite, a merge into another test, or a deletion
naming the test that covers it), then apply them. Run the repo's test, typecheck and lint commands from
`AGENTS.md`. Finish with `${CLAUDE_PLUGIN_ROOT}/scripts/review-check.sh --mark tests`.
