---
name: setup-space
description: >
  Set up structured-context (sctx) for a folder of markdown notes, such as an Obsidian vault: find what the
  notes are, choose a schema, add a space to the config and make a first validated edit. Use when the user
  wants schema validation or structure for a set of documents, wants to start with structured-context, or
  wants to add another space. An argument names the folder or goal to start from.
---

# setup-space

Leave the user with one working space and one edit that stayed valid. Most answers should come from looking
at the content, not from asking.

## 1. Check the setup

```bash
sctx spaces --json    # config found, spaces valid, problems with codes
```

If `sctx` is not installed: `bun install -g structured-context` (needs Bun). For any error in `problems`, use
`../structured-context/references/troubleshooting.md` before going on. An `info` `E_CONFIG_NOT_FOUND` only means
nothing is set up yet. Note the existing space names so you do
not reuse one.

Work from the folder the session opened in; config discovery only looks in parent folders.

## 2. Get familiar with the content

Sample rather than read everything. Skip folders that are not notes (attachments, `.obsidian`, archives).

- Count markdown files per top-level folder, then read the first ~40 lines of about five notes from the one or
  two most likely folders, spread across oldest, newest, smallest and largest.
- Look for clues to what kind of documents these are: repeated frontmatter keys (especially a type-like key),
  folder and file naming, links between notes, status or provenance fields, templates, and what is in the
  headings and body.
- If many folders qualify or nothing stands out, ask what the user wants to do with the content and which
  folder to start with. Say what you saw.

Compare with `sctx schemas list` and `sctx schemas show <name>` for the likely candidates, reading entity
types as well as names. If none fits, say so and offer the schema design process in
`../structured-context/references/schema-design.md`.

Build a new schema on the closest bundled one: import it in `$metadata.imports` and `$ref` its entity `$defs` (for
example `sctx://core/_strategy_general#/$defs/opportunity`), adding only what is missing. An import already brings
its aliases, relationships and rules, and redefining one is an error. Read `schema-authoring.md` in
`../structured-context/references/` to the end before writing. When the user asks for the schema after your
proposal, continue from step 4.

## 3. Propose one space

In one message give the space name (lowercase letters, digits, `-`, `_`), the folder, the schema and why, and
what you noticed. Include what configuring involves, including any edits to existing notes to add or change
frontmatter; take the notes to change from `sctx validate` output, not from your sample. Ask for a yes or corrections.

## 4. Add the space

```bash
sctx spaces add <name> <path> --schema <schema>.json
```

The first space needs a place to write. Use `--config <folder holding the notes>/.sctx.json` (for an Obsidian
vault, the vault root). Use `--global` only if the user asks. If the command reports that something else needs
specifying, fix it and re-run. Settings such as type inference and field remaps go in the file afterwards (see
`sctx docs config`); edit the JSON directly, then run `sctx spaces` to confirm.

## 5. First validation

```bash
sctx validate <name>
```

Summarise how many notes are valid and the most common problems. Existing problems do not block anything: the
plugin's hooks only report problems introduced by edits. Notes without a `type` field are noted as ignored, not
failed; adding `type` is usually the first change, before other fields and relationships. If many notes fail for
one reason, it is likely a mapping question (a field with another name) rather than many mistakes. Offer choices
rather than fixing in bulk: leave it, fix a few to see how it works, or adjust the setup.

## 6. First edit

Pick something small that fits the user's goal: a new note, or one change to an existing note. Check
`sctx schemas show --space <name>` for entity types and required fields, make the change, then
`sctx validate-file <path>`.

## 7. Close

State what exists: the config path, the space, how checks behave. For an Obsidian vault, mention the optional
plugin (github.com/mindsocket/obsidian-structured-context), which shows the same checks inline. Offer one next
step, such as another space, without starting it.
