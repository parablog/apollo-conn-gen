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

## 65 · An entity key whose OAS name is not a clean GraphQL name breaks R1 emission — ⬜ Open

**Symptom:** an entity keyed on a property like `widget_id` emits a connector that references names
nobody defines. Two separate leaks, same root:
- `@key(fields: "widget_id")` writes the **raw OAS name**, but the type's field is the sanitised
  `widgetId` — composition rejects the `@key`.
- the resolver URL never gets its `$this`: the rewrite regex `\{([a-zA-Z0-9]+)\}` (`obj.ts`,
  `writeEntityConnector`) does not match `_`, so the path stays `GET: "/widgets/{widget_id}"`.

**OAS** — any by-id endpoint whose path param needs sanitising, e.g. (entity-aliased-key):
```yaml
/widgets/{widget_id}:
  get:
    parameters: [{ name: widget_id, in: path, required: true }]
Widget:
  properties: { widget_id: { type: string }, name: { type: string } }
```

**Example:**
```graphql
# now — @key names a field Widget does not have, and the URL kept the bare param
type Widget @key(fields: "widget_id")
    @connect(http: { GET: "/widgets/{widget_id}" } ...)
{ widgetId: String ... }
# wanted
type Widget @key(fields: "widgetId")
    @connect(http: { GET: "/widgets/{$this.widgetId}" } ...)
```

**Cause:** `keyFields` carries raw path-param names (`entity.ts`), `@key` writes them unsanitised
(`obj.ts`), and the `$this` rewrite regex predates non-identifier param names. The selection side is
already correct — `widgetId: widget_id` — and #16 spots the key by Prop identity, so neither fix
changes selections.

**Tests:** `test_R1_16_aliased_optional_key_plain_only_in_entity_selection` in
`tests/all/r1-entity.test.ts` generates this shape writer-level only; it must start composing once
this is fixed (then move it onto `runOasTest`).

**AST:** no change expected — an emission fix in `obj.ts` (sanitise `@key` fields, widen the
rewrite) plus keeping `$this.<sanitised>` consistent with the `@key`.
**Refs:** #16 (found while planning it — its key suppression matches `keyFields` against
`Prop.name`, both raw OAS names today; sanitising `keyFields` for `@key` must keep that check in
step, and the test above fails if it does not), `Naming.sanitiseField`.

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

## 93 · An inline map at the response root is always called `REntry` — ⬜ Open
**Symptom:** github `get:/emojis` emits its entry type as `REntry`, which says nothing about the
operation or the data. Every unnamed map at a response root gets that same name.

**Cause:** `Map.updateName()` names an unnamed map `<parentName> + "Entry"`. A response-root map's
parent is the `Res`, and a `Res` is named `r` — so the answer is always `REntry`. The three sibling
container nodes all special-case this position and name themselves after the operation:

| node | unnamed, under a `Res` |
|---|---|
| `Obj.updateName` | `op.getGqlOpName() + 'Response'` |
| `Composed.updateName` | `op.getGqlOpName() + 'Response'` |
| `Union.updateName` | `op.getGqlOpName() + 'Response'` |
| `Map.updateName` | `'REntry'` — the `Res` branch is missing |

**Latent, not currently biting.** Only an *inline* map root mints `REntry`; one behind a `$ref`
takes the ref's name (`/repos/{owner}/{repo}/languages` → `LanguageEntry`). github has exactly one
of each, so nothing collides today. Two inline map roots in one spec would both ask for `REntry` and
land on #78's conflict machinery, which renames by container — and both containers are `r`.

**Fix (not done):** give `Map.updateName` the same `parent instanceof Res` branch, with `Entry`
instead of `Response`. Cost: it renames confluence's entry type too, so the `REntry` assertions in
`test_90_map_at_the_response_root_takes_entries` move with it.

**Refs:** `src/oas/nodes/map.ts` (`updateName`), against `obj.ts` / `comp.ts` / `union.ts`
(`updateName`). Surfaced while fixing #92; the whole-spec github check that closed #92 is what
showed the collision is not reachable yet.

