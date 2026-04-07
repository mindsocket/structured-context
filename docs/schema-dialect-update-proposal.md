# Schema Dialect update Proposal

Date: 2026-03-10  
Status: Implemented in codebase (Stages A-D complete; smoke-test follow-up pending)

## Why this doc

Issue #28 opened the door to reorganize schema metadata, rules, and composition behavior. This proposal now serves as both the decision record and implementation tracker for the updated shape that has landed.

## Goals

- Improve composability across schema files and partials.
- Define explicit metadata/rule merge semantics.
- Keep schema editing friendly in IDEs and generic JSON Schema tools.
- Reduce duplicate model declarations between TypeScript runtime and JSON schema metadata contracts.
- Keep rule authoring simple for humans and agent workflows.

## Non-goals

- Backward compatibility with legacy `"$defs._metadata"`.
- Solving all qualitative rule expressiveness in one step.
- Replacing AJV/JSON Schema with a different validation stack.

## Implemented Snapshot

- Top-level `"$metadata"` is the shipped keyword.
- Hierarchy shape is `"$metadata.hierarchy.levels"` with optional `allowSkipLevels`.
- Rules are a flat `"$metadata.rules"` array with per-rule `category`.
- Metadata is composed across `$ref` graph (DFS, root last) with deterministic merge semantics.
- Rule conflict policy is error by default; explicit `override: true` enables replacement.
- `$metadata.rules` supports `$ref` imports for specific rules and rule sets.
- Metadata contract source is `src/metadata-contract.ts` (`json-schema-to-ts` types), with generated metaschema artifact in `schemas/generated/_ost_tools_schema_meta.json`.

## Decision Areas and Recommendations

## 1) Keyword Name and Top-level Shape

### Options

- `"$metadata"` top-level object.
- `"metadata"` top-level object.
- `"$ost"` top-level object for explicit namespace ownership.

### Recommendation

Use `"$metadata"`, with room to move to `"$ost"` only if we add several structure-context-specific keywords later.

Why:

- `"$"` signals dialect-level keyword rather than user data.
- Low churn from current issue #28 implementation.
- Still clear enough for authors today.

### Decision and rationale
Agreed. `"$metadata"`
`"$ost"` was appealing but we were not final on the forever name for the project, given how far it's already gone beyond opportunity solution tree specific uses. Future sub-options: 1. rename project then choose a name, 2. stick with $metadata (it's honestly fine), 3. rename now to something more specific but not tied to project name, eg `"$validation"` or `"$validationMeta"` 4. Move to `"$ost"`. I'd be open to trying sub-option 3 sooner than later.


## 2) Hierarchy Shape

### Current pain

`allowSkipLevels` sits beside `hierarchy`, even though it semantically configures hierarchy behavior.

### Recommendation

Move to a structured hierarchy object:

```json
"$metadata": {
  "hierarchy": {
    "levels": [
      "outcome",
      { "type": "opportunity", "selfRef": true },
      "solution",
      "assumption_test"
    ],
    "allowSkipLevels": false
  }
}
```

Notes:

- Keep level-entry shorthand as string or object.
- Keep runtime normalization defaults (`field`, `fieldOn`, `multiple`, `selfRef`) in code.
- Optional: include `default` annotations in metaschema for docs/editor hints, but do not rely on `default` for behavior.

### Decision and rationale
Agreed. Implement
Additional input - I'm of a mind to sort out the weird `const { hierarchy, levels, typeAliases } = loadMetadata(resolvedSchemaPath);` pattern at the same time. The flat hierarchy string[] is a bit pointless and with a richer structure gets confusing.

## 3) Rule Model: container vs per-rule category

### Current pain

Rules are grouped by container keys (`workflow`, `bestPractice`, etc.), which complicates composition and merging.

### Recommendation

Store rules as a flat array; make category an attribute.

```json
"$metadata": {
  "rules": [
    {
      "id": "active-outcome-count",
      "category": "workflow",
      "scope": "global",
      "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
    },
    {
      "id": "solution-quantity",
      "category": "best-practice",
      "type": "opportunity",
      "check": "$count(nodes[resolvedParentTitle=$$.current.title and resolvedType='solution']) >= 3"
    }
  ]
}
```

Benefits:

- Easier merge logic.
- Easier filtering/reporting.
- Better extensibility for future attributes (`severity`, `tags`, `source`).

### Decision and rationale
Agreed. Implement.

## 4) Rule scope inside subschemas

### Question

Should rules be embeddable in specific object/type definitions?

