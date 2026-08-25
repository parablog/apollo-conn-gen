# Generator tasks log

Curated, numbered log of non-obvious generator bugs, OAS edge cases, and scoped feature work. Code
comments stay short and cite an entry instead of carrying the full rationale inline. Every entry
carries a type label and, where it fits the kind of work, an **OAS:** snippet showing the input
schema that triggers it, a concrete **before → after** example, and an **AST:** note stating how
(or whether) the node tree changed.

**Type label.** Every entry's heading carries a bracketed label naming what kind of work it is —
`[BUG]` (a generator defect) or `[FEAT]` (planned/scoped feature work) today, with room for more
(`[CHORE]`, `[DOCS]`, `[REFACTOR]`, …) as they come up. The label is not a priority signal by
itself — a `[FEAT]` can still be P1 if it blocks something real, a `[BUG]` can be P5 if it's
theoretical.

**This file holds the open, loop-actionable entries only** — every entry here is `⬜`/`🔴` Open and
carries a `[P1]`-`[P5]` tag. Non-actionable entries (parked, noted, upstream-blocked, theoretical,
or resolved without a dedicated code change) live in `docs/DEFERRED.md` instead — the fix-the-issues
loop (`~/bin/issue-loop.sh`) only ever selects an `⬜`/`🔴` entry from *this* file, so anything not
meant for it belongs there, not here. The 147 fixed/shipped ones live in `docs/FIXED.md`. Ids are
global across all three files, shared by bugs and features alike, and never reused:
- open, loop-actionable — `// see docs/TASKS.md #N`
- deferred, not in the work queue — `// see docs/DEFERRED.md #N`
- fixed — `// see docs/FIXED.md #N`

When an entry is fixed/shipped, move it to `FIXED.md` (with its fixture under `tests/resources/oas/`
and its test) and repoint the comments that cite it. When an entry turns out not to be active work —
parked, theoretical, upstream-blocked, or already covered by tests with no code change — move it to
`DEFERRED.md` instead and drop its priority tag (it no longer needs one there).

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` still tracks the large, ongoing, multi-slice architectural items
(R4/R5/R6/R7/R10 — error handling, dynamic headers, batch resolution, richer JSONSelection, reusable
`@mapping`) that are deliberately NOT in this file: they're too large/partially-implemented to be a
single loop-actionable pickup, and this file's loop treats every open entry as equally eligible by
default (no opt-in gate) — dropping a big-bang architectural item in here would let it get attempted
unsupervised. Smaller, well-scoped R-items do move here once they're ready to be picked up
loop-style — see #138-#142, migrated 2026-08-21.

Style: keep entries scannable — short labeled bullets, **one fact per line**, example near the top;
no paragraph-blobs. The example carries the weight; prose only adds what the example can't show. For
`[BUG]` entries the labeled bullets are typically `**Symptom:**`/`**OAS:**`/`**Cause:**`/`**Refs:**`;
for `[FEAT]` entries, where "symptom"/"cause" don't fit, use `**Why:**` (the motivation) and
`**Shape:**` (the proposed mechanism) instead — `**OAS:**`/example stays wherever a concrete input
shape exists, `**Refs:**` always stays.

Status: ⬜ Open · 🔴 Open. (`docs/DEFERRED.md` has the rest: 🟡 Partly done · ⏸ Parked · 📋 Noted ·
✅ Covered.)

Priority (assigned 2026-08-20, extended 2026-08-21 to the migrated feature entries; every entry in
this file has one): P1 real production risk · P2 confirmed compose failure, narrower blast radius ·
P3 tracking/umbrella, not independently actionable · P4 low real-world impact / DX only · P5
latent/theoretical or explicitly out of scope.

## Node model (AST) at a glance

The generator parses the OAS document into a node tree; `generate()` emits the GraphQL SDL and
`select()` emits the connector selection **from the same tree**:

```
Get/Post/Put/… (ops) → Res / Body → root type
Type ── Obj · Composed(allOf) · Union(oneOf/anyOf) · Arr · Map · En · Scalar
  ├── CircularRef ── RefCircRef          cycle sentinels — see #10
  └── Prop ── PropObj · PropArray · PropComp · PropMap · PropEn · PropScalar · PropCircRef
```

Invariants the entries below rely on:
- **ids are name-derived** (`obj:type:<name>`, `prop:obj:<name>`, …): renaming a node changes its id and
  its `path()` (`ancestors()` ids joined with `>`), which is how selections address fields and how the
  collector dedups types (`pendingTypes` keyed by id). Raw names are reserved in `context.types`.
- `visit()` builds children **lazily** (guarded by `visited`); `$ref`s resolve through
  `context.lookupRef`, which returns the **same `SchemaObject` instance** per ref.
- Fixes are either **emission-only** (tree untouched, only `generate`/`select` output changes),
  **identity** changes (a rename → new id/path, same shape), or **shape** changes (different nodes).

## 163 [BUG] [P2] · `?? $(default)` coalesce mappings break every pre-2.15 router — ⬜ Open

**Example:** `tag: tag ?? $("latest")` (the R7 default fallback, `scalar.ts:59`) — parses at
router/plugin 2.15+, fails below it.

**Symptom:**
- Composing with a pre-2.15 plugin rejects the syntax: `INVALID_SELECTION`, a `nom` parser error —
  already on record as corrections to `docs/FIXED.md #108-#110`, never filed as its own entry.
- Adam's benchmark report (2026-08-25) escalates it to runtime: deployed router **2.14.0 crashes at
  startup** on the same syntax (`nom::ErrorKind::Eof`) — 9 of his 10 app routers, 46 coalesce sites
  in his corpus.
- Knock-on: his harness shimmed the mappings out to run at all, which also stripped our body-field
  defaulting and inflated his HTTP 422 counts (report problem 4).

**Cause:** emission is unconditional — nothing gates the coalesce syntax on the router version the
user targets, and no doc states the 2.15 minimum.

**Shape (decide first):** (a) document the minimum router version and keep emission as is, or
(b) version-gate the fallback (emit the plain mapping below a target version) — Adam suggests a
`--target-router` flag; ours would more naturally hang off the existing version plumbing
(`--connector-spec-version` / `--federation-version`, `src/versions.ts`). Gating changes output for
those targets, so it needs the corpus treatment (#109's precedent).

**Refs:** `src/oas/nodes/scalar.ts:56-59` (the R7 emission), `src/oas/nodes/propArray.ts:115`,
`ROADMAP.md` R7, `docs/FIXED.md #108, #109, #110` (corrections), Adam's benchmark report
(claude.ai/code/artifact/c79bb3ab, problem 5) and Slack thread (2026-08-24).

## 164 [BUG] [P4] · Tags/pinned args degrade to `String` where Rust emits `[String!]`/`Boolean` — ⬜ Open

**Example:** needs a repro — no failing OAS snippet in hand; likely an AppWorld spec's
`tags`/`pinned` query parameters (`type: array, items: {type: string}` / `type: boolean`).

**Symptom:** Adam's benchmark report, verbatim: "one known counter-fidelity nit: TS degrades
tags/pinned args to String where Rust emits [String!]/Boolean" — the only fidelity regression his
report found vs the Rust baseline.

**Cause:** unconfirmed. Candidates: array query params flattened by the join path
(`Params.arrayJoin` → `->joinNotNull(...)` writes a `String` arg), or a param schema shape falling
through to the `String` default in `param.ts`. Confirm with a repro before fixing.

**Refs:** `src/oas/nodes/param.ts`, `src/oas/utils/params.ts` (`arrayJoin`), Adam's benchmark
report (claude.ai/code/artifact/c79bb3ab, "caveats").
