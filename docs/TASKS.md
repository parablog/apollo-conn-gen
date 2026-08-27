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
meant for it belongs there, not here. The 157 fixed/shipped ones live in `docs/FIXED.md`. Ids are
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

## 171 [BUG] [P2] · Motion mutation ops generate but fail compose — ⬜ Open

**Symptom:** motion.json mutation ops compose-fail: `GRAPH_QL_ERROR` ×4 (was five ops — the
`INVALID_BODY` one, `post:/v2/tasks/query`, was resolved by #170's fix, retested 2026-08-27).

- Repro: `post:/v2/views>**` — still failing after #170.
- Both bodies are saturated with #170's array-of-enum shape (nested wrappers whose only property
  is `value: [enum]`), but #170 alone didn't clear this class — something else is also wrong.

**Cause:** not yet traced.

**Refs:** `COVERAGE-mutations.md` gap histogram, `TEST_CORPUS.md` (Motion).

## 172 [BUG] [P4] · Array of non-identifier enum values is silently dropped from selection — ⬜ Open

**Symptom:** a `PropArray`-of-`En` field whose enum values aren't legal GraphQL names never appears
in a `>**` selection — the field just vanishes, no warning, no degrade.

**OAS:** (box.yaml) webhook `triggers` — values like `"FILE.UPLOADED"` fail `GqlUtils.isGqlEnum`
(a `.` isn't legal in a GraphQL name); omni.yaml has the same shape with `:`.
```json
{ "type": "array", "items": { "type": "string", "enum": ["FILE.UPLOADED", "FILE.DELETED"] } }
```

- Repro: any spec with an array-of-enum property whose values contain `:`/`.`/spaces — omni and
  box both have one.

**Cause:** #170's leaf guard (`typesCollector.ts`) skips a `PropArray`-of-`En` whose values fail
`GqlUtils.isGqlEnum`, on purpose — an illegal name written raw is what broke omni/box's SDL. But
the guard just excludes the field from selection instead of degrading it, the same silent-drop
behavior #24 already solved for scalar enum fields.
- Right fix: reuse #24's degrade — emit the base scalar (`[String]`) instead of skipping the
  field — or sanitize the illegal values in `En.generate()`.

**Refs:** `src/oas/generator/typesCollector.ts` (the guard), `src/oas/nodes/en.ts` (`generate`),
#24 (scalar-enum degrade precedent), #170 (introduced the guard).