### Recommendation

Phase this in later, not in these updates.

In scope:

- Keep canonical executable rule location in `"$metadata.rules"`.
- Add `type`/scope filters there for now.

Future candidate:

- Introduce `"$rules"` on subschema nodes.
- Compiler step extracts/normalizes these into the same runtime rule list.

Rationale:

- Avoid changing storage model and extraction model at the same time.
- Preserve simple mental model for schema authors during migration.

### Decision and rationale
Agreed. No action.

## 5) Composability and merge semantics

### Current pain

Metadata merge behavior is implicit and fragile.

### Recommendation

Define deterministic merge rules in this update:

- Metadata sources: traverse `$ref` graph from root schema (DFS), then apply root schema metadata last.
- `hierarchy`: exactly one provider allowed; error if multiple providers define it.
- `aliases`: shallow merge by key; later provider wins.
- `rules`: concatenate, then dedupe by `id`; later provider wins on conflict.
- Validation: fail fast on duplicate rule ids with incompatible payload unless override is explicit.

This gives predictable composition without inventing a second inheritance mechanism.

### Composition patterns to choose from

Below are viable patterns for how schema authors can compose metadata/rules across files.

### Pattern A: Single metadata owner (root-only)

- Rule: only root schema may define `"$metadata"`.
- Refs are for structural schema content only.

Pros:

- Minimal ambiguity and simplest implementation.
- Easy mental model for authors.

Cons:

- Weak reuse of shared rule packs.
- Tends toward copy/paste for metadata blocks.

### Pattern B: Multi-source metadata via `$ref` graph (recommended)

- Rule: referenced schemas may define `"$metadata"` fragments.
- Loader walks `$ref` graph, collects metadata, applies deterministic merge.

Pros:

- Strong composability and reuse.
- Enables shared rule libraries and overlays.

Cons:

- Needs clear merge and conflict semantics.
- Slightly harder to reason about without good tooling/docs.

### Pattern C: Explicit metadata imports (custom field)

- Rule: keep `"$metadata"` root-only, add explicit import list inside it, e.g.:

```json
"$metadata": {
  "imports": [
    "ost-tools://rules/workflow-core",
    "ost-tools://rules/strict-ost"
  ],
  "rules": [...]
}
```

Pros:

- Explicit import intent; easier to audit.
- Avoids overloading structural `$ref` traversal.

Cons:

- Introduces new custom mechanism parallel to `$ref`.
- More design and tooling work.

### Recommended choice

Use Pattern B now, with strict semantics:

- Source order: DFS over `$ref` graph, then root schema last.
- `hierarchy`: exactly one provider; error if multiple.
- `aliases`: shallow merge; later wins by key.
- `rules`: merge by `id`.
- Rule collision policy: default is **error** unless incoming rule declares `"override": true`.

This gives reuse with explicit safety around accidental overrides.

### Example: composable rule pack via `$ref`

```json
{
  "$id": "ost-tools://_rules_workflow",
  "$metadata": {
    "rules": [
      {
        "id": "active-outcome-count",
        "category": "workflow",
        "scope": "global",
        "check": "$count(nodes[resolvedType='outcome' and status='active']) <= 1"
      }
    ]
  }
}
```

```json
{
  "$id": "ost-tools://strict_ost",
  "allOf": [{ "$ref": "ost-tools://_rules_workflow" }],
  "$metadata": {
    "rules": [
      {
        "id": "active-outcome-count",
        "override": true,
        "category": "workflow",
        "scope": "global",
        "check": "$count(nodes[resolvedType='outcome' and status='active']) = 1"
      }
    ]
  }
}
```

### Decision and rationale
Round 1: I think this is pragmatic. Before proceeding though, let's consider alternatives. I'm not clear yet on where and how refs would be used to include things from other places - are they rules, lists of rules, chunks of metadata? What are the tradeoffs? Add more detail to this section (or in a separate doc) with examples of options.

Round 2: I agree that option B is directionally right. Can it also be used with `$ref` to import a specific rule (froma `$def` maybe)?

## 6) Schema ID convention and IDE compatibility

### Current pain

Custom `sctx://` schema identifiers are not resolvable by common editors, causing warnings.

### Recommendation

Use a mixed strategy:

- Keep `$schema` as a resolvable HTTPS URL to the generated metaschema:
  - `https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/_structured_context_schema_meta.json`
- Keep bundled schema/partial `$id` values in the internal `sctx://...` namespace for stable CLI registry resolution.
- Document that editor-side mappings (`json.schemas`) are optional conveniences and not a correctness mechanism.

