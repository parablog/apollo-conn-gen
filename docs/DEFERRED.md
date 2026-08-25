# Generator tasks log — deferred

Entries filed the same way as `docs/TASKS.md`'s, but not active work: design notes, parked
investigations, upstream-blocked gaps, and theoretical/no-repro cases — bugs and features alike.
None of these carry a priority tag, and none should — the fix-the-issues loop
(`~/bin/issue-loop.sh`) only ever considers `docs/TASKS.md` entries whose status is
`⬜ Open`/`🔴 Open`, so everything here is already out of its work queue by construction.

Entries keep the same bracketed type label as `docs/TASKS.md` (`[BUG]`, `[FEAT]`, …) — just without
a priority tag, since nothing here is queued.

For the node-model (AST) background these entries assume, see `docs/TASKS.md`'s own preamble.

Ids are global across all three files (`docs/TASKS.md`, `docs/DEFERRED.md`, `docs/FIXED.md`), shared
by bugs and features, and never reused:
- open, loop-actionable — `// see docs/TASKS.md #N`
- deferred, not in the work queue — `// see docs/DEFERRED.md #N`
- fixed — `// see docs/FIXED.md #N`

**Moving an entry out of here:** back to `docs/TASKS.md` (with a priority tag) if its status
genuinely turns Open — a parked wake condition fires for real, an upstream block lifts, a theoretical
case gets a repro. To `docs/FIXED.md` instead if work on it actually lands a fix.

Status: 🟡 Partly done · ⏸ Parked (blocked on an external gate) · 📋 Noted · ✅ Covered (resolved
without a dedicated code change).

---

## 54 [BUG] · The same "what does this operation give back" walk is written four times — 📋 Noted, not fixed

**Symptom:** four places walk the operation's result node the same way, each with its own copy of
the unwrap. They agree today, but nothing keeps them in step.

| Where | Unwraps to | Extra it does |
|---|---|---|
| `typeUtils.ts` `T.responseType` | the response node, list kept | — |
| `typeUtils.ts` `T.responseItemSchema` | the item's OAS schema | takes lists off — now delegates its unwrap to `T.responseItemType` (docs/FIXED.md #58), one copy folded |
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

## 73 [BUG] · Node ids embed emitted names, so visit order changes selection identity — ⏸ Parked (stripe trigger fixed 2026-08-19; identity-drift core confirmed 2026-08-24; one confirmed shape fixed same day, see docs/FIXED.md #154; general problem still parked)

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

