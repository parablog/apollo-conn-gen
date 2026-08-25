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
meant for it belongs there, not here. The 151 fixed/shipped ones live in `docs/FIXED.md`. Ids are
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

## 165 [BUG] [P2] · Below the `??` version gate, a real payload value is silently replaced by its OAS default — ⬜ Open

**Example:** `--federation-version v2.13` (below the R7 gate) on `coalesce-floor.yaml`'s
`tag: { type: string, default: latest }` emits `tag: $("latest")` — the response's real `tag`
value is discarded and every request answers `"latest"`, even when the API actually returned
something else.

**Symptom:** `scalar.ts:60-62`'s else-branch (the pre-gate fallback for `??`) reuses the same
`$(value)` literal-replacement form the synthetic `success` field uses on purpose — but here
there's a real field to read from and it's never referenced. Zero test coverage: every existing
default-value test composes at/above the v0.4 + v2.14 gate, so the else-branch has never been
exercised for a real (non-synthetic) field.

**Knock-on:** `propArray.ts:116-117` skips the `?` optional-marker on an array item that has a
default, reasoning "items with a default cover a missing key" (`#16`) — true only when the default
actually coalesces. Below the gate, the default *replaces* the value instead, so a genuinely
missing key stops being marked at all.

**Cause:** the gate at `scalar.ts:58` decides which literal form to emit but the else-branch was
written before the `??` coalesce form existed (replacing was the only option then) and was never
revisited once `??` shipped — `#165` was carved out of `#163` specifically to keep the router-floor
docs fix from also having to fix this pre-existing, unrelated defect.

**Repro:** `coalesce-floor.yaml` (`docs/FIXED.md #163`'s fixture — no maps, no `?` markers, so
`??` is the only pre-2.15 syntax at stake) generated with `--federation-version v2.13`.

**Acceptance:** the bare field is emitted plain (`tag: tag`, no literal), matching what a field
with no default at all would emit; the synthetic `success` field is unaffected and keeps its pure
`$(true)` (`scalar.ts:49-51`); `propArray.ts`'s `?` marker re-applies to a defaulted array item
once its owning field is below the gate.

**Refs:** `src/oas/nodes/scalar.ts:56-62`, `src/oas/nodes/propArray.ts:115-117`, `docs/FIXED.md
#163` (the router-floor issue this was split from).