Notes:

- This reflects the shipped behavior and avoids coupling runtime correctness to editor configuration.
- The CLI remains authoritative for resolution semantics.

### Decision and rationale
Round 1: Tell me more about json.schemas. Assuming I don't get a domain and hosted metaschemas anytime soon we're already in a pickle. Can these settings solve for `sctx://...` references in this current project with vs code settings? If so, let's try it. If that works it might suffice to document the settings needed for schema developers (they'll need to locate the bundled schemas but that's doable).

Round 2: This proved to be a disaster and there's no good way to get vs code to cooperate. I've reverted to much like what we had. The code still appears to validate, though I note a very worrying `METADATA_KEYWORD_SCHEMA` in schema.ts. What's the point of that? The whole point of _ost_tools_schema_meta.json was to not hardcode the schema again. I'm expecting this will be addressed when we work on item 7 below.

## 7) Single source of truth for types and runtime validation

### Current pain

Model declarations are duplicated between TypeScript interfaces and metaschema contracts.

### Recommendation

Use TS-authored metadata contract as the source of truth (`as const`) and infer types with `json-schema-to-ts`, then generate/export the metaschema artifact from that source.

Shipped workflow:

- Author metadata schema contract in `src/metadata-contract.ts`.
- Infer TS types from that contract via `json-schema-to-ts`.
- Validate runtime metadata via AJV using the same contract object.
- Generate `schemas/generated/_ost_tools_schema_meta.json` from the in-code contract (`bun run generate:schema-meta`).

This keeps one authoritative contract while still producing a portable schema artifact for tooling.

### Alternatives snapshot

### `json-schema-to-typescript`

- Input: JSON schema files.
- Output: generated `.d.ts`/TS types.
- Best fit when schemas remain authored as JSON/JSON5.

### `json-schema-to-ts`

- Input: schema object literals in TS (`as const`).
- Output: inferred types in type-space only.
- Strong type ergonomics, but pushes schemas into TS source (or requires conversion step).

### `@profusion/json-schema-to-typescript-definitions`

- Similar direction to `json-schema-to-ts` patterns.
- Useful if schema authoring is TS-first and codegen files are undesirable.

### `quicktype`

- Broad tool (schemas, samples, multiple languages, optional runtime helpers).
- Useful if cross-language generation becomes a goal; heavier than needed for current scope.

### Recommendation for this repo

Implemented approach is `json-schema-to-ts` with contract-in-code, plus generated metaschema artifact for compatibility.

### Decision and rationale
Round 1: I agree with this approach, and like it. Next step is to research alternatives.

Round 2: Given where things went with previous items I'm inclined to go with `json-schema-to-ts` and move _ost_tools_schema_meta into code.

## Proposed updated metadata example

```json
{
  "$schema": "https://raw.githubusercontent.com/mindsocket/structured-context/main/schemas/generated/_structured_context_schema_meta.json",
  "$id": "ost-tools://general",
  "$metadata": {
    "hierarchy": {
      "levels": [
        "vision",
        "mission",
        { "type": "goal", "selfRef": true },
        { "type": "opportunity", "selfRef": true },
        { "type": "solution", "selfRef": true },
        "experiment"
      ],
      "allowSkipLevels": false
    },
    "aliases": {
      "outcome": "goal",
      "assumption_test": "experiment",
      "test": "experiment"
    },
    "rules": [
      {
        "id": "active-outcome-count",
        "category": "workflow",
        "description": "Only one outcome should be active at a time",
        "scope": "global",
        "check": "$count(nodes[resolvedType='goal' and status='active']) <= 1"
      }
    ]
  }
}
```

## Migration plan (breaking)

- Step 1: Freeze updated dialect contract and merge semantics in docs.
- Step 2: Update metaschema and loader for new hierarchy + rules-array shape.
- Step 3: Migrate bundled schemas (`general`, `strict_ost`, partials).
- Step 4: Update `docs/rules.md`, schema authoring skill docs, and examples.
- Step 5: Add schema composition tests covering merge and conflict behavior.
- Step 6: Keep mixed ID strategy (`$schema` HTTPS + internal `sctx://` IDs) and document editor constraints.
- Step 7: Keep metadata contract in code (`json-schema-to-ts`) and generate metaschema artifact from that source.

## Execution checklist (staged)

Use this as the implementation tracker. Check items off as they land.

### Stage A - Contract and metadata shape

