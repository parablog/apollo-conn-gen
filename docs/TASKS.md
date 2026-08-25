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

## 160 [FEAT] [P4] · `--doc-response-fields`: operation docstrings omit the response fields, forcing agents to guess selections — ⬜ Open

**Example:** `getAuthTokens` docstring today: `Lists auth tokens (/auth/tokens)`. With the flag,
append the top-level result field names, e.g.

```
Returns a list of items with: id, value, expiresAt
```

**Why:** AppWorld benchmark feedback (Adam, 2026-08-24): GraphQL requires a subfield selection, and
agents guessed field names and retried until the shape stuck. Putting the fields in the docstring —
returned by the search/introspection call the agent already makes — was the single biggest lever in
the whole benchmark, fully closing the extra-turns gap vs baseline.

**Reference:** PR #8 (adamd-apollo, `parablog/apollo-conn-gen`) — reuse the flag, note format, and
cap; its evidence settles scope: a FLAT top-level field list alone closed the turns gap, so the
nested typed shape this entry originally sketched is not needed for v1. Do NOT copy:
- its duck-typed `unknown` casts (`response`/`itemsType`/`props` probing) — use the node model's
  `T` guards; Composed/Union fall through silently there, ours declines explicitly.

**Shape:** opt-in flag `--doc-response-fields` (plumbing like `skipOptionalArgs`); emission-only;
default output stays byte-identical.
- v1 handles exactly two shapes: `Res` → `Obj` (`Returns: …`) and `Res` → `Arr` → `Obj`
  (`Returns a list of items with: …`), unwrapped locally with `T` guards in one function in
  `src/oas/utils/schemas.ts` (same placement rationale as `docs/FIXED.md #159`; `entity.ts`'s private
  `unwrapToObj` stays private — extraction deferred).
- Anything else (scalar/JSON, Composed, Union, Map, …) → no `Returns` line via explicit early
  return — deterministic, never an accidental empty string. Composed/Union support is a separate
  follow-up only if a repro shows agents need it.
- First 14 field names, then `(+N more)`.
- Field spellings are the GraphQL-visible ones (`renamedTo ?? Naming.sanitiseField(name, keep)` —
  exactly what `prop.ts:37` writes), never wire names; matches `--keep-field-names` when on.
- Sites: the op docstring blocks `src/oas/nodes/get.ts:82-97` and `post.ts:77-89` (Put/Patch/Delete
  extend Post). Ordering (path, then `Params:`, then `Returns:`) falls out of insertion order —
  no combined #159+#160 test needed.
- Fixture `doc-response-fields.yaml` (own fixture — `inline-body-input-names.yaml` has only object
  `Ack {ok}` responses, no array): an object response `{id, name, created_at}`, an array of it, and
  a 16-field object pinning the `(+2 more)` cap.
- Preconditions met: #157 committed, #159 shipped (`docs/FIXED.md #159` — the adjacent docstring
  lines this entry writes next to).

**Refs:** `src/oas/nodes/get.ts`, `src/oas/nodes/post.ts`, `src/oas/utils/schemas.ts`, PR #8, the
codex-approved plan (`~/.claude-personal/specs/loop-nXHoSHEN/plan.md`). Adam's AppWorld benchmark
report (Slack, 2026-08-24).

## 162 [FEAT] [P5] · `--keep-field-names` still renumbers a `foo_bar`/`fooBar` twin pair — ⬜ Open

**Example:** `properties: { foo_bar: {...}, fooBar: {...} }` — both sanitise to `fooBar`. With
`--keep-field-names` on, the second one is still renamed to `fooBar2` instead of staying `foo_bar`.

**Why:** found scoping `docs/FIXED.md #158`'s fixture (kept deliberately free of twin pairs, so
this stayed out of that entry). `T.numberTwinFields` (`src/oas/nodes/typeUtils.ts:381`) decides the
collision by comparing `Naming.sanitiseField(prop.name)` with no `keep` argument, before either
prop's own kept spelling is ever written — so a name that `--keep-field-names` would otherwise keep
still loses to its sanitised twin.

**Shape:** not scoped yet. `numberTwinFields` is called through `selectedProps`, which none of its
five callers (`Obj`/`Composed`/`Union`/`entity.ts`/`sparseFieldsets.ts`) currently pass a context
to — threading `keep` through means changing that method's signature everywhere it's overridden and
called, a wider ripple than #158's one-line pass-throughs. Needs its own investigation and fixture
(two properties that sanitise to one field, one of them independently keepable).

**Refs:** `src/oas/nodes/typeUtils.ts`, `src/oas/nodes/obj.ts`, `src/oas/nodes/comp.ts`,
`src/oas/nodes/union.ts`, `docs/FIXED.md #158`.