**Step 0 result (2026-08-23) — negative, for the simple same-name/same-shape case.** Built the
repro the mechanism actually needs: `tests/resources/oas/same-inline-shape-two-ops.yaml`, two GET
ops (`/a`, `/b`) that each write out an identical inline `pagination: { cursor, hasMore }` block
by hand, not through a shared component. Ran the file twice with a fresh `OasGen` each time — once
reading `/a` then `/b`, once reading `/b` then `/a`
(`test_73_reversed_op_order_keeps_same_inline_shape_field_path_stable`,
`tests/all/oas-core.test.ts`). `/b`'s position in the file never moves between the two runs, and
neither does its `cursor` field's path: both orders give
`get:/b>res:r>obj:type:bResponse>prop:obj:pagination>obj:type:pagination>prop:scalar:cursor`. The
shared inline block resolves to one type named after its own field key ("pagination") whichever
op is read first, so there is never a name collision here and #57's "first-visited keeps the base
name" tie-break never triggers. This is a narrower shape than the digitalocean case that reopened
this issue (`allOf` members reached through different `$ref` pointers, `[inline:…]` names shifting
because a parent's name shifted) — this result clears the simple same-name/same-shape case only,
not the mechanism as a whole. Stays parked; wake again on a repro closer to digitalocean's actual
shape (a `$ref`-reached member whose reachable path differs between browse orders).

**Step 0 result (2026-08-24) — positive: a saved selection can fail to resolve at all.** Built the
repro this step's own gap named:
`tests/resources/oas/ref-member-under-colliding-allof-wrapper.yaml`, two GET ops (`/a`, `/b`) whose
response each puts a shared `$ref` component (`SharedPart`) and an op-specific extra field inside
one inline `allOf` wrapper under the same property key (`container`). The two wrappers collide
(same key, different extra field), so whichever op is visited first keeps the plain name
`Container`; the other is renamed after its own response type (`AResponseContainer`) —
`typeUtils.ts`'s `resolveNameConflict`, driven by visit order, exactly as this issue describes.
That rename cascades into the wrapper's OTHER `allOf` member too: the inline "extra field" object
is named `[inline:<wrapper's name>]`, so it silently picks up the new name even though it never
itself collided.

Ran the file twice with a fresh `OasGen` each time — once reading `/a` then `/b`, once reading `/b`
then `/a` — and saved `/a`'s `aOnly` field's path from the first run
(`test_73_ref_member_under_colliding_allof_wrapper_path_fails_to_resolve_after_reorder`,
`tests/all/oas-core.test.ts`). Replaying that saved path against a fresh run browsed in the second
order — what happens when a stored selection (web localStorage, a saved selection file) is reused
after the spec, or just the selection, is re-walked in a different order — throws `Could not find
type: obj:type:[inline:Container]` instead of resolving. `#72`'s single-target recovery
(`selectionPath.ts`'s `SelectionPath.resolveSegment`, via `T.innerChild`) can't help: the stale
segment sits directly under the `Composed` wrapper next to the stable `$ref` member
(`obj:type:.../SharedPart`) — two `obj:` children, not the single child a `Prop` wrapper
(`PropObj`/`PropComp`/…) holds, which is the only shape `T.innerChild` recovers. This is the
resolution-based failure this step's gate asked for, not just a string diff: the same selection
literally cannot be regenerated once the browse order changes.

This confirms the identity-drift core of this issue is real, for a `$ref`-reached member's PARENT
identity, not the member's own id. Per this step's own scope, no address scheme or fix is chosen
here — that is follow-up work, informed by this specific failure shape (an inline `allOf` sibling
of a stable `$ref` member, renamed only because its own parent's name shifted).

**This specific shape fixed (2026-08-24), see `docs/FIXED.md #154`.** `SelectionPath.resolveSegment`
gained a targeted third recovery step for exactly this case — a renamed `[inline:...]` member found
among its `allOf` wrapper's other children, not just via `T.innerChild`'s single-child check. The
saved `/a` selection above now resolves after the reorder, landing on the same field a fresh run in
the new order would pick on its own. This closes the one repro built above; the general identity-
drift problem (ids embedding emitted names) stays parked — see this issue's own status line.

## 79 [BUG] · Published plugin rejects `->match`-driven union selections — 📋 Upstream, awaiting a release

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

## 106 [BUG] · The selection linter checks selections against the spec, not against the emitted type — 📋 Noted, not fixed

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

## 115 [BUG] · Enum dedup is only tested inline, and the raw enum list keeps its doubles — ✅ Covered (2026-08-18, coverage-only)

- the untested routes were already correct (every construction path passes the `En` constructor's
  dedup): pinned by `test_115_enum_dedup_holds_on_ref_component_and_input_routes`
  (fixture `duplicate-enum-values-routes.yaml`) — $ref'd component enum + input-position reuse.
- `schema.enum` normalization declined: writing `En.items` back would mutate the shared
  `lookupRef` `SchemaObject` instance and change `sameSchemaAs` convergence — two enums differing
  only in duplicate patterns would start converging. Not output-identical-safe.
- writing the coverage found #120: a bare `$ref`-enum response drops its whole operation.

**Refs:** `src/oas/nodes/en.ts`, `docs/FIXED.md` #102, #120. Review §1. No code change, so the
entry stays here rather than moving to FIXED.md.

## 117 [BUG] · Union convergence ignores the discriminator mapping — 📋 Noted

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

## 119 [BUG] · Residual path()-cost hotspots left after #118 — 📋 Noted

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
not be memoized globally). The fourth bullet becomes moot under `docs/DEFERRED.md #139` (selection
externalisation), which replaces the representation these costs live in.

## 138 [FEAT] · Accept a folder of independent OAS specs, not just a single file — 📋 Noted, no real trigger found

**Why it was filed:** JSON mode already accepts `<file|folder>` (`src/cli/json.ts`), but OAS mode is
single-file. The stated motivation, "real APIs publish multiple independent OAS documents in one
folder (e.g. Sanity's query + mutation specs)," traced back through `git log` to `ROADMAP.md`'s R12
— an illustrative `e.g.`, not a citation of an actual encountered blocker.

**Checked against the real corpus and the premise doesn't hold:**
- **Sanity has no split.** `sanity-to-oas.mts` synthesizes exactly one `sanity-oas.json` per
  instance (checked 3 real instances: acme-shop, marriott-mgs, mirror-mgs); the converter never
  mentions a mutation spec at all.
- **Only HubSpot genuinely splits**, across the whole `service-catalog/` corpus (6 files, one per
  resource) — and it already has a working, unblocked solution external to `gen`:
  `graphos-service-factory/service-catalog/hubspot/generate.py` runs the generator once per file
  and merges the resulting GraphQL SDL text afterward.
- PagerDuty's 2 files (`pagerduty.json`, `openapi.json`) are one canonical spec plus a stale
  leftover, not an intentional split.
- `gen`'s own `tests/resources/oas/` has zero folder-of-specs fixtures.
- **The reference Rust implementation doesn't build this either** — `tools/connect-gen`'s
  `Generate` command takes a single `--openapi <PathBuf>`, no directory/glob, no merge-before-parse
  anywhere in `io.rs`. It uses the same per-file-then-external-merge pattern HubSpot's `generate.py`
  orchestrates around it.

**Parked, not loop-actionable — nothing in the corpus needs it, and even the reference
implementation deliberately merges post-generation instead of pre-parse.** Revisit only if a real
API surfaces that genuinely can't be split-and-merged externally — e.g. definitions shared across
files that only resolve correctly when parsed together, which none of today's candidates are.

**Refs:** `src/cli/json.ts` (the existing folder-input precedent for JSON mode, unaffected by this).

## 139 [FEAT] · Selections are flat emitted-name path lists, not spec-position addressed — 🟡 Partly done (sub-issue B fixed, docs/FIXED.md #153; one #73 recovery shape fixed, docs/FIXED.md #154; the module rewrite itself not started)

**Why:** selections are flat lists of leaf-path strings whose segments embed *emitted* names. That
one representation is behind three standing problems: `#73` (name-derived ids make stored
selections fragile to browse order — the parked structural-ids cure lands here),
`docs/FIXED.md #49`-adjacent (selection size scales with tree size: hubspot lists is 38,300 path
strings for "everything under this op", measured in `docs/FIXED.md #118`), and `#119`'s deferred
collect-walk map (the per-path re-resolve disappears with the representation).
Decided during `docs/FIXED.md #118` (2026-08-18): staged — the prefix-set fix shipped first; this is
the durable half.

**Two narrow slices are fixed, not the representation itself:** `docs/FIXED.md #153` (2026-08-23)
made `generateSchema` hand back the original wildcard instead of its expansion, so "everything under
this op" is compact again without waiting for this rewrite. `docs/FIXED.md #154` (2026-08-24) added
one more targeted recovery rule for a specific `#73` collision shape, the same way `#72`'s
`T.innerChild` already did for another shape. Neither touches why ids drift in the first place —
`#73`'s general identity-drift problem stays parked, and none of the "Shape" below has been built.

**Shape:** extract selection handling into its own module with **spec-position addressing** (paths
derived from the OAS document structure, not from emitted node names), and a **selectable
granularity mode** — the consumer chooses the selection algorithm per run:
- **operations** — an op is the unit; "everything under this op" is one fact, no field paths. The
  cheap mode for whole-spec generation and the CLI's `-n` default.
- **leaf fields** — today's per-field selection, for the web app's field picking and curated
  production connectors.
Op-only as the *only* mode was considered and rejected (breaks web field picking, makes
always-everything the default); as a *chosen* mode it is the right cost model.

**Migration surface to design for:** web app localStorage selections, saved selection JSON files
(`--load-selections`), test-pinned paths — all carry emitted-name paths today.

**Parked, not loop-actionable — same reasoning as ROADMAP.md's R4-R10.** This is a module rewrite
with a real cross-repo migration surface (the web app's stored selections), not a single-PR fix, and
unlike `docs/FIXED.md #122`/`#132` — both umbrellas that decomposed into a table of independently-
scoped rows a plan could pick one from — this one has no such table; every plan against
it has to invent its own scope-down, which is how `#153`/`#154` ended up as narrow patches around
the edges rather than any part of the actual rewrite. Move back to `docs/TASKS.md` once a specific,
independently-actionable slice is scoped out (its own new numbered entry, with a priority tag) —
not by reopening this one.

**Refs:** `#73` (parked cures, sized), `#119`; `docs/FIXED.md #118`
(the #49-adjacent measurements), `docs/FIXED.md #153`/`#154` (the two closed slices). Related:
`docs/FIXED.md #13`/`#89` (path-dependent divergence family).

## 143 [FEAT] · Enum value casing: decide whether to normalize to SCREAMING_SNAKE_CASE — 📋 Noted (decide first)

**Why:** found comparing `gen`'s output against `tools/connect-gen` (Rust)'s committed output for
the 5 real connectors in `graphos-service-factory`. Rust normalizes enum values to
`SCREAMING_SNAKE_CASE` (`ACTIVE`, `PAGE`); `gen` preserves the OAS spec's own casing verbatim
(`active`, `page` — 343 schema-level differences found, plus confirmed at runtime: real API
responses come back lowercase and fail a test written against Rust's uppercase enum values).
Uppercase is the more idiomatic GraphQL convention for enum values, so this leans toward "port
it" — but this is a style decision with a real migration cost (an existing client's enum literals
would need updating), not an unambiguous gap.

**Not filed as loop-actionable on purpose.** This needs a human decision on the casing convention
itself before any implementation starts — putting it in `docs/TASKS.md` would let the loop
autonomously pick a convention and implement it unsupervised, which is exactly the risk this file
exists to keep out of the queue. Move to `docs/TASKS.md` (with a priority tag) once the casing
question is actually decided — at that point it's a small, well-scoped change, same shape as the
other Rust-comparison items from this batch: `docs/FIXED.md #142` (a real, confirmed gap — string
properties promoted to `ID`) and `docs/FIXED.md #141` (turned out to be a false alarm — the
comparison's committed baseline was stale, no code change needed). Both closed 2026-08-21; worth
re-checking this entry's own casing-mismatch count against a fresh baseline too, not just assuming
the original 343-instance figure still holds, before treating it as ready to decide on.

**Shape (once decided "yes"):** normalize enum value strings to `SCREAMING_SNAKE_CASE` at the same
point enum values are currently read/emitted (`src/oas/nodes/en.ts`); the runtime request/response
still needs the *original* spec casing over the wire, so this is a display/selection-alias change,
not a raw-value change — needs the same "alias keeps the wire value, GraphQL name is sanitised"
pattern already used for field names (`Naming.genParamName`, `docs/FIXED.md #1`).

**Refs:** `graphos-service-factory/docs/ts-gen-comparison.md`.

## 144 [FEAT] · Type-name migration risk moving off Rust's `connect-gen` — 📋 Noted

**Why:** found during the Rust-comparison audit (`graphos-service-factory/docs/ts-gen-comparison.md`)
and flagged at the time as needing its own follow-up. `gen` names object/input/enum/union types by
shape (deduplicating structurally-identical types); Rust names them by full ancestor path (never
colliding, but duplicating the same shape once per reachable position). These are different,
incompatible conventions — for the same OAS input, the two tools essentially never produce the same
type name.

**Not a bug, and the fix is not "make `gen` match Rust."** Shape-derived naming is the more correct
approach and dedup is a real win, not a defect. The point of this entry is narrower: even where the
field-level *shape* is byte-for-byte equivalent between the two tools (the definition of
"behavioral parity" this whole comparison used), the *type name* attached to that shape is not, and
type names are client-visible — fragment type conditions, `__typename` checks, generated codegen
types. An existing client migrating off Rust's schema can still break on a renamed type even when
nothing about the underlying data changed.

**Not scoped as an implementation item.** There's no single fix that resolves this without
reintroducing ancestor-path naming's own problems; it's a real cost of moving off Rust that a
migration needs to plan around (e.g. a rename map, or accepting the client-side churn), not
something `gen` should absorb by changing its naming convention. Recorded here so it isn't lost, not
assigned a design — matches this file's own "design notes, parked investigations... theoretical/
no-repro cases" scope, not `docs/TASKS.md`'s loop-actionable one.

**Refs:** `graphos-service-factory/docs/ts-gen-comparison.md`; the plan this comparison followed
(`graphos-service-factory`, criterion 3's caveat) is where this was first flagged as needing a
follow-up.

## 161 [FEAT] · Entity link half: synthesized reference fields on id-carrying types — 📋 Noted (waiting on Adam's fork diff)

**Example:** `Song { album_id }` plus an R1-resolved `Album` → emit a `Song.album: Album` field
selecting `album: { id: $.album_id }`, so the router can traverse song → album through the
type-level resolver.

**Why:** AppWorld follow-up (Adam, Slack, 2026-08-25): `--infer-entity-resolvers` emits the
resolver half only — `@key` plus the type-level `@connect`/`$this` on the entity itself
(`src/oas/nodes/entity.ts`, `obj.ts` `writeEntityConnector`). Nothing emits the linking field on
the types that carry the id.
- Without it, cross-type traversal queries don't exist — that part of Adam's claim is confirmed.
- "The resolvers are unreachable" is overstated, though: a type-level resolver still backfills
  fields on any entity some connector returns with its key (e.g. a partial list response).

**From Adam's benchmark report (read 2026-08-25, claude.ai/code/artifact/c79bb3ab):**
- His heuristic is **deterministic exact-name matching** of GET-by-id ops onto id-carrying types —
  no fuzzy inference; 150 fields across 8 services, live-verified.
- Adoption was organic: 48/57 dev tasks used the synthesized fields unprompted (schema-embedded
  knowledge got used; discovery tools had zero voluntary adoption).
- Isolated impact: part of the v5 arm that closed the turn gap to +8% (sonnet, 168 tasks) while
  task completion hit 81.0.
- Operational caveat to carry into any implementation: one agent call now fans out N concurrent
  upstream requests — connector concurrency limits need setting deliberately.
- Scope limit confirmed: kills *agent-side* N+1 only; wire-level N+1 needs real batch endpoints
  (`--batch`, which his benchmark couldn't test — no upstream batch endpoints).

**Not loop-actionable yet:**
- No reference code: Adam's link-half work is in his fork and in none of PRs #5-#9 (verified) —
  ask him for the diff.
- The FK-name → type match (`album_id` → `Album`) heuristic is half-answered by the report
  (exact-name matching, above); the remaining design decision is whether we adopt exact-only or
  allow the sanitised/kept-spelling variants #158 introduced.
- Satisfiability territory: synthesized fields on shared types interact with composition pruning
  (never-returned types, partial-provider field keeping) — the same class of constraint that shaped
  R2's limits.

Moves to `docs/TASKS.md` once Adam's diff is in hand and the heuristic is decided.

**Refs:** `src/oas/nodes/entity.ts`, `src/oas/nodes/obj.ts` (`writeEntityConnector`), PRs #5-#9
(`parablog/apollo-conn-gen`, absence verified), the codex-approved plan
(`~/.claude-personal/specs/loop-nXHoSHEN/plan.md`). Adam's Slack follow-up (2026-08-25) and
benchmark report (claude.ai/code/artifact/c79bb3ab).