## 95 · An array node is named after its parent, so it shares its parent's ref name — ⬜ Open
**Symptom:** none on its own today; it is what made #94 possible, and anything else keyed by node
name can trip on it the same way.

**OAS** (confluence — the second member of an input-position `oneOf`):
```yaml
ContentRestrictionAddOrUpdateArray:
  oneOf:
    - { type: object, properties: { … } }
    - { type: array, items: { $ref: '#/…/ContentRestrictionUpdate' } }
```

**Example**:
```
# the array member of the union, as built:
array:#/components/schemas/ContentRestrictionUpdate   # id — from its items, correct
  name = '#/components/schemas/ContentRestrictionAddOrUpdateArray'   # the *union's* ref name
```

**Cause:** `Factory.createArrayType` does `new Arr(parent, parent.name)` — an array is a wrapper, so
it borrows a name rather than minting one. That is harmless while only `Arr.id` (derived from the
items type) is used to identify it, and wrong for anything reading `.name`: `context.refCount` is
keyed by ref name, so an `Arr` under a `$ref`'d container is indistinguishable from the container
itself. #94 is exactly that — a decrement meant for the member landed on the union.

**Known blast radius:** `decRefCount` (guarded in `union.ts` by #94), `context.store`/`types` keyed
by name, and the writer's `nameKey` (`T.isRef(type.name)`) — an `Arr` never reaches the writer as a
definition, so that one is theoretical.

**Fix (not done):** an `Arr` under a named parent should carry no ref name of its own — either a
derived one (`<parent>Items`) or none, with the callers that need a label reading the items type.
Cost: `Arr.name` is read in traces and in `createArrayType`'s `Res` branch (`<op>Response`), and any
name change is an identity change (#73) if it ever reaches a `path()`.

**Refs:** `src/oas/nodes/factory.ts` (`createArrayType`), `src/oas/nodes/arr.ts`. Surfaced while
fixing #94, which guards the one site that bites.

## 105 · A 3-member anyOf's merged type silently drops a member the selection still names — ⬜ Open

**Symptom:** stripe's real production spec fails `rover supergraph compose` on 3 ops:
```
SELECTED_FIELD_NOT_FOUND: [stripe] `@connect(selection:)` on `Query.stripe_listInvoices` contains
field `deleted`, which does not exist on `Stripe_DiscountsUnion`.
```
Same error, same field, on `stripe_getInvoice` and `stripe_searchInvoices` — all three read
`invoice.discounts`.

**OAS** (stripe — `invoice.properties.discounts.items`, three real members, no shapeless one):
```yaml
anyOf:
  - { type: string, maxLength: 5000 }
  - { $ref: '#/components/schemas/discount' }
  - { $ref: '#/components/schemas/deleted_discount' }   # has its own `deleted: true` field, required
```

**Example** — the emitted type only names 2 members and carries no `deleted` field, but the
selection three call sites still ask for one:
```graphql
#### union degraded to a merged object: DiscountsUnion = String | discount   # only 2, not 3
type Stripe_DiscountsUnion { #### replacement for Union DiscountsUnion
  id: String!
  ...
  # no `deleted` field anywhere in this type
}
```
```graphql
        discounts {
         id
         ...
         deleted        # <- this is what fails to resolve
        }
```

**Cause: not yet established**, but the trail so far rules out the two most obvious mechanisms:
- Not the `anyOf: [member, {}]` shapeless-member collapse (`factory.ts:80-87`, docs/FIXED.md #20)
  — that only fires when exactly one member is non-shapeless (`real.length === 1`); here all three
  are real object/scalar shapes, so `real.length === 3` and the collapse never triggers.
- Not `Union.dedupedSelectedProps`'s incompatible-kind guard (`union.ts:222-243`, docs/FIXED.md
  #39/#44) — that *replaces* a colliding field with a `JSON` scalar, it does not drop the member
  outright, and `deleted` is absent from the type entirely rather than typed as `JSON`.
- `Union.visit()` (`union.ts:45-88`) iterates every entry of `this.schemas` unconditionally and
  calls `this.add(type)` for each — so on paper all three members (String, `discount`,
  `deleted_discount`) should become children. The merged-object comment showing only two names
  means one member is gone by the time `generateMergedObject` reads `this.children`, somewhere
  between `visit()`'s add loop and that read.
- A structurally identical case, `account_tax_ids` (`String | tax_id | deleted_tax_id`, same
  shape: scalar + object + "deleted" superset of that object), merges correctly and keeps
  `deleted: Boolean!` — so this is not "3-member anyOf merges always lose the third member," it is
  specific to something about `discount`/`deleted_discount`'s shape that `tax_id`/`deleted_tax_id`
  doesn't share (worth diffing the two ref pairs directly as the next step).
- Note the parallel, unrelated in-flight change to this same file for #104 (a naming-collision
  guard in `Union.visit`/`add`) — check for interaction, but the symptom here (a whole member
  missing, not a rename) doesn't match #104's shape (two same-named inline members colliding).

**Not caught by the existing corpus gate.** `node --import tsx/esm tools/lint-corpus.mts --spec
stripe.json` walks all 263 ops of the full spec and reports 0 diagnostics — this bug reproduces
even though the generator's own "the generator should never write a selection its own linter
rejects" gate passes clean. See #106.

**Refs:** `src/oas/nodes/union.ts` (`visit`, `add`, `generateMergedObject`, `dedupedSelectedProps`,
`selectedProps`), `src/oas/nodes/factory.ts` (`fromSchema:80-87`, `createContainerType:161-174`).
Found running the real, curated 34-op Stripe selection from
`graphos-service-factory/service-catalog/stripe/manifest.yaml` through `scripts/gen-ts.mjs` (that
repo's wrapper comparing TS `gen` against `tools/connect-gen`, the Rust fork it currently uses).

## 106 · The selection linter checks selections against the spec, not against the emitted type — 📋 Noted, not fixed

**Symptom:** #105 above generates a selection referencing a field (`deleted`) that is real in the
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

## 111 · `--service-prefix` crashes the whole CLI on SDL its own generator already wrote invalid — ⬜ Open

**Symptom:** whenever the raw, pre-prefix SDL is already invalid GraphQL (an empty `type`/`input`
body — `#108`, `#110`, and presumably any future case in the same family), adding
`--service-prefix` turns a silent bad-output bug into a hard process crash:
```
GraphQLError: Syntax Error: Expected Name, found "}".
    at syntaxError (…/graphql/error/syntaxError.js:31:10)
    …
Node.js v26.7.0
```
Without `--service-prefix`, the same input just prints the (already broken) SDL and exits 0 — no
crash, no error, silently wrong. Neither behavior is right, but the crash is the more urgent one:
it takes the whole CLI process down with an unhandled exception and a raw stack trace instead of
"gen failed to produce valid GraphQL for operation X, see below."

**Cause:** `Namespace.apply(sdl, prefix)` (`src/oas/lint/namespace.ts`) calls graphql-js's `parse(sdl)`
to find byte offsets for the rename splice, with nothing catching a `GraphQLError` if the input
doesn't parse. `OasGen.generateSchema()` runs `Namespace.apply` last, unconditionally, whenever
`servicePrefix` is set (`src/oas/oasGen.ts`) — there is no validity check on the generator's own
output between generation and this parse.

**Fix (not done):** two independent, complementary things:
1. `Namespace.apply` should catch the parse failure and raise an actionable error naming the
   `--service-prefix` interaction, not let a raw `GraphQLError`/stack trace reach the user.
2. Separately (arguably higher-leverage, since it fixes both the crash and the silent-bad-output
   case at once): `generateSchema()` could validate its own output is parseable GraphQL before
   returning, and fail there with a clear message pointing at whichever operation produced the
   invalid type — `#108`/`#110` are two known root causes for how the SDL gets there, but this
   entry is about the missing safety net once it does, not about preventing every possible cause.

**Test:** not yet written standalone — reproduced today via `#108`'s and `#110`'s fixtures with
`--service-prefix` added (both crash identically). Worth a small dedicated fixture (any spec that
generates an empty type/input) + test once someone picks this up, rather than relying on those two
staying reproducible forever.

**Refs:** `src/oas/lint/namespace.ts` (`Namespace.apply`), `src/oas/oasGen.ts` (`generateSchema`,
where the unconditional call happens). Cross-cutting over `#108`/`#110` — fixing either of those
root causes narrows this issue's blast radius but doesn't close it; the missing safety net is
independent of which spec shape trips it. Found running
`graphos-service-factory/scripts/gen-ts.mjs` (same wrapper as `#108`/`#109`/`#110`) — `--service-prefix`
is one of the flags the wrapper always passes, which is why it hit this immediately rather than the
silent-bad-output path.


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

## 120 · A bare `$ref`-enum response drops the whole operation — ⬜ Open

**Symptom:** an op whose 200 response is a component enum directly (no object wrapper) vanishes
from the schema — no field, no error. Found writing #115's coverage.

**OAS** (`duplicate-enum-values-routes.yaml`):
```yaml
/status:
  get:
    responses:
      '200':
        content:
          application/json:
            schema: { $ref: '#/components/schemas/StateCode' }   # a bare enum
StateCode: { type: string, enum: [pending, active, done] }
```

**Example** — `type Query` contains `jobs` but no `status` field at all; the enum itself IS
visited and stored (trace shows `enum:visit`), only the selection walk loses it.

**Cause:** the leaf cases in `collectExpandedPaths`'s traverse (`src/oas/generator/typesCollector.ts`)
cover `PropScalar`, `PropEn`, `PropCircRef`, `Scalar` under a `Res`, and lists of values — a bare
`En` under a `Res` matches none, so the op yields zero selection paths and is dropped. The exact
mechanism #32 (bare scalar) and #47 (bare scalar array) fixed for their shapes; the enum case was
never covered (#24 only fixed `PropEn` leaves).

**Test:** `test_115_bare_enum_response_must_not_drop_the_operation` (`tests/all/oas-core.test.ts`,
`{ todo: ... }`) — flips green when fixed.

**Refs:** `src/oas/generator/typesCollector.ts` (the leaf cases), docs/FIXED.md #32 #47 #24.

## 121 · A `oneOf` component used top-level by one op and nested by another fails the combined compose — ⬜ Open

**Symptom:** each op composes alone; generate BOTH into one schema and rover rejects it with
`GROUP_SELECTION_IS_NOT_OBJECT ×2`. Found building the all-ops coverage column — the first
committed per-op-green/whole-red case.

**OAS** (`per-op-green-whole-red.yaml`):
```yaml
/media:  get -> $ref Media                      # top level: real union + ->match (has discriminator)
/shelf:  get -> { featured: $ref Media, ... }   # nested: isFlat -> merged object
Media:   oneOf [Book, Movie], discriminator kind
```

- one component, two forms: the top-level position emits `union Media = Book | Movie` with a
  `->match` selection; the nested position needs the flat merge (#25/#38).
- combined, the two nodes share the component's name and one form wins the definition while the
  other position's selection still speaks its own form — the `->match` group lands on a
  non-object.
- per-op coverage is 100% on this spec; only the all-ops column sees it (COVERAGE.md legend).

**Test:** `test_coverage_all_ops_column_catches_per_op_green_whole_red`
(`tests/all/coverage-tool.test.ts`) pins the DETECTION — when this entry is fixed, the fixture
turns green and that test moves to a then-current red case (or a synthetic one).

**Refs:** `src/oas/nodes/union.ts` (`isFlat`, `isTopLevelResponse`), docs/FIXED.md #25 #38 #48
(the union-form family), #13/#89 (position-dependent divergence). Fixture
`tests/resources/oas/per-op-green-whole-red.yaml`.

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
- #121 (union top-level + nested) is the already-isolated member of this family.

**Refs:** COVERAGE.md / COVERAGE-mutations.md `all-ops` column + `WHOLE:` histogram buckets,
`tools/coverage-spec.mts` (`runWholeSpec`), #121, #13/#89, #104/#112.

## 124 · digitalocean all-ops mutations: no connector resolves the `LoadBalancerRegion` fields — ⬜ Open

**Symptom:** the whole-spec mutations compose of digitalocean.yaml fails with 5 build errors,
one per field of a single type — previously masked by #123's `INVALID_BODY` errors:
```
CONNECTORS_UNRESOLVED_FIELD: No connector resolves field `LoadBalancerRegion.available`.
It must have a `@connect` directive or appear in `@connect(selection:)`.
```
(same for `.features`, `.name`, `.sizes`, `.slug` — the report column counts ×10 occurrences.)

- Per-op, all 145 mutation ops still compose 100% — a cross-op-only failure (#122 family).
- The type is emitted, but no selected op's connector selection covers its fields.
- Not chased as part of #123; first read pending.

**Refs:** COVERAGE-mutations.md `all-ops` column (`digitalocean.yaml`), #122 (umbrella), #123
(the unmasking fix). Probe: whole-spec mutations schema of `digitalocean.yaml` via rover.

## 128 · A pinned `composeFederationVersion` without `forceRover` composes against the wrong plugin — ⬜ Open (audit)

**Symptom:** `compose()` (`src/tests/runners.ts`) prefers a gitignored local patched composer
(`tools/local/apollo-federation-cli`) over real Rover unless `forceRover: true` is set — and that
local build ignores `federation_version` entirely (patched past 2.15). A test that pins
`composeFederationVersion` below 2.15 without also setting `forceRover: true` never actually
composes against that older plugin — its pin is inert, and it silently passes regardless of real
pre-2.15 incompatibilities.

**Confirmed instances, both already fixed:** `test_108_confluence_full_production_selection` and
`test_110_pagerduty_full_production_selection` both had this gap (see their `docs/FIXED.md`
2026-08-19 corrections) — real composition at `2.14.0` failed for real (confluence: 322
`CONNECTORS_UNRESOLVED_FIELD`, the same #14/#16 mechanism #109 hit; pagerduty: a `nom` parser
error on `??` default-coalesce syntax, a different specific gap in the same category). `test_73`
and `test_109` already set `forceRover: true`, so they were never affected — this is exactly their
same root-cause mistake, just not propagated everywhere it needed to be.

**Not yet audited (found by a cheap grep, not exhaustive):**
- `test_entity_resolver_with_errors_emits_wellformed_schema`,
  `test_recursive_schema_cut_composes_abstract_pass` — both pin a version without `forceRover:
  true`. Lower suspected risk (version matches their own `v2.14` declaration, and neither scenario
  obviously hits `?`/`->entries`/`??`), but not confirmed either way.
- Every other test that pins `composeFederationVersion` was found only by grepping for that
  literal string — a test that *should* pin a version but doesn't set `forceRover` and silently
  composes against the local patched build (already past 2.15) wouldn't show up in that grep at
  all, and isn't ruled out here.

**Also open:** this repo cannot confirm what composer version graphos-service-factory's production
deploy actually runs — every `2.13`/`2.14` reference found while investigating this traced back to
this repo's own test pins, not to a citation of the real production config. A green result at
`2.15.1` is necessary but not sufficient for release-readiness until that's confirmed (either
Fernando confirms it directly, or it's found in graphos-service-factory's own config).

**Refs:** `src/tests/runners.ts` (`compose()`, `localComposer()`), `docs/FIXED.md` #108, #109, #110
(the confirmed instances and the shared #14/#16 mechanism), #73 (the same mistake, independently).

