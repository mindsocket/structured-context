# Plan: Folder-based type inference (#73, #44, #78)

Implements automatic node type inference from folder structure in the markdown plugin.
Closes issues #73 (type inference from folder structure), #44 (parsing hints in space config), #78 (metadata layout).

## Design decisions

- **`$metadata` is unchanged** — no new fields added to the schema dialect
- **Known types source of truth**: canonical type names are extracted from `oneOf` branches in the schema (`properties.type.const` / `.enum`), not from metadata hierarchy/relationships. Flat schemas with no hierarchy work correctly.
- **Default mode (`folder-name`)**: match the leaf directory name case-insensitively against canonical type names and alias keys. `Sources` matches alias `"sources": "source"` but not the type `source` directly.
- **`folderMap` mode**: replaces auto-matching entirely. Keys are full paths from the space root (trailing slashes normalised). Longest-prefix match wins. Values may be aliases (resolved to canonical type).
- **Precedence**: explicit `type:` in frontmatter always wins over inferred type.
- **Config errors are hard errors**: unresolvable `folderMap` values (not a known type or alias) throw at parse time.
- **`mode` is an enum** (`'folder-name' | 'off'`) rather than boolean to support future modes (e.g. `'folder-level'`).

## Config shape

```json
{
  "name": "my-wiki",
  "path": "...",
  "schema": "knowledge_wiki.json",
  "plugins": {
    "markdown": {
      "typeInference": {
        "mode": "folder-name"
      }
    }
  }
}
```

With explicit folder map (replaces auto-matching):

```json
{
  "plugins": {
    "markdown": {
      "typeInference": {
        "folderMap": {
          "Research": "source",
          "Personal": "note",
          "topics/concepts": "concept"
        }
      }
    }
  }
}
```

## Tasks

- [x] **Step 1** — Relocate `extractEntityInfo` and add `extractSchemaTypeNames` in `src/schema/schema.ts`
  - Move `extractEntityInfo` from `src/commands/schemas.ts` to `src/schema/schema.ts` — it is schema inspection logic that only ended up in the command layer by accident. Update imports in `src/commands/schemas.ts` and `src/commands/validate.ts`.
  - Add `extractSchemaTypeNames(schema: SchemaWithMetadata, schemaRefRegistry: Map<string, AnySchemaObject>): Set<string>` as a thin wrapper: `new Set(extractEntityInfo(...).map(e => e.type))`
  - `EntityInfo` type moves to `src/schema/schema.ts` alongside the function (or `src/types.ts` if broadly useful)
  - **Simplify signature**: `extractEntityInfo` currently takes `oneOf` as a separate parameter; after the move, update it to take `SchemaWithMetadata` directly (accessing `schema.oneOf` internally). Update both call sites accordingly.

- [x] **Step 2** — Update `MarkdownPluginConfig` in `src/plugins/markdown/index.ts`
  - Add `TypeInferenceConfig` type: `{ mode?: 'folder-name' | 'off', folderMap?: Record<string, string> }`
  - Add `typeInference?: TypeInferenceConfig` to `MarkdownPluginConfig`
  - Add corresponding block to `MARKDOWN_CONFIG_SCHEMA`

- [x] **Step 3** — `inferTypeFromPath` in `src/plugins/markdown/util.ts`
  - Signature: `inferTypeFromPath(filePath: string, config: TypeInferenceConfig, knownTypes: Set<string>, typeAliases: Record<string, string> | undefined): string | undefined`
  - `mode: 'off'` → return `undefined`
  - **folderMap mode** (when `folderMap` is provided):
    - Normalise all keys (trim trailing slashes, normalise path separators)
    - Get directory of `filePath` relative to space root
    - Find longest-prefix matching key
    - Resolve value: check `typeAliases` first, then `knownTypes`
    - Hard error if value does not resolve to a known type or alias
  - **Leaf-dir mode** (default, no `folderMap`):
    - Get leaf directory component of `filePath`
    - Lowercase it
    - Check `knownTypes` case-insensitively → return matched type name (preserving original case from schema)
    - Check `typeAliases` keys case-insensitively → resolve and return canonical type
    - Return `undefined` if no match
  - Files at root of space (no directory component) → return `undefined`

- [x] **Step 4** — Wire into `readSpaceDirectory` in `src/plugins/markdown/read-space.ts`
  - Compute `knownTypes = extractSchemaTypeNames(context.schema)` once before the file loop
  - After `applyFieldMap`/`coerceDates`, if `!data.type`: call `inferTypeFromPath` and assign result to `data.type`

- [x] **Step 5** — Tests in `tests/plugins/markdown/read-space-directory-type-inference.test.ts`
  - Fixture directories under `tests/fixtures/` (knowledge-wiki schema)
  - Scenarios:
    - Leaf-dir matches canonical type name (`concept/page.md` → `concept`)
    - Leaf-dir matches alias key (`study/page.md` → `source`), case-insensitive (`Study/page.md`)
    - Leaf-dir plural with no alias does not match (`sources/page.md` → not inferred)
    - Explicit `type:` in frontmatter overrides inferred type
    - `mode: 'off'` → no inference
    - File at space root (no folder) → no inference
    - `folderMap`: mapped folder infers correctly
    - `folderMap`: unmapped folder does not infer
    - `folderMap`: nested path (`topics/concepts`) matches correctly
    - `folderMap`: longest-prefix wins when keys overlap (`a/b` vs `a/b/c`)
    - `folderMap`: trailing slash in key is normalised
    - `folderMap`: value can be an alias (resolves to canonical type)
    - `folderMap`: unresolvable value throws a hard error

- [x] **Step 6** — Docs
  - `README.md`: add `typeInference` to plugin config reference section
  - `docs/concepts.md`: add **Type inference** entry to the Space directory section

- [ ] **Step 7** — Close issues
  - Comment on and close #73, #44, #78 referencing the implementation
