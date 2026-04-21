# Use Cases

A catalog of use cases for structured-context, covering both direct CLI usage and agentic AI-assisted workflows.

**Status values:**
- `done` — implemented as a CLI command or plugin feature
- `agent` — achievable today via an AI agent with existing commands
- `partial` — some coverage but meaningful gaps remain
- `none` — not currently supported; would require new capabilities

> [!note] Format support
> This document covers Markdown format only where direct access to files is available.

---

## Validation & Compliance

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Validate content** | Verify that space content conforms to schema, link integrity, rules, and hierarchy | | |
| — Validate a space | Check all files in a space in one pass | done | `sctx validate` · `/validate-space` command |
| — Validate a single file | Validate one file in context of its space | done | `sctx validate-file` · auto-validation hook on `.md` save |
| — Watch for changes | Continuously re-validate as files are edited | done | `sctx validate --watch` |
| **Resolve validation errors** | Investigate and fix schema, link, or rule violations once identified | agent | structured-context skill (troubleshooting guide; `dump` for rule debugging) |

---

## Schema Development

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Design a schema** | Build a schema for content that doesn't have one yet | | |
| — Analyse unstructured content | Inventory entity types, fields, and relationships across existing markdown files before writing a schema | agent | structured-context skill (`schema-design.md` process) |
| — Model the hierarchy and relationships | Identify the structural backbone and lateral relationships, then express them in `$metadata` | agent | structured-context skill (`schema-design.md`); `schemas show --mermaid-erd` to verify |
| **Extend or maintain a schema** | Add to or refine an existing schema | | |
| — Author types and properties | Add new entity types, required/optional fields, enum definitions, and `$ref` partials | agent | structured-context skill (`schema-authoring.md`) |
| — Develop rules | Write JSONata rules to enforce workflow, best-practice, or coherence constraints | agent | structured-context skill; `dump` for iterating on rule expressions |
| — Inspect schema structure | Understand entity types, required fields, hierarchy levels, relationships, and rules | done | `sctx schemas show [--mermaid-erd] [--space]` |
| — Keep templates in sync | Update Obsidian templates to reflect current schema examples and field descriptions | done | `sctx template-sync [--create-missing] [--dry-run]` |

---

## Visualisation & Exploration

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Visualise a space** | Produce a structured view of the space's nodes and relationships | | |
| — Tree view | Print hierarchy, spot orphans, verify parent links | done | `sctx show` · `sctx render <space> markdown.bullets` |
| — Filtered / sliced view | Show a subset of nodes matching a type, status, or relationship condition | done | `sctx show --filter` · named views in config |
| — Mermaid diagram | Visual node map with type-based styling, exportable to `.mmd` | done | `sctx diagram [--output]` · `sctx render <space> mermaid.graph` |
| — Miro board sync | Push nodes and connectors to a Miro board as interactive cards | done | `sctx miro-sync [--new-frame] [--dry-run]` |
| — Custom output format | Render a space in a pluggable format (registered by a render plugin) | partial | `sctx render <space> <format>` · `sctx render list` shows registered formats |
| **Inspect and debug** | Examine parsed content in detail | | |
| — Inspect parsed nodes | See resolved types, parent refs, and field values as JSON; debug fieldMap and rule inputs | done | `sctx dump` |
| — Make sense of current content | Orient across a space: summarise what's there, identify gaps, understand structure | agent | `show`, `dump` + agent reasoning with structured-context skill |

---

## Content Authoring

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Author new content compliantly** | Create or edit nodes in Obsidian while staying schema-conformant | partial | Validation hook on `.md` save; schema-driven templates; structured-context skill for inline guidance |
| **Discover and curate inputs** | Identify new information (research, signals, events) to add to a space and integrate it | none | — |

---

## Analysis & Intelligence

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Assess coherence and quality** | Evaluate whether the content is internally consistent and strategically sound | | |
| — Suggest improvements | Surface gaps, stale content, weak links, or missing nodes | agent | Agent reads space via `dump`/`show`; structured-context skill provides domain context |
| — Coach or workshop content | Critique and iterate on the strategic coherence or completeness of a space | agent | Agent-driven; structured-context skill for schema/rule context |
| — Facilitate a decision or clarification | Use the space as context to support a strategic choice or stakeholder conversation | agent | Agent-driven with space content as grounding |
| **Strategy dashboard and alerts** | Summarise key metrics, flag rule violations, track changes over time | none | — |

---

## Content Transformation

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Docs to deck** | Convert space content into a presentation or slide format | none | — |
| **Deck to docs** | Extract structured content from a presentation and integrate it into a space | none | — |

---

## Workflow Automation

| Use case | Description | Status | Coverage |
|---|---|---|---|
| **Automate workflow rituals** | Run planning, review, or triage workflows against space content on a schedule or trigger | none | — |
| **Automate gardening and hygiene** | Scheduled or triggered cleanup: link repair, status updates, orphan triage | partial | `validate --watch` for live feedback; hooks for save-time checks; manual agent-driven triage |
