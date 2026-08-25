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
meant for it belongs there, not here. The 146 fixed/shipped ones live in `docs/FIXED.md`. Ids are
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

## 158 [FEAT] [P4] · `--keep-field-names`: preserve spec spellings that are already valid GraphQL — ⬜ Open

**Example:** `properties: { access_token: { type: string } }`
- today: `accessToken: String` in SDL, selection alias `accessToken: access_token`
- with the flag: `access_token: String`, no alias needed

**Why:** AppWorld benchmark feedback (Adam, 2026-08-24): agents see `accessToken` in the schema but
`access_token` in the upstream API docs, and burn search/introspection turns deciding which is real.
- `Naming.genParamName` camelCases every field/param unconditionally (`src/oas/utils/naming.ts:142-151`).
- The wire stays correct via aliases, but the schema no longer matches the spec's own vocabulary.

**Reference:** PR #6 (adamd-apollo, `parablog/apollo-conn-gen`) — reuse its flag plumbing shape and
keep-own-spelling guard idea; do NOT copy:
- its mutable static `Naming.keepOriginalNames` — gen is consumed as a library (web app), a static
  leaks across generations; thread `context.generateOptions` instead, no statics anywhere.
- its guard admits `__`-prefixed names (reserved in GraphQL) — exclude them.
- it ships no tests and no identity caution.

**Shape:** opt-in flag, plumbing like `skipOptionalArgs` (`src/cli/oas.ts` ~L165 block + opts map
~L99 + `GenerateOptions` field `oasContext.ts:37`); default output stays byte-identical.
- Guard: keep the spelling iff it matches `/^[_A-Za-z][_0-9A-Za-z]*$/`, doesn't start with `__`,
  and isn't `true|false|null`; sanitise as today otherwise.
- Mechanism: `genParamName`/`sanitiseField`/`sanitiseFieldForSelect` gain a trailing `keep = false`
  param; only spelling-writing call sites pass it. Type-name synthesis (`naming.ts:259/280`) and
  match keys (`params.ts:24/57`) stay canonical.
- Sites — SDL: `param.ts:81`, `prop.ts:37`, `propCircRef.ts:48`, `obj.ts:107` (`@key`).
  Selection: `prop.ts:86` `fieldForSelect()` gains a context param (6 one-line subclass callers);
  `propRef.ts:90`. Mappings: `obj.ts:184` (`$this`), `operationWriter.ts:159`, `:131`
  `templatedPath` gets context from `writeConnector:94`.
- 14 files, 11 of them one-line pass-throughs; ripple beyond this list → stop, back to codex.
- `sanitiseFieldForSelect` already emits no alias when sanitised === original (`naming.ts:192`).
- Narrowed contract: `numberTwinFields` (`typeUtils.ts:381`) keeps canonical dedupe, so a
  `foo_bar`/`fooBar` twin pair may still rename — file that as #162 during this entry's ceremony;
  keep twin pairs out of the fixture.
- **Identity** change under the flag (renamed nodes → new ids/paths): same `docs/DEFERRED.md #73`
  caution as `docs/FIXED.md #157`; no recovery code — selections under one flag setting are
  self-consistent.
- Fixture `keep-field-names.yaml`: fields `owner_id`, `created_at`, non-identifier `content-type`,
  reserved-ish `__meta`; query param `page_size`. Flag on: `owner_id` in SDL, bare in the selection,
  arg `page_size` spelled the same in queryParams; `content-type`/`__meta` rename exactly as today.
- Precondition: the #157 fix is committed first (its SHA is the failing-first baseline).
- Same fidelity-over-convention direction as the parked enum-casing decision (`docs/DEFERRED.md #143`).

**Refs:** `src/oas/utils/naming.ts`, `docs/DEFERRED.md #73, #143`, `docs/FIXED.md #1`, PR #6, the
codex-approved plan (`~/.claude-personal/specs/loop-nXHoSHEN/plan.md`). Adam's AppWorld benchmark
report (Slack, 2026-08-24).

