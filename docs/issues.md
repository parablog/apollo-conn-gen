# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry instead of carrying the full rationale inline. Every entry has an **OAS:** snippet
showing the input schema that triggers it, a concrete **before → after** example, and an **AST:**
note stating how (or whether) the node tree changed.

**This file holds the open entries only.** The 80 fixed ones live in `docs/FIXED.md`. Ids are
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

## 13 · Path-dependent cycle cuts make same-named instances diverge — 🟡 Mechanism fixed; ops gated behind the R2 union wall
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

**Refs:** `src/oas/generator/typesCollector.ts` (`collect` + `findSelectedFieldNode`),
`src/oas/oasContext.ts` (`sdlPropOverrides`), `src/oas/nodes/obj.ts` (`generate` override
lookup).

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

## 69 · Sibling names that collide after sanitising are written twice — ⬜ Open

**Symptom:** `INVALID_GRAPHQL: Field prefsBackground already exists` (trello `post:/boards`,
`put:/boards/{idBoard}`) and duplicate enum values (openfigi `post:/mapping`) — the last 3 ops of
the mutation sweep's INVALID_GRAPHQL bucket.

**OAS** (trello — the `boards` component carries both spellings of each pref side by side):
```yaml
boards:
  properties:
    prefs/background: { type: string }
    prefs_background: { type: string }
```
openfigi needs no sanitising at all — `MappingJob.stateCode` literally lists every `enum` value
twice (`AC, AC, HI, HI, …`).

**Example:**
```graphql
input BoardsInput {
  prefsBackground: String   # from prefs/background
  prefsBackground: String   # from prefs_background — same name, invalid
}
```

**Cause:**
- Each field name sanitises on its own (`prefs/background` and `prefs_background` both ->
  `prefsBackground`); nothing compares the result against sibling names before writing.
- Enum values are written as listed — a spec that repeats a value writes it twice.
- #61 is the same missing check seen from the other direction (`@type` vs `type`).
- A fix that renames or drops one twin must keep the body mapping in agreement — today it writes
  `prefs_background: prefsBackground` and the `prefs/…` twin against the same field name.

**AST:** none expected — a check at write time: two siblings with the same cleaned name and the
same shape collapse to one; different shapes need a bumped name, as #63 does for types.
**Refs:** `src/oas/utils/naming.ts` (field sanitising), `src/oas/nodes/en.ts` (enum values), #61
(the same missing check, found first on `@type` vs `type`), #63 (the bump precedent).

## 73 · Node ids embed emitted names, so visit order changes selection identity — ⏸ Parked

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

**Refs:** `src/oas/nodes/*.ts` (`get id()` per class), `src/oas/generator/typesCollector.ts`,
#71/#72 (the shipped floor), #12/#22/#9 (the rename machinery).

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

## 89 · A field cut on some routes but kept on others is declared and never provided — 🔴 Open
**Symptom:** three confluence relation ops fail compose, each with the same single error:

```
CONNECTORS_UNRESOLVED_FIELD: [test_spec] No connector resolves field `Content.space`.
```

- `get:/wiki/rest/api/relation/{relationName}/from/{sourceType}/{sourceKey}/to/{targetType}`
- `get:/wiki/rest/api/relation/{relationName}/from/{sourceType}/{sourceKey}/to/{targetType}/{targetKey}`
- `get:/wiki/rest/api/relation/{relationName}/to/{targetType}/{targetKey}/from/{sourceType}`

They are the whole `CONNECTORS_UNRESOLVED_FIELD` bucket left in the GET sweep once #88 took the
github op out of it.

**OAS** (confluence — `Content` and `Space` point at each other, and `User` reaches `Space` too):
```yaml
Content:
  properties:
    space: { $ref: '#/components/schemas/Space' }
    ancestors: { type: array, items: { $ref: '#/components/schemas/Content' } }
Space:
  properties:
    homepage: { $ref: '#/components/schemas/Content' }
User:
  properties:
    personalSpace: { $ref: '#/components/schemas/Space' }
```

**Example** — the same type, `Content`, reached at six places in one op's selection. Two keep
`space`, four lost it to the cycle cut:
```
results.source                            space? { … }
results.target                            space? { … }
results.source.homepage                   # space: circular reference omitted
results.source.personalSpace.homepage     # space: circular reference omitted
results.target.homepage                   # space: circular reference omitted
results.target.personalSpace.homepage     # space: circular reference omitted
```
The SDL declares the field once, because some route kept it:
```graphql
type Content {
  # ancestors: [Content] - circular reference omitted
  space: Space
  …
}
```
`ancestors` is the control: it is cut on *every* route, so it is commented in the SDL as well and
composes fine. Only a field cut on *some* routes breaks.

**Cause:** this is #13's mechanism, and it shows #13's guard is not enough.
- #13 makes the emitted type the union of the fields surviving across routes, so a field kept on
  one route is declared.
- Its stated guard is "every union field is selected on at least the path it came from, so no
  `CONNECTORS_UNRESOLVED_FIELD`". That holds here — `space` is selected, twice.
- The composer does not accept that. It wants the field provided everywhere the type appears, not
  somewhere. Four positions provide nothing, so the field counts as unresolved.
- So #13 did not remove the divergence, it changed which error it raises: before #13 the selection
  named a field the SDL lacked (`SELECTED_FIELD_NOT_FOUND`), after #13 the SDL names a field four
  routes do not provide.

**AST** — no new node shape. `Obj.generate` reads `context.sdlPropOverrides` for the un-cut version
of the field (`obj.ts`), while every route's `Obj.select` keeps its own `PropCircRef` comment.

**Ways out, none free:**
- **Intersect instead of union** — a field cut on any route is dropped from the SDL *and* from every
  route's selection. Small and boring, and it composes. Costs the field on the routes that could
  really reach it, and inverts #13.
- **Split the type** — the cut instance is a different shape, so give it its own name. Principled,
  but `Space.homepage` alone is cut 351 times across confluence's 65 GET ops (#13), so the type
  count needs measuring before this is affordable.
- **Leave it** — 3 ops of 2392, on a spec already at 93.8%.

**Refs:** `src/oas/generator/typesCollector.ts` (`collect`, `findSelectedFieldNode`),
`src/oas/oasContext.ts` (`sdlPropOverrides`), `src/oas/nodes/obj.ts` (`generate` override lookup vs
`select`), `src/oas/nodes/propCircRef.ts`. See #13 for the mechanism and #26 for the reachability
walk that has to mirror both.

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
