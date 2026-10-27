---
name: doc-review
description: Review written content in this repo (README, docs/, AGENTS.md, plugin skills and references, CLI help and error text) against the project's documentation standards, then fix what it finds. Use after writing or changing any prose, before committing or opening a PR.
---

## Task

Review the prose in the target named by `$ARGUMENTS`: a PR number, branch, commit, or list of files. With no
argument, use uncommitted changes, or if there are none, the branch against `main` (`git diff main...HEAD`).
Look at `*.md`, `plugin/**`, and user-facing strings in `src/` and tests. Apply the **Documentation Principles** in
`AGENTS.md`, then fix the findings. Re-read each finding in context: a flagged phrase is sometimes the right
wording.

## Checks

For every changed passage, ask:

1. **Would someone new to the project understand it?** Flag decision history and internal jargon ("never merged by
   location", "A′", phase names). Say what does happen.
2. **Does it earn its place?** Flag sentences that restate the previous one, state the obvious, spell out an
   implication the reader can work out, or describe what is not the case without a likely wrong assumption to
   correct. Flag error codes and flags the output already shows.
3. **Is it in the right place?** Flag duplicated explanations (owned once, linked elsewhere). A README section is
   a sentence or two pointing to docs/. Detail used rarely belongs in `references/` or `sctx docs`.
4. **Is a recommendation labelled as one?** "It is recommended to..." rather than a rule stated as fact.
5. **Names:** `structured-context` in prose, `sctx` only in commands. Terms match `docs/concepts.md`.

Skills and references (`plugin/skills/**`), also:

6. **Trigger:** the `description` names structured-context (sctx) and the task in words a user or agent would
   use, briefly. It does not rely on terms an agent session may not know (such as "space").
7. **Every line is an action or a fact the agent lacks.** Flag instructions made redundant by the next command,
   output that already says the same thing, steps that depend on a state check ("if there is no config yet")
   when intent alone should trigger the skill, and rules that limit what a capable model would do unprompted.
8. **Offers and confirmations** only where the user's decision changes what happens next.
9. **Order follows the user's journey**, happy path first.

Code comments and messages:

10. Flag comments that restate code or explain history, and library errors that mention CLI flags.

## Output

List findings as `file:line, check number, proposed rewrite`, then apply them. Run `bun run lint` and, if
`plugin/` changed, `bun run test:hook`. Finish by checking the "Definition of done" table in `AGENTS.md` for files
the change affects but does not touch.
