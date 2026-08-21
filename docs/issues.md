# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry instead of carrying the full rationale inline. Every entry has an **OAS:** snippet
showing the input schema that triggers it, a concrete **before → after** example, and an **AST:**
note stating how (or whether) the node tree changed.

**This file holds the open entries only.** The 107 fixed ones live in `docs/FIXED.md`. Ids are
global and never reused, so `#N` means the same entry in both files:
- open — `// see docs/issues.md #N`
- fixed — `// see docs/FIXED.md #N`

When an entry is fixed, move it to `FIXED.md` (with its fixture under `tests/resources/oas/` and
its test) and repoint the comments that cite it.

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` tracks priority/gaps and may link to these ids.

Style: keep entries scannable — short labeled bullets, **one fact per line**, example near the top;
no paragraph-blobs. The example carries the weight; prose only adds what the example can't show.

Status: ⬜ Open · 🔴 Open · 🟡 Partly done · ⏸ Parked (blocked on an external gate) · 📋 Noted.

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

---

## 13 · Path-dependent cycle cuts make same-named instances diverge — 🟡 Donation replaced: #89 removes the field everywhere
**Symptom:** with #10 + #12 in place, Confluence abstract fails compose with
`SELECTED_FIELD_NOT_FOUND: selection contains field 'history', which does not exist on 'Space'`.

**OAS** (Confluence — `Space` carries refs that re-enter `Content`/`User` only on *some* paths):
```yaml
Space:
  properties:
    homepage: { $ref: '#/components/schemas/Content' }   # cut when Space sits under Content
    history:
      type: object
      properties:
        createdBy: { $ref: '#/components/schemas/User' } # cut when Space sits under User
