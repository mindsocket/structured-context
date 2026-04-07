# Torres OST Alignment Research

Research for [issue #3](https://github.com/mindsocket/structured-context/issues/3): Check for alignment with Teresa Torres' perspective on OSTs.

## Torres' Canonical OST Structure

Torres defines the OST as having exactly **four levels**:

1. **Desired Outcome** — the single metric the team is working to move (the root)
2. **Opportunity Space** — customer needs, pain points, and desires; can be nested (parent-child)
3. **Solution Space** — solutions to explore for the target opportunity
4. **Assumption Tests** — tests of individual assumptions underlying each solution

Source: producttalk.org/glossary-discovery-opportunity-solution-tree, "Continuous Discovery Habits" (2021)

---

## Current Schema vs. Torres: Node Types

| Torres Type | Current Schema Type | Assessment |
|---|---|---|
| Desired Outcome | `goal` (closest analog) | Partial match — but see hierarchy issue below |
| — | `vision` | Extension beyond OST scope |
| — | `mission` | Extension beyond OST scope |
| Opportunity | `opportunity` | Good match in name; rules not enforced |
| Solution | `solution` | Good match |
| Assumption Test | *(absent)* | **Gap — entirely missing** |
| — | `dashboard` | Tooling type, not OST concept |
| — | `space_on_a_page` | Tooling type, not OST concept |

---

## Key Divergences

### 1. Vision/Mission/Goal hierarchy vs. a single Desired Outcome

**Torres:** "An opportunity solution tree helps you find the best path to your outcome. If you don't have an outcome, you don't need an opportunity solution tree." The outcome is a **single product metric** (e.g., "increase % of first-time users who reach the aha moment"). It is not a vision or mission statement.

**Current schema:** Uses a three-level strategy hierarchy (Vision → Mission → Goal) before reaching Opportunity. This is closer to an OKR/corporate strategy framework than Torres' OST.

**Verdict:** The vision/mission levels are deliberate extensions that go beyond the OST concept. This is fine, but it should be explicitly documented. For a "strict Torres" mode, only a single outcome node type would be valid at the root, and it would represent a product metric, not a vision.

**Specific mismatch:** Torres says the outcome should be a **product outcome** (customer behavior within the product), not a business outcome (revenue, market share) or a traction metric (feature adoption). A "vision" is neither of these — it's a qualitative direction statement that Torres would consider outside the OST's scope.

### 2. Assumption Tests are missing entirely

**Torres:** The fourth level of the OST is **assumption tests** (deliberately not called "experiments" — a distinction she made explicit in her 2021 book). Each solution has underlying assumptions (desirability, viability, feasibility, usability, ethical); teams test the riskiest ones to compare solution candidates before building.

**Current schema:** No assumption test type. The tree stops at solution.

**Verdict:** This is a significant gap if the tool intends to model a complete OST per Torres. However, for personal planning use cases (where the OST is used more as a strategic/discovery map than a full product discovery system), this may be intentional.

### 3. Opportunity framing rules not enforced

**Torres has strict rules for what constitutes a valid opportunity:**
- Must be framed in the **customer's voice** (something a customer would actually say)
- Must be grounded in a **customer story** from generative research — not invented
- Must be in the **problem space** (multiple possible solutions exist)
- Must be **specific** (moment, context, customer type)
- NOT a solution disguised as an opportunity ("I want to go out to eat" is a solution, not an opportunity — the real opportunity is "I don't have time to cook")
- NOT a business goal disguised as a customer need

**Current schema:** No enforcement of these rules. `title` and `content` are free-form strings. There is no `source` field to track which interview/research grounded the opportunity.

**Verdict:** Hard to enforce these rules in schema validation (they require judgment). However, adding a `source` field to opportunity would support the methodology even if not enforced by validation.

### 4. Numeric assessments not from Torres

**Current schema:** `impact`, `feasibility`, `resources` (1-5 integer scale) on opportunities and solutions.

**Torres:** Does not specify a scoring system for opportunities. Her prioritization approach involves structuring the opportunity space to reveal which opportunities are most worth pursuing based on the research, not numerical scoring. When she discusses opportunity sizing, it is qualitative.

**Verdict:** The numeric scoring is a reasonable pragmatic addition (similar to ICE scoring patterns common in product management). It does not contradict Torres, but it is not from her methodology. The field names are slightly off — Torres' assumption types include "feasibility" (can we build it?) but that applies to solutions/assumptions, not opportunities. No conflict, just not canonical.

### 5. "Experiments" vs. "Assumption Tests" terminology

**Torres:** Deliberately changed "experiments" to "assumption tests" in her 2021 book because real A/B experiments require a built product. Assumption tests happen before building and test a single assumption at a time.

**Current schema:** This distinction is moot since there is no assumption test type at all. But if added, the correct term is "assumption test," not "experiment."

### 6. One target opportunity at a time

**Torres:** Teams should work on **one target opportunity** at a time (WIP-limiting principle) and explore **three candidate solutions** for that target opportunity.

**Current schema:** No concept of "target" opportunity. The `status` field (active/exploring) partially approximates this, but there is no constraint preventing multiple opportunities from being simultaneously "active."

**Verdict:** Hard to enforce in schema; might be better as a linting rule or a convention in docs.

### 7. Parent constraint on Solution

**Current schema:** A solution can have a parent that is either an opportunity OR another solution.

**Torres:** Solutions connect directly to opportunities only. Sub-solutions are not a concept in her methodology — each solution is a candidate for the target opportunity.

**Verdict:** The solution → solution hierarchy is an extension. It may be useful (e.g., breaking down a large solution into sub-solutions), but it goes beyond Torres.

---

## What Aligns Well

- **Parent/child relationships** in the opportunity space: Torres explicitly uses a nested opportunity hierarchy (parent-child, sibling structure). The wikilink mechanism is a valid implementation.
- **Solution connected to opportunity** via `parent` field: Matches Torres' rule that solutions must connect to opportunities.
- **Lifecycle status on nodes**: Torres talks about target vs. explored vs. archived opportunities; having a status field is reasonable.
- **Opportunity and solution are the two core types**: These are correctly named and conceptually aligned.
- **Space scoping**: The space/config system aligns with Torres' emphasis that OSTs are team-scoped, not company-wide.

---

## Recommendations

### Option A: Document extensions explicitly (minimal change)

Add a note in the schema and/or README explaining which node types are standard Torres OST and which are extensions:

- **Standard Torres:** `opportunity`, `solution`
- **Outcome-level extensions:** `vision`, `mission`, `goal` (filling the role Torres' "desired outcome" plays, but with more strategic structure)
- **Tooling types:** `dashboard`, `space_on_a_page`
- **Missing Torres type:** `assumption_test`

### Option B: Add a "strict" schema mode (medium change)

Create a second schema (`schema-strict.json` or a schema with a `mode` flag) that enforces Torres' four-type structure:
- Only allows: `outcome`, `opportunity`, `solution`, `assumption_test`
- `outcome` cannot have a parent, and only one should exist per tree
- `assumption_test` must have a solution parent
- Opportunity types must have `source` field documenting research origin

### Option C: Add `assumption_test` type to current schema (low-risk addition)

Add a minimal `assumption_test` node type to the existing schema without changing anything else. This fills the most significant gap without breaking the existing hierarchy.

Suggested fields:
```yaml
type: assumption_test
parent: "[[Solution Name]]"   # required, must be a solution
status: identified | active | completed | archived
assumption: "string"          # the specific belief being tested
category: desirability | viability | feasibility | usability | ethical
test_activity: prototype | survey | data_mining | research_spike
risk: high | medium | low
```

### Option D: Add `source` field to `opportunity` (low-risk addition)

Add an optional `source` field to the opportunity type to track which customer research grounded the opportunity. This supports Torres' emphasis on research-based opportunities without enforcing it.

```yaml
source: "Interview with [name], [date]"
```

---

## Summary

The schema is a useful, well-designed personal productivity tool that draws inspiration from Torres' OST methodology while extending it significantly for personal/strategic use. The main gaps vs. Torres are:

1. **No assumption test type** — the fourth layer of Torres' OST is absent
2. **Vision/Mission/Goal hierarchy** is not part of Torres' OST (though it's a sensible extension)
3. **Opportunity rules not enforced** — Torres has specific constraints on what constitutes a valid opportunity that can't easily be enforced by schema validation

The extensions (vision, mission, dashboard, etc.) are intentional and reasonable adaptations. The key question is whether the tooling should also support the full Torres methodology for users who want strict compliance, or remain as a pragmatic personal planning tool.

The lowest-effort highest-value change would be **Option C**: add `assumption_test` as a node type, since this fills the most significant gap vs. Torres' canonical four-level structure.

---

## Roger's reflection on the above

My thoughts so far:
  * All points noted and generally fair.
  * I think goal and outcome are somewhat synonymous, as are assumption_test and experiment
  * I think we should explore the idea of type aliases in schemas - the existing schema could accept "goal" or "outcome" as a type for the same entity. This alone largely solves for
  "significant gap if the tool intends to model a complete OST per Torres"
  * I think we should also explore alternative schemas. We could `mkdir schemas && mv schema.json schemas/general.json` then add a `schemas/strict_ost.json` for the Torres version (limited
  parentage, opinionated names from Torres' work). We have '--schema' scafolding already. We could promote the schema in config.json to space level, and update the default so
  `schemas/general.json` is used - partly for backward compatibility but mainly because I have stronger opinions about structure. Put common `refs` in a shared file to avoid repetition.
  * Side note - there doesn't appear to be an IP (trademark) issue with "OST". We should be respectful and attribute Torres' work, while calling out these tools' applicability to a broader range of frameworks. The project already wants to explore adjacent and
  composite models anyway.
  * Taking that idea one further "general.json" might really be strategy_plus_ost.json or something.
  * I share concern about the term "experiment", but don't love assumption_test either. Other terms that might be used in the wild include "bet" (though that's arguably something bigger),
  "initiative" (again, possibly bigger), "discovery" (horribly overloaded and misused term, and not quite the right fit, best avoided), dare I say "epic" ... there's a lot of crossover from
  different mental models in tension here. I want this project to be a useful tool for a reasonable range of teams and their quirky ways of defining ideas and work, but at some level there
  needs to be some more qualitative capability with specific meaning given to things.
  * Speaking of, I totally agree about the qualitative point Torres makes. For that I have a separate issue (#2) covering this. I suggest you get a list of all issues for broader context of
  this conversation.
  * One solve for the goal/metric tension could be to introduce a metric entity, allowing goal or opportunity as a parent (this is arguably too flexible, but that's why supporting multiple
  schemas can become powerful). Issue #5 touches on this (though doesn't mention metric specifically).
  * Before going too crazy with new "entities", which sounds heavy, the flexible nature of the schema is already such that the same object (such as a metric) could be thought of as a simpler
  set of attributes/fields, without needing the cognitive weight of a full "entity".
  * Building on that idea, an emergent idea is that there's a primary entity cascade (vision, mission, goal, etc), but also sub-entities hanging off those (metrics, problem statements,
  assumptions, risks etc). The primaries may be expressed more often as full pages, whereas sub-entities would most often be sections (annotated headings) within a primary entity. This
  relates to issue #10
  * Expanding on "Opportunity framing rules not enforced", I like the idea of adding some descriptive/qualitative metadata somewhere (in the json schema perhaps?) with "rules" or guidance
  applicable to any given entity - this could begin to encapsulate inputs to "agent skills" in issue #2.
  * Somewhat left-of-center idea - we're basically building a `linter` for business and product planning models, one that can handle both logical and qualitative coherence.
  * Re "Numeric assessments" - agree with the assessment. These could be left out of a strict_ost. Hopefully though, top level schemas can be easily composed by teams from building blocks. eg
  a team could say that only solutions can have numeric assessments, or simply introduce their own. Perhaps someone contributes "RICE score" as another building block for folks to use.
  * Re "One target opportunity at a time" - I like this as an example of a descriptive rule that could be added to a schema (at the top level in this case, as it's opinionated and specific to
  strict_ost. An agent (or accompanying code, in this case) could check whether there's > 1 active opportunity.
  * ... that would be an interesting twist. Allow rules to be descriptive (for humans/agents) or in the form of executable code (eg a lambda-like expression)