- [x] Freeze final updated metadata contract in this doc (`"$metadata"` retained, hierarchy object shape, rules-array model).
- [x] Replace `loadMetadata` return shape to remove redundant `hierarchy: string[]` and rely on `metadata.hierarchy.levels`.
- [x] Update all call sites that destructure `hierarchy/levels/typeAliases` to use the new shape.
- [x] Move metadata schema contract into a single source in code (TS `as const`) and infer types (`json-schema-to-ts`) for runtime-facing metadata types.
- [x] Remove duplicated hardcoded metadata schema declarations (including `METADATA_KEYWORD_SCHEMA` duplication against the metadata contract source).

Stage A acceptance criteria:

- [x] `bun run test` passes.
- [x] `bun run lint` passes.
- [x] No remaining code path depends on legacy `"$defs._metadata"`.

### Stage B - Rules model migration

- [x] Convert schema metadata from grouped rule containers to flat `rules: Rule[]` with `category` attribute.
- [x] Update rule evaluation pipeline to iterate over flat rules.
- [x] Preserve current validation behavior for `scope`, `type`, and check expression execution.
- [x] Migrate bundled schemas (`general`, `_ost_strict`) to new rules shape.
- [x] Update tests/fixtures for the flat rules representation.

Stage B acceptance criteria:

- [x] `validate-rules` tests confirm behavior parity with prior rule execution.
- [x] Rule category output remains stable in CLI output.
- [x] `bun run test` and `bun run lint` pass.

### Stage C - Composability and merge semantics

- [x] Implement metadata collection across `$ref` graph (DFS) with root metadata applied last.
- [x] Enforce single-provider hierarchy (error on multiple providers).
- [x] Implement aliases merge (shallow merge, later provider wins).
- [x] Implement rules merge by `id` with conflict policy:
- [x] default conflict is error;
- [x] allow override only when incoming rule explicitly sets `"override": true`.
- [x] Add support for importing specific rules/rule sets via `$ref` targets (for example under `$defs`) and normalize into merged rule list.
- [x] Add composition-focused tests covering merge order, conflict errors, and targeted rule imports.

Stage C acceptance criteria:

- [x] Composition tests demonstrate deterministic merge outcomes.
- [x] Conflicting rules without explicit override fail with clear error messaging.
- [x] `bun run test` and `bun run lint` pass.

### Stage D - Documentation and release prep

- [x] Update docs (`README.md`, `docs/schemas.md`, `docs/rules.md`, `docs/concepts.md`) to final updated structure.
- [x] Update agent-facing docs (`AGENTS.md`, `skills/ost-tools/references/*`) to match updated structure.
- [x] Add authoring examples for composable rules (rule packs and override examples).
- [x] Document editor expectations and constraints (do not depend on fragile VS Code-only mappings for correctness).
- [x] Create a concise release checklist entry for breaking-schema migration guidance.

Stage D acceptance criteria:

- [x] All docs and examples are internally consistent with the shipped schema shape.
- [ ] Smoke test paths still validate real spaces.
- [x] Ready-to-release changelog notes drafted.

### Suggested PR boundaries

- [ ] PR A: Stage A only (contract + metadata shape).
- [ ] PR B: Stage B only (flat rules model).
- [ ] PR C: Stage C only (composition + merge + rule imports).
- [ ] PR D: Stage D only (docs + release prep).

## Draft changelog notes (release prep)

- **Breaking**: schema metadata now uses top-level `$metadata` with `hierarchy.levels` (legacy `$defs._metadata` unsupported).
- **Breaking**: `allowSkipLevels` moved under `$metadata.hierarchy`.
- **Breaking**: rule declarations migrated to flat `rules[]` with per-rule `category`.
- **New**: metadata composition across `$ref` graph with deterministic merge semantics.
- **New**: rule imports via `$metadata.rules` `$ref` entries and explicit rule override (`override: true`) behavior.
- **Internal**: metadata contract source consolidated in `src/metadata-contract.ts` with generated metaschema artifact.

## Open questions for decision

- Keep `"$metadata"` or rename to `"$ost"` now while breaking changes are allowed? A: Keep $metadata
- Should hierarchy support multiple named hierarchies, or only one? A: one
- Should duplicate rule IDs always override, or be an error unless `override: true` is set? A: I like override, stick with that
- Do we want first-class rule severity (`error`, `warn`, `info`) in thes updates or later? A: Yes, but later
- Do we host metaschemas publicly immediately, or ship local mapping first then host later? A: already hosted
