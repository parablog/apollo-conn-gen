# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry here (`// see docs/issues.md #N`) instead of carrying the full rationale inline. Every
entry has an **OAS:** snippet showing the input schema that triggers it, a concrete **before → after**
example, an **AST:** note stating how (or whether) the node tree changed, and fixed ones have an
executable companion fixture under `tests/resources/oas/`.

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` tracks priority/gaps and may link to these ids.

Style: keep entries scannable — short labeled bullets, **one fact per line**, example near the top;
no paragraph-blobs. The example carries the weight; prose only adds what the example can't show.

Status: ✅ Fixed · ⬜ Open.

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

## 1 · Non-identifier JSON field names produce invalid GraphQL — ✅ Fixed (`5c2e2f9`, R3)
**Symptom:** keys like `2fa_enabled`, `full name`, `cost$` emit invalid fields / selections that fail
composition.
**Cause:** field/arg/select names weren't guaranteed to be valid GraphQL identifiers.
**Fix:** `Naming.genParamName` / `sanitiseFieldForSelect` sanitise + alias the safe field back to the
original JSON key.
**OAS:**
```yaml
properties:
  2fa_enabled: { type: boolean }
  full name:   { type: string }
  cost$:       { type: number }
```
**Example**:
```graphql
# before: invalid identifiers
type Thing { 2fa_enabled: Boolean, full name: String }     # ✗ won't parse
# after: safe field + alias in the selection
type Thing { _2faEnabled: Boolean, fullName: String }
# selection:  _2faEnabled: "2fa_enabled"   fullName: "full name"
```
**AST:** untouched — emission-only. Nodes keep the raw JSON key as their name; sanitising + aliasing
happen at write time, so `path()`/ids/selection addressing are unaffected.
**Refs:** `src/oas/utils/naming.ts`, tests `test_R3_*`.

## 2 · Path params emitted raw, not templated as `{$args.…}` — ✅ Fixed (`e384a4f`, R8)
**Symptom:** snake_case path params → rover `INVALID_URL` (`engine_id` must start with `$args`).
**Cause:** templating regex `/\{([a-zA-Z0-9]+)\}/` excluded `_` and used the raw key, but the arg is the
sanitised camelCase name.
**Fix:** match the full `{…}` and map through `Naming.genParamName`.
**OAS:**
```yaml
paths:
  /engines/{engine_id}:
    get:
      parameters:
        - name: engine_id
          in: path
          required: true
```
**Example**:
```graphql
enginesByEngineId(engineId: String!): Engine
  @connect(http: { GET: "/engines/{engine_id}" })       # ✗ before  → INVALID_URL
  @connect(http: { GET: "/engines/{$args.engineId}" })  # ✓ after
