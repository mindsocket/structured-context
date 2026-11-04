---
name: publish-map-view
description: >
  Publish a Claude artifact with a map or tree visualisation of a structured-context (sctx) space, refresh its data, and read comments left on it. Use when the user wants to see, share or discuss their structured content visually, or to update an artifact made this way.
  An argument names the space.
---

The artifact is a fixed page from the `structured-context-map-views` package. The space's data lives in the
artifact's database, so refreshing is writing the data again.

Needs the Artifact tool and Bun. Find the space name with `sctx spaces`.

## Publish

1. **Pick one version of the package** for both the export and the page, normally the latest:
   `npm view structured-context-map-views version`.

2. **Export the space.** The export holds the graph, validation results, and the map views that apply to the schema:

   ```bash
   bunx structured-context-map-views@<version> export <space> > export.json
   ```

   Run it where sctx finds the config, or pass `--config <file>`. If `definitions` is empty no map view applies to
   the space's schema: tell the user and stop. Keep `export.json` and the files below in your scratchpad.

3. **Fetch the template and publish it unchanged:**

   ```bash
   curl -fsSL https://cdn.jsdelivr.net/npm/structured-context-map-views@<version>/dist/artifact.html > map-view.html
   ```

   Call the Artifact tool with that file, `capabilities: {db: {}}` and icon `map`.

4. **Write the space into the artifact database.** The page lists the `spaces` collection, one document per space,
   with the three large parts as JSON strings:

   ```bash
   jq '{schemaId, graph: (.graph | tojson), validation: (.validation | tojson), definitions: (.definitions | tojson)}' export.json > doc.json
   ```

   Then `write_db` with `db_op: "set"`, `collection: "spaces"`, `doc_id: "<space>"`, `file_path: doc.json`.

5. **Tell the user** the link and that the space's content (titles, fields, text) is stored in the artifact's
   database, visible to whoever the artifact is shared with (private by default).

To add another space to the same artifact, repeat steps 2 and 4 with its name as `doc_id`.

## Refresh

Re-run steps 2 and 4 with the same version. Read the existing `spaces/<space>` document with `read_db` and pass
its `version` as `if_version` to `write_db`. Viewers see the new data after a reload. To move to a newer package
version, publish its page to the same artifact URL first.

## Reading comments

Use the Artifact tool's `comments` action. A thread's `[location]` is the accessible name of the card, in the form
`[<index>] <title> · <view>`; the viewer cuts it at about 45 characters, so the view may be missing.

1. Read `spaces/<space>` with `read_db` and parse its `graph` string. `graph.nodes[<index>]` is the node: its
   fields, content, parent and children. Check that its title matches; if not, the space was refreshed since the
   page was loaded, so find the node by title or ask.
2. Its validation messages are in the parsed `validation` string: entries whose `nodeId` is that node's `id`.
3. The location doesn't include the viewer's parameter values (orientation, validation level); ask if they matter.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "This page needs the artifact database" | Published without the `db` capability | Republish with `capabilities: {db: {}}` |
| "Nothing to show yet" | Step 4 not done, or written to another artifact | Write `spaces/<space>` with this artifact's URL |
