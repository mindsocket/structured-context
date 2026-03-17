# OST Tools: Architecture

This document describes the architecture of ost-tools — how data flows through the system, and how key concepts map to code. It complements [concepts.md](concepts.md), which defines the canonical terminology.

---

## Information Flow

The following diagram shows the high-level flow from configuration and source files through to validated nodes and output commands.

```mermaid
flowchart LR
    config([config.json<br>space definition])
    schema[(Schema<br>json-schema/JSON5)]
    space[(Space<br>directory or file)]

    subgraph read [Read]
        direction TB
        rdir[read-space-directory<br>read-space-on-a-page]
        embed[parse-embedded<br>extract nodes from body]
        rdir --> embed
    end

    nodes[(Space Nodes<br>schemaData · linkTargets<br>resolvedType · resolvedParents)]

    subgraph validate [Validate]
        direction TB
        schema_val[Schema validation<br>AJV · structural checks]
        ref_val[Ref validation<br>parent wikilink resolution]
        hier_val[Hierarchy validation<br>parent-type rules]
        rules_val[Rules evaluation<br>JSONata expressions]
    end

    subgraph output [Output]
        show[show<br>indented tree]
        dump[dump<br>JSON debug]
        diagram[diagram<br>Mermaid]
        tmpl[template-sync<br>markdown templates]
        miro[miro-sync<br>Miro board]
    end

    config --> read
    schema --> read
    space --> read
    read --> nodes
    nodes --> validate
    schema --> validate
    nodes --> output
    schema --> output
    config --> output
```

**Key data concepts at each boundary:**

| Boundary | Data |
|---|---|
| Space → Read | Raw markdown files / `space_on_a_page` file |
| Read → Nodes | `SpaceNode[]` — schemaData (canonical fields), resolvedType, resolvedParents (`ResolvedParentRef[]`), linkTargets |
| Schema → Read | Hierarchy levels + relationships (type names, edge fields, direction, cardinality), type aliases |
| Schema → Validate | AJV validator, hierarchy rules, JSONata rule expressions |
| Nodes → Output | Validated node set; output commands interpret as needed |
| Config → Output | `fieldMap` (reverse) applied by template-sync for file field names |

---

## Field Remapping

Spaces may use different frontmatter field names than the canonical names expected by the schema (e.g. `record_type` instead of `type`). The `fieldMap` config option handles this transparently:

```mermaid
flowchart LR
    file([Markdown file<br>record_type: goal])
    fm{fieldMap<br>record_type → type}
    node([SpaceNode<br>type: goal])
    schema[(Schema<br>expects: type)]
    tmpl([Template file<br>record_type: goal])
    rfm{reverseFieldMap<br>type → record_type}

    file -->|frontmatter| fm
    fm -->|applyFieldMap| node
    node --> schema
    schema -->|canonical fields| rfm
    rfm -->|invertFieldMap| tmpl
```

- **Read path** (`read-space-directory`, `read-space-on-a-page`, `parse-embedded`): `applyFieldMap` renames file field names to canonical names before schema validation.
- **Write path** (`template-sync`): `invertFieldMap` reverses the map so generated templates use file field names.
- The map is a **single-pass rename** — chained transitive remapping (e.g. `record_type` → `type` → `entity_type`) does not occur.