```
**Example** — two `Space` instances in one op:
```
path A (under Content): Space { # history — cut }      path B: Space { history: SpaceHistory }
emitted (first wins):   type Space { # history … }     selection (path B): … space { history { … } }
                        → SELECTED_FIELD_NOT_FOUND     goal: emitted Space = union → history survives
```

**The two routes** (`get:/wiki/rest/api/content/{id}/restriction`, re-checked 2026-07-30). They part
company at `ContentRestriction`, and only the first one travels through `Content` — which is what
makes `homepage` loop back and get cut there:
```
… >obj:type:#/c/s/ContentRestriction>prop:obj:content>obj:type:#/c/s/Content>prop:obj:history> …
  … >obj:type:#/c/s/User>prop:obj:personalSpace>obj:type:#/c/s/Space>prop:circular-ref:#homepage
… >obj:type:#/c/s/ContentRestriction>prop:obj:restrictions> … >obj:type:#/c/s/UserArray
  >prop:array:#results>obj:type:#/c/s/User>prop:obj:personalSpace>obj:type:#/c/s/Space>prop:obj:homepage
```
The field it bites **today** is `homepage`: across all 65 confluence GET ops, `Space.homepage` is cut
351 times and `Space.history` never — `history` keeps its slot and the cut inside it lands on
`history.createdBy`. The June symptom above quotes `history`; same mechanism, different field.

**Cause:**
- #10's cycle cut is **per expansion path**: `Space` under a `Content` ancestor has `history`/`homepage`
  cut; a `Space` instance on a path without that ancestor keeps them.
- The writer emits **one** `type Space` (collector keeps the first instance per id).
- The op's selection is the union of all paths → a selection from an un-cut instance can reference a
  field the emitted (cut) instance commented out.

**Proposed fix:** when the collector meets an already-collected id, **merge props** — per prop name,
prefer the non-`PropCircRef` version. Then:
- emitted type = union of surviving fields → every selected field exists (no `SELECTED_FIELD_NOT_FOUND`);
- every union field is selected on at least the path it came from (no `CONNECTORS_UNRESOLVED_FIELD`);
- props cut on *every* path stay commented.

**AST (proposed):** no new nodes — a collect-time prop merge on the kept instance.

**Fix (2026-06-11 — incorporates the lessons of the reverted 06-10 attempt):**
- The routes are already spelled out in the final selection, so no extra bookkeeping: for each
  field a node lost to a cycle cut, find a selection path that carries the real field under the
  same type id (`>obj:type:X>prop:…:name`, in the `#/c/s` short form `path()` writes) and walk
  it to its node with the existing `collectPaths`.
- **SDL-only:** the found node goes into `context.sdlPropOverrides`
  (`Map<writtenInstance, Map<fieldName, node>>`), read by `Obj.generate` only — every route's
  selection keeps its own "field removed" comment. Mutating `props` instead leaked the field
  into the cut position's selection → rover `CIRCULAR_REFERENCE`.
- **Selection-guarded by construction:** the replacement comes FROM the selection, so a field
  nobody selects is never added to the SDL (`CONNECTORS_UNRESOLVED_FIELD`, caught by
  `test_040` AdobeCommerce).
- Runs after the collect loop, once `expanded` is final. (A first version tracked instance
  pairs during the loop — the same pair is met once per route and confluence has thousands,
  so it went quadratic and hung the sweep. Deriving from `expanded` avoids the whole class.)

**Measured:** confluence abstract `SELECTED_FIELD_NOT_FOUND` 8 → 1; the unblocked ops now fail
on the **R2 discriminator-less-union wall** (`GROUP_SELECTION_IS_NOT_OBJECT` on
`ContentMetadata.labels: LabelsUnion`, 14 ops) — net pass-rate unchanged (69.2% both passes)
until that R2 gap is fixed. Full corpus byte-identical otherwise (zero regressions, both
passes). box's 9 INTERNAL_ERROR ops confirmed a *different* mechanism (referenced-but-unemitted
`Folder--Mini`, R-collector family) — untouched by this merge.

**Status update (2026-08-14).** The R2 wall named above is gone, so it is no longer what holds
these ops back. Confluence is at 93.8% (61/65 GET) and three of its four failures are now
`CONNECTORS_UNRESOLVED_FIELD` on `Content.space` — the same divergence, raising the opposite
error. The guard this entry relies on ("every union field is selected on at least the path it came
from") is not enough: the composer wants the field provided at every position the type appears.
Written up as #89.

Fixed by #89 (see docs/FIXED.md): the donation is gone — a field removed on some routes but kept
on others is now removed on every route and in the SDL, so the instances cannot disagree.

**Refs:** `src/oas/generator/typesCollector.ts` (`consolidateRemovedFields`), `src/oas/oasContext.ts`
(`propOverrides`), `src/oas/nodes/obj.ts` (generate/select/dependencies). See docs/FIXED.md #89.

## 49 · A request body that reaches a big shared model makes composition run out of memory — ⬜ Open

**Symptom:** a write op whose request body pulls in a large, self-referencing model generates a
schema rover cannot compose in bounded memory: the composing process grows by about 2 GB every 5s
(16 GB at 45s) and never finishes. It reached 60–75 GB and took the machine down twice. Three
`confluence.json` ops do it, e.g. `put:/wiki/rest/api/content/{id}/child/attachment/{attachmentId}`.
Generation itself is fine and fast — 293K of SDL in about a second, 70 MB of heap (all 65 of that
spec's mutation ops generate in one process with a 310 MB peak).

**OAS** — the body looks small, but `version` reaches the whole content model:
```yaml
AttachmentPropertiesUpdateBody:      # the request body: 8 fields
  properties:
    id:        { type: string }
    title:     { type: string }
    container: { $ref: '#/components/schemas/Container' }
    version:   { $ref: '#/components/schemas/Version' }   # <- the door

Version:
  properties:
    content: { $ref: '#/components/schemas/Content' }     # <- the whole model

Content:                                                   # refers to 12 schemas, itself included
  properties:
    ancestors: { type: array, items: { $ref: '#/components/schemas/Content' } }
    children:  { $ref: '#/components/schemas/ContentChildren' }
    space:     { $ref: '#/components/schemas/Space' }
    version:   { $ref: '#/components/schemas/Version' }   # <- back to where we came from
    ...
```

**Example** — what one op writes:
```graphql
# 173 definitions for a body of 8 fields:
type ... x86         # the response side
input ... x87        # the same model again, as input types
# and one @connect body selection of 134,402 characters
```

**Measurements (all on that one op):**
- 86 output types + 87 input types, 293K of SDL.
- The `@connect(http: { body: ... })` selection is **134 KB in a single directive** — nearly half the file.
- 191 fields were dropped as cycle cuts (`# … - circular reference omitted`), and cycles still
  survive on **both** sides: `User -> Space -> SpaceHistory -> User` among the output types,
  `ContentInput -> ContentHistoryInput -> UserInput -> SpaceInput -> ContentInput` among the inputs.
  (Recursive types are legal GraphQL — this is listed as a fact about the output, not as the cause.)

**Not caused by #48** (checked, because that fix landed just before this appeared). The same op
generated with the pre-#48 union id is byte-identical except for 10 lines — the `type LabelsUnion`
definition that used to be missing. Both have the same 87 input types. What changed is only how far
rover gets: the old schema referenced an undefined type, so it was rejected at parse time
(`INVALID_GRAPHQL`, 4.2s); the corrected schema is valid, so composition actually starts, and that is
what runs out of memory. The op failed before and fails now — only the bucket changed.

**Cause:** not yet established. Two candidates, in order of suspicion:
1. the 134 KB body selection — its size, not the schema's;
2. the size of the input-type graph itself (87 types, 104 references between them).
Bisecting them apart is the next step: compose the same schema with the body selection trimmed, then
with the input types trimmed, and see which one changes the memory curve.

**Mitigation (not a fix):** `tools/coverage-spec.mts` now gives each compose a 30s deadline and kills
rover **and its `supergraph-<version>` child** (`pkill -9 -P` before killing rover — the child is
reparented and unfindable once the parent is gone, and `child_process.exec` silently ignores
`detached`, so a process-group kill does not work here). A runaway op now scores
`COMPOSE-FAIL [TIMEOUT]` instead of ending the sweep. Big schemas (≥200K) also compose one at a
time — eight of these at once is what turned 8 GB into 60 GB.
A `TIMEOUT` is wall-clock, so it depends on the machine and what else is running: 30s is about ten
times a normal compose and the big ones no longer compete with each other, but read a new one as
"look at this op", not as proof on its own.

**Evidence kept:** `/tmp/qbo-after.graphql` (current) and `/tmp/qbo-before.graphql` (pre-#48) —
the pair the comparison above is based on; `/tmp/oas-coverage-keep/` holds the harness's own
`schema-4.graphql` + `supergraph-4.yaml` for the same op.

**AST:** none — the node tree is not involved. Generation produces the same tree it always did; this
is about how much SDL that tree writes for a body, and what composition then costs.
**Refs:** `tools/coverage-spec.mts` (the deadline and the size split). Related: #48 (the fix that
made this op reach composition at all — not its cause), #10 (the cycle cuts that fire 191 times here
and still leave cycles behind), and `confluence.json post:/wiki/rest/api/content/{id}/copy`, the only
`CIRCULAR_REFERENCE` in the corpus, which may be the same shape seen from the response side.

## 54 · The same "what does this operation give back" walk is written four times — 📋 Noted, not fixed

**Symptom:** four places walk the operation's result node the same way, each with its own copy of
the unwrap. They agree today, but nothing keeps them in step.

| Where | Unwraps to | Extra it does |
|---|---|---|
| `typeUtils.ts` `T.responseType` | the response node, list kept | — |
| `typeUtils.ts` `T.responseItemSchema` | the item's OAS schema | takes lists off |
| `batch.ts` `responseItem` | the item object | also handles a `{ results: [Product] }` wrapper, returns a `BatchTarget` |
| `entity.ts` (around :49) | the response node | reads it for entity resolvers |

**OAS** — the two shapes they all have to cope with, e.g. (petstore) and (R6 fixtures):
```yaml
# a plain list
responses: { '200': { schema: { type: array, items: { $ref: '#/c/s/Pet' } } } }
# a wrapped list
responses: { '200': { schema: { properties: { results: { type: array, items: { $ref: '#/c/s/Product' } } } } } }
```

**The node graph they walk:**
```
get:/pet/findByStatus
 └─ res:r
     └─ array:#/components/schemas/Pet
         └─ obj:type:#/components/schemas/Pet
```

**Cause:** the walk grew where it was first needed and was copied each time another pass wanted it.
`allOfBase.ts` had two copies of its own; those now call `T.responseType`, which is what surfaced
the rest.

**Why it is worth fixing:** the four differ in how far they unwrap, and that difference is load-bearing.
`allOfBase` asks whether an operation gives back a union, so it must NOT see through a list; the linter
asks what shape one item has, so it must. Folding them together carelessly changes which unions R2
promotes — that near-miss is pinned by `test_oas_responseType_keeps_the_list_wrapper` in
`tests/all/oas-core.test.ts`.

**Not done because:** `responseItem` returns a `BatchTarget` with the wrapper field name attached, so
it is a bigger change than the `allOfBase` swap, and it is working code on the R6 batch path. Left for
a quieter moment.

## 61 · `@type` and `type` on the same object both emit as `type` — ⬜ Open

**Symptom:** composition fails with `INVALID_GRAPHQL: Field type already exists on
Customer360PromotionVO`. The written type carries two `type` fields.

**Also on the input side (2026-08-12):** since #74 resolves `$ref`'d request bodies, TMF717's
three `post:/listener/…` ops fail the same way inside `Customer360PromotionVOInput` — the
mutations sweep counts them under INVALID_GRAPHQL. One fix covers both directions.

**OAS:** (TMF717) every entity extends `Extensible`, whose tag field is `@type`; the promotion
object also has a business field literally named `type`:

```yaml
Extensible:
  properties:
    "@type": { type: string }        # "the sub-class Extensible name"
Customer360PromotionVO:
  allOf:
    - $ref: '#/components/schemas/Entity'   # Entity -> Extensible -> @type
    - type: object
      properties:
        type: { type: string }       # "Type of promotion. The basic type is Award/Discount/…"
```

**Cause:** `@type` is sanitised to `type` for GraphQL (the selection keeps the raw key through an
alias, `type: "@type"`), but nothing checks the sanitised name against the object's other fields.
The allOf fold then puts both props on one type and each writes its own `type:` line — the
selection duplicates the same way.

- `@baseType`/`@schemaLocation` sanitise cleanly (no plain `baseType` field beside them), so only
  `@type` + `type` collides
- accounts for the corpus's only 2 remaining `INVALID_GRAPHQL` ops (both TMF717 customer360 reads)
- pre-existing: reproduced identically on the pre-#57 baseline

**Test:** `test_61_sanitised_at_type_must_not_collide` in `tests/all/oas-core.test.ts`, failing as
todo — asserts the op composes.
**Refs:** #42 (the alias machinery involved), #57 (whose corpus sweep surfaced it).

## 73 · Node ids embed emitted names, so visit order changes selection identity — ⏸ Parked (stripe trigger fixed 2026-08-19; identity-drift core still open, untested)

**Symptom:** the same schema node gets a different id depending on what was expanded before it —
so a stored selection path (web localStorage, a test pin) can stop matching, and #72's recovery
only catches the positions with a single possible target. Measured on digitalocean: of ~415
`allOf`/`oneOf` member edges, ~130-150 differ between two browse orders, three ways at once —
`Inline2`-style minted names appear or not, the same member is reached through different `$ref`
pointers, and `[inline:…]` names shift because the PARENT's name shifted.

**Example** (digitalocean — one member, three identities):
```
comp:type:Jobs -> obj:type:#/paths/…/services/items/allOf/0     # one browse order
comp:type:Jobs -> obj:type:JobsServices                          # another
comp:type:SpecServices -> obj:type:[inline:SpecServices]:2       # the parent renamed too
```

**Cause:**
- An id is `class:kind:<name>`, and `<name>` is whatever the node ended up called — collision
  renames (#12/#22) and minted inline names both depend on what was visited first.
- Selection paths are built from ids, persisted (web localStorage) and pinned (tests), so
  identity leaks out of a single run. #71 made runs deterministic; order across the browsed tree
  and the generation run still differs.

**Parked (2026-08-11), after sizing both cures.** The shipped floor (#71 fresh state per
generation, #72 single-target recovery) covers every failure actually observed. Both full cures
were designed, measured, and set aside:
- **Structural ids** (position-based): zero emitted churn, but a stored path becomes positional
  at every step, so it needs a version tag, a spec hash and per-step staleness data — plus a
  coordinated web release. The machinery outweighs the problem.
- **Deterministic naming** (a name with several shapes never wins the short form): a first slice
  over property keys was implemented and measured — box drift fell 378 -> 297 name families, but
  digitalocean's did NOT move (1,486 -> 1,519). Bucketing the drifting names showed why: 84% are
  cascade renames whose roots are array-item names, `allOf` member minting and the DEDUP order
  itself (two browse orders build 2,111 vs 2,320 nodes). Making all of that order-independent is
  a rewrite of the naming policy with heavy, user-visible renames (530+ families, concentrated in
  stripe/github). Slice reverted.

**Wake this issue when** a member-list selection actually breaks in real web use — then pick the
cure knowing which cost hurts less in practice.

**Reactivated (2026-08-17) — the wake condition just fired, for real, on real Stripe.** Not web
use, but the same mechanism: generating the curated 34-operation selection
`graphos-service-factory/service-catalog/stripe/manifest.yaml` actually uses in production
(`tests/resources/oas/stripe-curated.yaml` + `stripe-curated-selection.json`, pinned as fixtures)
fails `rover supergraph compose` with **1161 `CONNECTORS_UNRESOLVED_FIELD` errors**. 605 of those
(9 distinct name families) are this issue exactly:

```graphql
type Stripe_SubscriptionItemDiscountsUnion { #### replacement for Union SubscriptionItemDiscountsUnion
  checkoutSession: String
  ... # 12 fields, byte-identical to the block below
}
type Stripe_SubscriptionItemDiscountsUnion2 { #### replacement for Union SubscriptionItemDiscountsUnion2
  checkoutSession: String
  ... # same 12 fields, same doc-comments, different name
}
# ...up to Union10 — 10 structurally-identical copies of one shape, one name each
```

Only the unsuffixed instance (`SubscriptionItemDiscountsUnion`, no number) keeps a connector that
resolves it; `Union2` through `Union10` are declared with the real field set but zero connector
resolves any of them — exactly "a member-list selection actually breaks," now with a concrete,
reproducible, real-vendor-spec trigger rather than a synthetic one. The other 8 families hit are
`AccountTaxIdsUnion` (×9), `SourcesDataUnion`/`DataUnion` (×4 each), `InvoiceDiscountsUnion`,
`InvoiceAccountTaxIdsUnion`, `SubscriptionTypeDiscountsUnion`, `SubscriptionsResourceSubscription…
AccountTaxIdsUnion`, `LineItemDiscountsUnion` — all the same pattern: one canonical name works, its
numbered twins don't.

**Not yet separated from this issue: the other ~556 errors.** Types that are *not* duplicate-named
(e.g. `Stripe_TaxId`, declared exactly once, still 11 unresolved fields) also fail, on types shared
across several operations (here, `Customer` and the merged `V1CustomersByCustomerResponse`, reached
from ~6 different curated operations). Traced 5 of the ~6 reachable positions and found complete
selections at every one — the 6th (not yet found) likely has no selection reaching that field at
all, which is `#13`'s exact "every position needs its own complete selection" mechanism, not this
issue's naming collision. `#13`'s own record says that mechanism was fixed by `#89` for Confluence's
case; whether the fix generalizes to Stripe's shape, or a residual gap remains, needs isolating
before filing separately — flagged here rather than guessed at.

**Parked again (2026-08-17, same day) — later found wrong, see the 2026-08-18 correction below.**
The claim at the time was: the stripe trigger was not this issue's identity drift — it was the
in-flight #104 guard renaming *identical* union twins apart (they only ever converged by id
accident before). `sameSchemaAs` now reads a union's member list and tag as its shape, so identical
twins converge on one name. The claim that this made the curated selection compose with **zero**
errors, including the ~556 "unseparated" ones, was **wrong** — see below.

**Correction (2026-08-18).** The "zero errors" test result was a false positive: the test never
pinned `composeFederationVersion`, so `compose()`'s own default (`2.15.1`, `src/tests/runners.ts`)
didn't match the `v2.13` this schema's `@link` declares. A federation-version mismatch doesn't fail
loudly — it makes rover silently validate less (the same trap documented in #109's methodology
note, found independently the same day on Omni: the identical schema went from 359 errors to 19
with zero version-mismatch complaint). Re-run with `composeFederationVersion: '2.13.0'` pinned to
actually match, the real count is **453 `CONNECTORS_UNRESOLVED_FIELD` errors** — not zero. #104's
fix is real and did cut the total from 1161 to 453 (the duplicate-named-twin families it targets
are gone from the list), but the ~556 "unseparated" errors flagged above were never resolved; they
were undercounted, not fixed. `test_73_curated_multi_op_stripe_selection_composes` and
`test_corpus_stripe_curated_production_selection` are both back to `{ todo: ... }`, both showing
the real 453. The identity-drift core of this issue — ids embedding names, browse-order divergence
— was never touched and stays open on the same "member-list selection breaks in real use" trigger,
now with an accurate count instead of a false all-clear.

**Refs:** `src/oas/nodes/*.ts` (`get id()` per class, `withUniqueName`), `src/oas/generator/typesCollector.ts`,
#71/#72 (the shipped floor), #12/#22/#9 (the rename machinery), #13/#89 (a candidate mechanism for
the remaining 453, still not isolated), #109 (the same federation-version methodology trap, found
independently the same day). Fixtures: `tests/resources/oas/stripe-curated.yaml`,
`tests/resources/oas/stripe-curated-selection.json` — found running
`graphos-service-factory/scripts/gen-ts.mjs`, that repo's wrapper comparing TS `gen` against
`tools/connect-gen`, the Rust fork it currently uses.

**Correction (2026-08-19).** The 453 `CONNECTORS_UNRESOLVED_FIELD` errors above were themselves a
second methodology artifact, not a real generator defect: the test pinned `composeFederationVersion:
'2.13.0'` to match the schema's declared `@link` version, on the premise that they "MUST match."
That premise was wrong — composition tooling is backward-compatible with older `@link` declarations
by design, and pinning below 2.15 loses two already-fixed-upstream credits (`docs/FIXED.md` #14's
`->entries` map transform, #16's `field? { nested }` optional marker), which is what actually
produced the cascade of unresolved fields. Composing the same, byte-identical generated SDL at
`2.15.1` instead gives **zero** errors — confirmed directly (`test_73_curated_multi_op_stripe_selection_composes`
now passes, un-todo'd, `composeFederationVersion: '2.15.1'`). This issue's own identity-drift
mechanism (ids embedding names, browse-order divergence) was neither proven nor disproven by this —
it stays open here as a separate, untested concern, parked until something exercises it for real
again. See #109's matching 2026-08-19 correction — the same version-pin mistake, found the same day
on a second schema.

## 79 · Published plugin rejects `->match`-driven union selections — 📋 Upstream, awaiting a release

**Symptom:** the last `GRAPH_QL_ERROR` sweep residue: launch_library
`get:/2.3.0/dashboard/starship/` fails on stock rover with `No matching shape found for selection.
Attempted 3 different shape variations and all failed` — the 3 matches the union's member count.

**Example** (generated output — a 3-member union discriminated by `->match`):
```graphql
union PolymorphicStarshipDashboardEndpoint = StarshipDashboardList | StarshipDashboardNormal | StarshipDashboardDetailed
... response_mode->match(
  ["list", { __typename: $("StarshipDashboardList"), … }],
  …
)
```

**Evidence it is upstream, not ours:** the same schema (today's sweep leftover `schema-115`)
composes clean through `tools/local/apollo-federation-cli` (patched, newer router code) and fails
only through the published supergraph plugin 2.15.1. Same pattern as #14 (`->entries` crediting):
validation gap fixed in router source, not yet in a released plugin.

**Next step:** nothing generator-side. Re-check this op when a supergraph plugin newer than 2.15.1
ships; if it still fails there, find the router fix commit and reference it here.

## 106 · The selection linter checks selections against the spec, not against the emitted type — 📋 Noted, not fixed

**Symptom:** docs/FIXED.md #105 generates a selection referencing a field (`deleted`) that is real in the
OAS spec (`deleted_discount.deleted`) but absent from the GraphQL type the emitter actually wrote
for the merge (`Stripe_DiscountsUnion`) — and the corpus lint gate (`tools/lint-corpus.mts`, which
runs `lintSelections` over every op of every corpus spec) reports it clean anyway.

**Cause:** `PathInResponseCheck` (`src/oas/lint/README.md`, "Stage 3 — the checks") walks a
selection path against the operation's real response schema via `ResponseShape`, which answers
"is this a real field somewhere in the API's response shape" — not "does this field survive on
the type the emitter actually wrote for this merge." For a plain object those two questions have
the same answer. For a merged/collapsed union (`Union.isFlat()`, `generateMergedObject`) they can
diverge: a field can be legitimate on one `anyOf`/`oneOf` member and still be missing from the
merged type if that member got dropped or its field didn't survive the merge — exactly what #105
hits. The check is answering the right question for every other node kind and the wrong one for
this specific case.

**Fix (not done):** add a check (or extend `PathInResponseCheck`) that, for a selection scoped
under a flat/merged union, also validates against `SchemaReader`'s parsed *emitted* type (already
available — it's the same document the linter is reading the selection out of) rather than only
against the spec. This would have caught #105 — and any future instance of the same class — before
generation, not at `rover compose` time on a real production spec.

**Refs:** `src/oas/lint/README.md` (Stage 3, `PathInResponseCheck`, `ResponseShape.look`),
`src/oas/lint/schemaReader.ts` (the emitted-type parse this fix would read from),
`tools/lint-corpus.mts` (the gate that currently passes #105's case clean). Surfaced alongside
#105, same investigation.

## 115 · Enum dedup is only tested inline, and the raw enum list keeps its doubles — ✅ Covered (2026-08-18, coverage-only)

- the untested routes were already correct (every construction path passes the `En` constructor's
  dedup): pinned by `test_115_enum_dedup_holds_on_ref_component_and_input_routes`
  (fixture `duplicate-enum-values-routes.yaml`) — $ref'd component enum + input-position reuse.
- `schema.enum` normalization declined: writing `En.items` back would mutate the shared
  `lookupRef` `SchemaObject` instance and change `sameSchemaAs` convergence — two enums differing
  only in duplicate patterns would start converging. Not output-identical-safe.
- writing the coverage found #120: a bare `$ref`-enum response drops its whole operation.

**Refs:** `src/oas/nodes/en.ts`, `docs/FIXED.md` #102, #120. Review §1. No code change, so the
entry stays here rather than moving to FIXED.md.

## 117 · Union convergence ignores the discriminator mapping — 📋 Noted

**OAS** (the shape that would trip it — two same-member unions, mappings differ):
```yaml
discriminator:
  propertyName: kind
  mapping: { a: '#/…/TypeA' }   # vs  mapping: { a: '#/…/TypeB' }
```

- `sameSchemaAs` compares a union's members and `discriminator` (the property name) but not the
  `mapping` block, so two such unions would converge on one type.
- theoretical: no spec in the corpus produces it; needs a same-side, same-name, same-members,
  mapping-only-differs repro before code.

**Refs:** `src/oas/nodes/typeUtils.ts` (`sameSchemaAs`), `docs/FIXED.md` #73/#104. Review §5.

## 119 · Residual path()-cost hotspots left after #118 — 📋 Noted

#118's fix removed the costs that broke the 5-minute bound; these four were measured, found
non-blocking (full HubSpot lists run is 18.9s), and deferred:

- eager trace args: `OasGen.expand`/`Type.expand` build `path()` strings for `trace()` even when
  the CLI no-op'd `console.log` (~10s residual at 30-op scale) — needs a look at how library
  consumers enable tracing before any gate ships
- `side.path()` re-computed inside a `.some` callback at `typesCollector.ts:333` (~9M calls)
- dead `const tree = T.print(this)` whole-subtree string builds at `comp.ts:149`/`:207`
- the collect walk re-resolves each expanded path from the root (~1.4s) — a path→node map carried
  out of `collectExpandedPaths` would remove it, but it is the only structurally risky change
  (wildcard `*`, #72 recovery, insertion order) and not worth it at current scale

**Refs:** docs/FIXED.md #118 (the measurements), `src/oas/log/trace.ts`, #73 (why `path()` must
not be memoized globally). The fourth bullet becomes moot under ROADMAP.md R15 (selection
externalisation), which replaces the representation these costs live in.

## 122 · All-ops sweep findings: four cross-op failure classes invisible to per-op coverage — ⬜ Open (umbrella)

**Symptom:** first sweeps with the all-ops column (2026-08-18): six spec/verb combos are per-op
100% and red combined. Umbrella entry — a class gets its own number when someone picks it up.

| class | where | first read |
|---|---|---|
| `INVALID_BODY` ×52 | digitalocean ×36, docker ×10, sendgrid ×6 — mutations only | ✅ fixed by #123 — digitalocean's all-ops now surfaces `CONNECTORS_UNRESOLVED_FIELD` (previously masked, see #124) |
| `SATISFIABILITY_ERROR` | asana ×12 GET / ×30 mutations | composition-level: shared types reachable from several roots with disagreeing fields |
| `GRAPH_QL_ERROR` + `SELECTED_FIELD_NOT_FOUND` | box ×34 GET / ×18 mutations | the SELECTED_FIELD_NOT_FOUND part smells like #13/#89 position divergence at cross-op scale |
| `INVALID_GRAPHQL` ×2 | digitalocean GET | likely a cross-op duplicate definition — smallest, easiest isolate |

- launch_library `GRAPH_QL_ERROR ×2` is the known #79 upstream op riding along — not new.
- #121 (union top-level + nested), the already-isolated member of this family — ✅ fixed, see docs/FIXED.md #121.

**Refs:** COVERAGE.md / COVERAGE-mutations.md `all-ops` column + `WHOLE:` histogram buckets,
`tools/coverage-spec.mts` (`runWholeSpec`), docs/FIXED.md #121, #13/#89, #104/#112.

## 130 · Two unrelated inline shapes sharing one property-key-derived name — box.yaml's real #126 residue — ⬜ Open

**Symptom:** after `#129`'s correction, box.yaml's whole-spec compose genuinely fails on 9 GET / 5
mutation `GRAPH_QL_ERROR`s — real, not #126's already-fixed pattern (checked: none collide with a
real top-level component). Two clusters:

**Cluster A — "AssignedTo"** (4 GET errors, all 5 mutation errors):
```yaml
TaskAssignment:
  properties:
    assigned_to:
      allOf: [{ $ref: '#/components/schemas/User--Mini' }, { description: ... }]   # small shape
LegalHoldPolicyAssignment:
  properties:
    assigned_to:
      allOf: [{ oneOf: [File, Folder, WebLink] }, { description: ... }]            # big shape
```
Both are inline `allOf`s on a property literally named `assigned_to` (the `oneOf` sits *inside* the
outer `allOf`, so both mint as `Composed`, not `Union`) — `Composed.updateName` names both
`"AssignedTo"`. Only the big File/Folder/WebLink-derived definition survives; selections expecting
the small shape's `login` field (e.g. `taskAssignmentCollection.entries.assignedTo.login`) no
longer match anything.

**Cluster B — "Fields"** (the other 5 GET errors, `metadata_templates*` ops): two unrelated
array-item objects both named from the property key `fields` — one with
`{description, displayName, hidden, id, key, options, type}`, one with just `{key, sort_direction}`.
Only the smaller shape survives; the `metadata_templates*` ops' selections expecting the larger
shape's fields no longer match.

**Cause:** this is `#22`'s original, deliberately-unfixed scope — a same-class collision (both
`Composed`, or both `Obj`) between two *unrelated* inline shapes that happen to mint the same
property-key-derived name, not a collision with a real top-level component (which `#126`'s
`collidesWithReservedComponentName` already handles). `#22`'s own entry documents why this is hard:
a same-class rename was tried once and reverted — box regressed 85→76 because description-only
differences made otherwise-identical twins look different under deep-equality, and visit order
decided which twin got renamed, orphaning the other's references.

**Not yet designed:** any real fix needs to solve the exact problem `#22` backed away from —
distinguish "these two same-named things are genuinely different" from "these two are the same
shape modulo a `description` field" — without the visit-order fragility that caused the box
regression. Do not attempt casually; needs its own design pass, same rigor as `#126`'s own
(narrow, existing-mechanism-first) approach.

**Refs:** `tests/resources/oas/box.yaml` (`TaskAssignment`, `LegalHoldPolicyAssignment`,
`metadata_templates*`), `src/oas/nodes/comp.ts` (`Composed.updateName`), `src/oas/nodes/typeUtils.ts`
(`collidesAcrossNodeClasses`, `sameSchemaAs`). See `#22`'s `FIXED.md` entry (the same-class scope
decision and its box regression, "Care" note), `#126` (the sibling, already-fixed real-component
case), `#129` (the measurement-tool bug found while investigating this).

## 132 · Most JSON-degrade sites still give no signal in the generated schema, only the build log — ⬜ Open (umbrella)

**Symptom:** `warn()` logs why a field gave up and became `JSON`, but that reason never reaches the
schema itself — anyone reading the SDL (or GraphQL tooling: Studio, GraphiQL, introspection) sees a
bare `JSON` field with no clue why. `docs/FIXED.md #133` fixed 4 of the 17 live sites found by an
exhaustive survey of `src/oas/` — the ones that could reuse `Prop.generate()`'s existing
`schema.description -> """..."""` mechanism with no new plumbing. Umbrella entry for the other 13,
each needing its own new-plumbing design; a site gets its own number when someone picks it up.

| site | where | why it needs new plumbing |
|---|---|---|
| `factory.ts:61` | `fromSchema`, dangling `$ref` | bare `Scalar`, no `Prop` at all — landing spot depends entirely on the caller (`Res`, `Union` member, `Map` value, `Param` type) |
| `factory.ts:115` | `fromSchema`, shapeless object (#19) | same — bare `Scalar`, no caller-independent landing spot |
| `factory.ts:146` | `createScalarType`, unrecognised scalar `type` (#98) | same |
| `factory.ts:212` | `fromArrayItems`, shapeless array item (#56) | the note belongs on the *field* (`[JSON]`), not the item — needs threading up into the owning `PropArray`'s schema |
| `factory.ts:219` | `fromArrayItems`, all-plain choice (#86) | same |
| `factory.ts:225` | `fromArrayItems`, mixed plain+object choice (#131) | same |
| `map.ts:95` | `Map.generate()`, list value with no named item type | writes straight into the `value:` line of the map's own generated type — not a `Prop` |
| `map.ts:117` | `Map.valueTypeName`, empty `Obj`/`Composed` value (#19/#70) | same |
| `map.ts:172` | `visitAdditionalProperties`, `additionalProperties: {}` | same, **and** arguably not a forced degrade — the API author explicitly said "value can be anything," so any wording here should read softer than the rest |
| `map.ts:184` | `visitAdditionalProperties`, all-plain choice (#108) | same |
| `union.ts:144` | `Union.generate()`, merged type with no selected fields (#80) | writes straight into an operation's return-type slot; natural home is the operation-level docstring in `get.ts`/`post.ts`, already computed before `resultType.generate()` runs |
| `propObj.ts:58` (D1) | `getValue()`, every field stripped from the object (#101) | decided *inside* `getValue()`, which runs after `Prop.generate()` has already written `this.schema.description` — needs a new overridable hook on `Prop` |
| `propObj.ts:62` (D2) | `getValue()`, every field removed on every route (#101) | same |

One dead line found in the same survey, not counted above: `map.ts:102`'s `else { writer.write('JSON') }`
can't fire — a `Map` node only ever gets built when `Schemas.isMap()` already confirmed
`additionalProperties` is a real object schema, so `visitAdditionalProperties`'s early-return guard
that would leave `valueType` unset never triggers for a real `Map`.

**AST:** none of the 13 — this only changes what a `Prop`/writer emits alongside an already-JSON
field, never which node kind gets built.

**Refs:** `ROADMAP.md` "R16" (this survey's own shape notes, kept there since it's still planned
work), `docs/FIXED.md #133` (the 4 sites already done, same design: `warn()` and the schema note
share one reason string, `Schemas.withDegradeNote`).

## 135 · A drift-recovered path segment answers empty when nothing re-derives its `.path()` string — ⬜ Open

**Symptom:** found as a side effect of landing #111's new "own output must parse" safety net — a
previously-green test, `test_72_browse_minted_path_resolves` (`tests/all/regen.test.ts`), turned out
to have been comparing two empty, invalid schemas against each other the whole time. Its own helper,
`mintPath`, walks a fully-expanded digitalocean.yaml tree and returns the path to the *first* scalar
leaf whose path contains a marker string (`ActiveDeployment` in this test) — after browsing
`/v2/apps` first (which claims the name `ActiveDeployment` for a same-shaped type reached from
*that* op), the deployments op's own `ActiveDeployment` drift-renames to
`inlinev2AppsByAppIdDeploymentsResponseActiveDeployment` (see #72's own naming-collision fix).
Passing `generateSchema([minted])` — that one drifted, fully-qualified scalar path, no `>**`
wildcard — produces `type ActiveDeployment {\n}\n`: the type is emitted, but `cause` (the field the
path names) is missing entirely.

**Root-caused** (correcting this entry's earlier "not yet root-caused" note — the prior hypothesis,
that the reachability loop's fixed point converges to nothing, was wrong; verified empirically
instead of assumed): a **plain, un-drifted** bare leaf selection works fine on its own (confirmed
against `petstore.yaml`'s `Pet.name`, and against `digitalocean.yaml`'s `ActiveDeployment.cause`
when `/v2/apps` is never browsed first, so no rename ever happens) — this is specific to the
drift-recovery case:
- `SelectionPath.resolveSegment` DOES recover the drifted segment to the right node (confirmed:
  the recovered `ActiveDeployment` object visits correctly and populates all 15 of its real props).
- But the selection array passed to `generateSchema` still holds the **literal, stale string**
  `minted` mints — containing the *drifted* segment name
  (`inlinev2AppsByAppIdDeploymentsResponseActiveDeployment`), which only existed in the browsed
  tree that had the naming collision.
- `Type.selectedProps` (`src/oas/nodes/type.ts`) checks selection membership by recomputing each
  prop's **own, fresh** `.path()` and testing it against the selection's prefix set
  (`selectionPrefixes`). The freshly-recovered node's `.path()` uses *its own* (un-drifted, or
  differently-drifted) name for that segment — never the stale string that found it — so `cause`'s
  fresh path never matches `minted`, and `ActiveDeployment.selectedProps([minted])` returns empty.
- With a `>**` glob, this can't happen: `PathsCollector.collectExpandedPaths` rebuilds the whole
  selection from the SAME live traversal (`T.traverse` + each child's own `.path()` call), so the
  string and the node it names are always in sync. The mismatch is only possible for a bare,
  pre-computed literal path string — which is also why this needed a *browsed-then-drifted* setup
  to surface at all; a plain fresh selection's string always already matches.

**Workaround applied to `test_72` (not a fix for the general case):** glob the drifted segment's
whole subtree (`>**`) instead of selecting its one leaf directly — this still exercises the thing
the test is about (a drift-recovered segment resolves to the same generation a fresh canonical name
does), while sidestepping the stale-string mismatch since `>**` always re-derives its own paths.
`test_72_browse_minted_path_resolves` un-`{ todo }`'d, passing again.

**Not done:** the general fix — make a bare, literal selection-path string survive recovery (e.g.
re-deriving each selected node's own fresh `.path()` back into the selection array after resolution,
instead of trusting the caller's original string past that point). No corpus case is known to hit
this outside `test_72`'s own drift setup; a `--paths` CLI invocation always selects at least a full
operation subtree (`SelectionPath.everythingUnder`, always `>**`), so this needs a browsed, renamed,
*and* leaf-only-selected combination to reach — unconfirmed whether that's reachable outside tests.

**Refs:** `tests/all/regen.test.ts` (`mintPath`, `test_72_browse_minted_path_resolves`),
`src/oas/nodes/type.ts` (`selectedProps`, `selectionPrefixes`), `src/oas/utils/selectionPath.ts`
(`resolveSegment`, the recovery this interacts with). Found while verifying #111's fix against the
full suite.