## 159 [FEAT] [P4] · `--skip-arg-defaults`: document defaults as prose instead of executable SDL defaults — ⬜ Open

**Example:**
```yaml
parameters:
  - name: page_limit
    in: query
    schema: { type: integer, default: 5, minimum: 1, maximum: 20 }
```
- today: `pageLimit: Int = 5`
- with the flag: `pageLimit: Int` plus an op-docstring line `Params: pageLimit (default 5, min 1, max 20)`

**Why:** AppWorld benchmark feedback (Adam, 2026-08-24): agents treat a published SDL default as the
value to use — a pagination default of 5 against a max of 20 meant 4x more pagination calls.
Documented as prose, agents picked sensible values themselves.

**Reference:** PR #7 (adamd-apollo, `parablog/apollo-conn-gen`) — reuse the coupled design and the
`Params:` note idea; its benchmark warning is load-bearing: shipping the flag WITHOUT the prose
collapsed task completion 89.5 → 54.4 (the visible default was the only pagination signal), so both
halves ship together under ONE flag. Do NOT copy:
- its `Params:` note is emitted ungated — that changes default output; gate both halves on the flag.
- its bare try/catch around `getParameters()`; its dropping of empty-string defaults; its uncapped
  enum lists.
- its helper sits in `Naming`; ours goes in `src/oas/utils/schemas.ts` (see below).

**Shape:** one opt-in flag, both halves gated on it; default output stays byte-identical. Plumbing
like `skipOptionalArgs` (`src/cli/oas.ts` ~L165 + opts map ~L99 + `GenerateOptions`, `oasContext.ts:37`).
- Gate `writeDefaultValue` at `src/oas/nodes/param.ts:92` (context in scope).
- Write the `Params:` line inside the existing op docstring blocks `get.ts:82-96` / `post.ts:78-88`;
  extend the block-opening condition (`get.ts:82`) so a flag-only docstring still opens.
- Formatter: one function in `src/oas/utils/schemas.ts` beside `withJsonNote` (docstring-prose
  precedent; shared by two writers, so it lives in neither). Reads `default`/`minimum`/`maximum`/
  `enum` — first `minimum`/`maximum` read in the codebase. No try/catch; keep empty-string
  defaults; cap enums at 8 values then `(+N more)`.
- Names in the line come from `Naming.genParamName(name, keep)` — the same call `param.ts:81`
  makes — so prose always shows the GraphQL-visible arg spelling, never wire names (and matches
  `--keep-field-names` when that flag is on).
- Leave #156's per-argument JSON-degrade docstrings untouched (different channel, no merge needed).
- Fixture `arg-defaults-prose.yaml`: `limit` int default 20/min 1/max 100; `page_size` int default
  10; `sort` string enum `asc|desc` default `asc`; `q` string default `""`. Flag on: defaults
  stripped from args and the docstring gains exactly
  `Params: limit (default 20, min 1, max 100), pageSize (default 10), sort (default asc, one of asc|desc), q (default "")`.
  Ops with no constrained params get no line.
- Do after #158 (this entry's tests combine its flag for name spelling); precondition: #157 committed.

**Refs:** `src/oas/nodes/param.ts`, `src/oas/nodes/get.ts`, `src/oas/nodes/post.ts`,
`src/oas/utils/schemas.ts`, `docs/FIXED.md #17, #29` (the emission being gated), PR #7, the
codex-approved plan (`~/.claude-personal/specs/loop-nXHoSHEN/plan.md`). Adam's AppWorld benchmark
report (Slack, 2026-08-24).

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
  `src/oas/utils/schemas.ts` (same placement rationale as #159; `entity.ts`'s private
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
- Do after #159 (adjacent docstring lines); precondition: #157 committed.

**Refs:** `src/oas/nodes/get.ts`, `src/oas/nodes/post.ts`, `src/oas/utils/schemas.ts`, PR #8, the
codex-approved plan (`~/.claude-personal/specs/loop-nXHoSHEN/plan.md`). Adam's AppWorld benchmark
report (Slack, 2026-08-24).