```
**AST:** untouched — emission-only. The URL template is rewritten in the operation writer; `Param`
nodes are unchanged.
**Refs:** `src/oas/io/operationWriter.ts` (`requestMethod`), fixture `path-param-snake.yaml`.

## 3 · `$ref` JSON-pointers into `#/paths/…` not resolved — ✅ Fixed (`d8914d1`, refactor `3f336ca`)
**Symptom:** DigitalOcean shares params/responses/schemas via pointers → "Schema not found for ref" /
"Could not find a response".
**Cause:** `lookupParam`/`lookupRef`/`lookupResponse` only handled `#/components/…`.
**Fix:** generic `resolvePointer` (RFC-6901 `~1/~0` + percent-decode; follows nested `$ref` chains) as a
fallback in all three. **(NB: resolves them but leaves naming broken — see #8.)**
**Example** — one op references another op's parameter:
```yaml
# /v2/actions GET parameters:
- $ref: '#/paths/~1v2~1account~1keys/get/parameters/0'   # encodes the path key /v2/account/keys
# before: throw "Schema not found for ref: #/paths/~1v2~1account~1keys/get/parameters/0"
# after:  resolvePointer decodes ~1 -> "/" and walks paths./v2/account/keys.get.parameters[0]
```
**AST:** new subtrees exist where before the build threw (no tree at all). The pointer-resolved schema
builds ordinary nodes whose **names/ids carry the raw pointer** — cleaned up at emission by #8.
**Refs:** `src/oas/oasContext.ts`, fixture `ref-into-paths.yaml`.

## 4 · Schema with `items` but no `type: array` rejected — ✅ Fixed (`e3087cf`, R7)
**Symptom:** Slack `{ items: { anyOf: [...] } }` (implied array) → "Cannot handle schema".
**Cause:** `Factory.fromSchema` only took the array path when `type === 'array'`.
**Fix:** treat `items` present (+ no/`array` type) as an implied array.
**OAS** (Slack — note: no `type: array`):
```yaml
latest:
  items:
    anyOf:
      - $ref: '#/components/schemas/ObjsMessage'
```
**Example**:
```
before: createScalarType -> throw "Cannot handle schema"
after:  latest: [ObjsMessage]      # treated as a list
```
**AST:** shape change — the schema now routes to the array path, building `Arr → <items type>`
(here `Arr → Union(anyOf …)`) where before construction threw and no node existed.
**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`), fixture `implied-array.yaml`.

## 5 · Contentless `allOf` members crash generation — ✅ Fixed (`d8797e7`, R2)
**Symptom:** a metadata-only `allOf` member (`{ description }` or `{ required: [...] }`) →
"Cannot handle schema". (Box `--Full`/`--Mini`, many Slack methods.)
**Cause:** `Composed.visitAllOfNode` passed every member to `fromSchema`; a member with no
`$ref`/`type`/`properties`/composition/`items`/`enum` has no GraphQL shape.
**Fix:** `Factory.isEmptySchema` predicate; skip those members.
**Example**:
```yaml
allOf:
  - { type: object, properties: { total: { type: integer } } }
  - { required: [total] }      # contentless -> before: throw; after: skipped
# -> type { total: Int }
```
**AST:** shape change — the contentless member contributes **no child** to `Composed.children`
(before: the whole build threw mid-tree). Sibling members are built as usual.
**Refs:** `src/oas/nodes/comp.ts` (`visitAllOfNode`), `factory.ts` (`isEmptySchema`), fixture
`allof-empty-member.yaml`.

## 6 · Leading-digit type names rejected — ✅ Fixed (`0b9c31e`, R3)
**Symptom:** an item type from a digit-leading path → rover `INTERNAL_ERROR`
("Unexpected character `C` as integer suffix").
**Cause:** `genTypeName` didn't guard leading digits like `genParamName` does.
**Fix:** prefix `_` for digit-leading/empty names (idempotent for valid names); definition + references
both route through `genTypeName`, so they stay consistent.
**OAS** (DigitalOcean):
```yaml
paths:
  /v2/1-clicks:        # path segment starts with a digit -> item type name does too
    get: { ... }
```
**Example**:
```graphql
type 1ClicksItem { slug: String }    # ✗ before  → INTERNAL_ERROR
type _1ClicksItem { slug: String }   # ✓ after
```
**AST:** untouched — emission-only. Node names/ids keep the raw digit-leading name; the `_` guard
applies in `genTypeName` at write time (definition and references both route through it).
**Refs:** `src/oas/utils/naming.ts` (`genTypeName`), fixture `type-name-digit.yaml`.

## 7 · Inline `allOf`-property emits `[inline:…]` as the type name — ✅ Fixed (`eb768c7`, R2)
**Symptom:** an `allOf` used as a *property* value (DigitalOcean `meta`) → `INTERNAL_ERROR` (brackets/
colon are illegal identifiers). Surfaced by #5 (the contentless member that used to throw is now
skipped, so the malformed type reaches composition).
**Cause:** `Composed.updateName` fell to the `[inline:${parent.name}]` fallback for un-named inline
composed.
**Fix:** when the parent is a `Prop` (a `PropComp` — the composed is a field's value type and **will be
emitted**), derive a real name from the property key. **Gated on `Prop`** because `allOf` *members* of
another `Composed` are consolidated (not emitted) and keep the `[inline:…]` id that selection paths
reference (`test_010`/`test_018`) — renaming those would break the paths.
**OAS** (DigitalOcean — `allOf` as a *property* value):
```yaml
meta:
  allOf:
    - type: object
      properties:
        total: { type: integer }
    - required: [total]
```
**Example**:
```graphql
type [inline:meta] { total: Int }   meta: [inline:meta]!   # ✗ before  → INTERNAL_ERROR
type Meta { total: Int }            meta: Meta!            # ✓ after
```
**AST:** identity change — the inline `Composed` is renamed at build when its parent is a `Prop`:
`comp:type:[inline:meta]` → `comp:type:Meta` (id/path follow the name). Consolidated `allOf` *members*
keep their `[inline:…]` ids — selection paths reference them.
**Refs:** `src/oas/nodes/comp.ts` (`updateName`), fixture `inline-allof-prop.yaml`.

---

## 8 · Resolved `#/paths` schema refs leak the raw pointer as the type name — ✅ Fixed (`7431952`)
**Symptom:** `INTERNAL_ERROR` / `INVALID_GRAPHQL` / `CONNECTORS_UNRESOLVED_FIELD`. ~82/145 DigitalOcean
ops; gated DigitalOcean at ~35%.
**Cause:** #3 made `lookupRef` *resolve* `#/paths/…` schema refs, but the resolved type is named by the
raw pointer; the ref-name extractor (`RemoveRefConverter`) only stripped `#/components/…`.
**Fix:** `RemoveRefConverter` derives a clean name from the `#/paths` pointer tail (`nameFromPathsPointer`
— property after the last `properties`, `+Item` for array `items`). Same family as #3.
**DigitalOcean 35% → 74%** (measured).
**OAS** (DigitalOcean — schema `$ref` pointing into another op's response):
```yaml
widget:
  $ref: '#/paths/~1widgets/get/responses/200/content/application~1json/schema/properties/widgets/items'
```
**Example**:
```graphql
type #/paths/~1widgets/get/responses/200/.../properties/widgets/items { … }  # ✗ before  → INTERNAL_ERROR
type WidgetsItem { … }   widget: WidgetsItem                                  # ✓ after
```
**AST:** untouched — emission-only. Node ids stay the full pointer (so #3's selection paths keep
working); only the emitted type name is derived from the pointer tail.
**Refs:** `src/oas/utils/naming.ts` (`RemoveRefConverter` / `nameFromPathsPointer`), fixture
`ref-schema-into-paths.yaml`. **Remaining DO residual is a separate bug — see #11.**

## 9 · Inline-type name collisions collapse distinct shapes — ✅ Fixed (`6977eaa`)
**Symptom:** selection references a field missing on a type → `SELECTED_FIELD_NOT_FOUND` (googlebooks,
github).
**Cause:** two structurally-different inline objects derive the same property-based name (the property
key) and dedup by name, losing fields. (The historical "duplicate Addressable/Extensible" problem.)
**Fix:** `Obj.visit` qualifies a colliding inline object with its container (nearest non-prop ancestor) —
`listPrice` under `saleInfo` -> `SaleInfoListPrice` — so distinct shapes survive as distinct types. Three
exclusions keep this from over-splitting:
- `$ref`-named types (`T.isRef`) — they are genuinely shared and dedup by id.
- `[inline:…]` consolidated `allOf`/`oneOf` members (`comp.ts:220`, `obj.ts` `updateName`) — they fold
  into their parent `Composed` and never emit standalone, so they must keep a shared id; otherwise a
  duplicate `$ref` instance's member escapes `Composed.consolidate()` and emits as an orphan type with
  no connector (`CONNECTORS_UNRESOLVED_FIELD`).
- the renamed node's `id` is name-derived (`obj.ts:35`, a getter), so the rename flows to both the
  definition and the reference (same instance) before collection — references stay in sync for free.
**OAS** (Google Books — same property key, two different inline shapes):
```yaml
saleInfo:
  properties:
    listPrice:
      properties:
        amount:       { type: number }
offers:
  items:
    properties:
      listPrice:
        properties:
          amountInMicros: { type: number }
```
**Example** (now split, both compose):
```graphql
# saleInfo.listPrice -> { amount }      offers[].listPrice -> { amountInMicros }
type ListPrice { amountInMicros: Float; currencyCode: String }          # first occurrence keeps the key
type SaleInfoListPrice { amount: Float; currencyCode: String }          # collider qualified by container
type OffersItem { listPrice: ListPrice }
type SaleInfo   { listPrice: SaleInfoListPrice }
```
**AST:** identity change — `Obj.visit` renames the colliding inline node:
```
obj:type:listPrice            obj:type:listPrice              ← first occurrence keeps its id
obj:type:listPrice    →       obj:type:SaleInfoListPrice      ← collider re-keyed
# ids are name-derived, so the collector's id-keyed dedup now keeps BOTH shapes; the field reference
# follows automatically (same node instance). Tree shape unchanged.
```
**Refs:** `src/oas/nodes/obj.ts` (`visit`/`resolveNameConflict`), `src/oas/utils/naming.ts`
(`genTypeName` now strips all non-identifier chars). Fixture `tests/resources/oas/inline-name-collision.yaml`,
test `test_inline_name_collision_splits_by_container`.

## 10 · Abstract-types (v0.4) path "infinite-loops" on recursive schemas — ✅ Fixed (`1c391bf`)
**Symptom:** `consolidateUnions:false` + connect v0.4 appeared to busy-loop (100% CPU, never returns) on
Confluence's recursive `Content`/`User`/`Space` schemas; the harness skipped the whole Confluence abstract
pass. Default v0.3 path was fine.
**Cause** — two independent defects, neither an actual infinite loop:

1. **Quadratic selection matching.**
   - Confluence's descendant op legitimately expands to ~2,700 types and a ~20,000-entry selection
     (path multiplicity: `User` reached via `createdBy`, `contributors`, `version.by`, …).
   - `selectedProps` re-ran `prop.path()` (rebuild `ancestors()` + join + regex) once per selection
     entry, per prop → O(types × props × 20k). Finite, but hours.
2. **Recursion never cut.**
   - True cycles (`User → personalSpace → Space → … → results: [User]`) were only caught when the
     *property name* coincidentally repeated (`results` under `results`).
   - The existing checks compare node ids (name-derived), and the recursion mints distinct synthesized
     names per depth → never matched.
   - The cycle reached the connector selection → rover `CIRCULAR_REFERENCE`.

**Fix:**

1. `selectedProps` indexes the selection once into a `Set` of its `>`-boundary prefixes
   (`selectionPrefixes`, cached per selection array) — O(1) per prop. Hours → seconds.
2. Cycle detection by **schema identity** (`Factory.cyclicAncestor`):
   - a recursive schema can only close through a component `$ref`, and `lookupRef` returns the *same
     `SchemaObject` instance* per ref → compare `a.schema === resolvedSchema` along `ancestors()`;
   - scoped to the current expansion path (never a global seen-set), so a shared non-recursive
     component used by sibling fields is *not* cut;
   - the cut renders **commented in both artifacts** (SDL + selection) — node structure below.

### Circular-reference nodes (AST structure)
A detected cycle becomes a *node* in the type tree (see the hierarchy in "Node model" above), not a
silent drop — the cycle is durably marked, the UI can render it, and when connectors support recursion
the renders flip in one place with zero change to detection. Three node kinds:

| Node | Created by | When | Renders as |
|---|---|---|---|
| `CircularRef` (`circularRef.ts`) | `Type.add` (`type.ts`) | legacy id-based cut: a *type* child whose id is already in `ancestors()` (e.g. `$ref` member of a union/allOf re-entering) | SDL: nothing (no-op `generate`); selection: `# Circular reference to '<name>' detected!` |
| `PropCircRef` (`propCircRef.ts`) | `Factory.fromProp` | a *property* re-enters: legacy prop-id repeat, the new `cyclicAncestor` schema-identity match on a direct `$ref` prop, or an array field whose items were cut (the sentinel bubbles up to the whole field) | SDL: `# <field>: <Type> - circular reference omitted`; selection: `# <field>: circular reference omitted …` |
| `RefCircRef` (`refCircRef.ts`, extends `CircularRef`) | `Factory.fromSchema` (via `fromRefCircRef`) | a `$ref` resolved anywhere *below* a property (array items, union/allOf members, map values) re-enters a schema on the path — returned *instead of* constructing the recursive container | SDL: `# <Member>: circular reference omitted`; selection: same comment. Legacy `CircularRef.generate` stays a no-op so v0.3 output is byte-identical |

All three are traversal-terminating (`visit`/`add`/`expand` are no-ops / yield no children). The collector
(`collectExpandedPaths`) treats a `PropCircRef` as a *selectable leaf* so the commented field is emitted
rather than silently dropped. Detection happens **only at construction time** (`fromProp` + `fromSchema`,
one shared predicate) — there is no traversal-time detector.

**OAS** (fixture; Confluence's `Content`/`User`/`Space` is the real-world case):
```yaml
Node:
  type: object
  properties:
    parent:   { $ref: '#/components/schemas/Node' }    # direct self-cycle
    children:
      type: array
      items: { $ref: '#/components/schemas/Node' }     # cycle through array items
    meta:     { $ref: '#/components/schemas/Shared' }  # shared, NOT recursive -> must not be cut
    extra:    { $ref: '#/components/schemas/Shared' }
```

**AST before → after** — `Node.children: { type: array, items: { $ref: Node } }` (and a direct
`parent: { $ref: Node }`):
```
before: each re-entry rebuilds Node            after: cut at the FIRST re-entry of a schema
(fresh copies per depth, unbounded)            already on the ancestor path
Obj(Node)                                      Obj(Node)
├─ PropObj(parent)                             ├─ PropCircRef(parent)        ← wraps the PropObj; leaf
│  └─ Obj(Node)            ← re-entry          ├─ PropCircRef(children)      ← PropArray bubbled up:
│     └─ PropObj(parent)…                      │    (its items resolved to a RefCircRef sentinel)
├─ PropArray(children)                         ├─ PropObj(meta)
│  └─ Obj(Node)            ← re-entry          │  └─ Obj(Shared)             ← shared non-recursive ref:
│     └─ PropArray(children)…                  │       NOT cut (not its own ancestor)
└─ …                                           └─ PropObj(extra) → Obj(Shared)
```

**Output before → after**:
```graphql
# ✗ before — the cycle reaches the connector selection; rover rejects it:
#   CIRCULAR_REFERENCE: type `Node` appears more than once in `…children.children`
nodes: Node @connect(… selection: """
  children { children { children { … } } }
""")

# ✓ after — cut commented in BOTH artifacts (inert, composes):
type Node {
  # children: [Node] - circular reference omitted
  extra: Shared
  id: String
  meta: Shared
  # parent: Node - circular reference omitted
}
nodes: Node @connect(… selection: """
  # children: circular reference omitted (re-visit schema and remove the reference)
  extra { label }
  id
  meta { label }
  # parent: circular reference omitted (re-visit schema and remove the reference)
""")
```
**Refs:** `src/oas/nodes/type.ts` (`selectionPrefixes`/`selectedProps`), `factory.ts`
(`cyclicAncestor`/`fromRefCircRef`), `propCircRef.ts`, `refCircRef.ts` (new), `iType.ts` (`schema` declared
on the interface), `typesCollector.ts`. Fixture `recursive-cycle.yaml`, test
`test_recursive_schema_cut_composes_abstract_pass`. Note: the Confluence abstract pass now terminates in
seconds and cuts correctly, but still fails compose on a *name* collision — tracked as #12.

## 11 · `anyOf`/`oneOf` param emits an empty arg type — ✅ Fixed (`985bc97`)
**Symptom:** `INTERNAL_ERROR` — an arg emitted with no type: `sshKeyIdentifier: !` (DigitalOcean
`/v2/account/keys/{ssh_key_identifier}`). Exposed once #8 cleared the type-name leak on the same ops.
**Cause:** the param's schema is `anyOf: [int, string]` (here via `#/paths` refs, issue #3). A GraphQL
argument must be a single scalar; `fromSchema(anyOf)` builds a `Union`, which isn't a valid arg type, so
the arg type renders empty.
**Fix:** `Param.visit` coerces an `anyOf`/`oneOf` param schema to `String` (path/query args are scalars).
**OAS** (DigitalOcean — a path param that accepts an id *or* a name):
```yaml
parameters:
  - name: ssh_key_identifier
    in: path
    required: true
    schema:
      anyOf:
        - type: integer
        - type: string
```
**Example**:
```graphql
sshKeyIdentifier: !          # ✗ before  → INTERNAL_ERROR (no type before `!`)
sshKeyIdentifier: String!    # ✓ after
```
**AST:** shape change — the param's value type is built differently:
`Param → Union(int | string)` becomes `Param → Scalar(String)`.
**Refs:** `src/oas/nodes/param.ts` (`visit`), fixture `param-anyof.yaml`.

## 12 · Inline object collides with a component's *emitted* name — ✅ Fixed (`cf19247`)
**Symptom:** Confluence abstract pass: `CIRCULAR_REFERENCE: type User appears more than once in
…subjects.user` — even after the real recursion is cut (#10).

**OAS** (Confluence — an *inline* pagination wrapper whose property key is `user`):
```yaml
SpacePermission:
  properties:
    subjects:
      type: object
      properties:
        user:                       # inline wrapper, NOT the component User
          type: object
          properties:
            results:
              type: array
              items: { $ref: '#/components/schemas/User' }
            size:  { type: integer }
```
**Example**:
```graphql
users: [User]                          # component #/c/s/User
…  subjects { user: User }             # ✗ before: inline wrapper also emits `type User` → CIRCULAR_REFERENCE
…  subjects { user: SubjectsUser }     # ✓ after: qualified by its container, like a #9 collision
```

**Cause:**
- `subjects.user` is an *inline* pagination wrapper (`{results: [$ref User], size, start, limit}`).
- It keeps its property key as its name (`user`) → emits as `type User`, same name as the component
  `#/components/schemas/User`.
- The #9 guard compared **raw** stored names (`'user'` vs `'#/components/schemas/User'`) — the
  cross-namespace collision was invisible.
- Two shapes emit under one name; rover sees `User` nested inside `User` → calls it circular.

**Fix:**
- `context.store` also reserves the **emitted** name (`Naming.genTypeName`).
- The guard — extracted to `Obj.collidesWithStoredType` — checks raw *and* emitted occupancy.
- Only **inline** objects rename. Safe: an inline object is referenced solely through its owning prop
  (same instance, name-derived id) so the reference follows. `$ref`-named types (`T.isRef`) never rename.

**Limitation** (pre-existing, same as #9): occupancy is point-in-time — an inline visiting *before* the
component is stored won't see the collision. Components are reached at shallower depths first in practice.

**AST:** identity-only, like #9 — `obj:type:user` → `obj:type:SubjectsUser`; no shape change.
**Refs:** `src/oas/nodes/obj.ts` (`collidesWithStoredType`/`resolveNameConflict`), `oasContext.ts`
(`store`). Fixture `inline-vs-component-name.yaml`, test
`test_inline_renamed_when_colliding_with_component_emitted_name`. Next Confluence blocker: #13.

## 13 · Path-dependent cycle cuts make same-named instances diverge — ⬜ Open
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
**Refs:** `src/oas/generator/typesCollector.ts` (`collect`, id-keyed `pendingTypes`),
`src/oas/nodes/propCircRef.ts`. Until fixed the harness keeps `confluence.json::abstract` skipped.

## 14 · connect v0.4 composition doesn't credit `->entries` sub-selections — ⬜ Open (upstream)
**Symptom:** 26/43 Mercedes CCS ops fail the abstract pass with
`CONNECTORS_UNRESOLVED_FIELD: AlternativesEntry.key / .value` — yet the selection selects both.
CCS default pass: 100%.

**OAS origin** — where the map comes from: an OAS *dictionary* (`additionalProperties` = arbitrary
keys, here currency code → amount):
```yaml
Amount:
  properties:
    alternatives:
      type: object
      additionalProperties:
        $ref: '#/components/schemas/Amount'
```
GraphQL has no map type, so the generator's `Map` node (`map.ts`) emits a synthetic entry type and maps
the JSON object through `->entries`:
- SDL: `alternatives: [AlternativesEntry]` + `type AlternativesEntry { key: String value: Amount }`
- selection: `alternatives: alternatives->entries { key value {…} }`

**Example** — identical schema, two compose runs:
```graphql
alternatives: [AlternativesEntry]            # SDL (the Map node's emission)
alternatives: alternatives->entries {        # selection
  key
  value { unit value }
}
# connect v0.3 / fed 2.12: ✓ composes
# connect v0.4 / fed 2.13: ✗ CONNECTORS_UNRESOLVED_FIELD: AlternativesEntry.key, AlternativesEntry.value
```

**Evidence** (A/B compose — not a generator bug):
- The **byte-identical** schema, with only the two `@link` version strings swapped:
  - connect v0.3 / fed 2.12 → ✓ composes
  - connect v0.4 / fed 2.13 (Rover 0.40.0) → ✗ fails
- Reproduced on two independent ops; the gap histogram buckets all 26 failures here.

**Root cause** (found in the router source, `apollo-federation/src/connectors/validation/connect/selection.rs`):
- v0.1–v0.3 use the **frozen legacy AST-visitor** validator; v0.4+ switched to **shape-based**
  validation (`selection.rs:120`).
- The new `walk_selection_with_shape` credits fields only for `ShapeCase::Object` (and `One`);
  **`ShapeCase::Array` falls into `_ => Ok(Vec::new())`** (`selection.rs:728`) — no fields credited.
- `->entries` is the method whose *static* shape is an explicit **list** (`entries_shape` returns
  `Shape::list/array` in every branch) → its sub-selection arrives as an Array shape → unhandled.
- Why others survive: `->first` returns the *item* shape (Object/Unknown → handled, credited —
  verified composing); plain list fields (`results { id }`) are statically Unknown (array-ness is
  runtime-only) → sub-selection yields an Object record → handled.
- Confirmed with a 30-line minimal repro (one map field, `->entries { key value }`): v0.3 ✓, v0.4 ✗.

**Next step:** report upstream — the fix is an `Array { prefix, tail }` arm in
`walk_selection_with_shape` recursing the item shape against the same `type_ref` (the caller already
unwrapped the GraphQL list via `inner_named_type()`). Likely also affects `->map` with sub-selections
(same static-array shape family). If we need to unblock sooner: under `connectorSpecVersion >= v0.4`,
degrade map values to `JSON` — same best-effort convention as #10.

**AST:** untouched — tree and emission are correct; the divergence is in composition validation.
**Refs:** `src/oas/nodes/map.ts` (`generate`/`select`). Found by adding CCS to the coverage sweep
(default 100%, abstract 39.5%); fixing this one family takes CCS abstract to ~100%.

**Status update:** fix drafted and verified locally — `212e35b60` on router branch
`fix/connect-v04-array-shape-seen-fields` (one `ShapeCase::Array` arm + fixture + snapshot + changeset;
test fails without the patch, passes with it). Re-running the corpus through the patched composition
(`apollo-federation-cli` + rover shim): **CCS abstract 39.5% → 100%**, and the patch recovers **~69 ops
corpus-wide** (box +14, github +15, confluence +7, DO +4, omni +2, asana +1) — abstract overall
73.5% → 79.1%. Awaiting internal PR.

## 15 · Response-root `allOf` type referenced but never emitted — ⬜ Open
**Symptom:** the new dominant compose failure after #14 — **143 ops** across the corpus (DO, box,
github, sendgrid, …):
`INVALID_GRAPHQL: cannot find type V2CustomersMyBillingHistoryResponse in this document`.
The Query field references the synthesized response type; its definition never appears (the name occurs
exactly once in the output — the reference).

**OAS** (DigitalOcean — the *response root* is an `allOf`):
```yaml
responses:
  '200':
    content:
      application/json:
        schema:
          allOf:
            - properties:
                billing_history:
                  items: { properties: { amount: …, date: …, description: … } }
            - $ref: '#/components/schemas/pagination'
            - $ref: '#/components/schemas/meta'
```

**Example**:
```graphql
v2CustomersMyBilling_history: V2CustomersMyBillingHistoryResponse   # reference emitted…
# …but no `type V2CustomersMyBillingHistoryResponse { … }` anywhere → INVALID_GRAPHQL
```

**Suspected cause (hypothesis — needs the comp.ts emission walk):** a response-root `Composed`
(`allOf`) gets its reference name from `getGqlOpName() + 'Response'`, but its definition is dropped on
emission — likely `Composed.generate` skipping when `selectedProps` is empty post-consolidation, or a
definition/reference naming divergence. Probably **not** v0.4-specific (DO's default pass shows the
same `INVALID_GRAPHQL` count family). Side smell in the same op: the field name keeps a raw underscore
(`v2CustomersMyBilling_history`) — `getGqlOpName` doesn't camelize every segment.

**AST (suspected):** emission-only or a missing collect — to be confirmed.
**Refs:** `src/oas/nodes/comp.ts` (`generate`/`consolidate`), `res.ts`, `operationWriter`. Biggest
single family in the post-#14 gap histogram (143 of 151 remaining compose-fails).
