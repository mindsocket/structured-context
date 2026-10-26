---
name: setup-space
description: >
  Set up a structured space: find the notes the user wants checked, choose a schema, write the config, and
  get to a first validated edit. Use when the user asks to set up, start with, or configure structured-context
  for a folder or an Obsidian vault, or asks to add another space. Also use when session context says
  structured-context has no config for this folder and the user wants schema-checked notes, a wiki or a
  strategy tree. The /setup-space command starts it.
---

# setup-space

Goal: leave the user with one working space and one edit you made that stayed valid. One space, not a
survey of the whole vault. Ask the user as little as possible; most answers should come from looking.

## 1. Check the setup

```bash
sctx --version            # not found: bun install -g structured-context (needs Bun), or run via bunx
sctx spaces --json        # the health check: config found, spaces valid
```

Read `problems` in the output. Any `error` means validation cannot run yet: follow
`../structured-context/references/troubleshooting.md` for that code and fix it before going on. A
`E_CONFIG_NOT_FOUND` at `info` is the normal starting point. If spaces already exist, this is an "add another
space" run: note their names so you do not reuse one.

Work from the folder the user opened the session in. Config discovery only walks up from there, so if the notes
are in a folder above it or elsewhere, ask the user to start a session inside the folder that holds them.

## 2. Get familiar with the content

Look before asking. Read enough to recognise what kind of content this is and which folder is the candidate.
Do not read everything; sample.

1. Map the layout: top-level folders and how many markdown files each holds (`ls`, `find <dir> -name '*.md' | wc -l`
   per folder). Skip folders that are obviously not notes (attachments, `.obsidian`, `node_modules`, archives).
2. Pick the one or two folders that look like structured content, and read the first ~40 lines of about five notes
   in each. Spread the sample: the oldest and newest, the smallest and largest, and a few from the middle. Read
   frontmatter and the first headings only.
3. Look for clues:
   - frontmatter keys that repeat across notes, and one whose values come from a small set (a type or kind field)
   - folder names that imply a type (`sources/`, `people/`, `goals/`), and file names with a pattern (dates, ids, prefixes)
   - links between notes: wikilinks in frontmatter such as `parent`, `related`, `source`, or a hub or index note
   - provenance fields (where a claim came from), status or lifecycle fields
   - markers that name an existing format or schema, or a templates folder
   - a long tail of notes with no frontmatter at all, which are not nodes and are skipped
4. A quick tally can confirm a hunch, for example how many notes carry a given key
   (`grep -rl '^type:' <dir> --include=*.md | wc -l`). It is a check, not the main evidence.
5. If many folders qualify, or nothing stands out, stop and ask: what are they trying to do with this content,
   and which folder should be first? Name what you saw so the question is easy to answer.

Then compare with the bundled schemas: `sctx schemas list`, and `sctx schemas show <name>` for the likely ones.
Read the descriptions and entity types, not just the names. If nothing fits well, say so and offer the schema
design process in `../structured-context/references/schema-design.md`. Do not force a poor fit or edit content
to match a schema.

## 3. Propose one space

In one message give: the space name (lowercase letters, digits, `-`, `_`), the folder, the schema and why, and
what you noticed that supports it. Ask for a yes or corrections. If the schema needs type inference from folders
or a field remap, check `sctx docs config` for the markdown plugin settings and include them.

## 4. Write the config

```bash
sctx spaces add <name> <path> --schema <schema>
```

- It adds to the config found by walking up from the current folder.
- `E_TARGET_REQUIRED` means there is no local config yet, or only the global one. Ask where it should live. The usual
  answer is the folder that holds the notes, for an Obsidian vault the vault root:
  `sctx --config <folder>/.sctx.json spaces add <name> <path> --schema <schema>`. Use `--global` only if the user asks.
- Never write the JSON by hand to create a config, and never put a vault's space in the global file unprompted.
- `E_CONFIG_NEEDS_MANUAL_EDIT` means the file has comments; show the entry the command printed and offer to add it.
- Extra space settings (type inference, field remaps) go in the file afterwards; keep the file valid JSON.

Check it: `sctx spaces` should list the space with no problems.

## 5. First validation

```bash
sctx validate <name>
```

Summarise in plain language: how many notes are valid, and the two or three most common kinds of problem. Explain
what happens next so the numbers are not alarming:

- existing problems do not block anything; the automatic checks only report problems introduced by edits
  (errors make the turn wait to be fixed, warnings are passed along)
- if most notes fail for one reason (a missing `type`, a field with another name), say that this looks like a
  mapping question, not 200 separate mistakes, and offer to adjust type inference or the schema choice

Offer choices instead of fixing in bulk: leave it, fix a few to see how it works, or adjust the setup.

## 6. First edit

Pick something small the user wants in the vault that fits their goal: a new note, or one change to an existing note.
Run `sctx schemas show --space <name>` first and follow the entity types and required fields. Make the change,
then `sctx validate-file <path>`. The automatic checks run around it and confirm it stays valid.

## 7. Close

State what exists: the config path, the space, how checks behave. If the folder is an Obsidian vault (it has a
`.obsidian` folder) and this was the user's first space, mention that the optional Obsidian plugin
(github.com/mindsocket/obsidian-structured-context) shows the same checks inline and reads the same `.sctx.json`.
Offer the next step once, such as another space, without starting it.
