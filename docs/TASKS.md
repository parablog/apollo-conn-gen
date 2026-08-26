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
meant for it belongs there, not here. The 153 fixed/shipped ones live in `docs/FIXED.md`. Ids are
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

## 161 [FEAT] [P4] · Entity link half: key-only reference fields on id-carrying types — ⬜ Open

**Plan (adopted 2026-08-26):** `~/.claude-personal/plans/issue-161.md` — the loop pickup follows it.
Settled there: automatic coupling to the flag (no new flag) · link nullability matches the source
scalar · self-link guard (`host !== target`) · regex singularizer (irregular plurals unhandled).

**Example:** `Song { album_id }` plus an R1-resolved `Album` → emit a `Song.album: Album` field
selecting `album: { id: $.album_id }`, so the router can traverse song → album through the
type-level resolver.

**Why:**
- `--infer-entity-resolvers` emits the resolver half only (`@key` + type-level `@connect`,
  `entity.ts` / `obj.ts` `writeEntityConnector`); nothing links to it, so cross-type traversal
  queries don't exist.
- Measured (Adam, 168-task AppWorld runs): agents used the link fields organically in 76-85% of
  tasks; read-side N+1 orchestration moved entirely to the router; part of the sonnet accuracy
  fix-set.
- Caveat to carry into the design: one agent call fans out N concurrent upstream requests —
  connector concurrency limits need setting deliberately.

**Shape (decided — Adam's description, 2026-08-26; his prototype is a ~190-line post-generation
SDL transform, not generator code):**
- Coupled to `--infer-entity-resolvers`: link fields only target types R1 resolved.
- Match: a root GET whose path ends in exactly one path param ↔ any emitted object type carrying
  a scalar field with that exact name. Exact-name only — no fuzzy matching, no kept-spelling
  variants.
- Emit a **key-only** link field: named from the singularized last static path segment
  (`/songs/{song_id}` → `song`), typed as the by-id op's response type, selection maps just the
  key and lets the type-level resolver complete the entity.
- NOT the prototype's shape (duplicated http + selection per link) — Adam's own recommendation.
- Guards, ported: skip if the field name already exists; skip ops with required args beyond the
  path param; skip placements where the target type can reach the host type through the SDL type
  graph (composer `CIRCULAR_REFERENCE` — he hit it on spotify albums⇄songs).
- His per-call `access_token` argument wart doesn't apply here — `@source`-level auth.

**Risk area:** the reachability guard walks the SDL type graph — the satisfiability/pruning
territory that shaped R2's limits (never-returned types, partial-provider field keeping).

**Refs:** `src/oas/nodes/entity.ts`, `src/oas/nodes/obj.ts` (`writeEntityConnector`), Adam's
Slack follow-ups (2025-08-25/26 — Python transform file requested) and benchmark report
(claude.ai/code/artifact/c79bb3ab).
