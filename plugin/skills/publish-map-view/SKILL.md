---
name: publish-map-view
description: >
  Publish a map view of a structured-context (sctx) space (tree, landscape or XY plot, with parameter controls and
  a validation overlay) as a private Claude artifact, refresh its data, and read comments left on it. Use when the
  user wants to see, share or discuss their structured content visually, or to update an artifact made this way.
  An argument names the space.
---

# publish-map-view

The artifact is a fixed page from the `structured-context-map-views` package. The space's data lives in the
artifact's database, so you never read, build or edit page code, and refreshing is writing the data again.

Needs the Artifact tool and Bun. Find the space name with `sctx spaces`.

## Publish

1. **Pick one version of the package** for both the export and the page, normally the latest:
   `npm view structured-context-map-views version`.

2. **Export the space.** The export holds the graph, validation results (expression rules only; no AI judge runs), the
   schema id and the map views that apply to the schema:

   ```bash
   bunx structured-context-map-views@<version> export <space> > export.json
   ```

   Run it where sctx finds the config, or pass `--config <file>`. If `definitions` is empty no map view applies to
   the space's schema: tell the user and stop. Keep `export.json` and the files below in your scratchpad.

3. **Fetch the template and publish it unchanged:**

   ```bash
   curl -fsSL https://cdn.jsdelivr.net/npm/structured-context-map-views@<version>/dist/artifact.html > map-view.html
   ```

   Call the Artifact tool with that file, `capabilities: {db: {}}` and icon `map`. Publish it unmodified: it carries its styles and loads its
   code and libraries from jsDelivr, pinned to `<version>`.

4. **Write the space into the artifact database.** The page lists the `spaces` collection, one document per space,
   with the three large parts as JSON strings:

   ```bash
   jq '{schemaId, graph: (.graph | tojson), validation: (.validation | tojson), definitions: (.definitions | tojson)}' export.json > doc.json
   ```

   Then `write_db` with `db_op: "set"`, `collection: "spaces"`, `doc_id: "<space>"`, `file_path: doc.json`.

5. **Tell the user** the link and that the space's content (titles, fields, text) is stored in the artifact's
   database, visible to whoever the artifact is shared with (private by default).

To add another space to the same artifact, repeat steps 2 and 4 with its name as `doc_id`; the page offers a picker.

## Refresh

Re-run steps 2 and 4 with the same version. Read the existing `spaces/<space>` document with `read_db` and pass
its `version` as `if_version` to `write_db`. Viewers see the new data after a reload. To move to a newer package
version, publish its page to the same artifact URL first.

If `write_db` is refused for size, tell the user; the page reads one document per space, so the space needs a
narrower selection.

## Reading comments

Use the Artifact tool's `comments` action. A thread's `[location]` is the accessible name of the card, in the form
`[<index>] <title> · <view>`; the viewer cuts it at about 45 characters, so the view may be missing.

1. Read `spaces/<space>` with `read_db` and parse its `graph` string. `graph.nodes[<index>]` is the node: its
   fields, content, parent and children. Check that its title matches; if not, the space was refreshed since the
   page was loaded, so find the node by title or ask.
2. Its validation messages are in the parsed `validation` string: entries whose `nodeId` is that node's `id`.
3. The location is the card even when the comment was made on something inside it. The viewer's parameter values
   (orientation, validation level) are not in it; ask if they matter.

The database holds the space as of the last write; refresh first if the content has changed since.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console error "Minified React error #527" | Two copies of React loaded | The page was modified. Fetch it again and republish unmodified |
| "This page needs the artifact database" | Published without the `db` capability | Republish with `capabilities: {db: {}}` |
| "Nothing to show yet" | Step 4 not done, or written to another artifact | Write `spaces/<space>` with this artifact's URL |
| `bunx` can't find `structured-context` | The package's peer isn't installed | `bun install -g structured-context`, then retry |
| `curl` returns 404 | That version isn't published, or predates the page | Use a later `<version>` |
