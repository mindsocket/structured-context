---
name: doc-review
description: Review written content in a structured-context (sctx) repo (README, docs/, AGENTS.md, skills and references, code comments, CLI help and error text) against the repo's documentation standards, then fix what it finds. Use after writing or changing any prose, before committing or opening a PR.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/review-check.sh --mark prose)
---

## Task

Review the prose in the target named by `$ARGUMENTS`: a PR number, branch, commit, or list of files. With no
argument, use uncommitted changes, or if there are none, the branch against `main` (`git diff main...HEAD`).
Look at `*.md`, skills, code comments, and user-facing strings in source and tests. Apply the documentation
principles in the repo's `AGENTS.md`, then fix the findings. Re-read each finding in context: a flagged phrase is
sometimes the right wording.

## Checks

Read each changed paragraph or section in full, not only its changed lines, and ask:

1. **Would someone new to the project understand it?** Flag decision history and internal jargon ("never merged by
   location", "A′", phase names). Say what does happen.
2. **Does it earn its place?** Flag sentences that restate the previous one, state the obvious, spell out an
   implication the reader can work out, or describe what is not the case without a likely wrong assumption to
   correct. Flag error codes and flags the output already shows.
3. **Is it in the right place?** Read the code and docs the passage describes, then flag duplicated explanations
   (owned once, linked elsewhere). A README section is a sentence or two pointing to docs/. Detail used rarely
   belongs in a skill's `references/` or a linked doc.
4. **Is a recommendation labelled as one?** "It is recommended to..." rather than a rule stated as fact.
5. **Follows the doc's convention:** a new entry matches its neighbours in size and shape. Do not describe call
   signatures, options, fields or types that the code already defines, since they go stale; say what it is for.
6. **Names** follow the naming rules in `AGENTS.md`, and terms match the repo's glossary (`docs/concepts.md`).

Skills and references (a `SKILL.md` and its `references/`), also:

7. **Trigger:** the `description` names structured-context (sctx) and the task in words a user or agent would
   use, briefly. It does not rely on terms an agent session may not know (such as "space").
8. **Every line is an action or a fact the agent lacks.** Flag instructions made redundant by the next command,
   output that already says the same thing, steps that depend on a state check ("if there is no config yet")
   when intent alone should trigger the skill, and rules that limit what a capable model would do unprompted.
9. **Offers and confirmations** only where the user's decision changes what happens next.
10. **Order follows the user's journey**, happy path first.

Code comments and messages:

11. Flag comments that restate code or explain history, and library errors that mention CLI flags.
12. Flag comments that state a fact another module decides, such as where a type is used ("render only") or a
    rule enforced elsewhere. Leave it out.

## Output

Go through the checks in order. List each finding as `file:line, check number, proposed rewrite`, and write "none"
for a check with no findings. Then apply them. Run the repo's lint and any check its definition of done names for
the area changed. Finish by checking the definition of done (in `AGENTS.md` or the doc it links) for files the
change affects but does not touch, then run
`${CLAUDE_PLUGIN_ROOT}/scripts/review-check.sh --mark prose`.
