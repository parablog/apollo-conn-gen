# Fixed generator issues

Archive of the entries in `docs/issues.md` that are done. Split out on 2026-08-14 because the one
file had grown to 89 entries and the open ones were lost in it.

- **Ids are global.** They are not renumbered here and are not reused in `docs/issues.md`; a `#N`
  in either file means the same entry.
- Code comments cite fixed entries as `// see docs/FIXED.md #N`, open ones as
  `// see docs/issues.md #N`.
- `docs/issues.md` holds the open entries, the style rules, and the node-model diagram the
  entries below refer to.
- Every entry keeps its fixture under `tests/resources/oas/` and its test.

Nothing here should need editing again. If a fixed entry regresses, move it back rather than
opening a duplicate.

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
**Refs:** `src/oas/nodes/comp.ts` (`visitAllOfNode`), `src/oas/utils/schemas.ts` (`Schemas.isEmpty`,
which is where `Factory.isEmptySchema` now lives), fixture `allof-empty-member.yaml`.

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
component is stored won't see the collision. Components are reached at shallower depths first in practice
— but #36's visit-order change broke that for array-reached wrappers; re-fixed structurally in #37.

**AST:** identity-only, like #9 — `obj:type:user` → `obj:type:SubjectsUser`; no shape change.
**Refs:** `src/oas/nodes/obj.ts` (`collidesWithStoredType`/`resolveNameConflict`), `oasContext.ts`
(`store`). Fixture `inline-vs-component-name.yaml`, test
`test_inline_renamed_when_colliding_with_component_emitted_name`. Next Confluence blocker: #13.

## 14 · connect v0.4 composition doesn't credit `->entries` sub-selections — ✅ Fixed (supergraph plugin ≥ 2.15.0)
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
73.5% → 79.1%.

**Status update (2026-07-04):** the router PR was reviewed and **accepted upstream**. Nothing to do
generator-side — this closes on its own once a router release ships with the patch. Re-run the
Mercedes CCS row of the corpus sweep (`COVERAGE.md`) against a released rover that includes it to
confirm, then flip this entry to ✅ Fixed. Until then, stock rover still hits the same
`CONNECTORS_UNRESOLVED_FIELD` on `->entries` — don't re-investigate this as a new bug.

**Status update (2026-08-10) — closed.** The fix shipped upstream as `5b4afe1066` (router #9619) and
is in the published **supergraph plugin 2.15.0+**, which stock rover 0.40 downloads fine. The harness
pins moved `=2.14.1 → =2.15.1` (`tools/coverage-spec.mts`, `tools/vet-spec.mts`, the `compose()`
default in `src/tests/runners.ts`); the full GET sweep confirms:
- Mercedes CCS **39.5% → 100%** (43/43) — the 26 `->entries` ops all compose.
- Corpus-wide **+83 ops** (2218 → 2301 of 2318): stripe +37, CCS +26, github +7, docker-engine +6,
  incident.io +4, square +2, omni +1.
- The `CONNECTORS_UNRESOLVED_FIELD` bucket collapsed **89 → 4** (a github residue, separate shape).

## 15 · Composed/Union definition and reference emit divergent names — ✅ Fixed (`44b628d`)
**Symptom:** the dominant compose failure after #14 — **143 ops** in the abstract sweep (DO, box,
sendgrid, …): `INVALID_GRAPHQL: cannot find type V2CustomersMyBillingHistoryResponse in this document`.
(The entry originally hypothesized "never emitted" — wrong: it IS emitted, under a divergent name —
`type V2CustomersMyBilling_historyResponse` — which a first grep missed.)

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
type V2CustomersMyBilling_historyResponse { … }                      # ✗ definition: upperFirst(getRefName)
v2CustomersMyBilling_history: V2CustomersMyBillingHistoryResponse   # ✗ reference: genTypeName → no match
type V2CustomersMyBillingHistoryResponse { … }                       # ✓ after: both via genTypeName
```

**Cause:**
- The response-root `Composed` is named `getGqlOpName() + 'Response'` — carries the path's `_`.
- Definition: `Composed.generate` (`comp.ts:80`) wrote `_.upperFirst(getRefName(name))` — keeps `_history`.
- Reference: the Res/return-type path writes `genTypeName(name)` — camelizes to `History`. Divergent.
- `Union.generate` (`union.ts:99`) had the identical pattern.
- Same family as #6: definition and reference must both route through `genTypeName`. Pass-independent
  (emission), so it affected default AND abstract.

**Fix:** both sites now use obj.ts's #6 pattern (`sanitised === refName ? refName : sanitised`).
Measured (stock rover, both passes): **sendgrid 77.9 → 89.0%**, **box 57.0 → 66.7%**,
**digitalocean 86.2 → 91.7%** — `INVALID_GRAPHQL` collapsed 143 → ~39 (residue is a different
sub-cause, e.g. box `retention_policies` — to triage). Side smell left open: `getGqlOpName` doesn't
camelize every path segment (`v2CustomersMyBilling_history` — legal GraphQL, cosmetic).

**AST:** untouched — emission-only; node names/ids keep the raw separator-bearing name.
**Refs:** `src/oas/nodes/comp.ts` (`generate`), `union.ts` (`generate`). Fixture
`response-allof-snake-path.yaml`, test `test_response_allof_snake_path_def_ref_names_converge`.

## 16 · Selections don't mark OAS-optional fields with `?` — ✅ Fixed (needs composition ≥ 2.15)
**Parked (2026-06-10):** emitting `?` today would break composition for anyone on the released
toolchain — supergraph plugins 2.13/2.14 don't credit `?`-groups (2.15 fixes it but is unreleased,
confirmed 404). Users upgrading from fed 2.11 onwards would hit a hard regression. Revisit when a
composition release with the `One`-shape fix reaches rover.
**Symptom:** the router's connectors debugger warns about "missing properties" at runtime when the API
omits a field the selection references plainly. Marking optional fields with the mapping language's
optional-chaining `?` silences the warnings (verified by hand on petstore `/pet/findByStatus`).

**OAS** (petstore — `category`/`name`/`tags` are not in `required`):
```yaml
Pet:
  required: [id, photoUrls]
  properties:
    id:        { type: integer }
    name:      { type: string }      # optional -> may be ABSENT in the response
    category:  { $ref: '#/components/schemas/Category' }
    tags:      { type: array, items: { $ref: '#/components/schemas/Tag' } }
```

**Example** — selection before → after:
```
category {            category? {
  id                    id
  name                  name?
}                     }
name            →     name?
tags {                tags? {
  id                    id
  name                  name?
}                     }
```

**Proposal:**
- Emit `?` **iff the prop is not required** — driven by the existing `Prop.required` (set in
  `Obj.visitProperties` from the OAS `required` array; the same source of truth as the SDL `!`).
- Required props stay plain so the debugger still flags genuine contract violations.
- Exclude entity-resolver key fields (R1) — keys must be present.
- Mapping-language semantics match exactly: not-in-`required` = key may be absent; `?` = tolerate
  absence (`a?`, `a? { b }`, `a?->method`).

**Compose support (measured, stock rover + patched workspace):**
- v0.3 / fed 2.12: ✓ composes.
- v0.4 / composition **2.13 & 2.14**: ✗ — `category? { id name }` leaves `Category.id`/`Category.name`
  uncredited (`CONNECTORS_UNRESOLVED_FIELD`) — same shape-validator family as #14, different shape case
  (`?` produces `One([Object, None])`). Fixed in composition **2.15** (its `One`-arm walks branches;
  independent of our #14 patch).
- Nuance: seen-fields are unioned **across all connectors**, so a `?`-group composes on 2.13 *if* another
  op selects the same type's fields plainly — which is why a manual petstore test can pass.

**Status update (2026-08-10) — done.** Composition 2.15 shipped (see #14's closure) and the repo
composes at 2.15.1, so the park expired. As proposed: `Prop.optionalMarker` (`src/oas/nodes/prop.ts`)
emits `?` iff the prop is outside the OAS `required` list, and every prop writer appends it —
`propScalar` (skipped when the `?? $(default)` fallback already handles absence), `propObj`,
`propArray` (also skipped when its *items* scalar carries the default — digitalocean's
`emails: emails ?? $("")` would otherwise become the unreadable `emails?: emails ?? $("")`;
caught by the corpus lint sweep's blind counter, pinned in `test_R7_default_coalesces…`),
`propComp`, `propRef`, `propEn`, and `propMap`, where the marker sits on the key
*before* the method — `currency_options?->entries`, never `->entries?` (which would mark the
result instead).

Two exclusions:
- **request/body selections** (`parent.kind === 'input'`) — those reference GraphQL fields, not
  response keys;
- **entity keys** — a key that may be absent is not a key, so the same `Widget.id` writes `id?` in
  a Query selection and plain `id` inside the entity's own `@connect`. No new state: a prop is a
  key iff its owner sits mid-generation on `context.stack` (the same fact `writeEntityConnector`
  leans on for indent — true only while the type's own connector is written) and one of the
  owner's `entityResolvers` names it in `keyFields`. A nested object's own `id` has a different
  owner, so it still gets `?`. Both sides of the name check are raw OAS names today; the #65 fix
  must move them together, and `test_R1_16_aliased_optional_key_plain_only_in_entity_selection`
  fails loudly if they drift. Composition 2.15 *accepts* `id?` on a key (probed) — the
  suppression is semantic, not a compose requirement.

The published minimum to compose the output is now **composition 2.15** (plugin `=2.15.1`
everywhere in the repo), the same kind of floor v0.4 set at fed 2.13. The lint reader already
tokenized `?` at every step, so linted schemas stay clean.

**Tests:** `test_16_optional_response_fields_marked_in_selection` (petstore before/after),
`test_R1_16_entity_selection_keeps_key_plain`, `test_R1_16_aliased_optional_key_plain_only_in_entity_selection`,
`test_R6_16_batch_selection_keeps_key_plain`, `test_R6_16_composite_key_both_parts_plain`,
`test_R11_16_optional_markers_read_clean` (`?->entries` placement + lint-clean).

**AST:** untouched — emission-only (`select()` in the `Prop` subclasses appends `?` from
`prop.required`). Care points: aliased keys (`safe: "raw key"?`), arrays (`tags? {`), method chains
(`alternatives?->entries`).
**Refs:** `src/oas/nodes/prop*.ts` (`select`), `obj.ts` (`visitProperties` sets `required`). Gate: the
abstract pass needs composition ≥ 2.15 (or the patched toolchain) before this is corpus-safe on v0.4.

### Opt-out for callers below composition 2.15

A consuming project pinned to the latest stable federation composition, 2.14.3, could not compose
anything the generator produced,
so the markers are now switchable: `skipOptionalMarkers: true` (CLI `--skip-optional-markers`) drops
every one of them. The default is unchanged — markers on. All seven `writer.write('?')` sites are
gated by one predicate, so the switch is a single clause in `Prop.isOptionalInSelection`, placed
first so `isEntityKey` is never walked when markers are off.

Measured with stock rover on petstore `get:/pet/findByStatus` (the op `test_16` already uses):

```
markers on,  federation_version: =2.14.3  -> 4 x CONNECTORS_UNRESOLVED_FIELD
                                             (Category.id, Category.name, Tag.id, Tag.name)
markers off, federation_version: =2.14.3  -> composes
```

**Why the existing 2.14.x tests never caught this:** `compose()` in `src/tests/runners.ts` prefers
`tools/local/apollo-federation-cli` whenever it is present, and that binary takes only `--config`
and `--no-expand` — it has no federation-version selection and ignores `federation_version`
entirely. So `oas-core.test.ts` tests passing `composeFederationVersion: '2.14.3'` were composing on
the patched ≥2.15 build. A new `forceRover` option in the runner's opts bag skips the local binary
and calls Rover's installed official plugin for that exact version, so the pin means something.

**Refs:** `src/oas/nodes/prop.ts` (`isOptionalInSelection`), `src/oas/oasContext.ts` +
`src/oas/oasGen.ts` (the two parallel option lists), `src/cli/oas.ts`, `src/tests/runners.ts`
(`forceRover`). Tests `test_16_optional_markers_fail_composition_below_215` (the pinned 2.14.3
rejection), `test_16_skip_optional_markers_composes_below_215`,
`test_16_skip_optional_markers_reaches_the_cli`, `test_16_skip_optional_markers_moves_nothing_else`
(map fixture — the marker sits between the self-alias and `->entries`).

## 17 · Param defaults dangle ` = ` for non-number/string values — ✅ Fixed (`aae14ca`)
**Symptom:** rover syntax error — `expected a valid Value`:
`v2RegistryDockerCredentials(…, readWrite: Boolean = ): …` — the default's right-hand side is empty.
66 INTERNAL_ERROR-bucketed ops in the sweep (DigitalOcean-dominated); exact share to re-derive at fix
time.

**OAS** (DigitalOcean `/v2/registry/docker-credentials` — a boolean query param with a default):
```yaml
parameters:
  - name: read_write
    in: query
    required: false
    schema:
      type: boolean
      default: false
```

**Example**:
```graphql
readWrite: Boolean =       # ✗ before: dangling `= ` → syntax error at compose
readWrite: Boolean = false # ✓ after
```

**Cause:** `Param.writeDefaultValue` (`param.ts:74-85`) writes ` = ` unconditionally, then only fills
the value for `typeof number` and `typeof string`. Boolean — and array/object/null — defaults fall
through, leaving the dangling ` = `.

**Fix:** `writeDefaultValue` decides *before* writing ` = `: emits number/boolean/string
literals; skips the whole default otherwise (an omitted default is always valid GraphQL).
Fixture `param-default-bool.yaml`, test `test_param_default_boolean_emits_literal`.
**Measured** (with #19, same commit): +32 ops/pass — github 78.4→82.0, sendgrid 89.0→92.9,
slack 41.3→45.0, asana +2, confluence +2, openai now 0 compose-fails, DO 92.4.

**AST:** untouched — emission-only (`writeDefaultValue`); `Param` nodes unchanged.
**Refs:** `src/oas/nodes/param.ts` (`writeDefaultValue`). Found by the post-#15 triage sweep.

## 18 · Identical inline schemas rename instead of dedup → orphan types — ✅ Fixed (`0cff45d`)
**Symptom:** `CONNECTORS_UNRESOLVED_FIELD` — emitted types that no selection references: box
`/collaborations` `InlineSharedLinkPermissions`/`…2`, DO `/v2/apps` `ServicesGit15` (counter 15!).
(The second mirror symptom once logged here — box `retention_policies` `cannot find type` — was #15
residue and already composes.)

**OAS** (box — `File`/`Folder`/`WebLink` each carry a byte-identical *inline* `shared_link`):
```yaml
File:
  properties:
    shared_link:
      type: object
      properties:
        url:         { type: string }
        permissions: { type: object, properties: { can_download: { type: boolean } } }
Folder:
  properties:
    shared_link:     # byte-identical inline copy — NOT a $ref
      ...
```
**Example**:
```graphql
type Permissions { canDownload: Boolean }                   # referenced by the selection
type InlineSharedLinkPermissions { canDownload: Boolean }   # ✗ orphan — nothing references it
type InlineSharedLinkPermissions2 { canDownload: Boolean }  # ✗ orphan
# ✓ after: one `type Permissions`; both parents reference it
```

**Cause:**
- #9's collision check is name-occupancy only — a byte-identical inline duplicate renames exactly
  like a genuinely different shape.
- The rename mints a fresh name-derived id; the duplicate's *container* (also same-named → same id)
  dedups away in the collector.
- The renamed child was already added to `pendingTypes` (per expanded path) → emitted unreferenced.
- The two prior hypotheses were halves of one mechanism: per-path collection adds the children;
  container dedup/consolidation drops only the containers.

**Fix** (named predicates in `Obj`; `context.store` now keeps the node, not just the name):
- `isSameInlineDefinition` — a same-id occupant built from a deeply-equal raw schema is NOT a
  collision: keep the shared name, the collector dedups (`collidesWithStoredType`).
- `canConvergeOn` — when the occupant's id differs (pointer-named #8 / component #12 — keeping the
  name there would emit two definitions of it), sibling twins converge on the first renamed name
  instead of minting `2`, `3`, … (`resolveNameConflict`).

**Measured** (full corpus, both passes): **+36 ops/pass** — github 82.0→86.5 (+20), box 66.7→74.6
(+9), confluence 63.1→69.2 (+4), DO 92.4→93.8 (+2, `/v2/apps` family cleared), slack +1. Box's
remaining 14 compose-fails are different sub-causes — #22 (`/files/{file_id}` INTERNAL_ERROR ×9)
and `R-options-pairing` (`/metadata_templates` UNRESOLVED ×5) in ROADMAP.
**Care:** dedup requires BOTH the same name-derived id and deep schema equality — schema equality
alone produced `type StepsItem` *defined twice* on DO (caught mid-fix). #13 (path-dependent cycle
cuts diverging same-named instances) is unchanged by this.
**AST:** identity-only — identical twins keep the shared name/id (no rename); different shapes
rename as before, but convergently. Tree shape unchanged.
**Refs:** `src/oas/nodes/obj.ts` (`collidesWithStoredType` / `isSameInlineDefinition` /
`canConvergeOn`), `src/oas/oasContext.ts` (`store`). Fixture `inline-identical-dedup.yaml`, test
`test_inline_identical_shapes_dedup_not_renamed`.

## 19 · Typeless `{}` / `additionalProperties:false` schemas throw — ✅ Fixed (`aae14ca`)
**Symptom:** `GEN-THROW: Cannot handle schema` — generation aborts for the whole op. 18 confirmed ops
(slack 4, github 14) per pass; sendgrid(3)+omni(3) unexamined (ROADMAP `R-genthrow-tail`).

**OAS** (Slack `objs_message…shares` — properties with no type and no shape):
```yaml
shares:
  type: object
  additionalProperties: false
  properties:
    private:
      additionalProperties: false   # <- no type, no properties: an explicitly EMPTY object
    public:
      additionalProperties: false
```

**Example**:
```
before: Factory.fromSchema falls through to createScalarType -> throw "Cannot handle schema" (factory.ts:129)
after:  private: JSON     # shapeless object -> JSON scalar (the existing unknown-shape convention)
```

**Cause:** `fromSchema`'s container check requires `type: object` / composition / `properties`; a
schema whose only content is a boolean `additionalProperties` (or nothing at all) matches neither the
container nor the scalar branch → `createScalarType` throws. (`fromProp` already defaults this shape
to a `JSON` `PropScalar` — the throw only happens for schemas reached via `fromSchema`: array items,
map values, composition members.)

**Fix:** named predicate `Factory.isShapelessObject` (no shape keyword; boolean
`additionalProperties` allowed; a real map `additionalProperties: <schema>` is NOT shapeless)
routed to `Scalar(JSON)` in `fromSchema`. Fixture `shapeless-object.yaml`, test
`test_shapeless_object_schema_becomes_json_scalar`.
**Measured:** all slack(4)/github(14)/sendgrid(3) throws cleared — sendgrid's were this shape too
(fold into scope); omni's 3 persist → ROADMAP `R-genthrow-tail` confirmed as a different shape.
**Care:** do NOT route to `createContainerType` — an empty `Obj` is skipped by `Obj.generate`
(empty props), which would dangle the reference and re-create #15-style `INVALID_GRAPHQL`.

**AST:** shape change — `Scalar(JSON)` node where construction previously threw (no node at all).
**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`/`createScalarType`, throw at :129),
`isEmptySchema` (#5) as the predicate's relative.

## 20 · `anyOf: [$ref, empty-closed-object]` → zero types — ✅ Fixed
**Symptom:** github's "maybe empty" convention generates nothing — 3 `interaction-limits` GET
ops per pass (the research estimate of 10 lumped in multi-member anyOfs, which are a different
case — see Care).

**OAS** (github):
```yaml
anyOf:
  - $ref: "#/components/schemas/interaction-limit-response"
  - additionalProperties: false
    properties: {}
    type: object
```

**Example** (before → after):
```graphql
# before: the anyOf was dropped entirely -> zero types, op uncredited
# after: the fieldless member adds nothing; the anyOf collapses to its one real member
interactionLimits: InteractionLimitResponse
```

**Cause:** `createContainerType` built unions from `oneOf` only — `anyOf` members were
dropped, leaving an empty union and no types.

**Fix:** when an `anyOf` has exactly ONE member left after removing fieldless ones
(`isShapelessObject`), build that member directly — no union.

**Care (why this sat parked for two days):** the first attempt regressed DO -4 / slack -2 —
the collapsed members surfaced types the collector then orphaned (`UNRESOLVED_FIELD`). Those
were #26's bugs, not this fix's: retested after #26, the collapse is **+6 ops / 0 regressions**.
Multi-member anyOfs stay dropped on purpose — building real unions from them regressed ~10
github ops into the R2 union wall when measured.
**Narrowed by #86:** a multi-member choice of plain values (`anyOf: [string, number]`) inside a
list is no longer dropped — it reads as `[JSON]`. Choices with object members are still dropped.
**AST:** shape change for the collapsing case only — the member's node replaces an empty Union.
**Refs:** `src/oas/nodes/factory.ts` (`fromSchema` collapse + `isShapelessObject`).

## 21 · JSON walker: empty `{}` value emits a dangling type reference — ✅ Fixed
**Symptom:** compose fails `INVALID_GRAPHQL: cannot find type MainAttributes in this document`
(`articles/clockwatch`, fed 2.12). Under fed 2.11 the same schema bucketed as
`SELECTED_FIELD_NOT_FOUND` instead — bucket labels are composition-version dependent (cf. the
corpus note in `ROADMAP.md`).
**JSON** (clockwatch — same key, one occurrence empty, one shaped):
```json
"blocks": {
  "main": { "attributes": {} },
  "body": [ { "attributes": { "keyEvent": true, "title": "…", "pinned": false } } ]
}
```
**Example**:
```graphql
type BlocksMain { attributes: MainAttributes }   # ✗ reference emitted
type BodyAttributes { pinned: Boolean }          # body's type exists
# type MainAttributes is never emitted — no fields, writer skips it → dangling reference
```
**Cause:**
- The walker builds a type node for the empty `{}` value.
- The writer skips field-less types at generation.
- The parent field still renders its reference → `cannot find type`.
- Same failure family as #19's **Care** note (empty type dangles the reference), JSON-walker path.
**Fix (2026-06-12):** an empty-object *value* routes to the `JSON` scalar (the unknown-shape
convention, cf. #19) instead of minting a field-less type; the JSON writer now declares
`scalar JSON`. Walker-side counterpart of `Factory.isShapelessObject`.
**Care:** fixing this exposed #35 on the same fixture (same-named objects diverging on
fields) — the clockwatch test now pins that shape instead.
**Refs:** `src/json/walker/jsonGen.ts` (`walkElement`), `src/json/io/writer.ts`.
**AST:** shape change (proposed) — scalar node instead of an empty object type.
**Refs:** `src/json/walker/`, test `articles/clockwatch` (`tests/all/json.test.ts`, repinned
`c13cfe5`). Verified: walker output byte-identical 0.8.3 → HEAD except `@link` versions — the
bucket shift came from the R0 default bump (`72f625e`), not a walker change.

## 22 · `Composed` skips the #9/#12 collision check → duplicate type definitions — ✅ Fixed (`1669c6a`)
**Symptom:** `INTERNAL_ERROR: the type Permissions is defined multiple times in the schema` —
box `/files/{file_id}` and 8 sibling ops (9 per pass). Predates #18 (same counts before/after).

**OAS** (box — two *different* inline `permissions` shapes; the second is a nested `allOf`):
```yaml
SharedLink:
  properties:
    permissions:          # inline OBJECT -> Obj, stores the name (issue #9 path)
      type: object
      properties: { can_download: {type: boolean}, can_edit: {type: boolean} }
File--Full:
  properties:
    permissions:          # inline ALLOF -> Composed: never collision-checks
      allOf:
        - allOf: [ {properties: {can_delete: …}}, {properties: {can_annotate: …}} ]
```
**Example**:
```graphql
type Permissions { canDownload: Boolean canEdit: Boolean }   # the Obj
type Permissions { canAnnotate: Boolean canComment: Boolean… } # ✗ the Composed — same name, redefined
```

**Cause:**
- `collidesWithStoredType`/`resolveNameConflict` live on `Obj` only (`obj.ts`, issues #9/#12/#18).
- A `PropComp`-named `Composed` (#7: named from its property key) emits its name blindly
  (`comp.ts` `updateName`/`generate`) — no occupancy check against `context.types`.
- Same gap presumably applies to `Map` (`map.ts` has only the legacy `nameConflict` flag) and `Union`.

**Fix:** the #9/#12/#18 collision checks moved from `Obj` (private methods) to `T` statics in
`typeUtils.ts`, so `Composed.visit` can run them too (under the #7 gate, `parent instanceof Prop`).
The `Composed` check is narrower — `collidesAcrossNodeClasses` — it only renames when the stored
type is of a DIFFERENT node class:
- different class (the box case: Obj `permissions` vs Composed `Permissions`): ids start with the
  class (`obj:` / `comp:`), so the collector can never dedup the two — the name is always defined
  twice → must rename.
- same class: keep the old behaviour (both keep the name; the collector keeps one by id). Renaming
  these was tried first and broke box 85→76 ok: File/Folder/WebLink carry `created_by`/`parent`/…
  inline allOfs that are identical except for their `description`, so the deep-equality check saw
  them as different shapes and renamed each one. Which copy got renamed depended on visit order,
  the collector then kept a copy whose fields point at the other names, and the renamed types were
  emitted with nothing referencing them (the same failure #18 describes).
- `canConvergeOn` no longer requires the stored type to be an `Obj`, only the same class as the
  node (same behaviour for `Obj`; lets two renamed `Composed` twins share one name).

**Measured (box, default):** the duplicate definitions are gone (all 6 ops a static scan finds);
ok stays 85 — the 9 INTERNAL_ERROR ops have a second, separate bug that the duplicate was hiding,
and they now fail on that one: `PathCollection.entries: [FolderMini]` is selected down to its
scalar fields, but `#/c/s/Folder--Mini` itself is never emitted (a #13-family cycle cut, not this
bug).
**Care:** do NOT extend the `Composed` rename to same-class clashes unless the schema comparison
learns to ignore `description` — see the regression above. `Map`/`Union` still skip the check
(same presumed gap).
**AST:** identity change — the colliding `Composed` is renamed at visit, like #9; its members are
built after the rename, so their `[inline:…]` ids use the new name. Ops without a collision are
byte-identical.
**Refs:** `src/oas/nodes/typeUtils.ts` (`collidesAcrossNodeClasses`/`resolveNameConflict` + moved
checks), `src/oas/nodes/comp.ts` (`visit`), `src/oas/nodes/obj.ts` (delegates). Fixture
`composed-name-collision.yaml` (the outer allOf needs 2+ members — with a single inline member,
`updateName` takes the one-`$ref` branch, the name comes out `undefined` and the type is emitted
as `type _`; separate small bug), test `test_composed_collision_with_stored_object_splits_by_container`.
Found while triaging the #18 residue.

## 23 · OAS 3.1 type array (`type: [string, 'null']`) throws — ✅ Fixed
**Symptom:** `Cannot handle property type string,null` — generation throws, zero output.
omni `get:/v1/connections/{connectionId}/dbt`, `get:/v1/documents`, `get:/v1/models/{modelId}/git`
(3 ops, both passes). The R-genthrow-tail residue after #19 took sendgrid's three.

**OAS** (omni — 3.1 nullable-type syntax; 3.0 would say `nullable: true`):
```yaml
projectRootPath:
  type:
  - string
  - 'null'
  description: Path to dbt project root
```

**Example** (before → after):
```graphql
# before: generation throws, the op emits nothing
# after:
projectRootPath: String
```

**Cause:**
- OAS 3.1 replaced `nullable: true` with JSON Schema type arrays: `type: ["string","null"]`.
- Every `schema.type` reader assumes a plain string.
- The array reaches `createScalarType`; `gqlScalar("string,null")` matches nothing → throw.

**Fix:** collapse the array to its first non-`"null"` entry, in place, on entry to
`fromSchema`/`fromProp` (`lookupRef` shares schema instances, so one normalization covers every
reader). GraphQL fields are nullable by default, so the `"null"` disjunct adds nothing.

**Care:** a heterogeneous array (`type: ["string","integer"]`) coerces to its FIRST entry — the
same single-scalar coercion as #11's `anyOf` params, not a scalar union (GraphQL has none).
**Measured (omni):** default 45→48 ok (83.3→88.9%), abstract 44→47 (81.5→87.0%); GEN-THROW 3→0;
all other buckets byte-identical. Suite 151/151.
**AST:** none — normalization happens before any node is built; single-type schemas unchanged.
**Refs:** `src/oas/nodes/factory.ts` (`normalizeTypeArray`, called from `fromSchema` + `fromProp`).

## 24 · `>**` expansion silently drops every enum field — ✅ Fixed
**Symptom:** Slack 43/80 GETs generate ZERO types (the `ok`-only stubs); every other spec
silently loses its enum fields from both SDL and selection (CCS alone: 5 enum types missing).
The mechanism behind the **E-slack-ok** "enhancement" — it was a bug, not input quality.

**OAS** (slack stub — `ok` is the only property, a boolean enum behind a `$ref`):
```yaml
schema:
  type: object
  additionalProperties: true
  properties:
    ok:
      $ref: "#/components/schemas/defs_ok_true"   # { type: boolean, enum: [true] }
  required: [ok]
```

**Example** (before → after):
```graphql
# before: zero types, op uncredited
# after:
type AdminAppsApprovedListResponse {
  ok: Boolean!
}
```

**Cause** (one dropped leaf, three latent bugs behind it):
- `collectExpandedPaths` treats only `PropScalar`/scalar-array/`PropCircRef` as `>**` leaves —
  `PropEn` never enters the selection, so enum fields vanish; stubs with only `ok` collapse to 0 types.
- Once selected, three latent enum bugs surfaced (github -20/pass until fixed):
  - boolean/number enums built an En with NO values → `enum X {}` is invalid GraphQL;
  - En definitions emitted the raw ref leaf (`enum author-association`) while nothing sanitized it;
  - github's ReactionRollup has literal `+1`/`-1` FIELDS — both sanitised to `_1` → duplicate field.

**Fix** (four small pieces):
- `PropEn` is a `>**` expansion leaf (typesCollector); its En lands via `dependencies()`.
- enums whose (trimmed) values aren't all legal GraphQL enum identifiers degrade to the base
  scalar (`ok: Boolean`, reactions `content: String`); TMF637's `'aborted '` trims, stays an enum.
- En definition + PropEn reference both emit `genTypeName` (the #15 def/ref discipline).
- `sanitiseField` encodes a leading sign (`+1`→`plus1`, `-1`→`minus1`); the selection alias keeps
  the raw JSON key (`plus1: "+1"`).

**Measured (corpus, both passes):** slack 46.3→96.3 (+40), github 86.5→91.7 / 84.9→90.1 (+23,
composeFail 24→1 default), DO 93.8→94.5 (+1); github per-op matrix: 23 fail→pass, 0 pass→fail.
Suite 152/152 (3 CCS count assertions bumped 17→22 — the 5 restored enum types).
**Care:** slack's residual 3 GEN-EMPTY are non-JSON/file endpoints (input quality, cf. E-scalar-roots).
**AST:** `PropScalar` replaces `PropEn` for non-identifier enums (id `prop:enum:` → `prop:scalar:`);
explicit selection paths referencing those ids change shape.
**Refs:** `src/oas/generator/typesCollector.ts` (leaf), `src/oas/nodes/factory.ts` (`isGqlEnum`),
`src/oas/nodes/en.ts`/`propEn.ts` (def/ref names), `src/oas/utils/naming.ts` (`encodeLeadingSign`).

## 25 · Discriminator-less `oneOf` emits a real union the selection cannot satisfy — ✅ Fixed
**Symptom:** abstract pass (v0.4) fails compose with `GROUP_SELECTION_IS_NOT_OBJECT` —
confluence 14 ops, box 3, github 3 (`ContentMetadata.labels: LabelsUnion` and friends).

**OAS** (confluence — a `oneOf` with no `discriminator`):
```yaml
labels:
  oneOf:
    - $ref: '#/components/schemas/LabelArray'
    - type: object
      properties: { … }
```

**Example** (before → after, abstract pass):
```graphql
# before: SDL and selection disagree
union LabelsUnion = LabelArray | LabelsUnion2     # SDL: a union…
selection: """ labels { limit size start } """    # …selected as a group -> rejected

# after: both sides agree on the merged-object form (same shape the default pass emits)
#### no discriminator — union degraded to a merged object: LabelsUnion = LabelArray | LabelsUnion2
type LabelsUnion { limit: Int size: Int! start: Int }
```

**Cause:**
- `Union.select` already falls back to the flat merged selection when there is no
  discriminator (`selectAbstract` is guarded on it — `->match` needs a tag field to dispatch on).
- `Union.generate` still emitted the real `union` line → SDL says union, selection selects a
  group on it → `GROUP_SELECTION_IS_NOT_OBJECT`.

**Fix:** real `union` + `->match` only when a discriminator exists; otherwise both passes share
the merged-object downgrade (`generateMergedObject`, headline comment names the original union)
and member refcounts are absorbed at visit. Discriminated unions and promoted interfaces (R2)
are untouched.

**Measured (abstract pass):** box 74.6→77.2 (+3), github 90.1→90.8 (+3); per-op 3+3 fail→pass,
0 pass→fail; default pass byte-identical. confluence unchanged at 69.2: its 14 GROUP_SELECTION
failures move down a layer to the orphan-type family (`CONNECTORS_UNRESOLVED_FIELD` 11 /
`CIRCULAR_REFERENCE` 4) — types like `Label` are emitted with fields no selection provides.
v0.3 emits the SAME orphans but its legacy validator doesn't check them; v0.4's shape validator
does. That residue is the R-collector orphan slice, not a union problem.
**AST:** none — emission-time branch only; the union node and its members are unchanged.
**Refs:** `src/oas/nodes/union.ts` (`generate`/`generateMergedObject`/`visit` refcounts),
fixture `oneof-no-discriminator.yaml`, test `test_R2_union_without_discriminator_degrades_to_merged_object`.

## 26 · Collector keeps types the output never references, drops ones it does — ✅ Fixed
**Symptom:** two mirror failures, both passes, ~76 ops corpus-wide:
- emitted-but-unreferenced: `type Label { id … }` written, but every route to it renders as a
  cycle-cut comment → v0.4 `CONNECTORS_UNRESOLVED_FIELD` (confluence 9, github 17 abstract);
- referenced-but-dropped: `entries: [FolderMini]` written, `Folder--Mini` deleted with its
  consolidated parent → `cannot find type` / `INTERNAL_ERROR` (box 11-15, asana 11 per pass).

**OAS** (confluence — the only route to `Label` closes a cycle, so its field is cut):
```yaml
LabelArray:
  properties:
    results:
      items: { $ref: '#/components/schemas/Label' }   # cut: re-enters the Label cycle
```

**Example** (before → after):
```graphql
# before: Label written, selection only has "# results: [Label] - circular reference omitted"
type Label { id: String! label: String! name: String! prefix: String! }   # ✗ UNRESOLVED_FIELD
# after: Label is not written at all — nothing references it
```

**Cause:** the collect loop keeps the first node per id and the consolidation loop deletes
absorbed ids — both decide by bookkeeping, neither asks what the written schema points at.

**Fix:** after collecting, walk the types the written output actually references — each node
answers for itself via `dependencies(context, selection)` (the hook Map/PropEn/PropMap already
had, now on the `Type` base: a field points at its target type, a wrapper at its payload, a
real union at its members, a merged one at its flat fields) — and make the collection exactly
that set: drop what nothing references, restore what the deletions over-removed.

**Measured (corpus, per-op matrix): 76 fail→pass, 0 pass→fail.** asana 86.1→100 (both),
box 74.6→84.2 / 77.2→90.4, github abstract 90.8→94.6 (composeFail 25→8), confluence abstract
69.2→83.1, omni +1/pass. Suite 154/154 (12 typesSize assertions updated — merged-union members
and inline allOf parts are no longer collected; the polymorphic refactor verified
verdict-identical on all 22 spec/pass dumps).
**Care:** `dependencies()` overrides must mirror their class's `select`/`generate` — they live
next to them on purpose. A real union also keeps a member's shared `$ref` base (the writer may
promote it, R2); inline `[inline:…]` parts stay absorbed.
**Care (history — a node-level `dependencies(context)` existed once and was removed in `d2e2672`,
Feb 2025; do not reintroduce its failure modes):**
- it called `visit()` during the walk → built nodes / stored names / triggered renames mid-collection;
- it pushed onto the shared context stack (`enter`/`leave`) mid-walk;
- it ignored the selection → over-collected;
- it pulled in members that consolidation was absorbing (the reason `consolidate()` replaced it).
The #26 version must stay read-only (no `visit()`, no context stack), selection-scoped, and run
AFTER consolidation. The one allowed write is `Composed.consolidate` (idempotent, the same call
`select()` makes) — guarded by `test_R2_collect_twice_is_byte_identical`.
**AST:** none — collection-time only; node trees and emission code are unchanged.
**Refs:** `src/oas/generator/typesCollector.ts` (`collectReachable`), `iType.ts`/`type.ts`
(`dependencies`), one-line overrides in `propObj/propArray/propComp/res/body/arr.ts`, container
overrides in `obj/comp/union.ts`, `T.isEmittable`.

## 27 · Mutations with params AND a body emit two argument lists — ✅ Fixed
**Symptom:** every mutation that has parameters (path OR query) plus a request body is invalid
GraphQL — ~390 ops per pass corpus-wide (asana 2.3%→55.7, omni 40→87, github 48→86.5). rover
labels the syntax error INTERNAL_ERROR or CONNECTORS_UNRESOLVED_FIELD, hiding the size.

**OAS** (petstore — one path param + a JSON body):
```yaml
/user/{username}:
  put:
    parameters:
      - name: username
        in: path
        required: true
    requestBody:
      content:
        application/json:
          schema: { $ref: '#/components/schemas/User' }
```

**Example** (before → after):
```graphql
updateUserByUsername(username: String!)(input: UserInput!): …   # ✗ two argument lists
updateUserByUsername(username: String!, input: UserInput!): …   # ✓ one
```

**Cause:** `generateParameters` wrote `(params)` and `generateBodyInput` wrote a second
`(input: X!)` — fine when an op has only one of the two, invalid with both.

**Fix:** one argument list — `Get.generateParameters` takes an optional body arg appended last;
`Post.bodyArg()` supplies `input: <Payload>!`; all mutation verbs inherit from `Post`.

**Measured (mutation sweep, 1249 ops/pass, both passes): 778 fail→pass, 0 pass→fail** —
mutations 47% → 77.6% default. GET output byte-identical (no body arg → same list).
**Care:** rover's error labels masked this as two different buckets (the ROADMAP histogram
warning applies); the first mutation triage should always start from raw compose errors.
**AST:** none — emission-only; `Body`/`Param` nodes unchanged.
**Refs:** `src/oas/nodes/get.ts` (`generateParameters`), `src/oas/nodes/post.ts` (`bodyArg`),
test `test_mutation_params_and_body_share_one_argument_list`.

## 28 · Request-body selections use the response alias direction — ✅ Fixed
**Symptom:** `INVALID_BODY: FunctionsItemInput doesn't have a field named log_destinations` —
DO `post:/v2/apps` and the whole INVALID_BODY family (~60 mutation ops with #29).

**OAS** (DO — a nested object inside a request body, snake_case key):
```yaml
requestBody:
  content:
    application/json:
      schema:
        properties:
          log_destinations: { type: object, properties: { … } }
```

**Example** (before → after, inside `body: """…"""`):
```graphql
logDestinations: "log_destinations" { … }   # ✗ response direction: field <- json key
log_destinations: "logDestinations" { … }   # ✓ body direction: json key <- input field
```

**Cause:** `sanitiseFieldForSelect(name, isInput)` flips the mapping for bodies, but only
`PropScalar`/`PropArray` passed `isInput` — `PropObj`/`PropComp`/`PropEn`/`PropMap` didn't, so
every nested non-scalar field inside a body kept the response direction.

**Fix:** pass `this.parent?.kind === 'input'` at the four missing sites (identical to the two
that already did).

**Measured:** with #29, mutations 77.6 → 82.7% default (+132 ops both passes, 0 pass→fail).
**AST:** none — emission-only.
**Refs:** `src/oas/nodes/propObj.ts`/`propComp.ts`/`propEn.ts`/`propMap.ts` (`select`), fixture
`body-aliases-defaults.yaml`, test `test_body_alias_direction_and_default_literals`.

## 29 · Default values emit as bare paths, and falsy defaults vanish — ✅ Fixed
**Symptom:** `INVALID_BODY: ImageInput.* doesn't have a field named latest` (DO `post:/v2/apps`);
and `default: 0` / `default: false` silently never emitted (the #17 falsy-guard class, two more
sites).

**OAS** (DO — a string default):
```yaml
tag:
  type: string
  default: latest
```

**Example** (before → after):
```graphql
tag: $(latest)     # ✗ `latest` reads as a field path
tag: $("latest")   # ✓ a string literal; numbers/booleans stay bare: retries: $(0)
```

**Cause:**
- `Scalar.select` wrote the default raw — a bare word inside `$()` is a path, not a value.
- Both `Scalar.select` and `PropScalar.select` gated on `if (schema.default)` — `0`/`false`
  dropped.

**Fix:** quote string defaults, `String(...)` the rest; both gates use `!= null`.

**Measured:** with #28, mutations +132 ops; the quoting alone also recovered **12 GET ops**
(string defaults appear in response selections too) — 0 pass→fail in either sweep.
**AST:** none — emission-only.
**Refs:** `src/oas/nodes/scalar.ts` (`select`), `src/oas/nodes/propScalar.ts` (`select`),
fixture `body-aliases-defaults.yaml` (shared with #28).

## 30 · Body arg references the raw payload name — ✅ Fixed
**Symptom:** `INTERNAL_ERROR: cannot find type 'ssh_keysItemInput' in this document` — DO
`post:/v2/account/keys` and the mutation INTERNAL_ERROR family.

**OAS** (DO — the body payload is named from a snake_case pointer):
```yaml
requestBody:
  content:
    application/json:
      schema:
        $ref: "#/paths/…/properties/ssh_keys/items"
```

**Example** (before → after):
```graphql
createV2AccountKeys(input: ssh_keysItemInput!): …   # ✗ definition is `input SshKeysItemInput`
createV2AccountKeys(input: SshKeysItemInput!): …    # ✓ same name both sides
```

**Cause:** `bodyArg` used `getRefName` (raw) while the input definition emits `genTypeName` —
the #15 def/ref divergence, on the body argument.

**Fix:** the same `genTypeName` conditional the definitions use (cf. #15, obj.ts/comp.ts).
**AST:** none — emission-only.
**Refs:** `src/oas/nodes/post.ts` (`bodyArg`), test `test_body_input_name_matches_definition`.

## 31 · Empty response schemas produce zero types — ✅ Fixed
**Symptom:** GEN-EMPTY — googlebooks 11 ops/pass (deleteBook, familysharing.share, …): the op
generates nothing at all.

**OAS** (googlebooks — every "no result" op returns `Empty`):
```yaml
responses:
  "200":
    content:
      application/json:
        schema: { $ref: "#/components/schemas/Empty" }
# components: Empty: { description: …, type: object, properties: {} }
```

**Example** (before → after):
```graphql
# before: zero types, op uncredited
# after (same as an op with no response content at all):
type CreateBooksV1CloudloadingDeleteBookResponse { success: Boolean }
# selection: success: $(true)
```

**Cause:**
- the synthetic `success: Boolean` response only kicked in when a response had NO content;
- a contentful response resolving to a fieldless schema fell through to the JSON-scalar route
  (#19) → a scalar root collects no types (cf. E-scalar-roots).
- `isShapelessObject` also rejected `type: object, properties: {}` (the `'type'` keyword was
  on its no-shape list) — widened to allow an explicit object type, like #24 did for enums.

**Fix:** resolve the response schema and route it to `SYN_SUCCESS_RESPONSE` when it renders no
fields (`isEmptySchema || isShapelessObject`); the synthetic default is now a real boolean
(`$(true)`, not `$("true")` — interacts with #29's quoting).
**AST:** shape change for these ops only — a synthetic response Obj where there was a JSON
scalar (or nothing).
**Refs:** `src/oas/nodes/get.ts` (`visitResponseContent`), `src/oas/nodes/factory.ts`
(`isShapelessObject`), `src/oas/schemas/index.ts`, test `test_empty_response_schema_synthesizes_success`.

## 32 · Ops whose only content is a JSON field emit an empty type; body keys with colons break the parser — ✅ Fixed
**Symptom:** two related body/selection failures:
- asana (28 ops): `type CreateGoals…Response {}` — empty braces, invalid GraphQL. The response's
  only field is a free-form JSON object, which the `>**` expansion had no leaf rule for.
- omni SCIM: `INVALID_BODY … ErrorKind::Eof` — a body key with colons written unquoted.

**OAS** (asana — the response's only field resolves to a fieldless object):
```yaml
responses:
  "200":
    content:
      application/json:
        schema:
          type: object
          properties:
            data: { $ref: "#/components/schemas/EmptyResponse" }   # { type: object } only
```

**Example** (before → after):
```graphql
type CreateGoalsRemoveSupportingRelationshipResponse {}      # ✗ empty braces
type CreateGoalsRemoveSupportingRelationshipResponse { data: JSON }   # ✓ selection: data

urn:omni:params:1.0:UserAttribute: urnOmniParams10UserAttribute       # ✗ body key unparseable
"urn:omni:params:1.0:UserAttribute": urnOmniParams10UserAttribute     # ✓ quoted key
```

**Cause:**
- free-form JSON fields (`data: JSON`, #19) were never selection leaves, so an op with nothing
  else selected nothing and emitted its response type with no fields;
- the body-direction alias quoted the wrong side: the field reference (always a bare
  identifier) instead of the JSON key (which may contain `:`/spaces/etc.).

**Fix:**
- when an op's expansion finds nothing selectable, take its free-form JSON fields as the
  leaves. **Deliberately scoped to otherwise-empty ops:** applying it everywhere diverged the
  per-connector selections of types shared across connectors (AdobeCommerce satisfiability,
  omni INVALID_BODY) — measured +62/-4 broad vs **+26/-0 narrowed**.
- body aliases quote the KEY when it isn't a bare identifier: `"json:key": graphqlField`.

**Measured (both passes): +26 mutation ops, 0 pass→fail; GETs byte-identical.** Mutations
47% → **88.8%** default across the arc (#27-#32).
**Care:** the broad leaf rule is the honest long-term form — it needs per-connector selection
agreement for shared types first (the #13/#26 family, input side).
**AST:** none — selection-time only.
**Refs:** `src/oas/generator/typesCollector.ts` (`collectExpandedPaths` post-pass),
`src/oas/utils/naming.ts` (`sanitiseFieldForSelect` input branch), fixture coverage via
`corpus-mutations.test.ts` (asana) + `test_body_alias_direction_and_default_literals`.

## 33 · Four generation crashes: nested component pointers, non-JSON responses, null union members, $ref'd no-content responses — ✅ Fixed
**Symptom:** ~19 GEN-THROW ops/pass across four small families:
- openai (6): `Cannot read properties of undefined (reading 'type')`
- github (4): `Cannot read properties of undefined (reading 'select')`
- omni (6): `Cannot handle property type null`
- DO (3): `Not yet implemented for: {"description":"The action was successful…"}`

**OAS** (one snippet per family):
```yaml
# openai — a $ref INTO a component, not to one:
logit_bias: { $ref: "#/components/schemas/CreateCompletionRequest/properties/logit_bias" }
# github /markdown — the 200 has no JSON content:
responses: { "200": { content: { "text/html": { … } } } }
# omni — OAS 3.1 null union member (the member form of #23):
oneOf: [ { $ref: "#/…/Query" }, { type: "null" } ]
# DO — a shared $ref'd response with headers but no content:
responses: { "200": { $ref: "#/components/responses/no_content" } }
```

**Cause / fix, one line each:**
- `lookupRef`'s component branch returned undefined for pointers INTO a component instead of
  falling through to `resolvePointer` (which handles exactly that) → falls through now.
- non-JSON-only responses left `resultType` unset and `writeConnector` checked `_.has`
  (true for a declared-but-unset field) → route to the synthetic success (#31's umbrella) and
  check truthiness.
- a `{ type: "null" }` union member adds nothing (GraphQL fields are nullable) → skipped, like
  #23's type arrays.
- the no-content fallback was gated on `code === '200' | 'default'`, but `$ref`'d responses
  arrive with the REF STRING as the code → the gate is gone; no content ⇒ synthetic success.

**Care:** non-JSON GET endpoints (slack/DO file downloads) now emit `success: Boolean` ops
instead of generating nothing — composable and callable, but the response body itself is not
representable; revisit if a raw-passthrough form ever exists.
**Still open in this family:** DO `post:/v2/certificates`/`/v2/droplets` (2 ops) — a `oneOf` of
`allOf`s as the request body; the collector cannot re-walk the expanded path (the known R2
"real-union with allOf members" gap, input side).
**AST:** shape changes only where generation previously threw (a node tree now exists).
**Refs:** `src/oas/oasContext.ts` (`lookupRef`), `src/oas/nodes/get.ts` (`visitResponse`),
`src/oas/nodes/union.ts` (`visit`), `src/oas/io/operationWriter.ts` (`writeConnector`).

## 34 · Real unions of allOf members: empty member list, twin member ids — ✅ Fixed
**Symptom:** two failures of the same family (the R2 "allOf-member union" gap):
- a discriminated `oneOf` of `allOf` members that is NOT interface-promoted (rule-3 skip)
  emits `union ItemResponse = ` — no members, invalid GraphQL;
- DO `post:/v2/certificates`/`/v2/droplets` (a `oneOf` of `allOf`s as the request body) crash
  the collector: two inline members share one id, so the path walk finds the wrong twin.

**OAS** (the body shape, DO):
```yaml
requestBody:
  content:
    application/json:
      schema:
        oneOf:
          - allOf: [ { … }, { … } ]   # both inline members were named `[inline:Input]`
          - allOf: [ { … }, { … } ]
```

**Example** (before → after):
```graphql
union ItemResponse =                       # ✗ empty
union ItemResponse = Book | Movie          # ✓ members with selected fields
```

**Cause:**
- the union line filtered members by prop-parent identity — an allOf member's folded props
  keep the inner part as parent, so no member ever matched (`selectAbstract` already had the
  correct any-selected-field filter);
- `Composed.add` suffixes duplicate child names but `Union.add` didn't, so twin inline members
  collapsed onto one id and broke path addressing.

**Fix:** shared `Union.selectedMembers` (consolidates Composed members, filters by selected
fields) used by both the union line and `->match`; the duplicate-name suffixing hoisted to
`Type.withUniqueName` and used by both `Composed.add` and `Union.add`.

**Also in this slice (R2 gate):** the union form is now derived from the connect version —
v0.4+ emits real unions/interfaces, below that the consolidate downgrade; an explicit ask for
real unions on < v0.4 downgrades with a warning (`resolveConsolidateUnions`, the R0 contract).
The CLI no longer hardcodes consolidation: `--connector-spec-version v0.4` gets abstract types.
**AST:** identity change for twin union members only (`[inline:Input]` → `[inline:Input]:1`).
**Refs:** `src/oas/nodes/union.ts` (`add`/`selectedMembers`), `src/oas/nodes/type.ts`
(`withUniqueName`), `src/oas/nodes/comp.ts` (`add` delegates), `src/versions.ts`
(`resolveConsolidateUnions`), `src/oas/oasGen.ts` (constructor), `src/cli/oas.ts`.

## 35 · JSON walker: same-named objects across documents diverge on fields — ✅ Fixed
**Symptom:** `SELECTED_FIELD_NOT_FOUND: selection contains field 'references', which does not
exist on 'ContentTags'` (clockwatch, multi-document walk) — surfaced when #21's dangling
reference was fixed.

**JSON** (two documents, the same `tags` object with different field sets):
```json
{ "tags": { "name": "…" } }                       // doc A -> ContentTags { name }
{ "tags": { "name": "…", "references": […] } }    // doc B -> selects references too
```

**Cause (measured):** two mechanisms, not one.
- An empty `[]` leaves the array typeless: the SDL drops the field (`### NO TYPE FOUND`
  comment) but the selection still emits it → `SELECTED_FIELD_NOT_FOUND`.
- `store()` merged one-directionally (incoming → stored), but the written tree points at the
  *incoming* instance — fields from earlier documents were lost, and a `[]`/`{}` twin could
  clobber a typed field (last doc wins).
**Fix (2026-06-12):**
- an empty `[]` walks to `[JSON]` (the #19/#21 unknown-shape convention) — SDL and selection agree;
- `merge()` converges *both* instances on the field union, and an unknown-shape twin
  (`isUnknownShape`: JSON scalar, or array thereof) never replaces a typed field.
Flipped four known-bad pins to passing: `articles/clockwatch`, `articles/blog`,
`articles/article` and the single-article file (all the same mechanism).
**Refs:** `src/json/walker/jsonGen.ts` (`walkArray`), `src/json/walker/jsonContext.ts`
(`merge`/`isUnknownShape`), fixture `tests/resources/json/articles/clockwatch`.

## 36 · Fields that share a name are wrongly treated as circular, leaving an empty type — ✅ Fixed
**What happened:** generating the connector for `get:/V1/carts/mine` (adobe-commerce-swagger.json) failed
to compose:
`INTERNAL_ERROR: Type QuoteDataProductOptionInterface must define one or more fields.`
GraphQL does not allow a type with no fields, and this one came out empty.

**The spec that triggers it** (condensed from adobe-commerce-swagger.json; every `$ref` points into
`#/components/schemas/`, irrelevant fields removed):
```yaml
quote-data-cart-interface:
  properties:
    items:                { type: array, items: { $ref: quote-data-cart-item-interface } }
    extension_attributes: { $ref: quote-data-cart-extension-interface }        # (1) the cart's

quote-data-cart-extension-interface:
  properties:
    shipping_assignments: { type: array, items: { $ref: quote-data-shipping-assignment-interface } }

quote-data-shipping-assignment-interface:
  properties:
    items: { type: array, items: { $ref: quote-data-cart-item-interface } }    # cart items reached again, deeper

quote-data-cart-item-interface:
  properties:
    product_option:       { $ref: quote-data-product-option-interface }
    extension_attributes: { $ref: quote-data-cart-item-extension-interface }

quote-data-product-option-interface:                                            # has ONLY one field:
  properties:
    extension_attributes: { $ref: quote-data-product-option-extension-interface }   # (2) the product option's
```
Fields (1) and (2) are both called `extension_attributes` but are completely different types.

**Why the type was empty:** the generator decided a field was circular (repeating) by checking whether a
field with the *same name* already appeared higher up the path. In Adobe Commerce many unrelated types
have an `extension_attributes` field. So on the path below, the product option's `extension_attributes`
(2) sits under the cart's `extension_attributes` (1); the generator mistook the inner one for a repeat
of the outer one and dropped it. `quote-data-product-option-interface` has no other field, so it was left
empty.
```
get:/V1/carts/mine
  cart
    > extension_attributes          (1) the cart's
      > shipping_assignments > items > product_option
        > extension_attributes      (2) the product option's   <- dropped here
```

**What the output looks like:**
```graphql
# the type's one field was removed, so the type is empty:
type QuoteDataProductOptionInterface {
  # extensionAttributes: QuoteDataProductOptionExtensionInterface - circular reference omitted
}
# and the selection asks for product_option but picks nothing inside it:
productOption: "product_option" { }
```

**The fix — compare the object, not the name, in TWO places.** A field is part of a cycle only when it
points back to the *same object* (same `$ref`, same resolved definition) already on the path — never
because of a shared name. The generator already had that check by object identity (`cyclicAncestor`, from
#10); the bug was two *legacy name-based* checks sitting beside it, both comparing node ids, and every id
is `<kind>:<name>` — the field name only, blind to the type:
- `src/oas/nodes/factory.ts` (`fromProp`) — where a property is built.
- `src/oas/nodes/type.ts` (`Type.add`) — where a built node is attached to its parent.

Both now cut only when the matched ancestor is the *same schema instance*. Fixing only `fromProp` is not
enough: the inner `extension_attributes` is then re-cut by `Type.add` on the same id collision — and a
`Type.add` cut renders nothing in the SDL, so the field just vanishes (that is what produced the
`SELECTED_FIELD_NOT_FOUND ... on QuoteDataCartItemInterface` seen mid-fix; it was the false cut moving,
not a real divergence). With both sites on object identity, `get:/V1/carts/mine` expands fully (32 types)
and composes. (Schema-less structural nodes — arrays, unions — keep the name behaviour in `Type.add`;
they cannot be the same-name/different-type case this targets.)

**Aliases:** a YAML anchor reused in two *sibling* places survives loading as one shared `SchemaObject`
(so identity is the right comparison there too), but a *self*-nested anchor is rejected at load (stack
overflow in `OASNormalize.convert()`). So no inline self-cycle ever reaches the generator: inline fields
never falsely cut, and identity still guards the (unreachable-in-practice) self-alias.

**Separate — was still open, now fixed as #101:** a type whose *only* field is a *genuine* cycle
degraded to an empty type (e.g. an inline `{ back: $ref Self }`); the field now reads as JSON.

**Tests:** `tests/resources/oas/same-name-fields.yaml` (false positive, exercises both sites — fails
before, composes after) and `cycles-by-route.yaml` (a genuine cycle per route, each still cut), both
wired in `tests/all/oas-core.test.ts`. The CCS `additionalProperties` tests gained one legitimately
un-cut type (`Ingredient`, 22→23).

**Files:** `src/oas/nodes/factory.ts` (`fromProp`), `src/oas/nodes/type.ts` (`Type.add`); ids are
name-based (`src/oas/nodes/propObj.ts` etc.). Related: #10, #13.

## 37 · Inline wrapper named after the component it lists re-collides after #36 — ✅ Fixed
**What happened:** the Confluence abstract pass regressed (89.2% → 81.5%): 8 ops failed to compose with
`CIRCULAR_REFERENCE: type Group appears more than once in …subjects.group.results`, and the subgraph
carried two `type Group` definitions. This is #12 returning — its fix stopped firing under #36's new
visit order.

**The spec that triggers it** (real Confluence — an *inline* pagination wrapper whose key is the same as
the component it lists):
```yaml
SpacePermission:
  properties:
    subjects:
      type: object
      properties:
        group:                        # inline wrapper, key `group`
          type: object
          properties:
            results: { type: array, items: { $ref: '#/components/schemas/Group' } }
            size:    { type: integer }
```
The same shape exists for `subjects.user`. (The `space`/`version`/`container` inline objects do NOT
contain their own component, so they are a different, non-cyclic collision class — out of scope here.)

**Why #12's fix stopped firing:** #12 renames an inline collider only when the colliding component is
*already* stored (`collidesWithStoredType` reads point-in-time occupancy — #12's own stated Limitation).
Here the component `Group` is reached *only* through the wrapper's own `results`, and arrays expand
**lazily** — so `Group` is not stored when the wrapper is checked. #36 changed visit/cut order and removed
the incidental sibling ordering that used to store such a component early. So the wrapper keeps `group` →
emits a second `type Group` → rover reads `group.results` as `Group → Group` → circular.

**What the output looks like:**
```graphql
# before: the wrapper and the component both emit `type Group`
type Group { limit, results: [Group], size, start }   # the inline wrapper (paginated)
type Group { id, name }                                # the component
# after: the wrapper is qualified by its container; one `type Group` remains
type SubjectsGroup { limit, results: [Group], size, start }
type Group { id, name }
…  subjects { group: SubjectsGroup }
```

**The fix — detect the wrapper from its OWN raw schema, not from occupancy.** A new
`T.wrapsSameNamedComponent` runs at the existing `obj.ts` rename check (before `visitProperties`): an
inline object named `X` whose schema has a property that is (an array of) `#/components/schemas/X` is a
self-referential wrapper → rename via the existing `resolveNameConflict` (`group` → `SubjectsGroup`). The
ref name is in the raw schema, so this needs no expansion, no occupancy, no ordering — it cannot regress
on visit order again. Two deliberate constraints: only `#/components/schemas/*` refs (the single ref class
that emits a colliding `type X`), and the array test mirrors the generator's own rule (`items` present,
`type === 'array' || type == null`, `factory.ts:83`). The component keeps its `$ref` name
(`isExemptFromRename`); only inline objects rename.

**Input/output co-emit is safe:** the two real `subjects.user` wrappers (request body + response, with
*different* bodies) both qualify to base `SubjectsUser`. They stay distinct because the input one carries
`kind='input'` — which appends `Input` and embeds the kind in the node id (`SubjectsUserInput`) — and the
two `subjects` themselves also collide and cascade-qualify the output. No duplicate; it composes. (A
same-namespace twin — two different-bodied output wrappers — would still hit the writer `nameKey` gap; not
a Confluence case, see #22-adjacent.)

**Tests:** `tests/resources/oas/inline-wrapper-vs-component.yaml` — two same-key owners → distinct names,
the scalar/unreached negatives (not renamed), and the real input+output `subjects.user` co-emit — wired in
`tests/all/oas-core.test.ts`. The real Confluence descendant op now emits one `type Group`/`type User` and
composes on stock rover.

**Files:** `src/oas/nodes/obj.ts` (`visit`), `src/oas/nodes/typeUtils.ts` (`containsNamesakeComponent`,
`componentSchemaRef`). Related: #12 (the limitation this realizes), #9, #36. Not covered: `allOf`-encoded
collection wrappers.

## 38 · A discriminated union nested under a field never gets its fields credited — ✅ Fixed

**Symptom:** launch library abstract pass fails 26/116 GET ops with `CONNECTORS_UNRESOLVED_FIELD`
inside a `->match` block, even though the selection is complete. launch library: 76.7% → 86.2%
(89 → 100 ops) after this fix; 14 ops remain, a separate issue (see Residue below).

**OAS** (launch library — a paginated list whose items are a discriminated union):
```yaml
PaginatedPolymorphicAgencyEndpointList:
  properties:
    results:
      type: array
      items:
        $ref: '#/components/schemas/PolymorphicAgencyEndpoint'   # oneOf [Mini, Normal, Detailed]
```
`PolymorphicAgencyEndpoint` itself is a normal discriminated `oneOf` (has a `discriminator`) — the
same shape R2's other tests already cover. The only difference is *where* it sits: one level
inside `results`, not the op's own response.

**Example** (before → after, same op, same selection):
```graphql
# before: real union + ->match, nested inside `results { ... }` — rover credits ZERO fields inside it
results {
... response_mode->match(
  ["list", $ { __typename: $("AgencyMini") name }],
  ["normal", $ { __typename: $("AgencyNormal") name }],
  ["detailed", $ { __typename: $("AgencyEndpointDetailed") name }]
)
}
# after: one flat merged type, no ->match — composes on stock rover
results { name }
```

**Cause:** a response that's a bare `oneOf` at the top level (`get:/item -> oneOf [...]`) composes
fine. The same union reached through a named field (`results`, `intent`, `partyOrPartyRole`, …)
gets wrapped in `fieldName { ... }` by the property/array node, and rover's connect-v0.4
shape-based field-crediting walker doesn't credit anything inside a `->match` sitting behind that
wrapper — confirmed with 4 isolated minimal repros. Same root cause as **#14** (there: a nested
`->entries`; here: a nested `->match`) — same upstream composer limitation, two different methods
trigger it. A pre-release patched composer (`tools/local/apollo-federation-cli`, used by this
project's own test harness when present) already fixes both; stock, released rover 0.40 does not,
so this is fixed here rather than left parked like #14 — a union already has a safe fallback shape
(the merged object, built for #25) to reuse; a map/dictionary doesn't have an equally cheap one.

**Fix:** `Union.isTopLevelResponse()` checks whether the union is reached directly from the op's
response (through any number of bare arrays) or through a named field. If it's nested, the union
degrades to the same merged-object form #25 already uses — no new state anywhere: the check reads
only the node's own `parent` chain, and the existing `generateMergedObject()`/`consolidate()` path
(already there for #25) absorbs the members and drops their reference count, unchanged.

**Known limitation, not handled here:** the same named schema could in principle be reached both
nested (in one op) and as a bare top-level response (in another op) within one generated schema.
GraphQL allows only one type definition per name, so whichever use-site's node the collector keeps
decides the SDL form for both — the other op's own selection could then disagree with it (real
union selected as a flat object, or vice versa), a loud compose failure (same family as #13/#26's
"same schema, different route" class). Not seen in any real corpus spec (every failing op found had
one consistent position); left as a follow-up if actually hit, rather than building a cross-op
mechanism for a case with no observed need — the project already has one comparable "same schema,
divergent routes" fix (#13) to model that follow-up on if it's ever required.

**Residue:** 14 launch library ops still fail. At least one (`get:/2.3.0/launches/`) is a
different, unrelated bug: a union member (`LaunchNormal`) is ALSO referenced directly as a plain
field type elsewhere in the same schema (`SpacecraftFlightNormal.launch: LaunchNormal!`) — once the
union absorbs its fields into the merged object, that other, independent reference is left without
its own connector coverage. Not investigated further here — a reachability problem in the same
family as #13/#26, not a union-form problem. **Fixed by #39** — all 14 ops now pass.

**Tests:** `tests/resources/oas/r2-union-nested-in-list.yaml` (nested-under-array, bare-array,
inline/unnamed) — `test_R2_union_nested_in_array_degrades_to_merged_object`,
`test_R2_union_top_level_array_stays_real_union`, `test_R2_union_inline_nested_degrades_via_local_check`
— in `tests/all/r2-abstract.test.ts`. Existing fixtures with the same nested shape
(`TMF637-001-UnionTest.yaml`, `TMF637-002-RecursionTest.yaml`, `launch_Library_2-docs-v2.3.0.json`)
updated to expect the merge.

**AST:** none — emission-time branch only, same shape as #25.
**Refs:** `src/oas/nodes/union.ts` (`isTopLevelResponse`, `isFlat`),
`src/oas/nodes/allOfBase.ts` (skips a merged union). Related: #13, #14, #25.

## 39 · A merged union's shadowed same-name member field still counts as reachable — ✅ Fixed

**Symptom:** the 14 ops left in #38's Residue all fail the same way: launch library abstract pass
86.2% → 98.3% (100 → 114/116 ops) after this fix. `rover` reports entire types with **every** field
unresolved (`CONNECTORS_UNRESOLVED_FIELD: LaunchNormal.<every field>`, plus
`SpacecraftConfigDetailed`, `SpacecraftConfigFamilyDetailed`, `SpacecraftConfigFamilyNormal`, …) —
not one stray field, whole orphan types with zero connector coverage.

**OAS** (launch library — two #38-merged union members share a field name, different target):
```yaml
LaunchNormal:
  properties: { rocket: { $ref: '#/components/schemas/RocketNormal' } }     # simple
LaunchDetailed:
  properties: { rocket: { allOf: [{ $ref: '#/components/schemas/RocketDetailed' }] } }  # rich,
    # RocketDetailed nests spacecraftStage/payloads → dockingEvents → SpacecraftFlightNormal.launch:
    # LaunchNormal! — the SAME schema, reached this time as a plain field, not a union member.
```

**Cause:** `Union.generate()`/`select()` (the #38 merged-object path) write **one** field per name:
`selectedProps()` returns every member's matching props un-deduped, and only the first one seen
per `prop.id` (`generated.has(prop.id)`) is actually written — `LaunchNormal.rocket` wins (it comes
first in the `oneOf`), so the merged object gets `rocket: RocketNormal!`, never
`rocket: RocketDetailed!`. But `Union.dependencies()` (used by the collector's #26 reachability
walk) called the *undeduped* `selectedProps()` directly — so the shadowed `LaunchDetailed.rocket`
prop, and everything its type (`RocketDetailed`) transitively references, was still walked and
collected, even though no selection anywhere ever asks for it. Two of those transitively-reachable
schemas happen to be **also** referenced directly elsewhere in the same document as plain field
types (`SpacecraftFlightNormal.launch: LaunchNormal!`, `PayloadFlightNormal.launch: LaunchNormal!`)
— that's what forces `LaunchNormal` to be emitted as *its own* standalone type (distinct from the
fields already folded into the merged `PolymorphicLaunchEndpoint`), with no selection route to it.

**Example** (before → after, same op):
```graphql
# before: RocketDetailed (and its whole orphan subtree) emitted, nothing ever selects it
type RocketDetailed { id spacecraftStage: [...] payloads: [...] }   # ✗ CONNECTORS_UNRESOLVED_FIELD
type LaunchNormal { id name … }                                     # ✗ CONNECTORS_UNRESOLVED_FIELD
# after: the shadowed branch (and everything only reachable through it) isn't collected at all
# RocketDetailed, LaunchNormal (as a standalone type) — both gone; PolymorphicLaunchEndpoint's
# merged object still has `rocket: RocketNormal!`, exactly as it did before this fix.
```

**Fix:** factor the existing "first prop per id wins" dedup (already inline in `generate()` and
`select()`'s flat branch, as a local `generated` Set) into one `dedupedSelectedProps()` helper, and
make `dependencies()` use the *same* deduped list for its flat/merged branch — so a name that loses
the race at emission time was never "reachable" in the first place. No new state: no new field,
Set, or Map on the class or on `OasContext` — just one small private method shared by the three
call sites that already needed the identical logic.

**Tests:** `tests/resources/oas/r2-union-nested-in-list.yaml` (`/wrapped-list` — two merged members
share a field name, one nesting a type with its own subtree) —
`test_R2_union_merge_name_collision_drops_shadowed_type` in `tests/all/r2-abstract.test.ts` (asserts
the shadowed type, and its own nested type, are absent from the generated schema entirely — and
regressed to a real collector count 5 → 3 with the fix reverted, confirming the mechanism).
`launch_Library_2-docs-v2.3.0.json` corpus re-measured: 86.2% → 98.3% (+14 ops); the 2 remaining
failures (`GRAPH_QL_ERROR`, `SELECTED_FIELD_NOT_FOUND`) are unrelated, pre-existing gaps.

**AST:** none — `dependencies()` and `generate()`/`select()` already walked the same node graph;
this only makes them agree on which of two same-named props is the "real" one.
**Refs:** `src/oas/nodes/union.ts` (`dedupedSelectedProps`, `dependencies`, `generateMergedObject`,
`select`). Related: #26 (the reachability walk this feeds), #38 (the residue this closes).

## 40 · An object-typed (or array-of-object) query param emits an invalid inline type body — ✅ Fixed

**Symptom:** box.yaml `get:/search` fails compose with `CONNECTORS_UNRESOLVED_FIELD` cascading
across many unrelated types. The actual defect: the generated argument list contains a full
`type X { ... }` definition body written inline, not a type-name reference — invalid GraphQL that
breaks SDL parsing for the whole document, producing the cascade.

**OAS** (box.yaml — `get:/search`'s `mdfilters` param, `tests/resources/oas/box.yaml:15121-15136`):
```yaml
in: query
name: mdfilters
schema:
  type: array
  items:
    $ref: '#/components/schemas/MetadataFilter'
```

**Example** (before → after):
```graphql
# before: a full type body inline in the argument list
search(..., mdfilters: [type MetadataFilter {
  templateKey: String
  scope: String
  filters: JSON
}], ...): SearchResultsMini
# after: degrades to the existing JSON-scalar convention (#19), array cardinality preserved
search(..., mdfilters: [JSON], ...): SearchResultsMini
```

**Cause:** `Obj.generate()` (`src/oas/nodes/obj.ts`) only special-cases
`context.inContextOf('Res', this)` for a bare name-reference; there's no equivalent
`inContextOf('Param', this)` case (unlike `Union.generate()` and `En.generate()`, which already
handle this for their node types — "params with Unions are weird"). `Arr.generate()`
(`src/oas/nodes/arr.ts`) calls `itemsType.generate()` with no special-casing either. `Param` also has
no `dependencies()` override, so its resultType never enters `TypesCollector.collectReachable`'s walk
(rooted only at `op.resultType`/`op.body`) — this type is only ever emitted via `Param.generate()`'s
direct, undeduped call.

**Fix:** `Param.visit()` gains a second schema coercion (alongside the existing #11 anyOf/oneOf →
string case): a schema that is object-shaped (`type: object`, `allOf`, or non-empty `properties` —
at the top level or in an array's `items`) has the offending part replaced with a genuinely empty
`{}` schema before `Factory.fromSchema` runs — landing it in the existing shapeless-object → `JSON`
scalar path (#19), preserving array cardinality where present. This also incidentally closes the
`Composed.generate()` missing-`Param`-case gap for `allOf`-shaped params: since the coercion runs
before `Factory.fromSchema`, an `allOf` param schema is degraded to JSON the same way a plain object
is, and `Composed` is never constructed under a `Param` at all. No new `Obj`/`Composed`/`Arr`
branches, no widened type-collection roots. The `$ref` sniff uses `context.resolvePointer`, not
`lookupRef`, so checking a schema this coercion is about to discard doesn't bump its `refCount`.

**Known limitation, not handled here:** a param whose `oneOf`/`anyOf` member is itself object-shaped
(e.g. `id: oneOf [Foo, Bar]` with object `Foo`/`Bar`) is *not* covered — no corpus case observed.
`oneOf`/`anyOf` route to `Union`, whose existing `Param`-context handling (`union.ts`) flattens by
delegating to each member's `generate()` without shielding object-shaped members, so the same
inline-body bug would resurface one level down through `Union` rather than through `Obj` directly.
Deliberately not folded into this coercion's "object-like" check, since doing so would also change
behavior for existing `oneOf`/`anyOf` params whose members are plain scalars/enums (which already
render correctly today). If a future corpus spec hits this, it needs an `Obj`/`Composed`
`Param`-context guard (mirroring `Union`/`En`'s existing one) — start here.

**Tests:** `tests/resources/oas/param-object-array.yaml` (array-of-`$ref`-object query param) —
`test_object_array_param_degrades_to_json_scalar` in `tests/all/oas-core.test.ts` (asserts
`filters: [JSON]` is emitted and no inline `type SearchFilter {` appears; composes via rover;
reverting the fix reproduces the exact `INVALID_GRAPHQL: expected R_BRACK, got SearchFilter` rover
error, confirming the mechanism). box.yaml corpus re-measured: 98.2% → 100.0% (+1 op) — the other
half of a previously undocumented local finding ("B3"), whose first half
(`get:/files/.../boxSkillsCards`) was already fixed as a side effect of #39.

**AST:** none — `Param.visit()` schema coercion only, same shape as #11.
**Refs:** `src/oas/nodes/param.ts` (`Param.visit`, `degradeObjectLikeSchema`, `isObjectLike`),
`src/oas/nodes/factory.ts` (`isShapelessObject`, the existing #19 path this reuses). Related: #11,
#14, #19.

## 41 · Only servers[0] is ever consulted for @source baseURL — ✅ Fixed

**Symptom:** docker-engine.json's 43 GET ops all fail rover with `INVALID_URL_SCHEME`.

**OAS** (docker-engine.json's real `servers` array):
```json
"servers": [
  { "url": "/v1.33" },
  { "url": "https://docker.com/{version}", "variables": { "version": { "default": "1.33" } } }
]
```
`servers[0].url` is a bare relative path — no scheme, no host. `servers[1]` resolves fine to
`https://docker.com/1.33`, but is never consulted.

**Example** (before → after, same op):
```graphql
# before
@source(name: "api", http: { baseURL: "/v1.33" })      # ✗ INVALID_URL_SCHEME, every op
# after
@source(name: "api", http: { baseURL: "https://docker.com/1.33" })
```

**Cause:** `SchemaWriter.writeDirectives()` only ever read `servers?.[0]`; the (now-removed)
`getServerUrl` took it verbatim with no absolute-URL validation, ignoring any later, usable server.
Same defect class the project already hit with Confluence (`servers[0].url` was a protocol-relative
placeholder, `//your-domain.atlassian.net`) — fixed there by patching the fixture directly.
`TEST_CORPUS.md` had already flagged "normalise relative / protocol-relative servers[].url" as a
wanted generator robustness gap; a second real spec hitting the same class of bug is what prompted
fixing it in the generator this time instead of another one-off fixture patch.

**Fix:** new `src/oas/utils/serverUrl.ts` (`ServerUrl.resolve`), following this codebase's existing
static-utility-class convention (`Naming`, `GqlUtils`, `Params`) rather than living inside the
writer. Walks the full `servers[]` array **in OAS-declared order** — an author's ordering is
deliberate (e.g. prod listed before sandbox), so this does not scan for "any absolute" candidate
first and jump ahead of an earlier, merely protocol-relative one. For each candidate: normalise a
protocol-relative URL (`//host/path`) by prefixing `https:`, then return the first one that's
absolute (`/^https?:\/\//i`); else fall back to the existing `http://localhost:4010` — byte-identical
to the old no-server behavior.

**Known limitation, not handled here:** a `servers[]` array where *every* entry is a bare relative
path (no absolute, no protocol-relative option anywhere) still falls back to
`http://localhost:4010` with the relative path dropped entirely — no corpus case currently needs
the path preserved in that fallback. This fix closes only the "skip a leading unusable server when
a later usable one exists" slice of the broader gap `TEST_CORPUS.md` named, not that case.

**Tests:** `tests/resources/oas/server-fallback-relative.yaml`
(`test_server_url_falls_back_past_bad_first_server`), `server-protocol-relative.yaml`
(`test_server_url_prefixes_protocol_relative`), `server-order-preserved.yaml`
(`test_server_url_preserves_declared_order` — proves order is preserved, not "prefer whichever is
absolute") — all in `tests/all/oas-core.test.ts`; each reverts to failing when the fix is undone,
confirming the mechanism. docker-engine.json corpus re-measured: 0.0% → 86.0% (0/43 → 37/43); the 6
remaining ops fail a different, unrelated error (`INVALID_SELECTION`) not investigated here.

**AST:** none — pure utility logic, no node/tree changes.
**Refs:** `src/oas/utils/serverUrl.ts` (`ServerUrl.resolve`), `src/oas/io/schemaWriter.ts`
(`writeDirectives`, the call site). Related: the Confluence fixture-patch this generalizes past
(see `TEST_CORPUS.md`).

## 42 · A map field needing a JSON-key alias writes it twice, breaking the selection — ✅ Fixed

**Symptom:** any map (`additionalProperties`) field whose JSON key needs snake_case→camelCase
aliasing emits an invalid, doubled selection. Confirmed on `stripe.json`'s `currency_options` and
`docker-engine.json`'s `Networks` — both fail rover with `INVALID_SELECTION`,
`nom::error::ErrorKind::Eof`.

**OAS** (a map field with a JSON key needing an alias):
```yaml
currency_options:
  type: object
  additionalProperties:
    type: object
    properties:
      amount_off: { type: integer }
```

**Example** (before → after, same field):
```graphql
# before: the alias text written twice — invalid, rover can't parse it
currencyOptions: "currency_options": currencyOptions: "currency_options"->entries { key value { amountOff: "amount_off" } }
# after: written once, matching every other field type
currencyOptions: "currency_options"->entries { key value { amountOff: "amount_off" } }
```

**Cause:** `PropMap.select()` (`src/oas/nodes/propMap.ts`) always wrote
`Naming.sanitiseFieldForSelect`'s result twice, joined by a stray `': '`. That helper already
returns the complete text for a field — just the bare name when no alias is needed, or the full
`name: "original"` pair when it is. Every sibling (`propArray.ts`, `propObj.ts`, `propComp.ts`,
`propEn.ts`, `propScalar.ts`) writes it once. Writing it twice only broke when a real alias was
present (two `name: "original"` pairs back to back); for a map field whose key needs no aliasing,
the old code produced a harmless self-alias (`name: name->entries`) — which is why this went
uncaught: no existing test exercised a map field that also needed aliasing.

**Fix:** write the field text once. When no alias is needed, a self-alias (`name: name`) is kept
before `->entries` — not because it's meaningful GraphQL, but because a locally-vendored pre-release
composer build (`tools/local/apollo-federation-cli`, used by `test_060`-`062`/`test_R5_security_apikey_header_emits_named_header`
when present) fails to credit `key`/`value` through a bare `name->entries` with no alias at all
(`Object type X has no field key`) — a quirk in that external tool, confirmed by reproducing it
directly, not something to fix here. Keeping the self-alias only for the no-op case preserves that
compatibility while still fixing the genuinely broken doubled-alias case.

**Known limitation, not a bug in this fix:** on stock rover (not the local pre-release build),
composing a map field at all — regardless of aliasing — still hits the pre-existing, already-accepted
upstream limitation from #14 (`CONNECTORS_UNRESOLVED_FIELD` on the map entry's `key`/`value`, since
rover v0.4's shape validator credits nothing inside `->entries`). This fix corrects an independent,
real parsing bug; it does not by itself change `stripe.json`/`docker-engine.json`'s stock-rover
pass-rate (both re-measured, unchanged: 82.4% / 86.0%) until a rover release ships #14's patch — at
which point these ops will compose without any further change here.

**Tests:** `tests/resources/oas/map-key-aliasing.yaml`, `test_map_field_key_aliasing_not_duplicated`
in `tests/all/oas-core.test.ts` (generation-only, no compose — mirrors
`test_no_duplicate_type_definitions_launch_library`'s pattern, since composing a map field is
blocked by #14 on stock rover regardless of this fix; asserts the alias text appears exactly once).
Reverting the fix reproduces the exact duplicated output and fails the test.

**AST:** none — emission-only, no node/tree changes.
**Refs:** `src/oas/nodes/propMap.ts` (`PropMap.select`), `src/oas/utils/naming.ts`
(`sanitiseFieldForSelect`, unchanged). Related: #14 (the separate upstream limitation still gating
full compose on stock rover).

## 43 · Real-union member list and `__typename` use the raw ref name, not the sanitised one — ✅ Fixed

**Symptom:** a real (discriminated, top-level) union whose OAS member refs aren't already
PascalCase composes as a flood of `CONNECTORS_UNRESOLVED_FIELD` — one per field of every member.
Confirmed on `ably-control.json get:/apps/{app_id}/rules` (172 rover build errors, one op).

**OAS** (snake_case discriminator mapping refs):
```json
"rule_response": {
  "discriminator": {
    "propertyName": "ruleType",
    "mapping": {
      "http": "#/components/schemas/http_rule_response",
      "http/ifttt": "#/components/schemas/ifttt_rule_response"
    }
  },
  "oneOf": [
    { "$ref": "#/components/schemas/http_rule_response" },
    { "$ref": "#/components/schemas/ifttt_rule_response" }
  ]
}
```

**Example** (before → after, same op):
```graphql
# before: member list + __typename reference an undefined, unsanitised type name
union RuleResponse = http_rule_response | ifttt_rule_response
...
__typename: $("http_rule_response")

# after: both agree with the real emitted type definition
union RuleResponse = HttpRuleResponse | IftttRuleResponse
...
__typename: $("HttpRuleResponse")
```

**Cause:** `Obj.generate()` (`obj.ts:80-85`) and `Composed.generate()` already resolve a member's
ref through the established `sanitised === refName ? refName : sanitised` pattern (PascalCase when
it differs from the raw ref — see #15), so `http_rule_response` is correctly emitted as
`type HttpRuleResponse`. But `Union.generate()`'s real-union branch (`union.ts:147`, was
`Naming.getRefName(child.name)`) and `Union.selectAbstract()`'s `__typename` literal (`union.ts:308`,
same bug) used the **raw** `Naming.getRefName` only, producing a `union X = ...` line and a
`__typename` string that name a type that was never defined. Rover then can't resolve any field of
any member — the union's member list is the only thing tying them to the schema at all.

**Fix:** added a `Union.resolvedTypeName(ref)` private static helper (the same sanitised/refName
pattern, scoped to this class since it's needed 3x in this file — matches obj.ts/comp.ts's existing
per-file duplication rather than centralizing into `Naming`, which is already correct everywhere
else). Used at the union member-list line and at `__typename`. Left the discriminator match-value
fallback (`this.discriminatorValue(child) ?? Naming.getRefName(child.name)`) on the raw ref name —
that value is compared against real API payloads, which carry the schema's own snake_case tag, not
the sanitised GraphQL name.

**Tests:** `tests/resources/oas/r2-union-nested-in-list.yaml` (`/snake-items`, `snake_item_union` +
`book_item`/`movie_item`), `test_R2_union_snake_case_member_refs_resolve_sanitised_name` in
`tests/all/r2-abstract.test.ts`. Existing coverage (`test_R2_union_top_level_array_stays_real_union`)
used PascalCase members (`Book`/`Movie`), so it never exercised a snake_case component ref on a real
union. Reverting the fix reproduces rover's exact failure (`cannot find type 'book_item' in this
document`) and fails the test.

**AST:** none — emission-only, no node/tree changes.
**Refs:** `src/oas/nodes/union.ts` (`Union.generate`, `Union.selectAbstract`). Related: #15 (the
def/ref name-agreement pattern this extends to unions' member list).

## 44 · Merged-union field dedup keys on Prop kind, not field name — and ignores type compatibility — ✅ Fixed

**Symptom:** a nested (merged/flattened) union whose members share a field name but give it
**different kinds** (e.g. one member has it as an OAS `enum`, another as a plain string) emits the
field twice — invalid GraphQL SDL. Confirmed on `TMF717_Customer360-v5.0.0.oas.yaml get:/customer360`:
rover rejects with `INVALID_GRAPHQL: Field status already exists on PartyOrPartyRole`.

**OAS** (two `PartyOrPartyRole` union members, same field name `status`, different kinds):
```yaml
Individual:
  properties:
    status:
      $ref: '#/components/schemas/IndividualStateType'   # enum
PartyRole:
  allOf:
    - type: object
      properties:
        status:
          type: string                                    # plain scalar
          description: Used to track the lifecycle status of the party role.
```

**Example** (current, broken output):
```graphql
type PartyOrPartyRole { #### replacement for Union PartyOrPartyRole
  ...
  status: IndividualStateType
  ...
  status: String          # duplicate field name -> INVALID_GRAPHQL
  ...
}
```

**Cause:** `Union.dedupedSelectedProps()` (`union.ts:202-207`, added for #39) dedupes merged-union
member fields by `prop.id`. `prop.id` is prefixed by the `Prop` *subclass* — `prop:enum:status`
(`propEn.ts:17`) vs `prop:scalar:status` (`propScalar.ts:21`) — so two members giving the same field
name **different kinds** both survive dedup. #39 only covered same-kind collisions (two `$ref`
members pointing at different object types, both `prop:ref:#detail` — see the existing
`test_R2_union_merge_name_collision_drops_shadowed_type`), never a kind mismatch.

**Fix:** a bare `prop.id` → `prop.name` key isn't enough on its own — GraphQL forbids two
same-named fields regardless of kind, but a name match alone doesn't mean two members' fields are
interchangeable. The plan's first draft compared each collision's resolved GraphQL type
(`getValue(context)`) and degraded on any mismatch — that broke the *existing* #39 test: two `$ref`
members pointing at different object types (`DetailBasic` vs `DetailRich`) resolve to different
`getValue()` strings too, but that collision was always meant to keep the first member's type
(shadowing the rest), not degrade to JSON. The correct comparison is **kind**, not resolved type —
the `id`'s subclass segment (`prop.id.split(':')[1]`: `enum`, `scalar`, `ref`, `obj`, `comp`, `map`,
`array`). Two members giving a field the *same kind* (whatever concrete type each resolves to) can
still be safely shadowed — selecting common sub-fields from differently-shaped payloads is fine,
exactly the #39 case. Two members giving a field *different kinds* (enum vs scalar, object vs
scalar, …) genuinely can't share one GraphQL representation — that's when it degrades to the
untyped JSON scalar fallback instead of arbitrarily picking one member's kind, reusing the same
"give up, use JSON scalar" policy already shipped for incompatible object-typed query params
(`0cf24ea`). No new data structures: `dedupedSelectedProps` still takes just `selection` (threading
`context` through turned out unnecessary once the comparison moved from `getValue()` to `id`-derived
kind).

**Tests:** `tests/resources/oas/r2-union-nested-in-list.yaml` gained `/kind-collision-list`
(`StatusEnumKind`/`StatusStringKind`, an enum-vs-scalar `status` collision — the enum has to be a
named `$ref` schema, not inline, or it degrades to a plain scalar before ever reaching the union
merge and never exercises the kind-mismatch path at all).
`test_R2_union_merge_kind_collision_degrades_to_json` in `tests/all/r2-abstract.test.ts` asserts
`status: JSON` and that the enum type never leaks into the schema. The existing #39 test
(`test_R2_union_merge_name_collision_drops_shadowed_type`) re-passes unchanged, confirming
same-kind/different-target collisions still shadow-and-keep-first exactly as before. Reverting just
the `dedupedSelectedProps` body (keeping the rest of the #43 changes in the same file) reproduces the
enum type leaking in and fails the new test. Also re-ran coverage on the other union-heavy specs
named in the plan (docker-engine 86.0%, launch_library 99.1%, common-room 100%, TMF717 33.3%) —
unchanged from baseline in every case, no regressions.

**Aside (flagged, not fixed here — out of scope for this entry):** clearing the `status` collision
on `TMF717_Customer360-v5.0.0.oas.yaml get:/customer360` surfaced a *second*, previously-masked
compose error on the same op: `INVALID_GRAPHQL: Field type already exists on
Customer360PromotionVO` — a duplicate `type` field (`String!` vs `String`) from two different
`allOf` branches of a **`Composed`** type, not a `Union`. This is a distinct bug in `Composed`'s
allOf field collection (unrelated to this entry's `Union.dedupedSelectedProps`) that was simply
hidden behind the `status` error until now. Not triaged or fixed as part of #44 — worth its own
entry if picked up.

**AST:** none expected — emission-only, changes which `Prop` survives dedup and how it's typed.
**Refs:** `src/oas/nodes/union.ts` (`Union.dedupedSelectedProps`, `Union.generateMergedObject`).
Related: #39 (the same-kind version of this collision, already fixed), `0cf24ea` (the JSON-scalar
degrade precedent for incompatible shapes).

## 45 · No reserved-GraphQL-name guard: an OAS resource literally named "Subscription" collides with the root type — ✅ Fixed

**Symptom:** any OAS component schema named `Query`, `Mutation`, or `Subscription` (case-sensitive)
gets emitted as a plain object type of that exact name, colliding with the reserved GraphQL root
operation type — rover composition rejects it under connectors' subscriptions-unsupported rule.
Confirmed on `stripe.json`: 7 ops (`get:/v1/customers`, `get:/v1/subscriptions`, `get:/v1/subscriptions/
{subscription_exposed_id}`, `get:/v1/customers/{customer}/subscriptions`, etc.) fail rover compose
with `SUBSCRIPTION_IN_CONNECTORS`.

**OAS** (a component schema literally named `subscription`, Stripe's actual resource name):
```json
"subscription": {
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "customer": { "type": "string" },
    "status": { "type": "string" }
  }
}
```

**Example** (current output — no before/after, nothing sanitises this today):
```graphql
type Subscription {   # collides with GraphQL's reserved root Subscription type
  id: String
  customer: String
  status: String
}
```

**Cause:** `Naming.genTypeName()` (`naming.ts:160`) sanitises characters (drops non-identifier
chars, guards a leading digit) but has no check against the 3 reserved root operation type names.
There's precedent for a similar collision-avoidance suffix (`Obj.generate`, `obj.ts:309-310`:
`parentName + 'Obj'` when a nested type shares its parent's name), but nothing for this case.

**Fix:** the guard lives inside `Naming.genTypeName` itself, not at each node's own definition-line
generation (`Obj`/`Composed`/`Union`, etc.). `genTypeName` is the one function every type
*definition* (`Obj.generate`, `Composed.generate`, `Union.generate`, `Map.generate`, `En.generate`)
and every type *reference* (`propRef.ts`, `propComp.ts`, `propObj.ts`, `propArray.ts`, `propMap.ts`,
`propEn.ts`, `propCircRef.ts`, `typeUtils.ts`, `allOfBase.ts`, `oasContext.ts`, `writer.ts`) resolves
through — there is no separate reference-side resolver to keep in sync. Guarding only a definition
site would rename `type Subscription { ... }` but leave references to it still resolving to the old,
now-undefined name. `genTypeName` was already a pure, idempotent function of the input string, so
appending a suffix when the sanitised result is exactly `Query`/`Mutation`/`Subscription` produces
the same renamed output at every call site naming the same schema — definitions and references
alike, nothing else to update. Composes cleanly with the existing
`sanitised === refName ? refName : sanitised` fallback used at definition sites (`obj.ts:85`,
`comp.ts:91`, `union.ts:126`): that fallback only reverts to the raw ref name when sanitisation made
no real change, and once a reserved-name suffix is appended `sanitised !== refName` is always true,
so the fallback correctly keeps the suffixed name. Suffix: `Type` (`Subscription` → `SubscriptionType`).

**Tests:** `tests/resources/oas/reserved-root-type-name.yaml` (a `Subscription` schema referenced
from a nested `Customer.subscription` field), `test_reserved_root_type_name_gets_suffixed` in
`tests/all/oas-core.test.ts` — asserts the definition and the reference both land on
`SubscriptionType` and rover-composes. Reverting the fix reproduces the un-suffixed
`type Subscription {` and fails the test. Also re-verified directly against `stripe.json`
(`get:/v1/customers`, `get:/v1/subscriptions`): `SUBSCRIPTION_IN_CONNECTORS` is gone; the remaining
7 `CONNECTORS_UNRESOLVED_FIELD` errors on those ops are the separate, already-documented #14 map-field
limitation (`currency_options`), unrelated to this fix.

**AST:** none expected — emission-only, a name-string transform in an already-existing function.
**Refs:** `src/oas/utils/naming.ts` (`Naming.genTypeName`). Related: `obj.ts` (`Obj generate`, the
`parentName + 'Obj'` precedent for a different collision).

## 46 · An array `$ref` to another array-typed schema nests an `Arr` inside a `PropArray`, breaking both the field's type name and its selection brackets — ✅ Fixed

**Symptom:** an array property whose `items` is a `$ref` that itself resolves to a `type: array`
schema (rather than a plain object) emits a field type that references an undefined type, AND drops
the nested selection's braces entirely — flattening the nested object's fields straight into the
*parent's* own selection body as if they were siblings. Confirmed on `docker-engine.json
get:/system/df`: rover rejects with `SELECTED_FIELD_NOT_FOUND: @connect(selection:) on
Query.systemDf contains field 'command', which does not exist on SystemDfResponse`.

**OAS** (`Containers` is an array whose item ref, `ContainerSummary`, is itself `type: array`):
```json
"SystemDfResponse": {
  "properties": {
    "Containers": { "type": "array", "items": { "$ref": "#/components/schemas/ContainerSummary" } }
  }
},
"ContainerSummary": {
  "type": "array",
  "items": { "properties": { "Command": { "type": "string" }, "Id": { "type": "string" } } }
}
```

**Example** (current, broken output):
```graphql
type SystemDfResponse {
  containers: [Containers]   # "Containers" is never defined anywhere
  ...
}
type ContainersItem {        # the real object — under a DIFFERENT name than the field references
  command: String
  id: String
  ...
}
# selection: containers' own fields leak into the parent's selection, unbracketed
containers: "Containers"      command: "Command"
id: "Id"
...
```

**Cause (confirmed by tracing the exact code path, one root cause explaining both symptoms):**
`Factory.fromProp`'s array branch (`factory.ts:295-305`) resolves `Containers`' `items` — the
`ContainerSummary` `$ref` — via `Factory.fromSchema`. Because `ContainerSummary`'s own schema is
`{type: array, items: {...}}` (not an object), `fromSchema` routes it through `createArrayType`
*again* (`factory.ts:248`), producing a **second, nested `Arr`** as `PropArray.items` — instead of
the plain `Obj` every other array property gets. That nested `Arr`'s own `.name` is just inherited
from its parent (`parentName = parent.name`, `factory.ts:250` — here the *outer* `PropArray`'s name,
`"containers"`), and the *real* object lives one level deeper, as that inner `Arr`'s `itemsType`
— named `ContainersItem` by `Obj.updateName()`'s array-item fallback (`obj.ts:294-297`, `parent
instanceof Arr` branch). Two call sites in `PropArray` assume `this.items` is always the actual
element type (object/scalar), never another `Arr`, and both break the same way once it is:
- `PropArray.getValue()` (`propArray.ts:52-59`) takes `Naming.genTypeName(this.items.name)` —
  reads the nested Arr's inherited name (`"containers"` → sanitised `Containers`) instead of the
  real object's name (`ContainersItem`) two levels down. Definition and reference now name two
  different things.
- `PropArray.select()`'s `needsBrackets()` (`propArray.ts:80/89/103-106`) gates on
  `T.isContainer(this.items)` (`typeUtils.ts:81-88`, true only for `obj:`/`comp:`/`union:`/`map:` id
  prefixes) — an `Arr`'s id (`array:...`, `arr.ts`) never matches, so no `{`/`}` gets written, and
  `this.items!.select(...)` (the nested `Arr`'s `select`, which itself has no bracket logic — it just
  delegates straight to its own `itemsType.select()`) writes the real object's fields completely
  unscoped, straight into whatever selection body is currently open.

The real API payload (`"Containers": [{...}]`, docker's own example) is a single-level array of
objects — `ContainerSummary` being independently modeled as `type: array` is redundant/an artifact of
how this OAS names a reusable "list of X" schema, not a genuine array-of-arrays on the wire.

**Fix:** a new `Factory.unwrapRedundantArrayItems(context, items)` helper — when `items` is a `$ref`
that resolves to a schema itself `{type: array, items: Y}`, returns `Y` directly (skips straight to
the true item schema) instead of letting the ref reach `fromSchema` and recurse into another
`createArrayType`. Applied at **both** places an array's `items` gets resolved: `fromProp`'s array
branch (`factory.ts` ~330, the named-property path — this is the one `Containers` actually takes) and
`createArrayType` itself (`factory.ts` ~257, the generic path reached via `fromSchema`, for arrays
found any other way). This keeps `PropArray.items` an invariant every existing call site already
assumes — never another `Arr` — so `getValue()` and `needsBrackets()`/`select()` needed no changes
themselves.

**Tests:** `tests/resources/oas/array-refs-array-typed-schema.yaml` (`widgets: [WidgetList]` where
`WidgetList` is itself `type: array`), `test_array_item_ref_to_array_typed_schema_unwraps_redundant_nesting`
in `tests/all/oas-core.test.ts` — asserts `widgets: [WidgetsItem]` matches the real
`type WidgetsItem` definition, `WidgetList` never leaks into the schema, and the selection nests
inside braces rather than flattening. Reverting the fix reproduces a real rover failure
(`cannot find type 'widgets' in this document`) and fails the test. Re-verified directly against
`docker-engine.json get:/system/df`: the `SELECTED_FIELD_NOT_FOUND` on `command` is gone; the op
still doesn't fully compose, but now only for the separate, already-documented #14 map-field
limitation (`NetworkSettings.Networks`), which was always going to block it regardless of this fix.
Re-ran the full `docker-engine.json` coverage sweep before/after: same 86.0% (37/43), same 6 ops in
the compose-fail bucket — no regression, and `/system/df`'s failure category changed from
`SELECTED_FIELD_NOT_FOUND` to the same `CONNECTORS_UNRESOLVED_FIELD` (#14) the other 5 already show.

**AST:** a shape change, not emission-only — removes a redundant intermediate `Arr` node so
`PropArray.items` always points at the true element type.
**Refs:** `src/oas/nodes/factory.ts` (`Factory.fromProp`'s array branch, `Factory.createArrayType`),
`src/oas/nodes/propArray.ts` (`PropArray.getValue`, `PropArray.select`, `PropArray.needsBrackets`),
`src/oas/nodes/obj.ts` (`Obj.updateName`, the array-item naming fallback that names the *real* object
two levels down), `src/oas/nodes/typeUtils.ts` (`T.isContainer`, unchanged — confirms `Arr` is
deliberately not a container, which is exactly why this shape falls through both checks).

## 47 · A bare array-of-scalar op response is dropped entirely (no Query field, empty selection) — ✅ Fixed

**Symptom:** an op whose response is a bare array of scalars (no wrapping object/property — the
response schema itself is `{type: array, items: {type: <scalar>}}`) vanishes from the schema
completely: no `Query`/`Mutation` field at all, not even a degraded one. Confirmed on 7
`spotify.json` ops (`get:/me/albums/contains`, `get:/me/tracks/contains`, `get:/me/shows/contains`,
etc. — Spotify's "check saved X" endpoints, which return `[true, false, ...]`).

**OAS** (a bare array-of-boolean response, no object wrapper):
```yaml
responses:
  '200':
    content:
      application/json:
        schema:
          type: array
          items:
            type: boolean
```

**Cause — two parts, confirmed by direct repro:**
1. **The op is dropped before generation even starts.** `PathsCollector.collectExpandedPaths`
   (`typesCollector.ts:251-303`) decides which nodes are "leaves" (selectable) by walking the op's
   tree; it already special-cases a *named* scalar-array property (`child instanceof PropArray &&
   child.items instanceof Scalar`, line 262) and a *bare single scalar* direct response (`child
   instanceof Scalar && child.parent instanceof Res`, line 272, added for #32 — e.g. a write that
   just returns `true`). It has no case for a **bare array of scalars** as the direct response
   (`Res -> Arr -> Scalar`, no `Prop` wrapper) — so the traversal finds no leaf at all, `newSelection`
   stays empty for the op, and it's dropped from the schema entirely (confirmed: `gen.getTypes()`
   returns `types.size === 0` and the generated schema has no `type Query {` block whatsoever).
2. **Even once selectable, the connector selection would be empty.** `Res.select()` only special-cases
   `T.isScalar(response)` (a bare scalar) by writing `$`; a bare array response falls to
   `response.select(...)` → `Arr.select()` → unconditionally delegates to `this.itemsType.select()`
   → `Scalar.select()`, which writes nothing unless the scalar has a JSON-schema `default`. Confirmed
   by patching in a fix for cause 1 alone (temporary, reverted): the op does get a `Query` field
   (`meAlbumsContains(ids: String!): [Boolean]`), but rover then rejects it with
   `INVALID_SELECTION: @connect(selection:) on Query.meAlbumsContains is empty`.

**Fix:** two matching additions, one per cause, mirroring the existing bare-scalar precedent each
was missing:
1. `PathsCollector.collectExpandedPaths`'s leaf-detection `T.traverse` callback gained a branch:
   `child instanceof Arr && child.parent instanceof Res && child.itemsType instanceof Scalar` →
   `newSelection.add(child.path())` — same shape as the existing bare-scalar-response branch beside
   it.
2. `Res.select()` now emits `$` for a direct-response array whose `itemsType` is a scalar too —
   widened the existing `T.isScalar(response)` branch to `T.isScalar(response) || (response
   instanceof Arr && response.itemsType instanceof Scalar)`.

**Tests:** `tests/resources/oas/bare-scalar-array-response.yaml` (mirrors #32's
`bare-scalar-response.yaml`, one level up — a bare `array of boolean` response, no wrapper),
`test_bare_scalar_array_response_not_dropped` in `tests/all/oas-core.test.ts` — asserts the field
survives with type `[Boolean]` and the selection is the bare `$` passthrough, and composes via
rover. Reverting both changes together reproduces the op vanishing entirely and fails the test.
Re-verified directly against all 7 originally-affected `spotify.json` ops: full corpus sweep for
that spec went from 87.9% (51/58, 7 `GEN-EMPTY`) to **100%** (58/58) — every dropped op now composes.

**AST:** none — both fixes are leaf-detection/selection-emission additions, no new node kinds.
**Refs:** `src/oas/generator/typesCollector.ts` (`PathsCollector.collectExpandedPaths`),
`src/oas/nodes/res.ts` (`Res.select`). Related: #32 (the bare scalar-response precedent this extends
to bare scalar-array responses).

## 48 · The same `oneOf` used by a request body and by a response is only written once — ✅ Fixed

**Symptom:** a mutation whose request body and whose response both contain the same `oneOf` list
generates a schema that refers to a type it never writes, so composition fails with
`CONNECTORS_UNRESOLVED_FIELD`. Seen on `quickbooks-online.yaml` `post:/v3/company/{realm-id}/bill`
and `post:/v3/company/{realm-id}/payment`.

**OAS** — QuickBooks writes the very same `Line` list in the schema you send (`BillCreateObject`,
line 2378) and in the schema you get back (`Bill`, line 2882):
```yaml
BillCreateObject:            # the request body
  properties:
    Line:
      type: array
      items:
        oneOf:
          - $ref: '#/components/schemas/ItemBasedExpenseLine'
          - $ref: '#/components/schemas/AccountBasedExpenseLine'
Bill:                        # the response
  properties:
    Line:
      type: array
      items:
        oneOf:               # identical
          - $ref: '#/components/schemas/ItemBasedExpenseLine'
          - $ref: '#/components/schemas/AccountBasedExpenseLine'
```

**Example**:
```graphql
# before: only the input flavour is written; `LineUnion` is referenced but never defined
input LineUnionInput { ... }        # the two members merged into one object (no discriminator, see #25)
type Bill { line: [LineUnion] }     # ✗ CONNECTORS_UNRESOLVED_FIELD — no `LineUnion` anywhere

# after: both flavours are written
input LineUnionInput { ... }
type LineUnion { ... }
type Bill { line: [LineUnion] }     # ✓
```

**Cause:**
- A node's `kind` says whether it is something you send (`input`) or something you get back (`type`).
- `Union.id` was the only node id that left the kind out — its siblings all carry it:
  ```
  src/oas/nodes/obj.ts:34    obj:${this.kind}:${this.name}
  src/oas/nodes/comp.ts:26   comp:${this.kind}:${this.name}
  src/oas/nodes/map.ts:25    map:${this.kind}:${this.name}
  src/oas/nodes/union.ts:38  union:${this.name}              <- the bug
  ```
- Two `Union` nodes are built for `Line` — one for the body, one for the response — but they end up
  with the same id.
- Everything that keeps track of what has been written is keyed by that id
  (`typesCollector.ts:63-72,133`, `oasGen.ts:185`, `writer.ts:92`), so the second node replaces the
  first and only one of the two is ever written. The body one wins, and the response field is left
  pointing at nothing.
- GET-only specs never showed this: with no request body there is no second node to collide with.
- `Union.generateMergedObject` already writes the kind and appends `Input` to the name, so both
  flavours were always meant to exist side by side — the shared id was what prevented it.

**Fix:** put the kind in the id, exactly like `Obj` / `Comp` / `Map`:
`union:${this.kind}:${this.name}`.

**Tests:** `test_R2_union_shared_by_body_and_response_emits_both_flavours` in
`tests/all/r2-abstract.test.ts` — selects `post:/v3/company/{realm-id}/bill>**` on the existing
`quickbooks-online.yaml` fixture and asserts that both `type LineUnion` and `input LineUnionInput`
are written. Undoing the one-line change fails it. The QuickBooks mutation sweep went from 5/7
(71.4%) to **7/7 (100%)**; the full GET sweep is byte-identical to the run before the change.

**AST:** an identity change — same nodes, same shape, one of them now has a different id, so union
segments inside selection paths gained the kind (real path, `mapper.test.ts:28`):
```
before:  get:/2.3.0/agencies/>res:r>obj:type:#/c/s/PaginatedPolymorphicAgencyEndpointList
           >prop:array:#results>union:#/c/s/PolymorphicAgencyEndpoint>…
after:   …>prop:array:#results>union:type:#/c/s/PolymorphicAgencyEndpoint>…
```
A union reached from a request body gets `union:input:` instead — that is the node that used to be
lost. 18 literal paths in `oas-core.test.ts`, `r2-abstract.test.ts`, `mapper.test.ts` and `single.test.ts`
were updated to `union:type:`; all of them are response-side. The web UI stores checked selections
under `oas:tree-selection`, so a selection saved before this change and crossing a union will not
restore — it clears on the next upload.

**Refs:** `src/oas/nodes/union.ts` (`Union.id`), `src/oas/nodes/obj.ts` / `comp.ts` / `map.ts` (the
siblings it now matches), `src/oas/generator/typesCollector.ts` and `src/oas/io/writer.ts` (the two
places keyed by the id). Related: #25 (a `oneOf` with no discriminator becoming one merged object —
that downgrade works fine here; this is about it being written once instead of twice), #14
(`CONNECTORS_UNRESOLVED_FIELD` from the opposite problem — types written that nothing selects).

## 50 · An `anyOf` with no `oneOf` loses all its members and writes an empty block — ✅ Fixed

**Symptom:** an op whose request body is an `anyOf` (and not also a `oneOf`) writes an input type
with no fields — invalid GraphQL, rejected by rover as `INVALID_GRAPHQL`. The body selection is
empty too, so even the fields the service requires are never sent. Seen on 8 of
`digitalocean.yaml`'s 10 failing mutations, e.g. `post:/v2/domains/{domain_name}/records`.

**OAS** — digitalocean lists the record variants under `anyOf`, with no `oneOf` anywhere:
```yaml
requestBody:
  content:
    application/json:
      schema:
        anyOf:                                  # 9 members, one per DNS record type
          - allOf:
              - $ref: '#/paths/~1v2~1domains~1%7Bdomain_name%7D~1records/get/…/domain_records/items'
              - required: [type, name]
          - …
        discriminator: { propertyName: type }
```

**Example**:
```graphql
# before: no fields, and nothing is sent
input InputInput { }                    # ✗ INVALID_GRAPHQL
body: """ $args.input { } """

# after: the members are merged as usual
input InputInput { data: String, name: String, type: String!, ttl: Int, … }
```

**Cause:**
- `Factory.createContainerType` sends a schema to `Union` when it has **either** `oneOf` or `anyOf`.
- But it then read the member list from `oneOf` alone: `const oneOfs = schema.oneOf || []`.
- So an `anyOf`-only schema built a union with **zero** members.
- Everything after that behaved correctly on an empty union — an empty merged object, an empty body
  selection. The tree confirms it: the whole body is one childless node.
  ```
  post:/v2/domains/{domain_name}/records>body:b>union:input:Input     (no children)
  ```
- #20 already handles one `anyOf` case — two members where one is a fieldless placeholder, which
  collapses to the other before reaching here. An `anyOf` with several real members had no path.

**Fix:** read the members from whichever keyword carries them —
`const members = schema.oneOf || schema.anyOf || [];`. `allOf` still wins (it is checked first), and
a member list with no discriminator lands in the existing merged-object form (#25) like any `oneOf`.

**Tests:** `test_anyof_only_body_keeps_its_members` in `tests/all/oas-core.test.ts` — selects
digitalocean's create-record op and asserts the input carries the real fields and that no empty
`input … { }` block is written; composes via rover. Reverting the one line fails it.

**AST:** a shape change — the union node gains the children it should always have had. No new node
kinds; node ids are unchanged.
**Refs:** `src/oas/nodes/factory.ts` (`Factory.createContainerType`). Related: #20 (the narrow
`anyOf` case that already worked), #25 (the merged-object form these bodies take), #51 (the other
half of the empty-block family, fixed alongside this).

## 51 · An empty response object is left empty when the op's body is selectable — ✅ Fixed

**Symptom:** a write whose response is an object with no fields emits `type … { }` and
`selection: """ """` — invalid, and rover rejects it with `INVALID_SELECTION`. Only mutations are
affected. Seen across `asana.yaml`, e.g. `post:/goals/{goal_gid}/removeSupportingRelationship`;
asana declares 30 such writes.

**OAS** — asana's "nothing to return" convention, an object whose schema declares no properties:
```yaml
responses:
  '200':
    content:
      application/json:
        schema:
          type: object
          properties:
            data: { $ref: '#/components/schemas/EmptyResponse' }
components:
  schemas:
    EmptyResponse:      # "An empty object. Some endpoints do not return an object on success."
      type: object
```

**Example**:
```graphql
# before
type CreateGoalsRemoveSupportingRelationshipResponse { }   # ✗ INVALID_SELECTION
selection: """ """

# after
type CreateGoalsRemoveSupportingRelationshipResponse { data: JSON }
selection: """ data """
```

**Cause:**
- #32 already covers this shape: when an op's expansion finds nothing selectable, its fieldless
  objects are taken as the leaves and written as `JSON`.
- That check asked whether the **whole op** had nothing selected. A write has two sides, and its
  body usually does have something — so the check passed and the fallback never ran for the
  response. The AST shows the split, one side selectable and the other not:
  ```
  post:…>body:b>obj:input:Input>prop:obj:data>obj:input:#/c/s/…Request>prop:scalar:supporting_resource
  post:…>res:r>obj:type:createGoals…Response>prop:obj:data>obj:type:#/c/s/EmptyResponse   <- no leaf
  ```
- GET ops never showed it: with no body, "the op" and "the response" are the same thing.

**Fix:** ask the question per side instead of per op — for each of the op's own children (`res`,
`body`), if nothing under that side was selected, run the same fieldless-object traversal there. The
mechanism is #32's, unchanged; only the scope it is applied at moved.

**Tests:** `test_empty_response_alongside_a_selectable_body` in `tests/all/oas-core.test.ts` —
asserts `data: JSON` on the response type and `data` in the selection, composing via rover.
Narrowing the scope back to the op fails it.

**AST:** none — the node tree is untouched; this only changes which paths the collector selects.
**Refs:** `src/oas/generator/typesCollector.ts` (`PathsCollector.collectExpandedPaths`). Related:
#32 (the fallback this generalises), #50 (the other half of the empty-block family).

## 52 · An array whose items wrap another array, written inline, breaks the field name and its selection — ✅ Fixed

**Symptom:** a list field points at a type nobody defines, and the element's fields are written into
the parent's selection with no braces around them, so rover reports `SELECTED_FIELD_NOT_FOUND` for
each of them. Found on `slack.yaml get:/conversations.replies` after #50 gave the `anyOf` its
members; slack has 5 sites of this shape.

**OAS** — the inner schema's only key is `items`, so it wraps the element rather than being it:
```yaml
messages:
  type: array
  items:                    # no `type`, no `properties` — only `items`
    items:
      anyOf: [ {…}, {…} ]
```
slack's own example payload is one level — `"messages": [ {…}, {…} ]` — so the extra level is an
artifact of how the spec was generated, not something the service sends.

**Example**:
```graphql
# before
type ConversationsRepliesResponse { messages: [messages]! }   # ✗ nothing is named `messages`
type MessagesUnion { lastRead: String, … }                    # the real definition, other name
selection: """ messages      lastRead: "last_read" … """      # ✗ no braces: the element's fields
                                                              #   read as the parent's own

# after
type ConversationsRepliesResponse { messages: [MessagesUnion]! }
selection: """ messages { lastRead: "last_read" … } """
```

**Cause:**
- A property's `items` is expected to be the element itself. Here it is another array, so the tree
  carries an extra level:
  ```
  …>prop:array:#messages>array:messagesUnion>union:type:messagesUnion>obj:type:[inline:messagesUnion]>…
  ```
- `PropArray.getValue` then reads the inner array's name — inherited from the property, `messages` —
  instead of the element's real name two levels down.
- `PropArray.select`'s brace test asks `T.isContainer`, which is true for objects, unions and maps
  but never for an array id, so no `{`/`}` is written.
- This is #46's defect exactly. #46 fixed it only where the wrapper arrives through a `$ref` to a
  component that is itself a list; written inline, nothing handled it.

**Fix:** the same helper, `Factory.unwrapRedundantArrayItems`, gained a branch for the inline form:
when `items` has `items` of its own, no `type`, and no `properties`, take the inner one.

**The inline test is stricter than the `$ref` one, on purpose.** An explicit `type: array` there is
a real list of lists and must stay nested — docker's `top` (one array of column values per process),
digitalocean's monitoring `[timestamp, value]` pairs, box's `name_conflicts`. A scan of the corpus
splits cleanly: 5 wrapper sites, all `type`-less, all slack; 11 genuine sites across 6 specs, all
with an explicit `type: array`. Accepting both would have corrupted the 11 to fix the 5. Note this
is deliberately narrower than the implied-array rule in `fromSchema` (#4), which treats a missing
`type` and `type: array` alike.

**Tests:** `tests/resources/oas/nested-array-items.yaml` carries both halves — `/wrapper-array`
(the artifact, mirroring slack) and `/matrix` (a genuine list of lists, mirroring docker `top`).
`test_inline_array_wrapping_another_array_unwraps_to_the_real_element` asserts the field names the
type that is defined and that the element nests inside braces;
`test_genuine_array_of_arrays_stays_nested` asserts the matrix is never flattened to a single list.
Both in `tests/all/oas-core.test.ts`, composing via rover. Dropping the branch fails the first;
relaxing the test to accept `type: array` fails the second, so the restriction is load-bearing.

**AST:** a shape change — the intermediate `Arr` is gone, so `PropArray.items` is again always the
real element, the invariant every call site already assumed. Same as #46.
**Refs:** `src/oas/nodes/factory.ts` (`Factory.unwrapRedundantArrayItems`),
`src/oas/nodes/propArray.ts` (`getValue`, `select`/`needsBrackets` — unchanged, they work once the
invariant holds). Related: #46 (the `$ref` form of the same defect), #50 (which made slack's union
non-empty and so exposed this), #4 (the implied-array rule this deliberately does not mirror).

## 53 · A bundled build asks "where am I?" by class name, so every context check answers no — ✅ Fixed

**Symptom:** an enum-typed query parameter is written as a whole enum *definition* inside the
argument list — invalid GraphQL. Reported from the web tool on petstore `get:/pet/findByStatus`.
The same spec run from Node is correct, which is why the whole suite stayed green.

**OAS** — an ordinary enum query param:
```yaml
parameters:
  - name: status
    in: query
    schema:
      type: string
      enum: [available, pending, sold]
      default: available
```

**Example**:
```graphql
# before, in any bundled build
petFindByStatus(status: enum Enum { available, pending, sold} = "available"): [Pet]   # ✗

# after (and in an unbundled build all along)
petFindByStatus(status: String = "available"): [Pet]
```

**Cause:**
- A node asks whether it is being visited from inside another with
  `context.inContextOf('Param', this)`.
- That compared **the class's runtime name**: `this.stack[i].constructor.name === 'Param'`.
- Bundlers rename classes. `Param` becomes `t`, so the comparison is false and the check answers
  "no" — silently, with no error anywhere.
- `En.generate` then takes its non-param branch and writes the enum definition instead of the
  scalar an argument needs. The name `Enum` is the giveaway: a param's enum node is built as
  `new En(parent, 'enum', …)`, and `genTypeName('enum')` is `Enum`.
- **All 14 call sites were affected**, not just this one — `union.ts` (4), `comp.ts` (3), `en.ts`
  (3), `obj.ts` (2), `map.ts`, `ref.ts`. The inline enum was simply the most visible of them.
  Anything that bundles the package — the web app's production build, the desktop build, any
  consuming app — got quietly wrong SDL.

Proven by mangling the real sources with esbuild and running the real fixture:
```
unbundled:            petFindByStatus(status: String = "available"): [Pet]
minified identifiers: petFindByStatus(status: enum Enum {
```

**Fix:** pass the class instead of its name and test with `instanceof`, which survives renaming:
```ts
public inContextOf<T extends IType>(type: new (...args: never[]) => T, node: IType): boolean
```
`instanceof` is already how the rest of the code identifies nodes (`T.isLeaf`,
`Union.isTopLevelResponse`, `allOfBase.ts`), so the call sites read `inContextOf(Param, this)`. A
mistyped class is now a compile error rather than a silent `false`. Only four classes are ever
asked for (`Param`, `Res`, `Composed`, `Union`); each of the six files already value-imports the
node barrel, so no new module edges and no cycle. `instanceof` also matches subclasses where the
name check was exact — none of the four is extended, so behaviour is unchanged (the corpus sweep
confirms it).

**Also removed:** `oasGen.ts`'s `constructor.name === 'Webhook'` guard. It had the same defect but
was dead: `visit()` only reads `getPaths()`, which yields operations only — webhooks come from
`getWebhooks()`, never called here. It was pretending to reject webhooks when they are ignored.

**Tests:** `tests/all/bundled.test.ts` — builds its own esbuild bundle from `src/` with
`minifyIdentifiers` (`packages: 'external'`, so only our code is renamed and `oas-normalize`'s
dynamic requires stay out of it), imports it, and asserts the argument is `String`. It builds its
own artifact so it works on a bare checkout and can never silently skip. Restoring the name
comparison fails it while every unbundled test stays green — no other test can see this class of
bug. Plus, unbundled: `test_enum_query_param_is_a_scalar_argument` pins the intended output, and
`test_webhooks_are_ignored_not_generated` (`tests/resources/oas/webhooks.yaml`) asserts the parser
really does carry a webhook *and* that only `get:/ping` is collected.

**AST:** none — no node shape or id changes; only how the context stack is interrogated.
**Refs:** `src/oas/oasContext.ts` (`inContextOf`), `src/oas/nodes/en.ts` (`En.generate`, the visible
symptom), plus the call sites in `union.ts`, `comp.ts`, `obj.ts`, `map.ts`, `ref.ts`, and
`src/oas/oasGen.ts` (`visitPath`, dead guard removed).

## 55 · A field that is both `required` and `nullable: true` is emitted non-null — ✅ Fixed

**Symptom:** the router errors on a legitimately-null value. In OpenAPI `required` and `nullable` are
orthogonal — `required` says the key is present, `nullable: true` says the value may be null — so a
field that is both must be **nullable** in GraphQL. `required` currently wins and `nullable` is ignored.

**OAS:**
```yaml
Thing:
  type: object
  required: [reqPlain, reqNullable]
  properties:
    reqPlain:    { type: string }
    reqNullable: { type: string, nullable: true }   # key always present, value may be null
```

**Example:**
```graphql
# now
reqNullable: String!      # ✗ router errors when the API returns null
# wanted
reqNullable: String
```

**Cause:** the `!` decision read only the parent's `required` list — nothing anywhere read
`nullable`. For the 3.1 spelling it was worse: `normalizeTypeArray` (#23) took the `'null'` out of
`type: [string, "null"]` and threw that fact away, so by the time `required` was applied the schema
looked plainly non-null.

**Fix:** three lines, no new state.
- `normalizeTypeArray` (`factory.ts`) marks the schema `nullable: true` when it strips a `'null'` —
  the 3.1 spelling becomes the 3.0 keyword, on the shared schema instance, so every later reader
  and every later visit sees it.
- The one place `Prop.required` is set (`obj.ts`) skips a property whose schema says
  `nullable: true`. The schema on the prop is the resolved one, so a `$ref` to a nullable
  component works the same way.
- The parameter `!` (`param.ts`) takes the same guard. This one is a deliberate tradeoff: GraphQL
  cannot say "must be sent, may be null" — an argument either has `!` (must be sent, never null) or
  neither guarantee. Keeping `!` rejects null, which the API explicitly allows; dropping it means a
  *missing* parameter is no longer caught by GraphQL and instead comes back as the API's own
  missing-parameter error. Null wins because rejecting allowed usage is the reported defect.

`?` in selections is a different tool for a different job (it silences a missing-or-null step in a
path, per the router's mapping README) and is not part of this fix; emitting it is #16, still parked
until composition 2.15 ships. `Prop.required` now means "key present and value never null" — which
is also the right trigger for `?` when #16 lands.

**Not fixed here:** `oneOf: [{type: string}, {type: 'null'}]`, the third spelling. That field is
dropped from the type entirely today — a different defect in different code, filed as #60.

**Tests:** `test_required_and_nullable_emits_a_nullable_field` (todo dropped; the two `\b`
assertions tightened to `String\n` so they can actually fail; new assertions for the `$ref` and
parameter cases) and `test_required_and_nullable_31_type_array` (new fixture
`required-nullable-31.yaml`, whose `refA`/`refB` share one component so the second visit proves the
in-place rewrite is order-independent). Every touch point revert-checked one at a time — each
reverts to exactly its own test failing.

**AST:** no change — a field-level `!` decision, not a node-shape change.
**Refs:** #23, #33 (3.1 nullability forms), #16 (parked `?` emission), #60 (the oneOf spelling).

## 56 · `items: { type: object }` drops the field instead of degrading to `[JSON]` — ✅ Fixed

**Symptom:** the field is absent from the emitted type. Valid OpenAPI, no warning, missing field. Its
two neighbours in the same family both degrade honestly: `items: {}` and
`items: { additionalProperties: false }` each give `[JSON]` (#19). Only `type: object` with no
properties is dropped.

**OAS:**
```yaml
typedObjs:  { type: array, items: { $ref: '#/components/schemas/Small' } }   # -> [Small]
emptyObjs:  { type: array, items: {} }                                      # -> [JSON]
bareObjs:   { type: array, items: { type: object } }                        # -> field vanishes
```

**Example:**
```graphql
# now
type Thing { emptyObjs: [JSON]  id: String!  typedObjs: [Small] }   # bareObjs gone
# wanted
type Thing { bareObjs: [JSON]  emptyObjs: [JSON]  id: String!  typedObjs: [Small] }
```

**Cause:** the order of the checks in `Factory.fromSchema`. The `type === 'object'` check runs before
the shapeless-object one, so the schema goes to `createContainerType` and becomes an `Obj` with no
fields — which is skipped when the schema is written, and never put in the selection either. The
other two spellings have no `type` at all, fall past that check, and reach the JSON fallback; that
is why only this one broke. Exactly what #19's **Care** note warned about.

**Fix:** `Factory.fromArrayItems` — what a list holds, sending an object with no fields to the JSON
scalar and everything else to `fromSchema`. Called from the only two places array items are built
(`createArrayType`, and `fromProp`'s array branch).

Deliberately narrow. Moving the shapeless check up inside `fromSchema` would look tidier, but that
function is called from 13 places, and the same empty object is harmless in most of them — inside
an `allOf`/`oneOf` list it would become a scalar where a container is expected. Only in array items
does it cost the whole field.

**Tests:** `test_typeless_object_items_degrade_to_json` in `tests/all/oas-core.test.ts`, fixture
`tests/resources/oas/shapeless-object.yaml` (property `archivedChannels`, alongside the existing
`privateChannels` / `publicChannels` cases). The `todo` marker is dropped.

**AST:** the same shape as #19 — a `Scalar` (JSON) in place of an empty `Obj`.
**Refs:** #19 (the shapeless-object family this belongs to). Found the same way as #55: a nested object
emitted as bare `type: object` loses its field with no signal.

## 57 · An inline (non-`$ref`) enum degrades to `String` — ✅ Fixed

**Symptom:** the same value set keeps its enum type when declared as a named component and degrades to
`String` when declared inline on the property. Silent either way.

**OAS:**
```yaml
state:       { $ref: '#/components/schemas/State' }         # -> state: State  + enum State { … }
inlineState: { type: string, enum: [active, terminated] }    # -> inlineState: String
```

**Cause:** the enum branch of `fromProp` (`factory.ts`) required a `$ref`, so an inline enum fell
through to `PropScalar`. The missing piece was only a name.

**Fix:** the branch takes any enum that passes `isGqlEnum` (#24's degradations untouched). The `En`
starts under its field's own name; on first visit it renames itself through the existing
`resolveNameConflict` — owning type's name in front, `2`, `3`… when taken — before the one
`context.store` call, so no lookup ever holds an old name. e.g. (petstore.yaml) `Order.status` ->
`enum OrderStatus`. Decisions worth knowing:
- **Component names are reserved even when never visited** — the bump candidates are checked
  against every `components/schemas` name (via `resolvePointer`), because a component cannot rename
  itself. `User.role` next to a `UserRole` component becomes `UserRole2` in every selection.
- **The rename runs exactly once**, guarded by `En.visited` — running it twice would put the
  parent's name in front again. `PropEn.visit` reaches the enum for explicit selection paths
  (mirroring `PropObj.visit`), so both selection styles produce the same name.
- **Parameters unchanged** — a `status` query argument stays `String`, pinned by existing tests.
- Works with #55/#60: `oneOf: [{type: string, enum: […]}, {type: 'null'}]` becomes a promoted,
  nullable enum.
- **Merged unions fold before they answer the reachability walk.** The first corpus run regressed 8
  box ops (`INVALID_GRAPHQL: Unknown type FileBaseType`): a discriminator-less `oneOf` is merged into
  one object, and it folded its members' `allOf` parts only at write time — after the walk (#26) had
  already decided which types to keep. Folding changes which member's copy of a shared field wins the
  merge, so the walk collected the `web_link` member's `type` enum while the writer emitted the
  `file` member's. Fix: the flat branch of `Union.dependencies` now consolidates first, exactly as
  `generateMergedObject` does, so both read the same folded view. Only enums surfaced this — before
  the promotion those fields were `String` and needed no definition.

**Tests:** `test_enum_fields_selected_and_degraded` (promoted `StatusResponseInlineState`, `reaction`
still degrades), seven `test_57_*` cases in `tests/all/oas-core.test.ts` over
`enum-collisions.yaml` / `enum-collisions-deep.yaml` (split collisions both visit orders,
reserved-component bumps, `UserUserRole` qualification, cross-selection-style name stability),
`test_57_merged_union_defines_the_enum_it_references` (box `get:/collaborations>**`, the corpus
regression isolated — composes without re-running the corpus), and the enum-or-null case in
`test_required_oneof_null_field_is_kept`.

**AST:** an `En` (plus `PropEn`) where a `PropScalar` was.
**Refs:** #24 (degradations, unchanged), #9/#12 (the name collision machinery this reuses), #55/#60
(nullability interplay).

## 58 · A discriminated `oneOf` whose members share an `allOf` base emits an orphan base type — ✅ Fixed

**Symptom:** composition fails with one `CONNECTORS_UNRESOLVED_FIELD` per base field. The base is
emitted as a concrete `type` that no field or union member references, so nothing resolves it.
Interface promotion — which exists for exactly this shape — silently did not fire.

**OAS:**
```yaml
PageBase:     { type: object, required: [_id], properties: { _id: …, _type: …, title: … } }
ResourcePage: { allOf: [ { $ref: '…/PageBase' }, { properties: { discipline: … } } ] }
OwnerPage:    { allOf: [ { $ref: '…/PageBase' }, { properties: { templateVariant: … } } ] }
AnyPage:
  oneOf: [ { $ref: '…/ResourcePage' }, { $ref: '…/OwnerPage' } ]
  discriminator: { propertyName: _type, mapping: { resourcePage: …, ownerPage: … } }
```
Response is `[AnyPage]` — top level, so the union is *not* flattened by #38.

**Example:**
```graphql
# now
union AnyPage = ResourcePage | OwnerPage
type PageBase { id: String!  type: String  title: String }   # ✗ orphan, nothing selects it
# -> CONNECTORS_UNRESOLVED_FIELD: PageBase.id / .type / .title

# wanted (either)
interface PageBase { … }                       # promotion fires
type ResourcePage implements PageBase { … }
# or: no PageBase type at all, base flattened into each member as it is without the oneOf
```

**Cause:** the response is a **list** of the union, and promotion only ever looked at the whole
answer. `candidateUnions` (`src/oas/nodes/allOfBase.ts`) read the response node and asked
`node instanceof Union`; for `[AnyPage]` that node is the array, so the union one level below was
never a candidate. None of the three rules ran — which is why nothing was logged, rule 3 being the
only one that warns. (The earlier guess here, "rules 1 or 2 rejected silently", was wrong.)

The generator already disagreed with itself about this: `Union.isTopLevelResponse`
(`src/oas/nodes/union.ts`) walks *through* an array on purpose — "the op's response (optionally
under a bare array)" — and `r2-union-nested-in-list.yaml` marks its array-of-union responses "this
must stay a real union". Only `candidateUnions` treated `[Union]` as not-a-union.

The same blind spot sat in rule 3 itself, with the opposite effect. `baseUsedExternally` part (a)
says "any op whose result type unwraps directly to the base" but did no unwrapping, so an op
answering `[PageBase]` did not count as concrete use. Fixing the first half alone would have made
that reachable: the base gets promoted anyway and that op returns a list of an interface with no
`__typename` to match on. Both halves had to move together.

**Fix:** added `T.responseItemType` (`src/oas/nodes/typeUtils.ts`) — the response with any list
wrappers taken off, as a node — and used it at both sites. The walk already existed inside
`responseItemSchema`; it now lives in one place and `responseItemSchema` delegates to it (#54).
Rules 1 and 2 also got a `trace` line on rejection, since their silence is what made the original
diagnosis point at the wrong rule.

Note plain `allOf` inheritance **without** a `oneOf` is correct: the base is flattened into each
member, no orphan is emitted, and it composes.

**Tests:** `test_R2_interface_promotes_when_the_union_is_returned_in_a_list` (fixture
`tests/resources/oas/r2-interface-oneof-list.yaml`) and
`test_R2_interface_skips_when_the_base_is_returned_in_a_list` (fixture
`r2-interface-base-in-list.yaml`), both in `tests/all/r2-abstract.test.ts`. Revert-checked one half
at a time: reverting `candidateUnions` fails both, reverting only `baseUsedExternally` fails the
second. The second asserts the rule-3 warning, so it pins that rule 3 *ran and rejected* rather than
just that no interface appeared.

**AST:** no change. Promotion is id-neutral by design (`emitAsInterface` on `Obj`, not a `kind`
change), and this only alters which unions reach it.
**Refs:** #38 (nested unions flatten; this one is top-level so it does not), and
`test_R2_interface_oneof_promotes_and_composes` / `test_R2_interface_skips_when_base_used_concretely`
in `tests/all/r2-abstract.test.ts` (the promotion path that should have applied).

## 59 · A list of lists writes a name nothing defines, no block, and its `!` on the next line — ✅ Fixed

**Symptom:** three things, all on a field that is a list of lists. The first two only show when the
items are objects, which is why this sat as a cosmetic issue until box reached it:
- the field names the inner list (`nameConflicts: [name_conflicts]`) and composition stops with
  `cannot find type 'name_conflicts' in this document`;
- the selection opens no block, so the item's fields are written as the parent's own — the linter
  says `PATH_NOT_IN_RESPONSE: download_name is not one of the properties post:/zip_downloads
  documents`, and it is right;
- a required list of lists of plain values puts its `!` alone on the next line.

**OAS** (box `post:/zip_downloads` — `name_conflicts` is a list of lists of objects):
```yaml
ZipDownload:
  properties:
    name_conflicts:
      type: array
      items:
        type: array
        items:
          type: object
          properties:
            download_name: { type: string }
            id: { type: string }
            original_name: { type: string }
            type: { type: string }
```

**Example** — before, and after:
```graphql
# before
nameConflicts: [name_conflicts]        # nothing defines this
selection: """
nameConflicts: name_conflicts?      downloadName: download_name?
id?
"""

# after
nameConflicts: [[NameConflictsItem]]
selection: """
nameConflicts: name_conflicts? {
 downloadName: download_name?
 id?
}
"""
```
```graphql
# and for plain values
processes: [[String]]!                 # was `[[String]]` then `!` on its own line
```

**Cause:** three places in `propArray.ts` looked at `items` without peeling the list wrappers.
`items` is the inner `Arr`, not what the list finally holds:
- `getValue` — `T.isContainer(Arr)` is false, so it wrote the inner list's raw name;
- `needsBrackets` — same test, so no `{ }` was opened and `Arr.select` wrote the object's fields
  straight into the parent;
- `generateValue` — the `T.isScalarArray` branch ended the line itself (`']\n'`), while
  `Prop.generate` writes `!` after the value and then the newline.

**Fix:** all three peel first, through one helper — `T.findLastArrayItemIn`, which is now also what
`T.responseItemType` uses instead of its own copy of the same walk — and
`generateValue` writes `']'` with no newline, so the one contract in `Prop.generate` holds: the
value, then `!`, then the line ending. One block is right for any depth: the router keeps the
nesting, measured with `rover connector run` on the generated box connector against an echo server:
```
{"name_conflicts": [[{download_name…}, {…}]]}  ->  nameConflicts: [[{downloadName…}, {…}]], no problems
```

**Why it surfaced now:** #85. Box's op documents `202` plus a `default`, so we used to answer the
error shape and never built `ZipDownload`. It was the one op in the corpus reaching this shape —
`lint-corpus --verbs mutations` went from 0 diagnostics to 4, and box's mutations pass-rate showed
one `composeFail`.

**Still open:** a list of lists of *plain values* has no leaf, so `>**` still drops the field and
only a named path reaches it. Same family as #70 and #86; not fixed here.

**AST:** no node change — the same tree, written differently.

**Refs:** `src/oas/nodes/propArray.ts` (`getValue`, `needsBrackets`, `generateValue`),
`src/oas/nodes/typeUtils.ts` (`T.findLastArrayItemIn`). Fixture
`required-nested-array.yaml` (the plain-value case, plus `rows` for the object case), tests
`test_59_required_nested_array_bang_stays_on_the_line`,
`test_59_nested_list_of_objects_names_and_selects_its_item`, and
`test_corpus_mut_box_nested_list`, which composes the real box operation. Related: #52 (a real list
of lists must stay nested), #55, #85 (which reached it).

## 60 · A required `oneOf [string, null]` property loses its field entirely — ✅ Fixed

**Symptom:** the field is missing from the emitted type. The other two ways a spec says "may be
null" now come out as a nullable field (#55); this third spelling silently loses the field — worse,
and easy to mistake for #55 until the type is read closely.

**OAS:**
```yaml
required: [reqOneOf]
reqOneOf:
  oneOf:
    - type: string
    - type: "null"
```

**Example:**
```graphql
# now
type ThingOneOf { plain: String }          # reqOneOf gone
# wanted
type ThingOneOf { plain: String  reqOneOf: String }
```

**Cause:** the union builder skips a `{ type: "null" }` member (`union.ts`, the #33 skip), leaving
a one-member union with nothing to pick a branch by, so #25 merges member fields — and a plain
string has none, so the merged type is empty and dropped, the same way #56's empty object was.

**Fix:** `Nullability.normalize` (`src/oas/utils/nullability.ts`, grown out of the #23/#55
rewrite; `Factory` calls it once per schema) takes the null choice out of a `oneOf`/`anyOf` and
marks the schema `nullable: true` — the 3.0 keyword the `!` guards already read. Runs before any
node is built, in place on the shared schema, safe to run twice. What is left decides the shape:
two or more choices stay a choice (now without the `!`); one plain value
(string/number/boolean/list) becomes the value itself; nothing left degrades to JSON.

Decisions taken, in order of importance:
- **Two guards protect everything pre-existing.** A schema with a shape of its own beside the
  choice list (`type: string` next to the `oneOf`) is left byte-identical — both apply at once, so
  null is not actually allowed there. And only a list with **exactly one** null choice is touched:
  two cancel out under `oneOf` (null would match both), and zero means there is nothing to do. The
  first fix attempt broke `test_024` (TMF637's `PartyOrPartyRole: oneOf [$ref]`, one member, no
  null) precisely because it had no such guard — the missing piece was the guard, not a different
  layer.
- **`oneOf [X, null]` is read as the author's "X or null"**, even though a remaining choice might
  itself allow null (a strict reading then says the null choice can never match). `$ref`s are not
  resolved at this layer so the strict reading cannot be checked, and for output types the nullable
  direction is the safe error: a dropped `!` never fails at runtime, a kept one does.
- **Only plain values collapse.** A single `$ref` or inline object keeps its choice list — that
  list is byte-identical to what the #33 skip already produced, so nothing about unions, names or
  selection paths moves. A one-choice list whose choice turns out to have no fields (a `$ref` to a
  scalar, `properties: {}`) still drops today, as it did before — out of scope, none in the corpus.
- **`oneOf: [{type: 'null'}]` degrades to a nullable `JSON`** rather than disappearing — lossy on
  purpose (GraphQL has no only-null type), pinned by its own test case.

**Tests:** `test_required_oneof_null_field_is_kept` (todo dropped) now covers eight shapes in
`required-nullable-oneof.yaml`: both spellings, the kept two-arm choice, the kept object arm, the
collapsed list arm, the only-null degrade, and one pin per guard (`doubleNull`, `constrained` —
both asserted absent, exactly as today). `test_024` pins the protected TMF637 shape.

**Tests:** `test_required_oneof_null_field_is_kept` in `tests/all/oas-core.test.ts`, fixture
`tests/resources/oas/required-nullable-oneof.yaml`. Marked `todo` — asserts the wanted output,
fails today.

**AST:** to be decided by the diagnosis — likely the single member's node in place of the union.
**Refs:** #55 (the other two spellings, fixed), #33 (the null-member skip this builds on), #25
(discriminator-less unions degrade — the machinery a one-member collapse has to respect).

## 62 · Every aliased response key is a string literal under connect/v0.4 — ✅ Fixed

**Symptom:** a field whose JSON key needed an alias resolves to **the name of the key** instead of its
value. Composition is clean, the request is correct, the response is correct — the value is then thrown
away. Found by running a generated connector through a router: `id` came back as the string `"_id"`.

- **Affects the default output.** `connect/v0.4` is what gen emits with no `--spec`; the router parses
  v0.4 and v0.5 with the same function, so both are affected and only v0.3 is not.
- **This is #1's mechanism.** #1 introduced `alias: "original"` to map a safe GraphQL field back to a
  non-identifier JSON key — and its own example, `_2faEnabled: "2fa_enabled"`, is now a literal.
- Invisible to every check gen has: composition sees a `String` selected by something of type `String`.

**OAS:** any key gen aliases — whether it *repairs* an invalid identifier or merely *renames* a valid one:
```yaml
properties:
  _id:         { type: string }    # already a valid identifier — should never have been quoted
  full name:   { type: string }    # genuinely needs quoting
  2fa_enabled: { type: boolean }
```

**Example:**
```graphql
# now
selection: """ id: "_id"   fullName: "full name" """
# -> { "id": "_id", "fullName": "full name" }                  ✗ key names, returned as data

# wanted
selection: """ id: _id   fullName: $."full name" """
# -> { "id": "seed-contact-alex", "fullName": "Alex Rivera" }
```

**Cause:** one half in gen, one half in the spec.

- `Naming.sanitiseFieldForSelect` (`src/oas/utils/naming.ts`) quotes the key **unconditionally** in the
  response direction. Its comment claims "the key is not a bare identifier", which is false whenever the
  converter renames rather than repairs: `_id` sanitises to `id`, so `sanitised !== name` and it falls
  into the quoted branch even though `_id` is a valid identifier. The request direction, four lines
  above, already tests `/^[_A-Za-z][_0-9A-Za-z]*$/` before quoting.
- The selection grammar changed meaning at v0.4:
  ```ebnf
  NamedSelection ::= "..." LitExpr | Alias LitExpr | PathSelection
  Key            ::= Identifier | LitString
  ```
  Alternatives are tried left to right, so after an alias a quoted string matches `LitExpr` → `LitString`
  — a literal. That arm was added in v0.4 on purpose, to make `__typename: "Book"` expressible. Under
  v0.3 the only post-alias arm was `Alias PathSelection`, where a `LitString` **is** a `Key`, so the same
  text was a key reference. In the router: `parse_v0_3` calls `PathSelection::parse` after the alias,
  `parse_v0_4` calls `LitExpr::parse`.

**Measured**, on two builds of one connector differing **only** in the `@link` URL:

| `@link` | `id: "_id"` returns |
|---|---|
| `connect/v0.3` | `"seed-contact-alex"` — the value |
| `connect/v0.4` | `"_id"` — the key's name |

Both compose on stock rover 0.40 at fed 2.14.1, with no warning either way.

**Renaming is still possible under v0.4 — the escape hatch just moved.** `Key ::= Identifier | LitString`
still holds *inside a path step*, so a quoted string is a key there; only in the value position after an
alias is it reinterpreted as a literal. Measured against a live router on v0.4, one payload, every
spelling in one selection:

| Written | Returns | |
|---|---|---|
| `fullName: "full name"` | the literal `"full name"` | ✗ |
| `fullName: $."full name"` | the value | ✓ |
| `fullName: @."full name"` | the value | ✓ |
| `cost: $."cost$"` | the value | ✓ |
| `twofa: $."2fa_enabled"` | the value | ✓ (leading digit) |
| `id: "_id"` | the literal `"_id"` | ✗ |
| `id: _id` | the value | ✓ |
| `id: $."_id"` | the value | ✓ |

**`$` is scope-local, so this nests correctly.** It is bound to "the value received by the closest
enclosing `SubSelection`" (router `json_selection/README.md`), *not* the document root — verified: a
`$."full name"` inside `nest { … }` returns the nested value, not the top-level one. `@` behaves the same
here and differs only inside `->` method arguments. This is the part most likely to be got wrong on a
first reading of the grammar, and it is what makes a blanket rewrite safe.

**Fix:** the response direction gets the guard the request direction already has, and a path step for
the keys that fail it — in BOTH copies of `sanitiseFieldForSelect` (`src/oas/utils/naming.ts` and the
JSON walker's `src/json/walker/naming.ts`, deliberately siloed, so the same few lines twice):
```ts
const key = isBareKey ? original : `$."${escapeSelectionKey(original)}"`;
return `${sanitised}: ${key}`;
```
Bare where the key is already an identifier (the `_id` class, which should never have been quoted), and
`$."…"` for the keys #1 exists to handle (spaces, `$`, leading digits). Details settled while landing:
- **Keys named `true`/`false`/`null` are excluded from the bare form** — in value position they parse
  as literals, the same trap one step further. Unreachable today (such a key sanitises to itself and
  never aliases), kept as a guard on the invariant.
- **Escaping is the router's, not JSON's.** `parse_string_literal` maps `\n` to newline and every
  other escaped char to itself — so `JSON.stringify` would corrupt keys (`\t` becomes a bare `t`).
  `escapeSelectionKey` emits only the safe escapes: `\\`, `\"`, `\n`. Control characters other than
  newline have no escaped spelling in the grammar — a key carrying one is unrepresentable; it was
  already broken under the quoted form. A grammar ceiling, not ours.
- **The container spelling composes.** `pageInfo: $."page info" { count }` and the array form pass
  rover; the entry's runtime table did not cover it, so the live-router spot-check on the Sanity
  connector is the remaining confirmation.

**Care:** this rewrites every response selection gen emits, so it wants a corpus sweep rather than unit
tests alone — the blast radius is #1's, which is most specs. Unmeasured here; the one datapoint is 992
affected entries in a single Sanity connector.

**Not the request direction (#28).** Bodies map `json key <- input field` and quote the key on the
**left**, where a `LitString` key is still a key. Only the response direction is wrong.

**Tests:** `r3-edge-cases.yaml` gained `_id`, an object and an array under non-identifier keys, and the
two escaping keys (`say "hi"`, `back\slash`). `test_R3_oas_sanitiseFieldForSelect_aliases` and
`test_R3_json_walker_naming_edge_cases` pin both copies at the unit level;
`test_R3_oas_edge_fixture_composes_with_safe_names` and
`test_R3_aliased_container_and_escaped_keys_compose` assert the emitted text and rover-compose it.
Churn: the #42 map alias (`currencyOptions: currency_options->entries`) and the #24 signed enum
aliases (`plus1: $."+1"`) flipped to the new forms. Asserting on the emitted text is the only option:
composition cannot distinguish a literal from a key reference, which is the whole point — the runtime
half is pinned by the table above.

**AST:** none expected — emission-only, like #28/#29.
**Refs:** #1 (introduced the quoted alias; its example is now wrong for v0.4), #42 (alias machinery),
#28 (the request direction, unaffected), `src/oas/utils/naming.ts` (`sanitiseFieldForSelect`). Router
side: `apollo-federation/src/connectors/json_selection/README.md` (grammar) and `parser.rs`
(`parse_v0_3` / `parse_v0_4`). Found while building the Sanity connector, whose
`sanity/issues.md #10` carries a post-process that un-quotes as a workaround.

## 63 · An inline wrapper's minted name steals a component's name, writing `type X` twice — ✅ Fixed

**Symptom:** the schema defines `type ContentBody` twice — once for the real component, once for an
inline object that was *renamed into* the same name. Rover rejects the op:
`CIRCULAR_REFERENCE: type ContentBody appears more than once in …body.anonymousExportView` — the
selection path crosses the shared name twice. The v0.5 lint sees the same op as
`ARROW_TYPE_MISMATCH` (the twin `@mapping`s disagree with the field types).

**OAS** (confluence, `post:/wiki/rest/api/content/{id}/copy`) — `Content.body` is inline and its
props point at the component of the same natural name:

```yaml
Content:
  properties:
    body:                       # inline, no $ref — needs a made-up name
      type: object
      properties:
        view:                  { $ref: '#/components/schemas/ContentBody' }
        anonymous_export_view: { $ref: '#/components/schemas/ContentBody' }
        # …9 more siblings, all ContentBody
ContentBody:                    # the real component
  properties:
    value: { type: string }
```

**Cause:**
- the request body (walked first) has its own inline `body` prop, occupying the name `body`
- the response-side inline `Content.body` collides with it and gets a made-up name:
  container + prop = `ContentBody`
- at that moment the real `ContentBody` component has not been visited — it is only reached
  *through this wrapper's own props*, and the rename runs before they are walked
- so the wrapper takes the component's name; both survive to the writer (different node ids)
  and both are written
- the #37 guard compares the wrapper's *pre-rename* name against contained refs, so it never sees
  the minted candidate; the writer's emit-once name key only covers `$ref`-named types

**Fix:** made-up names now stay off *all* component names, exactly as #57 already did for enums —
`resolveNameConflict` reserves every `#/components/schemas` name for every rename, not just enum
renames. The wrapper bumps to `ContentBody2`, the component keeps `ContentBody`, and the two
`_expandable` children stop deriving the same base (`ContentBody2Expandable` /
`ContentBodyExpandable` — no more `2`-suffix drift on the children).

Churn: a renamed wrapper changes its node id (`obj:type:ContentBody` → `obj:type:ContentBody2`),
so selection paths through affected ops change — same consumer impact class as #37. No test in the
suite churned; the corpus sweep quantifies the rest.

**Test:** `test_63_inline_wrapper_must_not_steal_component_name` in `tests/all/oas-core.test.ts`,
fixture `tests/resources/oas/inline-wrapper-steals-component-name.yaml` — asserts `ParentBody2`
(wrapper) + `ParentBody` (component), no duplicated type definitions, and composes.

**AST:** rename-only — affected wrappers change name and id; no shape change.
**Refs:** #9/#12 (the renamer), #37 (the contained-component guard this slips past), #57 (the enum
form of the same fix), #18 (same-schema convergence, untouched), `src/oas/nodes/typeUtils.ts`
(`resolveNameConflict`). Found by the R11 mutations lint (`ARROW_TYPE_MISMATCH` on the copy op) —
its only corpus finding.

## 64 · The lint reader compares a quoted key with its escapes still on — ✅ Fixed

**Symptom:** the first `make coverage-all` on main stopped at the GET lint gate with two
`PATH_NOT_IN_RESPONSE` warnings on `r3-edge-cases.yaml` — both false: the selection reads real,
documented keys.

**Example:** the #62 emitter writes `backSlash: $."back\\slash"` for the JSON key `back\slash`.
The lint's reader returned the quoted name with its escapes still on (`back\\slash`), so the
lookup against the spec's properties missed.

**Fix:** `readQuotedName` (`src/oas/lint/selectionReader.ts`) now unescapes the way the router
reads the escapes — `\n` is a newline, any other `\x` is `x`. Applied to the gen.rm working copy
of the reader too, so the next merge does not resurrect the warning.

**Test:** `test_R11_escaped_quoted_keys_resolve_to_their_json_key` in `tests/all/r11-lint.test.ts`
— lints the generated `r3-edge-cases` op with the spec loaded, expects no findings.

**AST:** none — lint-only.
**Refs:** #62 (the escaping this reads back), `escapeSelectionKey` in `src/oas/utils/naming.ts`
(the writer side of the same rules). Found by running the R11 lint over the corpus on main.

## 66 · An array request body names an input type that is never defined — ✅ Fixed

**Symptom:** `INVALID_BODY: unknown type InputInput.*.isDeleted` — gong
`post:/v2/crm/object/schema` and `post:/v2/crm/stages` (2 mutation ops, only corpus hits).

**OAS** (gong, Swagger 2.0 — a body param whose schema is an **array**; the loader converts it
to an OAS 3 request body before we see it):
```yaml
parameters:
  - in: body
    name: fields
    required: true
    schema:
      type: array
      items: { $ref: '#/definitions/GenericSchemaFieldRequest' }
```

**Example:**
```graphql
# now — the arg names InputInput, which no SDL line defines; the real input type is the item's
createV2CrmObjectSchema(..., input: InputInput!): SchemaUpdateResponse
input GenericSchemaFieldRequestInput { ... }
# wanted — a list of the item input type that is actually emitted
createV2CrmObjectSchema(..., input: [GenericSchemaFieldRequestInput!]!): SchemaUpdateResponse
```

**Cause:** an inline body schema gets the placeholder name `Input` (`body.ts` `visitBody`), and
`bodyArg()` (`post.ts`) builds the arg as `genTypeName(payload.name) + nameSuffix()` → `InputInput`.
- `bodyArg()` has no array branch: it never unwraps an `Arr` payload to its item type, and never
  writes the `[...]` list wrapper.
- The item type itself generates fine — only the argument reference is wrong.
- The body selection (`$args.input { … }`) also assumes an object payload; check what the list
  form should emit before fixing the arg alone.

**AST:** none expected — `Body` already holds the `Arr` payload; this is an emission fix in
`bodyArg()` plus whatever the body selection needs.

**Fix:** `bodyArg()` gets an `Arr` branch — it unwraps the payload to its item type and writes the
list form, `input: [GenericSchemaFieldRequestInput!]!`, using the same genTypeName + suffix
convention `PropArray.getValue` already uses for item references (#30 agreement kept). The body
selection needed nothing: `$args.input { … }` applies element-wise over a list, and the fixture
composes as-is.

**Refs:** `src/oas/nodes/body.ts` (`visitBody`, `select`), `src/oas/nodes/post.ts` (`bodyArg`),
#30 (the genTypeName agreement discipline the fix must keep). Fixture
`tests/resources/oas/array-body.yaml`, test `test_66_array_body_references_item_input_type`.

## 67 · A property whose `allOf` wraps an array loses the field and writes an empty input — ✅ Fixed

**Symptom:** `INVALID_GRAPHQL: expected an Input Value Definition` — the body's input type is
written with no fields, `input InputInput { }`. digitalocean `post:/v2/firewalls/{firewall_id}/tags`
and `del:` on the same path (both reproduced; they are the spec's only 2 failing mutations).

**The whole INVALID_GRAPHQL bucket** (25 mutation ops, attributed 2026-08-11 by generating each op
from the `COV_DUMP` list and validating with graphql-js) splits into three families:
- 14 — a map entry's `value:` misses the `Input` suffix -> **#68**.
- 8 — a body that ends up with no fields is still written and referenced -> **this issue**. Besides
  the digitalocean pair documented below, the same gap covers: github `patch:/gists`, pages x2 and
  `…/requested_reviewers` (a body union whose members all degrade to JSON -> zero-field merge);
  plaid `post:/categories/get` (body object with no properties — nothing emitted, the arg still
  points at it); omni `put:/v1/schedules/{scheduleId}` (arg references `BInputInput`, never emitted).

**Population grew 8 -> 12 (2026-08-12):** #74 made `$ref`'d request bodies visible, and the
fieldless ones land here — sendgrid x4 (confirmed on `del:/contactdb/lists/{list_id}`: the
referenced body is just `schema: { nullable: true }` -> a JSON scalar renamed `Input` -> the arg
says `InputInput`; a `COV_DUMP` run names the other three). TMF717's three new failures are NOT
this issue — they are #61 on the input side (`@type` + `type` colliding inside
`Customer360PromotionVOInput`), noted there.
- 3 — sibling names that collide after sanitising are written twice -> **#69**.

**OAS** (digitalocean — an `allOf` used only to attach a description to a `$ref`; the target is an
**array**, not an object):
```yaml
requestBody:
  content:
    application/json:
      schema:
        properties:
          tags:
            allOf:
              - $ref: '#/paths/…/image/properties/tags'   # type: array, items: {type: string}, nullable
              - description: An array containing the names of the Tags to be assigned…
        required: [tags]
```

**Example:**
```graphql
# now — the field is gone, and the empty block is invalid GraphQL
input InputInput {
}
body: """ $args.input { } """
# wanted — the array the allOf wraps (required + nullable -> no `!`, as #55)
input InputInput { tags: [String] }
body: """ $args.input { tags } """
```

**Cause:**
- Every property carrying `allOf` becomes a merged object (`Factory.fromProp` -> `PropComp` +
  `Composed`, `factory.ts:419`).
- The merge collects fields from the members that are objects (`Composed.consolidate`); an array
  member has no fields to give, so the merge ends up with zero.
- The description-only member is already skipped (#5), so this `allOf` is really just a wrapper
  around one array — but nothing unwraps it to the array.
- The field then drops out of the type and out of the body selection, yet the empty
  `input InputInput { }` block is still written and the argument still points at it.
- The tree shows the array itself is visited fine — the loss happens after, when the merge and the
  emission only look for object fields:
  ```
  body:b>obj:input:Input>prop:comp:tags>comp:input:Tags>array:String>scalar:string
  ```

**AST:** none expected — the `Composed` already holds the array child. The likely fix is an unwrap:
an `allOf` whose only real member is not an object takes that member's shape (`Composed.updateName`
already treats a single-`$ref` `allOf` as a wrapper around its target). The other 6 ops in the
family reach the empty body by different roads (union of JSON members, object with no properties),
so the check belongs where every body passes through (`bodyArg()`): a body that produced no fields
should drop the whole `input:` argument (or degrade to JSON) instead of writing an empty block or
referencing a name that is never defined.

**Fix (two parts, as the AST note called it):**
- an `allOf` that only decorates one non-object schema IS that schema
  (`Factory.allOfDecoratedTarget`) — digitalocean's `tags` comes out `tags: [String]`, still
  nullable per #55, and the body sends it;
- a body with nothing to send drops its argument, its mapping and its emitted type
  (`Body.isEmptyBody`, read by `bodyArg`, `Body.select` and `Body.dependencies`); a body that
  is one value is sent whole — `input: JSON!` / `input: String!` with `body: "$args.input"` — and
  a scalar payload keeps its own name instead of being renamed `Input`.
Verified on all nine reproducible corpus ops (digitalocean x2, github x4, plaid, omni, sendgrid
lists). Expected sweep: INVALID_GRAPHQL 18 -> 6 (3 x #61 TMF717, 3 x #69 remain).
**Refs:** `src/oas/nodes/factory.ts` (`allOfDecoratedTarget`), `src/oas/nodes/body.ts`
(`isEmptyBody`, `select`), `src/oas/nodes/post.ts` (`bodyArg`), #50 (same empty-input
symptom, different cause), #5 (description-only members skipped), #55 (required + nullable stays
nullable). Fixtures `allof-array-body.yaml` + `fieldless-bodies.yaml`, tests
`test_67_allof_decorated_array_body_keeps_the_field`, `test_67_fieldless_bodies_stop_dangling`.

## 68 · A map entry's `value:` names the input type without its `Input` suffix — ✅ Fixed

**Symptom:** `INVALID_GRAPHQL: cannot find type Manifest in this document` — the map entry
references a name only the un-suffixed output side would use. 14 of the mutation sweep's 25
INVALID_GRAPHQL ops: docker `post:/containers/create`; github `post:/gists`,
`post:…/dependency-graph/snapshots`; incidentio catalog_entries x5; omni
`patch:…/dashboards/{dashboardId}/filters`, `put:/v1/documents/{documentId}`; square team-members
x2 and catalog x2. The square catalog pair wears a different error — the bare name also exists as
an output type there, so rover says `must be Input Type` instead — but it is the same line.

**OAS** (github `post:/repos/{owner}/{repo}/dependency-graph/snapshots` — a request-body field
that is a map of components):
```yaml
manifests:
  type: object
  additionalProperties:
    $ref: '#/components/schemas/manifest'
```

**Example:**
```graphql
# now — the entry's own name gets the suffix, its value does not
input ManifestsEntryInput {
  key: String
  value: Manifest          # ✗ never defined — the definition below has the suffix
}
input ManifestInput { … }
# wanted
  value: ManifestInput
```

**Cause:**
- The entry type's header appends the input suffix (`Map.generate`, `map.ts:70`) — `ManifestsEntryInput`.
- Its `value:` line writes only `genTypeName(valueType.name)` (`map.ts:89`) — the value's own
  suffix is never asked for.
- The response side spells both without a suffix, so they agree there — which is why only
  mutations break.
- The array branch beside it (`map.ts:83`) has the same gap: a map of arrays of objects would
  write `value: [Thing]` against a `ThingInput` definition.

**AST:** none expected — definition and reference must agree (the #15/#30 discipline); an emission
fix in `Map.generate`.

**Fix:** both value writes route through one helper (`Map.valueTypeName`): containers take
`genTypeName + nameSuffix()`, scalars and enums stay bare, and the response side is untouched
(the suffix is empty there). Verified on plain, array and nested-map values — nested maps agree
because the reference now derives the same name the nested map's own header writes.

**Superseded on the body side by #84:** a map in a request body is written as one `JSON` field now,
so no map is left under an input and the suffix never applies there. `Map.valueTypeName` stays as
it is — it is still the one place a value is named, and the response side uses it.

**Refs:** `src/oas/nodes/map.ts` (`generate`, the `value:` lines), #15/#30 (the agreement rule),
#66 (the same rule applied to array bodies), #84 (bodies). Fixture
`tests/resources/oas/map-input-suffix.yaml`, test `test_68_map_value_names_the_type_it_points_at`.
Found while testing, filed separately: an input-side map with SCALAR values drops out of the body
entirely (fixture `labels`/`tags`; docker's real `Labels`) — see #70.

## 70 · A map with scalar values disappears from a request body — ✅ Fixed

**Symptom:** a body field that is a map of strings is silently missing from the input type and the
body mapping — the request can never carry it. Found while fixing #68; docker
`post:/containers/create` loses its `Labels` map the same way. No compose error, so no sweep
bucket counts it — the field is just gone.

**OAS** (docker — a map whose values are plain strings):
```yaml
Labels:
  type: object
  additionalProperties:
    type: string
```

**Example** (fixture `map-input-suffix.yaml` — `labels` is in the spec, not in the schema):
```graphql
# now
input InputInput {
  manifests: [ManifestsEntryInput]     # map of objects: kept
}                                      # labels: gone
# wanted
input InputInput {
  manifests: [ManifestsEntryInput]
  labels: [LabelsEntryInput]           # key: String, value: String
}
```

**Cause:**
- The `>**` selection expansion only produces paths that end at a `prop:` leaf.
- A map of objects ends in the object's props, so it gets paths. A map of scalars ends at a bare
  `scalar:` node — no path is produced:
  ```
  prop:map:manifests>map:input:ManifestsEntry>obj:input:#/c/s/Manifest>prop:scalar:name   ✓ selected
  prop:map:labels>map:input:LabelsEntry>scalar:string                                     ✗ no path
  ```
- With no path, `selectedProps` never matches the field, and it drops from the type and the body.
- Same gap #59 records for a list of lists of scalars ("no leaf to select") — this is the map
  spelling of it.

**AST:** no node change expected — the expansion (or the selection match) needs to treat a map
whose value is a scalar as its own leaf.

**Fix (two lines of behaviour, no new machinery):**
- after the `>**` walk expands a map field (its own, existing expansion), a value that is a plain
  value (`T.isLeaf` — a string, an enum, a list of strings, free-form JSON, which is a Scalar
  node) makes the field itself the leaf (`collectExpandedPaths`);
- the written mapping reads such a value whole — `labels->entries { key value }` — instead of
  opening a `value { }` block it cannot fill (`PropMap.needsValueSelection` now checks the value's
  shape with `T.isLeaf`, not its name);
- a map value that is an object with no fields writes `value: JSON` — the empty object is never
  written (#19), so naming it dangled. Caught by the sweep on docker `ExposedPorts` and eleven
  confluence ops (`Map.valueTypeName`).
Works on both sides (body and response). A map with NO declared value shape (mindbody `data`,
empty `additionalProperties`) now comes out as entries of JSON values rather than vanishing —
two corpus fixture counts moved for exactly this (omni `join_via_map`, mindbody `data`).

**Since #84 this holds on the response side only:** a map in a request body is sent as one `JSON`
field, because `->entries` reads an object and the argument was a list of pairs — the field never
reached the API. The test keeps the response assertions.

**Refs:** `src/oas/generator/typesCollector.ts` (`collectExpandedPaths`),
`src/oas/nodes/propMap.ts` (`needsValueSelection`), #59 (the list-of-lists spelling), #68 (where
it surfaced), #84 (bodies). Fixture `tests/resources/oas/map-input-suffix.yaml` (`labels`, `tags`,
GET-side `labels`), test `test_70_scalar_valued_maps_stay`.

## 71 · Generating twice on one `OasGen` changes the output — `reset()` forgets most state — ✅ Fixed

**Symptom:** the same op generates DIFFERENT schemas depending on what was generated before it on
the same instance. Reproduced on digitalocean: generate three `/v2/apps` ops, then
`get:/v2/apps/{app_id}/deployments` — against a fresh instance the fourth op says
`type ActiveDeployment`; on the reused one it says
`type Inlinev2AppsDeploymentsResponseActiveDeployment`, and the whole selection is indented one
space deeper. Flagged by another session as: "`reset()` only clears some fields; the fix is
'always build a fresh instance', but the API does not force this."

**Example** (same op, `get:/v2/apps/{app_id}/deployments>**`, fourth vs first on an instance):
```graphql
# fresh instance
type ActiveDeployment { … }
  deployments: [ActiveDeployment]
# reused instance — earlier ops' names still occupy context.types, so the rename kicks in
type Inlinev2AppsDeploymentsResponseActiveDeployment { … }
  deployments: [Inlinev2AppsDeploymentsResponseActiveDeployment]
```

**Cause:**
- `OasContext.reset()` (`oasContext.ts`) clears `generatedSet` and `sdlPropOverrides` — nothing else.
- `context.types` keeps every name stored by earlier generations, so a name that is free on a
  fresh instance looks taken on a reused one and gets the #12-style qualified rename.
- `context.indent` / `refCount` carry over too — the indent drift is visible in the selection.
- The nodes themselves also remember: `visited`, `Composed.consolidated` + the props it copied in,
  and any renames — none of that is reachable from `reset()` at all.
- The workaround is already institutional: `tools/coverage-spec.mts` builds a fresh `OasGen` per op
  ("the abstract-types path mutates shared nodes"), and every test does the same. Nothing stops
  the web app (the yalc consumer) or any other caller from reusing one instance.

**AST:** no node change — a lifecycle decision. Either `reset()` becomes complete (hard: node
state is out of its reach) or the API enforces one-generation-per-instance (e.g. `generateSchema`
rebuilds from the kept parser+options, or refuses a second call). The second matches what every
caller already does.

**Fix:** `generateSchema`/`getTypes`/`expanded` each run against a fresh context and a fresh op
forest built from the kept parser, then put the browse-time ones back (`isolatedRun` +
`buildForest` in `oasGen.ts`). Every call now equals a fresh instance byte-for-byte; the web's
tree keeps its `paths`/`context` objects untouched. `reset()` is no longer needed by generation.
- Two readers used to get `resultType` filled as a generation side effect — the lint's response
  check (`responseShape.ts`) and one test; both now expand the op and its response child
  themselves.
- Speed, full-spec selection: stripe repeat runs went 414s -> ~60s (the polluted context was
  making every later run slower); digitalocean repeat runs went 9s -> 22s, the same as the first
  run a page reload already pays.
- The parser document is shared across runs; its in-place rewrites (#55) were audited and pinned
  as write-once: a second generation changes nothing (`test_71_parser_document_reaches_a_fixpoint`).
- Known limitation, filed as #72: a selection path minted from the browsed tree can spell a name
  the fresh forest spells differently.

**Refs:** `src/oas/oasContext.ts` (`reset`), `src/oas/oasGen.ts` (`isolatedRun`, `buildForest`),
`tools/coverage-spec.mts` (the fresh-instance workaround this replaces), #12/#22 (the renames that
make stale `context.types` visible), #13 (cycle-cut divergence, same shared-node mutation family).
Tests `tests/all/regen.test.ts`.

## 72 · A selection path minted while browsing may not resolve against generation's forest — ✅ Fixed

**Symptom:** generation throws `Could not find type: obj:type:<name> …` (the web shows it as a
toast) for a selection path that the tree itself handed out — or, worse, the path silently matches
a DIFFERENT sibling whose name the drift lands on. Needs three things at once: a spec whose inline
names collide (digitalocean), a fine-grained selection (not `op>**`), and browse order differing
from generation's own expansion order.

**Example** (digitalocean — the same type, named by who got there first):
```
# the tree, expanded by hand in click order, mints:
get:/v2/apps/{app_id}/deployments>res:r>obj:type:Inlinev2AppsDeploymentsResponseActiveDeployment>…
# generation's fresh forest (selection order) spells the same node:
get:/v2/apps/{app_id}/deployments>res:r>obj:type:ActiveDeployment>…
```

**Cause:**
- Node ids embed names (`obj:type:<name>`), and collision renames (#12/#22) depend on visit order.
- Since #71 generation expands its own fresh forest, so the two orders routinely differ; before
  #71 the same mismatch existed only across a page reload (persisted selections in localStorage).
- The failure is per-path and at lookup — nothing stops building or generating.

**Fix:** the two selection walkers match a segment by id as before, and when that misses, take
the ONE node the parent can possibly mean — the field that holds its single target
(`PropObj.obj`, `PropArray.items`, `PropComp.comp`, `PropMap.map`, `Arr.itemsType`, the sole
child of `Res`/`Body`), same kind of node only (`SelectionPath.resolveSegment`,
`src/oas/utils/selectionPath.ts`). A position with several candidates still throws — picking
among them could silently bind the wrong one
(`test_72_recovery_never_guesses_among_siblings`). This covers the reproduced failure: the
drifted digitalocean segment sits where a list holds one item type.

A larger design (renaming `allOf`/`oneOf` members at construction, a throw-first check, recovery
by member position) was reviewed and REJECTED on measurement:
- the members it would rename are not rare — digitalocean has 300, box 55, and the names are
  emitted GraphQL type names, so the rename would rewrite schemas wholesale;
- a member's name shape is itself visit-order-dependent (the same schema member shows a `$ref`
  name, a minted name, or an `[inline:…]` name depending on order — ~130 of ~415 digitalocean
  member edges differ between two browse orders), so counting "the k-th inline-named member"
  does not identify the same member in two runs.
Paths through those member lists that actually drift stay unresolved (they throw, as before) —
the honest cure is #73.

**AST:** none — ids are unchanged; only how a stale id is looked up changed.
**Refs:** `src/oas/utils/selectionPath.ts`, `src/oas/generator/typesCollector.ts` (both walkers),
#71 (what exposed it), #12/#22 (the renames), #73 (the id redesign), web `useSpecTree.ts`
(where paths are minted). Tests `test_72_*` in `tests/all/regen.test.ts`.

## 74 · A request body written as a reference emits a mutation with no input at all — ✅ Fixed

**Symptom:** the mutation comes out as `createThings: Thing` — no `input` argument, no `body:`
mapping — so a client can never send data through it, and nothing errors. Found by the TS/Rust
comparison (finding C12, `docs/research/connect-gen-comparison`).

**OAS** (`request-body-component-ref.yaml` — the body lives under `components.requestBodies`):
```yaml
paths:
  /things:
    post:
      requestBody:
        $ref: '#/components/requestBodies/CreateThing'
components:
  requestBodies:
    CreateThing:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Thing'
```

**Example:**
```graphql
# before — silently unusable
createThings: Thing
# after — identical to what the inline spelling produces
createThings(input: ThingInput!): Thing
```

**Cause:**
- the parser keeps the `$ref` exactly as written, and `getRequestBodyMediaTypes()` answers
  nothing for it;
- `visitBody` read that as "this op has no body" and returned at its first guard.

**Fix:** when no media types come back, `visitBody` resolves the reference itself
(`resolvePointer`), takes the JSON media type's schema out of the referenced request body, and
hands it to the same `Factory.fromBody` call the inline path uses. The test pins byte-equality
against an inline twin of the same spec.

**Side effect, expected:** bodies this fix makes visible land on the open #67 bug when they have
no fields — the mutations sweep's INVALID_GRAPHQL bucket grew 11 -> 18 (sendgrid +4, TMF717 +3).
Those ops were "green" before only because they carried no body at all; #67's entry carries the
new population.

**AST:** none — the resolved schema joins the existing body path.
**Refs:** `src/oas/nodes/post.ts` (`visitBody`, `referencedBodySchema`). Fixtures
`request-body-component-ref.yaml` + `request-body-inline.yaml`, test
`test_74_request_body_component_ref`, comparison finding C12.

## 75 · A parameter declared through `content` crashes generation — ✅ Fixed

**Symptom:** the whole run dies with `TypeError: Cannot read properties of undefined (reading
'default')` in `factory.ts`. Found by the TS/Rust comparison (finding C28).

**OAS** (`param-via-content.yaml` — `content` with one media type instead of `schema`):
```yaml
parameters:
  - name: filter
    in: query
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/Filter'
```

**Example:**
```graphql
# wanted, and now generated — the same arguments a `schema:` parameter gets
things(filter: JSON, sort: String): [Thing]
```

**Cause:**
- a parameter carries either `schema` or `content` (with exactly one media type entry);
- `fromParam` read only `param.schema` and dereferenced `.default` on it.

**Fix:** `fromParam` falls back to the single `content` entry's schema, and the `.default` read
is guarded. The argument then takes the identical route a `schema:` parameter takes — an object
degrades to `JSON` (#19), a plain string/enum stays a scalar. Scope: the argument type and the
crash — how a `content` parameter should serialize into the query string is untouched; if it must
differ from the `schema:` form, that is a new issue.

**AST:** none — the fallback schema feeds the existing parameter path.
**Refs:** `src/oas/nodes/factory.ts` (`fromParam`). Fixtures `param-via-content.yaml` +
`param-via-schema.yaml`, test `test_75_param_via_content_generates`, comparison finding C28.

## 76 · A map whose value cycles back selects a bare `value` against a composite type — ✅ Fixed

**Symptom:** the op composes into `GRAPH_QL_ERROR: No matching shape found for selection` (the
local composer says it plainly: `` `Amount` has no fields ``). Regression from #70's fix: the
2026-08-12 sweep dropped Mercedes CCS from 43/43 to 21/43 GET ops (stripe −2, launch_library −1 —
the whole 25-op `GRAPH_QL_ERROR` bucket).

**OAS** (ccs — a dictionary whose values are the very type that holds it, currency → amount):
```yaml
Amount:
  properties:
    value: { type: number }
    unit: { type: string }
    alternatives:
      type: object
      additionalProperties:
        $ref: '#/components/schemas/Amount'
```

**Example** — the schema and the selection disagree about `value`:
```graphql
type AlternativesEntry {
  key: String
  value: Amount                        # SDL: a composite type
}
# selection
alternatives: alternatives?->entries {
  key
  value                                # bare — nothing ever selects Amount's fields
}
```
Expansion then trims `Amount` to zero fields, and composition rejects the empty type.

**Cause:**
- Deep in a walk, the map's value node is a `CircularRef` (the cycle cut — `Amount` is already on
  the path).
- Before #70 such a map field produced no selection path at all, so it silently vanished — and
  everything composed.
- #70's expansion clause used `T.isLeaf` to spot maps of plain values, and `T.isLeaf` counts
  `CircularRef` as a leaf — so the cycle-cut fields came back, half-formed:
  - selection: `PropMap.needsValueSelection()` (also `T.isLeaf`) → bare `value`;
  - SDL: `Map.valueTypeName()` keeps the referenced name → `value: Amount`.

**Fix:** the expansion clause asks `T.isWholeMapValue` instead — `T.isLeaf` minus `CircularRef` —
so a cycle-cut map value drops the field again (the pre-#70 behaviour for exactly this shape).
Maps of plain values (#70's point) still stay. Dropping is deliberate: keeping the field would
need either `value: JSON` in the SDL (divergent twin definitions of the same entry type within
one op — the #15 family) or expanding through the cycle (unbounded).

**AST:** untouched — the change is which map fields the `>**` expansion selects.
**Refs:** `src/oas/nodes/typeUtils.ts` (`isWholeMapValue`), `src/oas/generator/typesCollector.ts`
(the #70 clause). Fixture `map-recursive-value.yaml`, test
`test_76_cycle_cut_map_value_drops_the_field`. Verified per-op on ccs
`get:/api/v1/vehicles/{vehicleId}/alternatives` (fails at `c282f31`, composes with the fix); the
sweep re-run (2026-08-12) confirms: ccs 43/43, GET corpus 2300 → 2322 of 2339 (99.3%), the
`GRAPH_QL_ERROR` bucket 25 → 3. The 3 left (stripe `get:/v1/promotion_codes` ×2,
launch_library ×1) are NOT this bug — stripe's op already failed on 2026-08-11, before
`c282f31` existed. Separate, pre-existing issue; unfiled as of this entry.

## 77 · A map whose value is an allOf of empty objects vanishes; a plain empty object stays — ✅ Fixed

**Symptom:** the sibling of #70's fix, found during #76's review. A map value that is a plain empty
object is kept and degraded to `JSON`; the same shape written as an `allOf` of empty objects
silently drops the field. No corpus hit — caught by reading the predicates, not a sweep.

**OAS** (fixture — both fields mean "free-form values", only the spelling differs):
```yaml
exposedPorts:                       # kept: value: JSON, read whole (#70)
  type: object
  additionalProperties:
    type: object
mergedPorts:                        # gone: field vanished from SDL and selection
  type: object
  additionalProperties:
    allOf:
      - type: object
      - type: object
```

**Cause:**
- `Map.valueTypeName()` already degrades an empty `Obj` **or `Composed`** to `JSON`, but
  `T.isLeaf` only had the `Obj` empty-props clause — `Composed extends Type`, not `Obj`.
- So `T.isWholeMapValue` said "not a whole value" and the #70 expansion clause skipped the field.
- The naive fix (read `Composed.props` in `isLeaf`) is wrong: the collector runs before
  `consolidate()`, and a Composed's own props are filled **only** by consolidation — at collect
  time every Composed reads as empty, and populated ones would select a bare `value` against a
  real SDL type (#76 in reverse).

**Fix:** `T.isComposedEmpty` — safe to ask before `consolidate()` has run, walking the Composed's members
(visited by then) for any non-`Prop` node with props. `T.isLeaf` adds it as a clause;
`Map.valueTypeName` stays untouched (it runs post-consolidation, where `props.size === 0` is
correct). Both spellings of the field now emit `value: JSON`, read whole.

**Not folded in:** a Composed whose members have props but whose selected props are all filtered
out by `consolidate(selection)` — same disagreement class, different trigger; file separately if
it ever surfaces.

**AST:** untouched — the change is which map values count as read-whole.
**Refs:** `src/oas/nodes/typeUtils.ts` (`isComposedEmpty`, `isLeaf`). Fixture
`map-empty-composed-value.yaml`, test `test_77_empty_composed_map_value_reads_whole`
(empty-`Obj` control in the same fixture). Related: #70, #76.

## 78 · Two same-named maps over different value types collapse into one entry type — ✅ Fixed

**Symptom:** `GRAPH_QL_ERROR` on compose; the local composer names it:
`Object type 'CouponCurrencyOption' has no field 'minimumAmount'`. Hit all four stripe
`/v1/promotion_codes` ops (GET + POST, both paths) — the sweep residue left after #76.

**OAS** (stripe — two dictionaries, same field name, different value schemas):
```yaml
coupon:
  currency_options:
    additionalProperties: { $ref: coupon_currency_option }           # amount_off, …
promotion_codes_resource_restrictions:
  currency_options:
    additionalProperties: { $ref: promotion_code_currency_option }   # minimum_amount, …
```

**Example** — one definition wins, the other route's selection still asks for its own fields:
```graphql
type CurrencyOptionsEntry { key: String value: CouponCurrencyOption }   # first one stored
currencyOptions: currency_options?->entries {
  key
  value { minimumAmount: minimum_amount }    # resolved against CouponCurrencyOption -> no such field
}
```

**Cause:** the map entry type is named from the field alone (`map.ts updateName` →
`CurrencyOptionsEntry`), and `Map.visit` carried a literal stub where the collision should be
handled: `// Handle name conflict similar to Obj` — empty branch, second map never stored, never
renamed. The #9 machinery (`T.collidesWithStoredType` / `T.resolveNameConflict`) was never wired up
for maps.

**Fix:** fill the stub the same way `Obj.visit` does: when the name is taken by a different shape,
the map takes its container's name in front (`RestrictionsCurrencyOptionsEntry`). Two maps with the
same schema still share one entry type (stripe's dozens of `metadata` string maps keep a single
`MetadataEntry`, via `isSameInlineDefinition`), and a renamed shape that appears again takes the
same new name instead of a `2` (`canConvergeOn`). The map's id is built from its name, so the
definition and every reference move together, same as #9. One guard on top: a request-body map and a response map can share a name
without clashing — the body side writes with the `Input` suffix (`LabelsEntryInput` next to
`LabelsEntry`), so that pair is left alone (test_68/test_70 caught the false rename).

**Known ceiling:** when a body map holds the name, a response map is neither renamed nor
remembered — so a *second* response map with the same name and a different shape would still
collapse into the first. Needs three maps sharing one name in one op; file a new issue if it
ever fires.

**AST:** untouched — naming only.
**Refs:** `src/oas/nodes/map.ts` (`visit`). Fixture `map-entry-name-collision.yaml`, test
`test_78_same_named_maps_over_different_values_split`. Verified per-op on stripe: all four
`promotion_codes` ops compose. Related: #9, #15, #18.

## 80 · A union of unions (or of arrays) merges to an empty type and an empty selection — ✅ Fixed

**Symptom:** stripe's last 3 mutation failures — `del:/v1/customers/{customer}/bank_accounts/{id}`,
`…/cards/{id}`, `…/sources/{id}` — fail as `INVALID_SELECTION: @connect(selection:) … is empty`
(the local composer trips first on the empty type body: `INVALID_GRAPHQL: expected Field
Definition`). Github's 2 stargazers GETs fail the same way.

**OAS** (stripe — the delete answers a choice between two choices, none with fields of its own):
```json
"responses.200": { "anyOf": [ { "$ref": "payment_source" }, { "$ref": "deleted_payment_source" } ] }
"payment_source":         { "anyOf": [account, bank_account, card, source] }
"deleted_payment_source": { "anyOf": [deleted_bank_account, deleted_card] }
```
(github — the members are arrays instead:)
```yaml
schema:
  anyOf:
    - { type: array, items: { $ref: simple-user } }
    - { type: array, items: { $ref: stargazer } }
```

**Example** — what was written:
```graphql
type DeleteV1…Response { #### replacement for Union …
}
selection: """
"""
```

**Cause:** a union with no discriminator is written as one merged object (#25/#36), and the merge
(`Union.selectedProps` / `consolidate`) collected fields by reading each member's own `props` —
one level only. A member that is itself a union, or an array, has no `props`, so the merge found
nothing and both the type body and the selection came out empty. The #51 fallback for empty
response sides never fires here — it only looks at object-typed fields, and this union is the
response itself.

**Fix**, two halves:
- **Members that are unions contribute their members' fields** — `selectedProps` recurses into a
  union member, so stripe's deletes now merge the six leaf members' fields
  (`last4`, `deleted`, …) into the replacement object.
- **A merge that still finds nothing is written as `JSON`** — the field answers `JSON` and the
  selection passes the whole value through as `$`, the same route a plain-value response takes
  (#47). Covers the array members: a merged object cannot carry a list shape. The check reads the
  merged `props` when consolidation already ran, because the op line is written without a
  selection at hand.

**AST:** untouched — the change is which fields the merge collects and what an empty merge writes.
**Refs:** `src/oas/nodes/union.ts` (`selectedProps`, `consolidate`, `hasSelectedProps`,
`generate`), `src/oas/nodes/res.ts` (`select`, the #47 branch). Fixtures `union-of-unions.yaml` +
`union-of-arrays.yaml`, tests `test_80_union_of_unions_merges_member_fields` +
`test_80_union_of_arrays_answers_json`. Verified per-op: the 3 stripe deletes and github
stargazers compose; the control `del:/v1/accounts/{account}/bank_accounts/{id}` (a union of real
objects) emits byte-identical output. Related: #25, #36, #47, #50, #51.

## 81 · A path token the spec names differently (or not at all) loses its argument — ✅ Fixed

**Symptom:** rover rejects the connector — `INVALID_URL: In 'GET' in @connect(http:) on
'Query.v1ApiKeys': $args doesn't have a field named 'id'`. Four ops: omni
`get:/v1/api-keys/{id}`, `put:/v1/labels/{labelName}`, `del:/v1/labels/{labelName}`, mindbody
`put:/v2/subscribers/{subscriberId}/add-ons/{addOnId}`.

**OAS** — three ways a spec disagrees with its own path:
```yaml
/v1/api-keys/{id}:          # omni — no `parameters:` block at all
  get:
    responses: { '200': { ... } }

/v1/labels/{labelName}:     # omni — the token is `labelName`, the parameter is `name`
  put:
    parameters:
      - { name: name, in: path, required: true, schema: { type: string } }

/v2/subscribers/{subscriberId}/add-ons/{addOnId}:   # mindbody — `addOnId` vs `addonId`
  put:
    parameters:
      - { name: addonId, in: path, required: true }
```

**Example** — what was written for the labels PUT:
```graphql
updateLabelsByName(name: String!, userId: String): Label
  @connect(http: { PUT: "/labels/{$args.labelName}" ... })
```
The URL asks for `$args.labelName`; the field only has `name`.

**Cause:** the URL and the arguments were built from two sources that never met. `templatedPath`
(`src/oas/io/operationWriter.ts`) rewrites every `{token}` in the path string to
`{$args.<camelCased token>}` from the path alone, while the arguments come from an independent walk
of the declared parameters (`Get.visitParameters` -> `Factory.fromParam` -> `Param.generate`). They
agree only when the spec's parameter name matches its own path token.

**Fix:** make the two agree before the arguments are built. `Params.matchToPath` matches each path
token to a declared path parameter — same argument name, then same ignoring case, then a lone
leftover token and a lone leftover parameter, which can only be each other — and renames the
parameter to the token it serves. A token with no parameter at all gets a required `String` one
invented for it. `templatedPath` is untouched: once every token has a parameter of that name, the
two sides agree by construction.

A rename fires only where the *argument* names differ, so a snake-cased `label_name` serving
`{labelName}` is left alone — its raw name is what entity-resolver inference matches object
properties against (`src/oas/nodes/entity.ts`).

**Why `Params.pathTokens` matches `{...}` itself:** the `oas` library (v25.3.0) exposes nothing that
enumerates a path template's tokens. `Operation.getParameters()` returns only what the spec declared,
which is the input that is wrong here. The library does parse templates internally for URL matching,
but `normalizePath` is module-local and lossy (it drops the first `-` in a name), and
`PathMatch.url.slugs` needs a concrete request URL and returns that URL's values, not the tokens.
`PathMatch` is not even an exported type. Five other sites in `src` already match `{...}` the same
way, so the idiom is the house style, not a new one.

**Latent siblings** (no failing op in the corpus, so not fixed):
- An optional (`required: false`) declared path parameter is dropped from the arguments by
  `skipOptionalArgs` while the URL still templates it — the same mismatch from the other side.
- A path token declared as `in: header` is filtered out of the arguments (`get.ts`) and still
  templated.
- omni's `get:/v1/api-keys` and `get:/v1/api-keys/{id}` both name themselves `v1ApiKeys`, because
  `Naming.genOperationName` derives its `ByX` suffix from the declared parameters and never sees the
  invented one. Only a whole-spec generation collides; per-op composition does not.

**Composer divergence, worth knowing:** `tools/local/apollo-federation-cli` composes all four of
these clean — it skips rover's `$args`/body argument-existence checks. Per-op repros for URL and
body shapes have to go through rover.

**AST:** untouched — the change is which parameters an operation node is built from.
**Refs:** `src/oas/utils/params.ts` (`matchToPath`, `matchPathTokens`), `src/oas/nodes/get.ts`
(`visitParameters`, which now resolves `$ref` parameters up front so the match can read their
names). Fixture `path-param-mismatch.yaml`, test
`test_81_path_tokens_match_declared_params`. Verified per-op through rover: all four ops
compose; the control `put:/v1/api-keys/{id}` (the sibling op that declares its `id`) emits
byte-identical output. Related: #2, #3.

## 82 · A selection value starting with `null` is read as the null literal — ✅ Fixed

**Symptom:** two omni ops. `post:/v1/query/run` fails `INVALID_BODY: InputInput.*.query.*.sorts.*
doesn't have a field named 'Sort'`; `post:/v1/ai/generate-query` fails composition with
`Object type 'SortsItem' has no field '_sort'`.

**OAS** (omni — a sort carries a `null_sort` field):
```yaml
sorts:
  type: array
  items:
    type: object
    properties:
      null_sort: { type: string }
```

**Example** — what was written, and how the router reads it:
```
null_sort: nullSort      # body:     `null` then a stray `Sort`
nullSort: null_sort?     # response: `null` then a stray `_sort`
```

**Cause:** #62 established that after an alias the composer parses a literal or a path, and guarded
keys that are *exactly* `true`, `false` or `null`. The keyword is matched by prefix, so any value
beginning with `null` splits into the literal plus whatever follows it.

**Fix:** the guard now covers values *prefixed* with `null`, in both directions and in both
deliberately siloed copies (`src/oas/utils/naming.ts`, `src/json/walker/naming.ts`). The response
direction extends the existing keyword guard; the request direction had no value-side guard at all
(its #32 guard quotes the *key*, on the left of the alias), so it gains one. Emitted forms:
```
null_sort: $.nullSort         # body
nullSort: $."null_sort"?      # response
```

**Latent sibling** (no failing op in the corpus, so not fixed): `true`/`false` are the same trap one
prefix further — a `true_value` key would alias to `trueValue: true_value` and split identically.
They keep the narrow exact-word guard until an op actually fails on one, so the corpus does not move
for a shape nobody has hit.

**AST:** untouched — the change is how one alias is spelled.
**Refs:** `src/oas/utils/naming.ts` (`sanitiseFieldForSelect`, both branches),
`src/json/walker/naming.ts` (`sanitiseFieldForSelect`). Fixture `literal-prefixed-field.yaml`, test
`test_82_keyword_prefixed_keys_take_the_path_form`. Verified per-op through rover and the local
composer: both omni ops compose. Related: #32, #62.

## 83 · A request body that is not JSON is dropped, so the mutation sends nothing — ✅ Fixed

**Symptom:** stripe's `createV1Customers` and slack's `createAdminAppsApprove` compose and run with
no `input` argument and no `body:` mapping — there is no way to send them any data.
- 445 write operations across the corpus are like this, about 16% of the mutations counted as
  passing: stripe 326, slack 91, and 28 more across box, docker, openai, confluence, github, ably,
  asana and omni.
- Slack still carries its auth headers, so at a glance the operation looks finished.
- Not a stripe problem: slack has been like this all along, the stripe upgrade only made it big.

**OAS** (stripe `post:/v1/customers`, trimmed — every write operation in the spec takes a form,
never JSON):
```yaml
requestBody:
  content:
    application/x-www-form-urlencoded:
      schema:
        type: object
        properties:
          name: { type: string, maxLength: 256 }
          expand: { type: array, items: { type: string } }
          cash_balance:
            type: object
            properties:
              settings:
                type: object
                properties:
                  reconciliation_mode: { type: string, enum: [automatic, manual, merchant_default] }
      encoding:
        expand:       { style: deepObject, explode: true }
        cash_balance: { style: deepObject, explode: true }
```

**Example** — before, and after:
```graphql
# before — nothing to send
createV1Customers: Customer
  @connect(source: "api", http: { POST: "/v1/customers"} selection: """…""")

# after
createV1Customers(input: InputInput!): Customer
  @connect(
    source: "api"
    http: {
      POST: "/v1/customers"
      headers: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }]
      body: """
      $args.input {
        cash_balance: cashBalance {
         settings {
          reconciliation_mode: reconciliationMode
         }
        }
        expand
        name
      }
      """
    }
    …
  )
```

**Cause:**
- `Post.visitBody` kept only content types matching `application/…json` and returned otherwise.
- `this.body` stayed unset, so no argument and no mapping were written.
- The same filter sat in the `#74` `$ref` path (`resolveBodySchemaReference`), there without even a
  warning — 2 of slack's 91.
- Composition cannot see it: a mutation with no body is valid, so the sweep counted these as OK.

**Fix:**
- The body takes the first content type we can send: JSON, else `application/x-www-form-urlencoded`.
- `Body` carries the content type it was built from; `isFormEncoded()` answers for the writer.
- A form connector writes `Content-Type: application/x-www-form-urlencoded` on its `@connect`. The
  router matches that value exactly — a `; charset=utf-8` suffix stops the match — and a header the
  spec or the user already wrote wins. It goes per-operation, not on `@source`: box has 3 form
  bodies against 98 JSON ones.
- Everything else (multipart, octet-stream, x-tar, text/*) still sends no body, but now warns with
  the operation name: `Cannot send multipart/form-data: /v1/files goes out with no body.`

**How the router encodes it** — the generated `form-encoded-body.yaml` `post:/customers` connector,
run with `rover connector run` against a local echo server, with
`{ name: "Fer & Co", expand: ["a","b"], address: { line1: "1 High St", city: "Luton" } }`:
```
address%5Bcity%5D=Luton&address%5Bline1%5D=1+High+St&expand%5B0%5D=a&expand%5B1%5D=b&name=Fer+%26+Co
   i.e.  address[city]=Luton&address[line1]=1 High St&expand[0]=a&expand[1]=b&name=Fer & Co
```
Lists are indexed from 0, nested objects use brackets, spaces become `+`. That is exactly what
stripe's `style: deepObject, explode: true` asks for, so `encoding:` needs no code of its own. A
spec asking for `style: form, explode: false` would want its lists written another way — no spec in
the corpus does.

**Known limitation — a form has to be an object.** Send one value or a list and the router stops
with `Could not serialize body: Expected URL-encoded forms to be objects`; composition never sees
it. So a form body that is a single value (#67) or an array (#66) takes no argument and writes no
body — the same answer #67 already gives a body with no fields.

**Known limitation — a map in a body is not sent, form or JSON.** Filed as #84.

**AST** — the body node was never built before, so a whole side of the operation was missing:
```
before   post:/v1/customers > res:r > obj:type:customer
after    post:/v1/customers > body:b > obj:input:Input > prop:scalar:name …
                            > res:r  > obj:type:customer
```
`Body` also holds the content type it was built from. No new node kind, and nothing walks the tree
differently — the header itself is written at emission time only.

**Refs:** `src/oas/nodes/post.ts` (`visitBody`, `sendableMediaType`, `resolveBodySchemaReference`),
`src/oas/nodes/body.ts` (`isFormEncoded`, `isEmptyBody`, `select`), `src/oas/io/operationWriter.ts`
(`headersBlock`, `sendsForm`), `src/oas/nodes/factory.ts` (`fromBody`). Fixture
`form-encoded-body.yaml` (flat form, nested form, a form of one value, a form that is a list,
multipart, a form written as a `$ref`, and JSON alongside a form), tests
`test_83_form_body_is_sent_with_its_content_type`,
`test_83_a_form_the_router_refuses_stays_bodyless`, `test_83_json_still_wins_over_a_form`,
`test_83_stripe_writes_its_form_bodies`. `test_corpus_mut_slack` moves from 1 type to 2 — it pinned
the bug. Related: #66, #67, #70, #74.

## 84 · A map in a request body is never sent — ✅ Fixed

**Symptom:** a mutation whose body carries a map of plain values composes, runs, and silently posts
everything except the map. docker's `post:/containers/create` loses its `Labels`. The router reports
it as a problem on the request, not as an error:
```
Method ->entries requires an object input, not array
  path: $args.input.labels.->entries   location: RequestBody
```

**OAS** (docker-engine `post:/containers/create`, trimmed — `Labels` takes any key the caller wants):
```yaml
requestBody:
  content:
    application/json:
      schema:
        allOf:
          - $ref: '#/components/schemas/ContainerConfig'
          - properties: { HostConfig: { $ref: '#/components/schemas/HostConfig' } }
ContainerConfig:
  type: object
  properties:
    Labels:
      type: object
      description: User-defined key/value metadata.
      additionalProperties: { type: string }
```

**Example** — what is generated today, and what docker receives:
```graphql
input InputInput { labels: [LabelsEntryInput]  image: String  … }
input LabelsEntryInput { key: String  value: String }

createContainersCreate(name: String, input: InputInput!): CreateContainersCreateResponse
  @connect(… body: """
  $args.input {
    Labels: labels->entries {
     key
     value
    }
    Image: image
  }
  """)
```
```
called with:  labels: [{ key: "env", value: "prod" }], image: "nginx"
POST body:    {"Image":"nginx"}          # Labels never arrives
```

**Cause:**
- `->entries` takes an **object** and gives back a list of `{ key, value }` pairs.
- That is what a response needs — the API sends `{"a":"1"}`, we read it as pairs — and it works.
- A request goes the other way: the argument is **already** a list of pairs, so `->entries` gets a
  list where it wants an object, and refuses.
- Nothing in the mapping language goes back the other way. The whole list of methods is `entries`,
  `size`, `map`, `filter`, `find`, `first`, `get`, `last`, `slice`, `joinNotNull`, `echo`,
  `jsonStringify`, `match`, the comparisons and the arithmetic — none of them build an object.
- The object literal `$({ … })` does build one, but every key has to be written in the schema. A map
  takes whatever keys the caller sends, so there is nothing to write. Measured:
  ```
  Labels: $({ env: $args.input.name })                      -> {"Labels":{"env":"nginx"}}   ok
  Labels: $({ $args.input.labels->first.key: … })           -> Failed to parse schema
  ```
- Composition cannot see it: the selection is written correctly, and only the values that reach the
  API are wrong.
- The same code writes both sides: `PropMap.select` has no idea whether it is inside a body or a
  response (`src/oas/nodes/propMap.ts:58-100`).

**AST** — one node type, two sides. The response side is right, the body side is not:
```
get:/containers/{id} > res:r  > obj:type:Container   > prop:map:labels > map:type:LabelsEntry   ok
post:/containers/create > body:b > obj:input:Input   > prop:map:labels > map:input:LabelsEntry  lost
```

**This is ours to fix, not the router's.** An argument typed `JSON`, sent as it comes, already
arrives correctly — as JSON and as a form. Measured with `rover connector run` against a local echo
server:
```graphql
input BInputInput { name: String  metadata: JSON }
body: """
$args.input { metadata name }
"""
```
```
form:  metadata%5Bk1%5D=v1&metadata%5Bk2%5D=v2&name=Fer     # metadata[k1]=v1&metadata[k2]=v2
json:  {"metadata":{"k1":"v1","k2":"v2"},"name":"Fer"}
```
**Fix:**
- A map-valued field in a body is not built as a map: it is the JSON scalar, the same answer #19
  gives an object with no shape. The caller passes the object, and the body sends it as it comes.
- One predicate, `T.isParentAnInput(parent)` — true when the parent is on the input side, which
  only a body is: `kind = 'input'` is set in one place (`body.ts`) and inherited from there.
- A map inside a map falls out with it. The outer field is a scalar now, so the inner map is never
  built and `PortBindingsEntryEntryInput` is gone with the rest.
- Responses are untouched: they still read their pairs with `->entries`.
- A query param that is a map was already JSON before this (#40) and stays that way — there is a
  test over `map-input-suffix.yaml`'s GET that says so.

**Example** — the same docker operation, after:
```graphql
input InputInput { labels: JSON  image: String  … }     # no LabelsEntryInput any more
body: """
$args.input {
  Labels: labels
  Image: image
}
"""
```
```
called with:  labels: {"env":"prod","tier":"web"}, image: "nginx"
POST body:    {"Image":"nginx","Labels":{"env":"prod","tier":"web"}}
```
Measured on the regenerated docker connector with `rover connector run` against a local echo
server: the field arrives and the run reports no problems.

**What it costs:** the argument stops being typed. `labels: [LabelsEntryInput]` becomes
`labels: JSON`, so nothing checks the keys any more. That is the trade — a field that arrives
untyped, instead of a typed one that was thrown away.

**Still open — a body that is only a map, and a list of maps.** Both are built through
`Factory.fromSchema`, not through the property route, and keep the old shape. Same defect, no
operation found that does it; fix them when one turns up.

**AST** — one node kind is replaced, on the body side only:
```
before   post:/containers/create > body:b > comp:input:Input > prop:map:Labels > map:input:LabelsEntry
after    post:/containers/create > body:b > comp:input:Input > prop:scalar:Labels
```
A selection saved against the old path (the web app stores them) will not resolve — #72 matches on
names, not on a node that changed kind.

**Refs:** `src/oas/nodes/factory.ts` (both `fromProp` map branches), `src/oas/nodes/typeUtils.ts`
(`T.isParentAnInput`), `src/oas/utils/schemas.ts` (`Schemas.isMap`). Fixture
`map-input-suffix.yaml` (a body map, a map of maps, a map of lists, and now a map query param),
tests `test_84_body_map_is_sent_as_json`, `test_70_scalar_valued_maps_stay` and
`test_68_map_value_names_the_type_it_points_at` (both re-pointed at the response side). Found while
verifying #83 against the router. Related: #19, #40, #68, #70, #83.

## 85 · A response that is not `200` is thrown away — ✅ Fixed

**Symptom:** a POST whose only documented answer is `201` returns `success: Boolean` and nothing
else. The real schema is never read, and no warning says so. Found by running the generator against
HubSpot's and PagerDuty's create endpoints and comparing with the deployed connectors.

**OAS** (github `post:/app-manifests/{code}/conversions` — `201` is the only success it documents):
```yaml
responses:
  '201':
    description: Response
    content:
      application/json:
        schema: { $ref: '#/components/schemas/integration' }
  '404': { $ref: '#/components/responses/not_found' }
  '422': { $ref: '#/components/responses/validation_failed' }
```

**Example** — before, and after:
```graphql
# before — the answer is invented
createAppManifestsByCodeConversions(input: InputInput!): CreateAppManifestsByCodeConversionsResponse
  @connect(… selection: """
  success: $(true)
  """)

# after — the answer is the integration the API really sends
createAppManifestsByCodeConversions(input: InputInput!): CreateAppManifestsByCodeConversionsResponse
  @connect(… selection: """
  id
  slug?
  nodeId: node_id
  …
  """)
```

**Cause:**
- `Get.visitResponses` looked for `200`, then `default`, and invented a response when it found
  neither (`SYN_SUCCESS_RESPONSE`, the `success: Boolean` object from #31/#33).
- `201`, `202` and the rest were never looked at, however much schema they carried.
- `Post` inherits the method from `Get`, so every write operation using the REST "created"
  convention was affected.
- Composition cannot see it: a mutation answering `success: Boolean` is valid, just useless.

**How many** (a parse of the corpus, no generation — operations with no `200` whose 2xx carries a
JSON body):
```
  99  github        50  sendgrid      39  incidentio     23  asana
  11  omni           8  docker         5  ably            5  confluence (202)
 244  answered with the invented response
  79  more also declare `default`, so they answered with `default` — usually the error shape
```

**Fix:** `visitResponses` picks the response to answer with, in this order:
- `200` if the spec has one — unchanged, whatever its content, so nothing that works today moves;
- else the lowest other 2xx that carries a JSON body;
- else `default`;
- else the invented response, as before.

A reference is resolved with `context.lookupResponse`, the same call `visitResponseRef` makes; one
that cannot be read is skipped rather than thrown on, because this step only picks a code —
`visitResponse` still does all the schema work, including the non-JSON fallback (#33) and the
empty-schema case (#31).

**Why the content test.** `204` and any 2xx with no body must keep the invented response: TMF632's
`del:/individual/{id}` answers `204` and still writes `success: $(true)`. Picking by status code
alone would take an empty `201` and lose a `202` that has the schema — no corpus operation has that
shape today, but the test costs one line.

**A real 2xx also beats `default`.** `default` means "anything else", and in these 79 operations it
is the error shape: digitalocean's `post:/v2/account/keys` answers `[201, 401, 429, 500, default]`
and we returned the error. Same defect, so it is fixed here rather than filed again.

**AST** — the response node points at the real type instead of the invented one:
```
before   post:/app-manifests/{code}/conversions > res:r > obj:type:…Response  (success: Boolean)
after    post:/app-manifests/{code}/conversions > res:r > comp:type:…Response (the integration)
```

**Refs:** `src/oas/nodes/get.ts` (`visitResponses`, `findSuccessResponseCode`, `sendsJson`; the JSON media-type
test is now one constant shared with `visitResponse`). Fixture `response-201-only.yaml`, test
`test_85_first_success_response_is_taken`. `test_corpus_mut_github` pinned this bug at one type and
now expects three — it was the canary; `test_corpus_mut_digitalocean` (2 -> 3, the `default` case)
and `test_corpus_mut_omni` (3 -> 5) moved with it, and sendgrid's `post:/alerts` changed shape
without changing its count. Related: #31, #33.

## 86 · A list of "one of several plain values" loses the whole field — ✅ Fixed

**Symptom:** a field declared as a list whose items are `anyOf: [string, number]` is missing from
the type and from the mapping. When it is the only property of a request body, the input type is
written with no fields at all and rover rejects the schema:
`INVALID_GRAPHQL: expected an Input Value Definition`. Found against the deployed connector for
confluence's `post:/content/convert-ids-to-types`, which sends the field.

**OAS** (confluence — `contentIds` takes either spelling of an id):
```yaml
ConvertRequest:
  required: true
  content:
    application/json:
      schema:
        type: object
        required: [contentIds]
        properties:
          contentIds:
            type: array
            items:
              anyOf:
                - type: string
                - type: number
```

**Example** — before, and after:
```graphql
# before — the field is gone, and the type it left behind is invalid
input InputInput {
}

# after
input InputInput {
  ids: [JSON]!
}
body: """
$args.input { ids }
"""
```

**Cause:**
- Two or more members means a real union is built (#20 collapses a choice only when ONE member is
  left after dropping the fieldless ones).
- A union of plain values has no fields, so nothing under it can be selected.
- With no selectable leaf the collector drops the field from the type and the mapping — the same
  cause as #59 (a list of lists of plain values) and #70 (a map of plain values).
- Written straight onto a property the same choice already answered `JSON`, through #80's
  no-fields-to-merge fallback; only the list spelling had nothing to catch it.
- Composition sees the fallout, not the cause: a body whose only property vanished writes an empty
  input type.

**Fix:** `Factory.fromArrayItems` answers `JSON` for a choice of plain values, the way it already
answers `JSON` for an object with no shape (#56). A member is a plain value when it is an enum or a
type GraphQL has a scalar for; a `$ref` to one counts, a `null` member is ignored, and a choice with
object members is left alone as a union.

**What still applies:** measured on one fixture per shape —
```
direct:   anyOf [string, number]                -> JSON               (unchanged, #80)
withNull: [ anyOf [string, null] ]              -> [String]           (unchanged)
objects:  [ anyOf [Widget, Gadget] ]            -> [ObjectsUnionInput] (unchanged, a real union)
listed:   [ anyOf [string, number] ]            -> [JSON]             (#86)
viaRef:   [ anyOf [$ref Name(string), integer]] -> [JSON]             (#86)
```

**AST** — the list's item node changes kind; nothing else moves:
```
before   prop:array:#ids > union:input:IdsUnion   (no fields, never selected -> field dropped)
after    prop:array:#ids > scalar:JSON
```

**Refs:** `src/oas/nodes/factory.ts` (`fromArrayItems`), `src/oas/utils/schemas.ts`
(`Schemas.holdsPlainValues`). Fixture
`anyof-body-drops-operation.yaml` (a body list and, added with the fix, the same shape in the
response), test `test_86_list_of_plain_values_stays`. Narrows #20, which still drops a choice of
objects. Related: #19, #56, #59, #70, #80.

## 87 · An API key header sends the key alone, with no room for the text the API asks for — ✅ Fixed

**Symptom:** PagerDuty answers `401` to every request. The API wants
`Authorization: Token token=<API_KEY>`, and the generated `@source` sends only the key. Found by
comparing the generated schema against the deployed PagerDuty connector, which is written from a
manifest by a different (Rust) tool.

**OAS** (pagerduty, `components.securitySchemes` — the format lives in prose, in `description`;
there is no OAS field for it):
```yaml
security:
  - ApiKeyAuth: []
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Authorization
      description: 'Format: `Token token=<API_KEY>`'
```

**Example** — before, and after `--auth-value-prefix "Token token="`:
```graphql
# before — the key alone, which the API rejects
@source(name: "api", http: { baseURL: "…", headers: [{ name: "Authorization", value: "{$config.apiKey}" }] })

# after — the text the description asks for, then the key
@source(name: "api", http: { baseURL: "…", headers: [{ name: "Authorization", value: "Token token={$config.apiKey}" }] })
```

**Cause:**
- `mapSchemeToAuth` writes one fixed value per scheme type; for an API key in a header that value is
  always `{$config.apiKey}`.
- The spec says what the value must look like in free text only, so nothing in the document can be
  read to build it.
- The generator had no option for it either, on the command line or in `IGenOptions`.

**Fix:** a new `--auth-value-prefix <prefix>` option (library: `authValuePrefix`). Its text is
written in front of the key, exactly as given:
- one value for the whole run — the same prefix applies wherever an API-key header resolves, on
  `@source` and on each `@connect`;
- nothing is added between the prefix and the key, so a trailing space belongs in the option
  (`--auth-value-prefix "Token "`);
- every other scheme is untouched: an API key in the query string, bearer, basic and OAuth2 all
  write what they wrote before;
- without the option the header is `{$config.apiKey}`, byte for byte what it was.

**Known limitation:** a prefix passed for a spec with no API-key header does nothing and says
nothing. Telling the difference would mean knowing which schemes an operation really uses and
whether `--skip-auth` turned them off.

**AST** — none. Auth is written from the parsed security schemes, not from the node tree.

**Refs:** `src/oas/io/security.ts` (`mapSchemeToAuth`, `resolveAuth`, `SecurityPlan`),
`src/cli/oas.ts`, `src/oas/oasGen.ts`, `src/oas/oasContext.ts`, `src/oas/io/writer.ts`. Fixture
`apikey-header-prefix.yaml`, tests `test_87_apikey_header_writes_the_auth_value_prefix` and
`test_87_auth_value_prefix_reaches_the_cli` (the option really travels from the command line).

## 88 · An operation on the root path `/` is written with no field name — ✅ Fixed

**Symptom:** `github.yaml get:/` — GitHub's API root — is the last op in the corpus to fail with
`CONNECTORS_UNRESOLVED_FIELD`, and it fails 33 times, once per field of the response type:

```
CONNECTORS_UNRESOLVED_FIELD: [test_spec] No connector resolves field `Root.authorizationsUrl`.
CONNECTORS_UNRESOLVED_FIELD: [test_spec] No connector resolves field `Root.codeSearchUrl`.
… 31 more
```

That reads like the selection is missing all 33 fields. It isn't — the selection is complete. The
field it hangs off has no name:

```graphql
type Query {
  : Root
    @connect(source: "api", http: { GET: "/"}, selection: """
      authorizationsUrl: authorizations_url
      … all 33, correct
      """)
}
```

rover cannot bind a connector to a nameless field, so every field of `Root` reads as unresolved.
This is the masking described in #27 and #40: one syntax error reported as a cascade. The local
composer is blunter about the same schema — `INVALID_GRAPHQL: expected a Name`.

**OAS** (github):
```yaml
paths:
  /:
    get:
      operationId: meta/root
      summary: GitHub API Root
```

**Cause:** `Naming.genOperationName` names an operation after its path. `formatPath('/')` splits on
`/`, which gives two empty parts, capitalises neither, and joins them back to the empty string —
correct for every other path, and nothing at all for the root. Nobody checked the result, so the
empty name went straight into the SDL.

Only GET shows it. The other verbs prefix the name — `post.ts` writes `'create' + upperFirst(name)`
— so `POST /` was already emitting a valid, if odd, `create`.

**The name also reaches type names.** `getGqlOpName()` is read in four more places to build
`<op>Response` (`union.ts`, `obj.ts`, `comp.ts`) and a parent name (`factory.ts`). github escapes
that because its response is a `$ref` (`Root`); with an inline response schema the same op emits a
type called plain `Response`. That is why the fix belongs in `genOperationName` and not in `Get`.

**Fix:** when the path yields no name, take the operationId; when there is no operationId either,
call it `root`. `Naming.genParamName` already turns `meta/root` into `metaRoot`, so no new
sanitiser. `GET /` is now `metaRoot`, `POST /` with no operationId is `createRoot`.

**Blast radius:** two fixtures in the tree have a `/` path — `github.yaml` (get) and
`FHIR-baseR4.yaml` (post, no operationId, not in the coverage corpus). No other operation's name
changes: the new clause only runs when the old code produced the empty string.

**AST** — none. This is the field name written from the path, not the node tree.

**Refs:** `src/oas/utils/naming.ts` (`genOperationName`), reached from `get.ts` (`getGqlOpName`,
`writeOpName`). Fixture `root-path-op.yaml` (both branches: the GET with an operationId, the POST
without), test `test_88_root_path_op_takes_a_name`.

## 90 · A map at the response root loses its `->entries` wrapper — ✅ Fixed
**Symptom:** `confluence.json get:/wiki/rest/api/content/{id}/restriction/byOperation` fails compose:

```
SELECTED_FIELD_NOT_FOUND: `@connect(selection:)` on
`Query.wikiRestApiContentByIdRestrictionByOperation` contains field `operationType`,
which does not exist on `REntry`.
```

It is the last `SELECTED_FIELD_NOT_FOUND` in the GET sweep — the "1" left over from #13's 8 → 1.

**OAS** (confluence — the whole response body is a dictionary, keyed by operation):
```json
{ "type": "object",
  "additionalProperties": {
    "properties": {
      "operationType": { "$ref": "#/components/schemas/ContentRestriction" },
      "_links":        { "$ref": "#/components/schemas/GenericLinks" } } } }
```

**Example** — the two artifacts describe different shapes:
```graphql
# SDL — an entry object, and not a list of them
wikiRestApiContentByIdRestrictionByOperation(id: String!, expand: [String]): REntry
type REntry { key: String  value: inlineREntry }
type inlineREntry { operationType: ContentRestriction }

# selection — starts inside the value, with no ->entries and no key/value
operationType? { … }
```

**Cause:** the map is the response *root*, so no `PropMap` is involved, and `PropMap` is the only
node that writes the wrapper.
- `Res.select` passes through for a scalar, a list of scalars and a fieldless union — there is no
  case for a map, so it calls `Map.select`.
- `Map.select` delegates straight to `valueType.select`. It writes no `->entries`, no `key`, no
  `value` — so the selection is the value type's fields, at the root.
- `Map.generate` in `Res` context writes the bare type name, so the field is `REntry` and not
  `[REntry]`. `->entries` yields a list, so the field has to be one.
- `PropMap` gets both right already: `getValue` returns `[<Map>]` and `select` writes
  `<field>->entries { key value { … } }`. A map under a field composes; the same map at the root
  does not.

Confirmed in this op's own selection: `->entries` appears twice, both times on
`macroRenderedOutput` — a `PropMap` deeper in the tree — and never at the root.

**Fix:** mirror `PropMap` at the root — make the field a list
and wrap the selection in a root-level `$->entries`. Hand-patching the generated schema to

```graphql
wikiRestApiContentByIdRestrictionByOperation(…): [REntry]
selection: """
$->entries { key  value { …the existing selection… } }
"""
```

composes clean on stock rover at fed 2.15.1 — checked by hand before implementing, because the
generator emitted `$->entries` nowhere and the root form was unproven.

**Where it landed, and the one surprise.** `Res.select` owns the response root, so the branch sits
there next to the scalar / scalar-list / fieldless-union passthroughs. The first attempt put it in
`Map.select` behind `context.inContextOf(Res, this)`, the same guard `Map.generate` uses — and it
never fired: `Res.generate` calls `context.enter(this)` but `Res.select` does not, so `Res` is
never on the stack during selection. Worth remembering for any other node that wants to know it is
at the response root while selecting.

The `->entries { key value { … } }` body now lives on `Map.selectEntries`, called by both
`PropMap.select` (which writes the field name first) and `Res.select` (which writes `$`); the two
formerly had one implementation each. `needsValueSelection` moved to `Map` with it.

**Measured:** confluence 61/65 → 62/65 GET; the last `SELECTED_FIELD_NOT_FOUND` in the sweep is
gone. Maps under a field are byte-identical — the full suite is unchanged apart from the
pre-existing #61 failure.

**Also seen, not a bug:** `_links` is missing from `inlineREntry`. `GenericLinks` is itself a map
whose value is `object | string`, which degrades away — and it is dropped from the SDL *and* the
selection, so the two agree. Data completeness, not composition.

**AST** — no new node shape. `Map` in `Res` position needs the list cardinality and the wrapper that
`PropMap` already supplies.

**Refs:** `src/oas/nodes/res.ts` (`select`), `src/oas/nodes/map.ts` (`generate` `Res` branch,
`selectEntries`, `needsValueSelection`), `src/oas/nodes/propMap.ts` (`select`). Fixture
`map-response-root.yaml` (both forms: the map as the whole response, and the same map under a
field), tests `test_90_map_at_the_response_root_takes_entries` and
`test_90_map_under_a_field_is_unchanged` (the guard on the shared body). See #13 for the entry this
leftover belongs to.

## 91 · Two connectors generated on their own cannot compose together — ✅ Fixed
**Symptom:** every generated connector brings a `scalar JSON`, and most bring a root field named
after their path. Generate two specs separately, put both subgraphs in one supergraph, and the
names collide. There was no way to namespace the output.

The Rust `connect-gen` fork that generates the five production connectors (Stripe, Confluence, Omni,
PagerDuty, HubSpot) prefixes everything with the service name — `type_prefix()` / `field_prefix()`
threaded through its emit layer. `gen` had no equivalent.

**Example** — `--service-prefix ACME` on the `apikey-header-prefix.yaml` fixture:
```graphql
# before
scalar JSON
type WidgetsResponse { count: Int }
type Query { widgets: WidgetsResponse @connect(source: "api", …) }

# after
scalar ACME_JSON
type ACME_WidgetsResponse { count: Int }
type Query { acme_widgets: ACME_WidgetsResponse @connect(source: "api", …) }
```

**The rule, taken from the Rust manifest and not guessed** (`manifest.rs`, `capitalize()`):
- type prefix = first character uppercased, **tail verbatim** — so `ACME` stays `ACME_`, and the five
  services produce `Stripe_`, `Hubspot_`, `Pagerduty_`, `Confluence_`, `Omni_`;
- field prefix = the value lowercased;
- `Hubspot_`/`Pagerduty_`, not `HubSpot_`/`PagerDuty_` — those spellings are `catalog.yaml`
  `display_name` values, not prefixes.

**Why not `Naming.genTypeName`:** it is a context-free static function with 34 references across 18
files, so making it prefix-aware means threading a mapper through the whole node hierarchy.

**Fix:** a finished-document transform, the same technique `Directives.apply` uses — `parse()` only
to read byte offsets, collect `{from, to, insert}` spans, sort descending and splice the original
string. The AST is never re-printed, so the formatting survives.
- renames every OBJECT / OBJECT_EXTENSION / INPUT_OBJECT / ENUM / UNION / INTERFACE / SCALAR
  definition except `Query`/`Mutation`/`Subscription`, whose *fields* take the field prefix instead;
- follows every reference: field and argument types, `implements` entries, union members, unwrapping
  `[Pet!]!` so only the name inside the brackets moves;
- runs **after** `Directives.apply`, so `--directives` selectors keep naming the unprefixed types;
- rejects a prefix that is not a GraphQL name (`assertName`) — a hyphenated service directory id
  like `acme-sanity` stops the run with a message; the prefix it wants is `ACME`.

**Edge cases:** `scalar JSON` is renamed like any other scalar. A schema type called `Subscription`
has already become `SubscriptionType` by then (`RESERVED_ROOT_TYPE_NAMES`), so it is just another
name to prefix. Directive arguments are `StringValueNode`s and are never walked, so
`@source(name: "api")` is untouched. Nested field names are left alone — their parent type carries
the prefix.

**Not in scope:** independent type/field prefix overrides (the Rust manifest allows them; all five
services use the defaults), and hyphenated ids like `constellation-registry` →
`Constellation_Registry_`.

**AST** — none. This reads the finished document, not the node tree.

**Refs:** `src/oas/lint/namespace.ts` (new, `Namespace.apply`), `src/oas/oasGen.ts`
(`generateSchema`, `IGenOptions`), `src/oas/oasContext.ts` (`GenerateOptions` — `OasGen.options` is
typed from here, so the field is required in both), `src/cli/oas.ts` (`--service-prefix`,
`checkServicePrefix`). Tests `tests/all/service-prefix.test.ts`: two through the CLI (the rename and
the rejection) and three calling the transform directly (interface/union/members, argument types,
the name check). The CLI one is what a revert breaks — the direct calls bypass the wiring.

## 92 · A response that is a dictionary of plain values generates nothing — ✅ Fixed
**Symptom:** two github ops produce an empty document — no types, no `type Query` — and the sweep
scores them GEN-EMPTY: `get:/emojis` and `get:/repos/{owner}/{repo}/languages`. They were the last
two GEN-EMPTY ops with a known cause, and the whole of github's remainder after #88.

**OAS** (github — the whole 200 body is a dictionary; `/emojis` is names to image URLs,
`language` is languages to byte counts):
```yaml
/emojis:            { additionalProperties: { type: string } }
language:           { additionalProperties: { type: integer } }   # $ref'd by /repos/…/languages
```

**Example**:
```graphql
# before — 268 bytes, the preamble and nothing else
scalar JSON

# after
type REntry { key: String  value: String }
type Query { emojis: [REntry] @connect(… selection: "$->entries { key value }") }
```

**Cause:** `PathsCollector.collectExpandedPaths` pairs every "the response is just X" leaf case with
its under-a-property twin, and one half of the map pair was never written:

| under a property | at the response root |
|---|---|
| `PropScalar` | `Scalar` + `parent instanceof Res` (#32) |
| `PropArray` of scalars | `Arr` + `parent instanceof Res` (#47) |
| `PropMap` with a whole value (#70) | missing |

Nothing matched, `newSelection` stayed empty, and the empty-side fallback only looks for a `PropObj`
with no props — so the op expanded to zero paths and was dropped before any writer ran. That is why
#90, which fixed the *writers* for a map at the response root, did not reach these two: an
object-valued map root descends into the value's props and expands normally, a plain-valued one has
nothing below it to reach.

**Fix:** the missing leaf case, `Map` whose parent is a `Res` and whose value `T.isWholeMapValue`
answers for — the same call #70 makes under a property. #90 had already taught `Map.generate` to
write `[<Name>Entry]` in `Res` position and `Res.select` to write `$->entries`, so nothing else was
needed; `needsValueSelection()` is false for a plain value, giving `key` and a bare `value`.

**Where it goes, and why not where it looks like it should.** The check sits **inside** the `else`,
after `this.gen.expand(child)` — not as a branch beside the other `parent instanceof Res` cases. The
node tree is lazy: a `Map`'s `valueType` is undefined until the node is expanded, so a branch placed
before the `else` tests `undefined` and never fires. #70's twin is inside the `else` for exactly
this reason. Placing it alongside its siblings looks right and silently does nothing.

`Map` is imported there as `MapNode`: the file builds plenty of real `Map`s and the node class would
shadow the built-in.

**Measured:** github 442/444 → 444/444; the corpus GEN-EMPTY bucket 4 → 2. Whole-spec github
generation before and after differs by additions only — the two ops and their two entry types, with
none of the other 502 types touched.

**Petstore gained an op too**, which is what moved three existing tests from 8 types to 9:
`get:/store/inventory` is the same shape (`additionalProperties: { type: integer }`, status codes to
quantities) and had been generating nothing all along. It now answers
`storeInventory: [REntry]`. The tests already listed the op in their selections, so the count was
the only thing hiding it — a reminder that a GEN-EMPTY op is invisible in a `typesSize` assertion
until it stops being empty. Updated in `oas-core.test.ts` (two) and `mapper.test.ts` (one).

**AST** — none. The tree already held the `Map`; only the expansion missed it.

**Refs:** `src/oas/generator/typesCollector.ts` (`collectExpandedPaths`), `src/oas/nodes/typeUtils.ts`
(`isWholeMapValue`). Fixture `map-response-root.yaml` (four ops: object-valued root, map under a
field, string-valued root, integer-valued root), test
`test_92_map_of_plain_values_at_the_response_root_expands`. See #70 for the under-a-property twin
and #90 for the writers.

## 94 · A union request body with an array member is referenced and never defined — ✅ Fixed
**Symptom:** confluence's two restriction mutations fail compose with
`INVALID_BODY: unknown type ContentRestrictionAddOrUpdateArrayInput.*.links`. The mutation argument
is typed `ContentRestrictionAddOrUpdateArrayInput!` and no `input` block for it is written.

**OAS** (confluence — `post`/`put:/wiki/rest/api/content/{id}/restriction`; a body that is either
the paged object or the bare list):
```yaml
ContentRestrictionAddOrUpdateArray:
  oneOf:
    - type: object
      properties: { results: { type: array, items: { $ref: '#/…/ContentRestrictionUpdate' } }, … }
    - type: array
      items: { $ref: '#/…/ContentRestrictionUpdate' }
```

**Example**:
```graphql
# before — the argument points at a type that is nowhere in the document
createContentRestriction(input: ContentRestrictionAddOrUpdateArrayInput!): ContentRestrictionArray

# after
input ContentRestrictionAddOrUpdateArrayInput {
  links: JSON  limit: Int  restrictionsHash: String
  results: [ContentRestrictionUpdateInput]!  size: Int  start: Int
}
```

**Cause:** an input-position union is written as one merged object, and merging inlines the members'
fields — so each member's ref count is decremented, or the writer would emit member definitions
nothing points at. The array member is built by `Factory.createArrayType` as
`new Arr(parent, parent.name)`, so it carries **the union's own ref name**. `decRefCount` is keyed by
name, so that decrement hit the union: 1 → 0. The writer's `count > 0` gate (`io/writer.ts`) then
skipped the definition while the operation still asked for it.

Both merge paths do the decrement — `generateMergedObject` and `dependencies` — and each had its own
copy of the same three lines.

**Fix:** one `consolidateMembers` used by both, skipping a member whose `name` equals the union's.
Decrementing your own name is never right: the count is per name, so it can only ever cancel the
definition being written.

**Not fixed here:** the array member inheriting its parent's name is itself wrong — anything else
keyed by node name can trip on it. Filed as #95, now fixed.

**Measured:** whole-spec confluence generation before and after differs by additions only — the 16
lines of this one input type, with none of the other 376 definitions touched.

**AST** — none. Emission only; the same nodes are built, one fewer decrement lands.

**Refs:** `src/oas/nodes/union.ts` (`consolidateMembers`). Fixture `union-body-array-member.yaml`,
test `test_94_union_body_with_an_array_member_keeps_its_input_type`. See #57 for why `dependencies`
consolidates before reading the merged fields.


## 89 · A field cut on some routes but kept on others is declared and never provided — ✅ Fixed
**Symptom:** confluence's three relation GETs (`/wiki/rest/api/relation/...`) fail compose, each
with the same single error:
`CONNECTORS_UNRESOLVED_FIELD: [test_spec] No connector resolves field `Content.space`.`

**OAS** (confluence — `Content`, `Space` and `User` point at each other):
```yaml
Content:
  properties:
    space: { $ref: '#/components/schemas/Space' }
Space:
  properties:
    homepage: { $ref: '#/components/schemas/Content' }
User:
  properties:
    personalSpace: { $ref: '#/components/schemas/Space' }
```

**Example** — the op reaches `Content` at six selection positions; two kept `space`, four lost it
to the cycle cut. The SDL declared the field because some route kept it (#13's donation):
```graphql
# before — declared once, provided at two of six positions: rover rejects it
type Content {
  space: Space
}

# after — removed at every position and in the SDL, like a field removed on all routes
type Content {
  # space: Space - circular reference omitted
}
```

**Cause:**
- cycle detection (#10) works per route, so two nodes of the same schema can disagree on a field.
- #13 donated the kept version to the written SDL type; every route's selection kept its own comment.
- the composer wants a declared field provided at *every* position the type appears, not somewhere.
- `ancestors` was the control: removed on all routes, commented in the SDL too, composes fine.

**Fix:** a field removed on any route is now removed on every route, instead of declared because
one route kept it. The comment takes its place everywhere — the SDL, each route's selection, and
reachability:
- `TypesCollector.collect` walks the selected nodes once (`consolidateRemovedFields`, the same
  walk `collectReachable` uses) and stores a `PropCircRef` per removed-and-kept field in
  `context.propOverrides`, keyed by node **id** so every instance sees it (a ref *name* can
  collide — #95; ids cannot).
- `Obj.generate`, `Obj.select` and `Obj.dependencies` all read the same map, so the three stay in
  lockstep by construction. The select-side lookup is new — its absence was this bug.
- #13's donation (`findSelectedFieldNode`, `sdlPropOverrides`) is deleted: it only ever fired when
  a route had lost the field, and that now always means removing it everywhere.
- One override instance per id is safe: `PropCircRef.select` writes only the name at the runtime
  indent, and only the written instance ever generates.

Cost, accepted in the issue entry: the field also disappears from the routes that could really
reach it. Input objects (`obj:input:` ids) get the same treatment — deliberate, same invariant.

**Not fixed here:** `Composed` never consulted the overrides (it didn't consult #13's either); a
removed-and-kept field surfacing through an allOf would need the same lookup in `comp.ts`.

**AST** — no new node shape; `PropCircRef` now also stands in at positions that kept the field.

**Refs:** `src/oas/generator/typesCollector.ts` (`consolidateRemovedFields`), `src/oas/oasContext.ts`
(`propOverrides`), `src/oas/nodes/obj.ts` (generate/select/dependencies). Fixture
`cycle-cut-on-some-routes.yaml`, test `test_89_field_removed_on_any_route_is_removed_everywhere`.
Supersedes #13's donation; see #10 for the cycle cut itself and #26 for the reachability walk.


## 96 · A list of lists of plain values under a property has no leaf — ✅ Fixed
**Symptom:** digitalocean's `get:/v2/reports/droplet_neighbors_ids` comes out empty and the op is
dropped (GEN-EMPTY in the sweep). Ops with more properties keep composing but lose the field:
docker's `get:/containers/{id}/top` loses `Processes`, digitalocean's bandwidth op loses `values`.

**OAS** (digitalocean — the response's only property):
```yaml
neighbor_ids:
  type: array
  items:
    type: array
    items: { type: integer }
  example: [[168671828, 168663509], [168671883, 168671750]]
```

**Example**:
```graphql
# before — no field, and with no other property the whole op went with it

# after
type V2ReportsDroplet_neighbors_idsResponse {
  neighborIds: [[Int]]
}
# selection: neighborIds: neighbor_ids
```

**Cause:** `>**` walks the response and keeps the paths of what it can select. The list branch
requires `items instanceof Scalar`; here `items` is an `Arr` (whose own items are the scalar), so
no branch fires, no path is kept, and a field without a path is neither selected nor written.
The leaf table, per position:

| construct | under a property | at the response root |
|---|---|---|
| value | prop-scalar branch | #32 |
| list of values | list branch | #47 |
| map of values | #70 | #92 |
| list of lists of values | **this fix** | no corpus example |

**Fix:** the list branch also accepts a list whose items are a list of plain values. One level
deep, matching every reproduced case; emission needed nothing (#59 already writes `[[Int]]`).

**Not fixed here:** depth ≥ 3, and a list of lists as the whole response — no spec in the corpus
produces either; the branch is one more `instanceof` away if one ever does.

**AST** — none. The same nodes are built; one more shape counts as a leaf.

**Refs:** `src/oas/generator/typesCollector.ts` (`collectExpandedPaths`). Fixture
`nested-list-of-values.yaml`, test `test_96_nested_list_of_values_under_a_property_is_a_leaf`;
`test_genuine_array_of_arrays_stays_nested` now sees docker's `processes: [[String]]` appear.
See #47/#92 for the sibling axes and #59 for the emission.


## 98 · A made-up value in the type slot stops the whole run — ✅ Fixed
**Symptom:** two common-room POSTs (`/source/{destinationSourceId}/activity` and `…/user`) crash
the generator: `Cannot handle property type url`. Had `url` not thrown, `date` would have — one
call later, as `[getGQLScalarType] Cannot generate type` — so both messages are this one bug.

**OAS** (common-room — format names where a JSON Schema type belongs):
```yaml
value:
  oneOf:
    - { type: string }
    - { type: number }
    - { type: url }     # not a JSON Schema type
    - { type: date }    # neither; means string + format in a correct spec
```

**Example**:
```graphql
# before — no output at all, the run stopped at the first `url` member

# after — the op generates; the unknown member reads as JSON, `date` as String
```

**Cause:**
- `Factory.createScalarType` had no branch for a `type` it doesn't know — it threw.
- union members and array items reach it through `fromSchema`; a *property* takes `fromProp`,
  which already answered `String` for `date` — the same schema crashed or passed by position.
- inside the scalar branch, two tables disagreed: `gqlScalar` knows `date`/`date-time` (String),
  `getGQLScalarType` has those cases commented out and throws.

**Fix:** the scalar branch uses `gqlScalar`'s own answer (so `date` members emit `String`, like
props always did), and a type neither table knows reads as free-form `JSON` with a warning naming
the value and the path. The array invariant throw and the typeless throw stay.

**Care:** never add `url` to `gqlScalar` — `Schemas.holdsPlainValues` delegates to it, so a new
entry there silently changes which arrays collapse (#86).

**AST** — a `Scalar('JSON')` node where construction previously threw; nothing else moves.

**Refs:** `src/oas/nodes/factory.ts` (`createScalarType`), `src/oas/utils/gql.ts` (the two tables).
Fixture `unknown-scalar-type.yaml`, test `test_98_union_of_unknown_scalars_still_generates`.
See #19 for the same degrade on shapeless objects, #23/#33 for earlier unknown-`type` crashes.

## 99 · A $ref that points nowhere stops the whole run — ✅ Fixed
**Symptom:** common-room's `del:/user/{email}` crashes the generator:
`Unknown or undefined schema`.

**OAS** (common-room — the 200 response, a truncated pointer next to a healthy sibling):
```yaml
responses:
  '200':
    content:
      text/plain:
        schema: { type: string }
      application/json:
        schema: { $ref: '#../' }   # goes nowhere; the 404 suggests Status was meant
```

**Example**:
```graphql
# before — no output at all

# after
deleteUserByEmail: JSON
# selection: $
```

**Cause:**
- `context.lookupRef('#../')` answers nothing — the pointer is not a component ref and not a
  valid JSON pointer.
- `Factory.fromSchema` treated every unresolved schema as a programming error and threw; a
  spec's own bad pointer took the whole run down with it.

**Fix:** inside the `$ref` branch only, an empty lookup reads as free-form `JSON` with a warning
naming the ref and the path. The guard for a genuinely undefined input schema stays.

Closes the "tolerate dangling component `$ref`s" gap TEST_CORPUS.md had recorded as open since
omni — whose refs were stubbed in the fixture instead. The stubs stay; removing them is a
separate cleanup.

**AST** — a `Scalar('JSON')` node where construction previously threw; nothing else moves.

**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`). Fixture `dangling-ref.yaml`, test
`test_99_dangling_ref_response_degrades_to_json`. See #41 for the sibling `servers[].url` slice.

## 100 · Inline wrapper writes a component's type name in input position — ✅ Fixed
**Symptom:** `the type 'GroupInput' is defined multiple times in the schema` on
confluence `post:/wiki/rest/api/space` and `post:/wiki/rest/api/space/_private`.

**OAS** (confluence — `SpacePermissionCreate.subjects`, the body's permission entries):
```yaml
# SpaceCreate.permissions[]: { $ref: '#/components/schemas/SpacePermissionCreate' }
SpacePermissionCreate:
  properties:
    subjects:
      properties:
        group:                       # inline wrapper, writes GroupInput
          properties:
            results:
              type: array
              items:
                $ref: '#/components/schemas/GroupCreate'   # NOT Group
            size: { type: integer }
        user:                        # sibling, holds $ref User — #12 catches it
          properties:
            results:
              type: array
              items:
                $ref: '#/components/schemas/User'
```
The `user` wrapper renames correctly (`SubjectsUserInput`) because it contains `$ref User` and
`collidesWithContainedComponent` fires. The `group` wrapper holds `$ref GroupCreate` — a different
name — so neither trigger fires, `group` keeps its name. Component `Group` is reached later through
`User → personalSpace → Space → permissions → SpacePermission → subjects.group.results → Group`,
and both write `input GroupInput`.

**Example**:
```graphql
# before — duplicate GroupInput, INVALID_GRAPHQL
input GroupInput { … }  # from inline `group`
input GroupInput { … }  # from component Group

# after — the wrapper is container-qualified
input SubjectsGroupInput { size: Int, results: [GroupCreateInput] }
input GroupInput { id: String, name: String }
```

**AST** — only the inline `group` node is renamed; the component keeps its name:
```
before   post:/space > body:b > … > obj:input:group         (name = group)
after    post:/space > body:b > … > obj:input:SubjectsGroup  (name = SubjectsGroup)
```

**Cause:** `Obj.visit` had two rename triggers: `collidesWithStoredType` (checks `context.types`)
and `collidesWithContainedComponent` (checks refs the wrapper itself holds). Neither consults the
component-schema namespace when the inline would write the same type name as a component it doesn't
contain. The `#57` reservation set inside `resolveNameConflict` only constrained the bump loop after
a trigger had already fired.

**Fix:** a third trigger, `T.collidesWithReservedComponentName`, checks the inline's type name
against the component-schema namespace. Only components that write a type (objects, composed, enums)
count — scalars write nothing and cannot collide. The reservation set is extracted into
`reservedComponentNames`, reused by both the trigger and the bump loop.

**Measured:** whole-op confluence generation before and after differs by exactly two lines — the
`group:` field's type and the wrapper's definition line (`GroupInput` -> `SubjectsGroupInput`) —
and the result composes. Nothing else in the 4819-line SDL moves.

`test_inline_not_renamed_without_contained_same_named_ref` was renamed and updated: inline `label`
matching an object component `Label` is now renamed (it would collide in a multi-op selection);
inline `status` matching a scalar component `Status` still keeps its name (no type written).

**Refs:** `src/oas/nodes/typeUtils.ts` (`collidesWithReservedComponentName`, `reservedComponentNames`,
`emitsTypeDefinition`), `src/oas/nodes/obj.ts` (visit). Fixture
`inline-wrapper-vs-component-input.yaml`, test
`test_100_inline_wrapper_must_not_take_a_later_components_name`. See #12, #57, #63.


## 101 · A type whose every field was removed prints a comment-only body — ✅ Fixed
**Symptom:** two confluence mutations fail compose with `INVALID_GRAPHQL` because the SDL does not
even parse (`Expected Name, found "}"`):
- `post:/wiki/rest/api/content/{id}/version` — `type Contributors { # publishers … omitted }`
- `put:/wiki/rest/api/content/{id}/child/attachment/{attachmentId}` — same shape as
  `input ContributorsInput`

**OAS** (confluence — the only field re-enters the history it hangs from):
```yaml
ContentHistory:
  properties:
    contributors: { $ref: '#/components/schemas/Contributors' }
Contributors:
  properties:
    publishers: { $ref: '#/components/schemas/UsersUserKeys' }   # removed on every route
```

**Example**:
```graphql
# before — a body with no real field between the braces; GraphQL refuses to parse it
contributors: Contributors
type Contributors {
  # publishers: UsersUserKeys - circular reference omitted
}
# selection:  contributors? { # publishers: circular reference omitted … }

# after — the field reads whole, the definition is never written
contributors: JSON
# selection:  contributors?
```

**Cause:**
- a removed field is still a prop (`Obj.visitProperties` stores the `PropCircRef`), so every emptiness
  test read a non-empty map: `PropObj.getValue`'s #19 fallback, `needsBrackets`, `Obj.generate`'s
  early return.
- nothing asked "does any field print uncommented", after #89's removals included.
- #36 had already recorded this exact residue as still open.

**Fix:** one predicate, `T.everyFieldRemoved` — an object with fields where every one prints as a
cycle comment, judged through `context.propOverrides` so #89 removals count. Three readers keep the
triple in lockstep:
- `PropObj.getValue` answers `JSON` (the #19 move: degrade at the field, never write the empty type),
- `PropObj.select` drops the group — the field reads whole,
- `PropObj.dependencies` answers nothing, so the #26 walk drops the type and everything only it
  reached (confluence's `UsersUserKeys`),
- `Obj.generate` returns before writing the definition, the belt to the reachability suspender.

**Not folded in:**
- `Composed`/`Union` members — they never consulted the overrides (#89's own scope-out); an
  member with every field removed surfacing through an allOf needs that lookup in `comp.ts` first.
- an object with every field removed as array items or a map value (`[Contributors]` would need `[JSON]`) — no
  corpus example.
- an object with every field removed as the whole response — it would reference an unwritten name; no corpus
  example.
- a hand-written narrow selection that picks only a mixed type's removed fields still prints a
  comment-only body — unreachable under the full-subtree form.
- same-id instances where one lost every field and another keeps one: the JSON reference no
  longer feeds the #89 walk, so the kept twin would miss its removal — no reproducing fixture;
  its own issue if one surfaces.

**AST** — none. The same nodes are built; four readers answer differently for one shape.

**Measured:** confluence mutations 63/65 -> 65/65; both ops compose. GET sweep untouched.

**Refs:** `src/oas/nodes/typeUtils.ts` (`everyFieldRemoved`), `src/oas/nodes/propObj.ts`,
`src/oas/nodes/obj.ts`. Fixture `only-field-in-a-cycle.yaml`, test
`test_101_type_with_every_field_removed_becomes_json`. Closes #36's residue; see #10 for the removal, #19
for the degrade convention, #26 for the walk, #89 for the removals.


## 102 · An enum that lists a value twice writes it twice — ✅ Fixed
**Symptom:** openfigi `post:/mapping` fails compose:
`INVALID_GRAPHQL` on `enum MappingJobStateCode` — 16 values appear twice.

**OAS** (openfigi — the spec itself repeats the values):
```yaml
stateCode:
  type: string
  enum: [AB, AC, AC, HI, HI, ME, ME, …]
```

**Example:**
```graphql
# before — written as listed, invalid
enum MappingJobStateCode { AB, AC, AC, HI, HI }

# after — each value once, first place kept
enum MappingJobStateCode { AB, AC, HI }
```

**Cause:** enum values were written exactly as the spec lists them; nothing removed repeats.

**Fix:** the `En` constructor keeps the first occurrence of each value — one place covers every
way an enum is built (component, inline, param).

**AST** — none. The same node is built with the repeats gone from `items`.

**Measured:** openfigi mutations 0/1 -> 1/1; nothing else in the corpus repeats an enum value.

**Refs:** `src/oas/nodes/en.ts` (constructor). Fixture `duplicate-enum-values.yaml`, test
`test_102_enum_value_listed_twice_is_written_once`. Split from #69, whose trello half is a
different mechanism (sibling names colliding after sanitising).


## 69 · Sibling names that collide after sanitising are written twice — ✅ Fixed
**Symptom:** `INVALID_GRAPHQL: Field prefsBackground already exists` on trello `post:/boards`
and `put:/boards/{idBoard}` — the last two real failures in the mutation sweep.

**OAS** (trello — the `boards` component carries both spellings of each pref side by side):
```yaml
boards:
  properties:
    prefs/background: { type: string }
    prefs_background: { type: string }
```

**Example:**
```graphql
# before — both spellings cleaned to one name and both were written
input BoardsInput {
  prefsBackground: String
  prefsBackground: String
}

# after — the same shape keeps the first twin; a different shape takes a numbered name
input BoardsInput {
  prefsBackground: String
  fooBar: FooBarInput
  fooBar2: String        # body: "foo/bar": fooBar2 — the original key stays in the mapping
}
```

**Cause:**
- each field name cleaned on its own (`prefs/background` and `prefs_background` both ->
  `prefsBackground`); nothing compared the result against sibling names before writing.
- the body mapping wrote both twins against the same field — a wrong request, not only a
  compose error.

**Fix:** `Obj.selectedProps` runs the list through `T.numberTwinFields` — the one list
`generate`, `select` and `dependencies` all read, so the three agree:
- same cleaned name and same shape (descriptions aside): the first twin stays, the other is
  dropped from the type and from the mapping.
- a different shape takes a numbered name (`fooBar2`), carried on the prop (`renamedTo`) and
  read by both the field line and the alias — the original JSON key stays on the wire in both
  directions (body `"foo/bar": fooBar2`, response `fooBar2: $."foo/bar"`).

**AST** — none. The same props are built; emission reads a resolved list and one extra name.

**Measured:** trello mutations 179/181 -> 181/181. #61 is the same missing comparison seen from
the other direction (`@type` vs `type`) — TMF-only, out of scope.

**Refs:** `src/oas/nodes/obj.ts` (`selectedProps`), `src/oas/nodes/typeUtils.ts`
(`numberTwinFields`), `src/oas/nodes/prop.ts` (`renamedTo`, `fieldForSelect`),
`src/oas/utils/naming.ts` (`sanitiseFieldForSelect`). Fixture `sibling-name-collision.yaml`,
test `test_69_sibling_names_that_clean_to_one_field_write_once`. See #63 for the numbered-name
move at type level, #102 for the enum half this entry once bundled.


**Revised by #113 (2026-08-18):** same-shape twins are no longer dropped — both are kept, the
later one numbered (`prefsBackground2`), each aliased to its own wire key. `sameFieldShape` is
gone with the drop. The test is now `test_69_113_sibling_names_that_clean_to_one_field_are_numbered`.

## 97 · slack's reactions.get response is an object stamped on a list, and comes out empty — ✅ Fixed
**Symptom:** slack's `get:/reactions.get` expanded to zero types and the op was dropped — the last
GEN-EMPTY in the sweep. Parked at first (archived spec, one occurrence); finished once the corpus
had no other gap left.

**OAS** (slack — the response root: `type: object`, no `properties`, an `items` beside it):
```yaml
type: object
items:
  anyOf:
    - properties: { ok: …, type: { enum: [message] }, channel: …, message: … }
    - properties: { ok: …, type: { enum: [file] }, file: … }
    - properties: { ok: …, type: { enum: [file_comment] }, file: …, comment: … }
```

**Example:**
```graphql
# before — the factory built a fieldless object and the op vanished

# after — the items schema is read in its place
reactionsGet: ReactionsGetResponse
```

**Cause:**
- the factory read `type: object`, found no `properties`, and built an object with no fields —
  the `items` and everything inside it was thrown away.
- the implied-array reading (#4) skips it: `type` is not array and not empty.
- #52's unwrap of the same artifact only fires under an array's `items`.

**Fix:** an object with no fields of its own and an `items` beside it reads the items schema as
the real shape. The example the spec prints next to this construct is a single object — slack's
`reactions.get` answers one item's reactions — so the wrapper is the same generator artifact #52
unwraps under arrays, not a real list.

**AST** — the artifact level builds no node; the items schema's nodes stand where it stood.

**Measured:** slack GETs 79/80 -> 80/80; the real op emits 13 types and composes. GEN-EMPTY is
now zero corpus-wide.

**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`). Fixture `object-stamped-on-a-list.yaml`,
test `test_97_object_stamped_on_a_list_reads_the_items`. See #52 for the artifact under arrays,
#4 for the implied array.


## 103 · github's list and by-id operations share one query field name — ✅ Fixed
**Symptom:** a whole-spec github selection failed composition with 83 duplicate Query/Mutation
fields — `get:/gists` and `get:/gists/{gist_id}` both wrote `Query.gists`. Per-op composition
never sees it: the two fields only meet in one schema when both ops are selected.

**OAS** (github — the by-id op declares its path param by reference):
```yaml
/gists/{gist_id}:
  get:
    parameters:
      - $ref: '#/components/parameters/gist-id'   # name: gist_id, in: path, required: true
```

**Example:**
```graphql
# before — the by-id op lands on the list op's name; a multi-token path repeats a suffix
gists(gistId: String!): GistSimple
gistsByShaBySha(gistId: String!, sha: String!): GistSimple

# after — each token names itself, in place
gistsByGistId(gistId: String!): GistSimple
gistsByGistIdBySha(gistId: String!, sha: String!): GistSimple
```

**Cause:**
- `genOperationName` took its `By` suffixes from the declared parameters passing
  `required && in != header`.
- a `$ref` parameter has neither field until dereferenced, so it was dropped — no suffix.
- a token never declared at all contributed nothing either (the latent note under #81).
- `formatPath` stamped the entire joined suffix on every `{token}`, so one surviving inline
  param on a multi-token path repeated: `/gists/{gist_id}/{sha}` -> `gistsByShaBySha`.

**Fix:** each `{token}` becomes its own positional suffix, derived from the token text itself —
declared inline, `$ref`'d, or not at all, the name comes out the same. Non-path params (query,
cookie) keep contributing after the last token, their old site; a tokenless path keeps dropping
them, as it always has.

**AST** — none. The same nodes are built; only the names they mint change (`<op>Response` types
follow the field, from the same function).

**Measured:** full github selection (845 paths): 84 composition errors -> 1 with #104 — the 83
duplicate root fields all gone; the survivor is #107, previously masked. Renames land only on
token-bearing paths; user transform-rule files matched against old names stop matching.

**Refs:** `src/oas/utils/naming.ts` (`genOperationName`, `formatPath`). Fixture
`root-field-name-collisions.yaml`, test
`test_103_ref_and_undeclared_path_params_take_positional_by_suffixes`. See #81 for the same
resolution gap at the URL/argument level, #91 for collisions between separate connectors.


## 104 · an object body and a oneOf body both write `input InputInput` — ✅ Fixed
**Symptom:** the last INVALID_GRAPHQL of the whole-spec github run: `input InputInput` defined
twice — once by an op with an inline object body, once by an op with a `oneOf` body.

**OAS** (github — most write ops carry an inline object body; `patch:/gists/{gist_id}` a oneOf):
```yaml
requestBody:
  content:
    application/json:
      schema:
        oneOf:
          - type: object
            properties: { content: … }
          - …
```

**Example:**
```graphql
# before — the union body repeats the object body's name
input InputInput { … }
input InputInput { #### replacement for Union Input

# after — the union takes the next name, as a second object body already did
input InputInput { … }
input BInputInput { #### replacement for Union BInput
```

**Cause:**
- an inline body payload is always named `Input` (body.ts), and kind `input` appends the
  `Input` suffix — every inline body wants the same `InputInput`.
- `Obj.visit` guards the name store (#9/#12): a second object body renames to `BInputInput`.
- `Union.visit` stored its name with no check, so a oneOf body after an object body wrote
  `InputInput` again.
- the writer's name-level dedup only covers `$ref`-named types.

**Fix:** `Union.visit` runs the same guard `Map` does before storing — a real collision renames
via `resolveNameConflict`; `$ref`-named and `[inline:…]`-named unions stay exempt, and an
occupant on the other side of the wire (body vs response, #48) keeps the shared name.

**AST** — none; the union node just carries the resolved name.

**Measured:** with #103, full github composes past INVALID_GRAPHQL entirely (84 -> 1, the
survivor filed as #107). Single-op output is untouched — no collision, no rename. First cut renamed
*identical* twins apart too, which split stripe's shared unions ten ways and broke the curated
34-op selection (1161 unresolved fields — see #73's parked-again note); `sameSchemaAs` now reads a
union's member list and tag as its shape, so identical twins converge on one name and the curated
selection composes clean (`test_73_curated_multi_op_stripe_selection_composes`, stock rover).

**Refs:** `src/oas/nodes/union.ts` (`visit`), `src/oas/nodes/typeUtils.ts`
(`collidesWithStoredType`, `resolveNameConflict`). Fixture `duplicate-inline-body-inputs.yaml`,
test `test_104_second_inline_oneof_body_renames_instead_of_duplicating`. Latent siblings, not
biting in the corpus: a Composed allOf body in the same position (comp.ts renames only under a
Prop). See #100 for the component-name half of this family.


## 107 · Two maps' inline value types share one name, and one selection names missing fields — ✅ Fixed
**Symptom:** the whole-spec github selection composed past #103/#104 and failed on the one
survivor: `INTERNAL: … Object type `inlineFilesEntry` has no field `content``.

**OAS** (github — two gist models carry a `files` map whose inline value shapes differ):
```yaml
base-gist:
  properties:
    files:
      type: object
      additionalProperties:
        type: object
        properties: { filename: …, type: …, language: …, raw_url: …, size: … }
gist-simple:
  properties:
    files:
      type: object
      additionalProperties:
        type: object
        properties: { filename: …, …, truncated: …, content: … }
```

**Example:**
```graphql
# before — one value type for both shapes; gist-simple's selection asks for content on it
type inlineFilesEntry { filename … size }        # base-gist's 5 fields, the only definition
type GistSimpleFilesEntry { key: String, value: inlineFilesEntry }

# after — the value follows its wrapper's resolved name
type inlineGistSimpleFilesEntry { filename … content truncated }
type GistSimpleFilesEntry { key: String, value: inlineGistSimpleFilesEntry }
```

**Cause:**
- `Map.visit` built the value before its own #78 collision-rename, so the value was baptised
  `[inline:FilesEntry]` while the wrapper still held the pre-rename name.
- `[inline:…]` names are exempt from every rename check (#9's premise: never emitted standalone —
  true for allOf members, false for map values, which are real emitted types).
- ids are name-derived, so both value objects shared `obj:type:[inline:FilesEntry]` and the
  collector kept whichever it reached first.

**Fix:** `Map.visit` resolves the wrapper's name first and builds the value after, so the value's
minted `[inline:<map name>]` carries the resolved wrapper name — definition, `value:` reference and
selection split together, all read from the same instance. `isExemptFromRename` is untouched: the
allOf-member exemption keeps its true premise, and Composed-member selection paths don't churn.

**AST** — the same nodes are built; the value under a renamed wrapper mints a different name (and
so a different id) than before.

**Measured:** full github (845 paths) composes with zero errors — the whole-spec run is clean for
the first time (84 -> 1 -> 0 across #103/#104/#107). No corpus name is pinned on a map-value
inline type; per-op runs are unaffected unless the wrapper renames, which was the broken case.

**Refs:** `src/oas/nodes/map.ts` (`visit` ordering), `src/oas/nodes/obj.ts` (`updateName`
placeholder branch), `src/oas/nodes/typeUtils.ts` (`isExemptFromRename`, unchanged). Fixture
`map-inline-value-collision.yaml`, test `test_107_inline_map_values_split_with_their_wrappers`.
See #78 for the wrapper half (its `$ref`-valued fixture never hit this), #9 for the exemption's
original premise, #95 for the mirror case (a wrapper borrowing a name).


## 112 · A response union takes the stored entry from a body union, and the next body keeps a used name — ✅ Fixed
**Symptom:** found by the 17 Aug 2026 five-commit review, reproduced on `75d4461`: with three
unions landing on one name — body, response, body — the third body union kept the name the first
had already emitted, and its connector selected fields the emitted input doesn't have.

**OAS** (union-store-overwrite.yaml — the response comes from a component literally named Input):
```yaml
/alphas:  post -> requestBody oneOf [ {alpha}, {beta} ]     # input union, named Input
/bravos:  get  -> $ref: '#/components/schemas/Input'        # oneOf component, the other side
/gammas:  post -> requestBody oneOf [ {gamma}, {delta} ]    # input union, named Input again
```

**Example:**
```graphql
# before — createGammas sends gamma/delta against a type that defines alpha/beta
input InputInput { alpha … beta }
createGammas(input: InputInput!): Ack

# after — the third union renames off the first, as #104 intends
input BInputInput { gamma … delta }
createGammas(input: BInputInput!): Ack
```

**Cause:**
- #104's guard skips the rename when the stored type is the other side of the wire — right —
  but then stored unconditionally, so the response union took the entry over.
- the next body union compared itself against the response union, read the name as
  other-side-shared, and kept it.
- `Map.visit` (#78) already guards the store the same way it guards the rename; Union didn't.

**Fix:** the same store guard as Map: an other-side type never takes the entry, and a name
already stored is not overwritten. A registry keyed by name AND side would remove this class
outright — noted as a follow-up, not done (the guard covers the reproduced failure).

**AST** — none; only which node the name's registry entry points at changes.

**Measured:** the three-union fixture composes; github whole-spec and stripe curated stay at
zero errors.

**Refs:** `src/oas/nodes/union.ts` (`visit`), `src/oas/nodes/map.ts` (the guard mirrored),
`src/oas/nodes/typeUtils.ts` (`ownedByOtherSide`). Fixture `union-store-overwrite.yaml`, test
`test_112_response_union_must_not_take_the_stored_entry_from_a_body_union`. See #104 for the
rename half, #78 for the pattern.

## 118 · A mutually-recursive `oneOf` reached through arrays never finishes expanding — ✅ Fixed

**Symptom:** HubSpot's real `GET /crm/lists/2026-03/{listId}` (and the plain list endpoint) never
returned — the first entry in this log where the CLI process itself had to be killed. The fixture
form (7 branch types whose per-branch-named arrays all hold the same 7-way `oneOf`) hung >60s on a
~100-line spec.

**OAS** (hubspot lists — `filterBranch` is a `oneOf` of 7 branch types; each branch's array holds
the *same* 7-way `oneOf` again):
```yaml
OrBranch:
  properties:
    orBranches:            # each branch names its array differently (or/and/notAll/…)
      type: array
      items:
        oneOf: [OrBranch, AndBranch, NotAllBranch, NotAnyBranch, RestrictedBranch,
                UnifiedEventsBranch, AssociationBranch]   # 7-way, mutually recursive
```

**Cause** — two independent defects, one entry (mirrors #10's pair exactly):

1. **No union-level cycle cut.** The #10 cut (`Factory.cyclicAncestor`) compares one resolved
   `SchemaObject` along `ancestors()` — but mutual recursion through a `oneOf` clique closes
   through the member LIST, which a `Union` carries as raw `$ref`s (`Union.schemas`; it never sets
   `.schema`). So no path ever matched, and the tree enumerated every simple ordering of the
   clique — factorial in clique size. On real HubSpot a name-based accident in `Type.add` happened
   to bound it at 56 branch objects (vacuous `schema === schema` on undefined); with per-branch
   array prop names (the common AND/OR filter-group spelling) even that never fires and expansion
   is genuinely factorial.
2. **Quadratic selection matching, again.** Post-cut, the op still yields a 38,300-entry
   selection, and four sites missed by #10's `selectionPrefixes` fix re-ran
   `selection.find((s) => s.startsWith(prop.path()))` per prop — 55.7M `path()` rebuilds, ~94s of
   a 97.6s run (`Union.selectedMembers`/`consolidate`/`selectedProps`, `Composed.consolidate`).
   The full 30-op spec exceeded 600s. (An earlier "0% CPU stall" report was a measurement
   artifact: `node --import tsx/esm` runs as a supervisor+worker pair with identical command
   lines, and the idle ~6MB supervisor was sampled while the worker ran at 99% — sample tsx
   workers by CPU/RSS or ppid, never by name.)

**Fix:**

1. Union member-set signature cut (`src/oas/nodes/factory.ts`): `unionRefSignature` (sorted
   member-`$ref` set; undefined when any non-null member is inline or <2 refs — keeps stripe's
   `anyOf [string, $ref]` out) + `cyclicUnionAncestor` (first ancestor `Union` with the same
   signature, path-scoped like #10 — sibling reuse is never cut). Applied at
   `createContainerType`'s union branch (returns the #10 `RefCircRef` sentinel) and `fromProp`'s
   epilogue (wraps in `PropCircRef`, covering the inline-oneOf `PropComp` constructions). The
   instance cut stays checked first at both sites.
2. The four missed sites use `selectionPrefixes(selection)` membership instead of the scan
   (`src/oas/nodes/union.ts`, `src/oas/nodes/comp.ts`; re-exported through `internal.ts`).

**Measured:** fixture >60s hang → 0.5s. Real `{listId}` op: never terminates → 104s after fix 1
→ 5.4s after fix 2 (38,300 entries, unchanged). Full 30-op lists.json CLI run: >600s timeout →
18.9s exit 0 (confirmed independently at 19.4s). Whole suite byte-identical (371 pass / 0 fail /
7 pre-existing todos).

**AST** — shape change only where the new cut fires (deep duplicate branches become the existing
#10 sentinel nodes); an instrumented sweep of every union-heavy green fixture (TMF632/637/666/717,
box, github, omni, quickbooks, stripe-curated at 4M nodes, union-shared) found zero chains where
the new cut fires — existing outputs untouched, `id`/`path()` semantics untouched.

**Residuals** deferred to #119 (trace-arg cost, a `.some` path() hoist, dead `T.print` calls, a
path→node map for the collect walk — none needed for the bound).

**Refs:** `src/oas/nodes/factory.ts` (`unionRefSignature`, `cyclicUnionAncestor`),
`src/oas/nodes/union.ts` / `src/oas/nodes/comp.ts` (prefix sets), `src/oas/nodes/type.ts`
(`selectionPrefixes`, #10). Fixture `recursive-oneof-array-branches.yaml`; tests
`test_118_recursive_oneof_clique_terminates` (spawnSync 60s canary),
`test_118_recursive_oneof_clique_cut_output`, `test_118_prefix_set` (deterministic `path()` call
counter: 123 fixed vs 578 with the scans, bound 250). See #10 (both halves are its direct
descendants), #119 (residuals). Found via `graphos-service-factory/scripts/gen-ts.mjs` against
`service-catalog/hubspot/lists.json`; note that wrapper cannot run the hubspot service end-to-end
yet (multi-spec dir, its task #19) — the acceptance evidence is the raw CLI run above.

## 114 · An object stamped on a list is only repaired on one route — ✅ Fixed

**Symptom:** #97's malformed shape (`type: object` with no fields and an `items` beside it) was
repaired in `Factory.fromSchema` only. The same shape reached as a nested PROPERTY went through
`Factory.fromProp`, built a fieldless object, and the field was **dropped entirely** — absent
from the type and the selection (worse than the "degrades to JSON" the review guessed).

**OAS** (`object-stamped-on-a-list-nested.yaml`):
```yaml
broken:
  type: object            # no properties of its own
  items:                  # the real shape lives here
    type: object
    properties: { id: { type: string }, label: { type: string } }
```

**Fix:** the repair is one shared predicate, `Schemas.isFieldlessObjectWithItems`
(`src/oas/utils/schemas.ts`), used at both sites in `src/oas/nodes/factory.ts`: `fromSchema`
(behavior unchanged) and NEW in `fromProp` — recurse via `fromProp(context, parent, propName,
items)`, which keeps the prop name, wrapper class, optional marker and cycle checks. Both sites
now warn `object stamped on a list — reading its items in: <path>` so the recovery is visible.

**Boundary kept:** `items: { anyOf: [...] }` on the prop route still degrades (fromProp has no
bare-anyOf union branch) — a pre-existing, separate gap; the fromSchema route (#97's original
slack case) already handles it.

**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`, `fromProp`), `src/oas/utils/schemas.ts`.
Fixture `object-stamped-on-a-list-nested.yaml`, test
`test_114_nested_object_stamped_on_a_list_reads_the_items`. See #97 (the original route),
Review §3.

## 113 · Two same-shaped keys clean to one field, and the second key's value is unreachable — ✅ Fixed

**Symptom:** #69 dropped the same-shape twin, so its wire key could never be read or sent; and
twins folded together by an `allOf` or a flattened `oneOf` merge skipped the resolver entirely
and wrote the same field twice — invalid GraphQL.

**OAS** (trello — the #69 pair):
```yaml
prefs/background:  { type: string }
prefs_background:  { type: string }
```

**Decision:** number, never drop. Each twin keeps its own wire key:
```graphql
prefsBackground: String      # selection: prefsBackground: prefs_background
prefsBackground2: String     # selection: prefsBackground2: $."prefs/background"
```

**Fix** (`src/oas/nodes/typeUtils.ts` `numberTwinFields`): the same-shape early-continue and
`sameFieldShape` are deleted — every later twin takes the numbered name via the existing
`prop.renamedTo` machinery (which already flowed into both the SDL line and the selection alias).
The allocator now respects an existing `renamedTo` so a second pass in a different prop order
cannot flip which twin holds the base name. Bypass routes covered by reuse: `Composed` gets Obj's
one-line `selectedProps` override (`src/oas/nodes/comp.ts`), `Union.dedupedSelectedProps` wraps
its return (`src/oas/nodes/union.ts`) — both previously emitted duplicate fields, so only
already-invalid output changes there.

**The review's `required`-membership gap** in `sameFieldShape` died with the function.

**Refs:** `src/oas/nodes/typeUtils.ts`, `src/oas/nodes/comp.ts`, `src/oas/nodes/union.ts`.
Fixtures `sibling-name-collision.yaml`, `sibling-name-collision-merged.yaml`; tests
`test_69_113_sibling_names_that_clean_to_one_field_are_numbered`,
`test_113_twin_spellings_across_allof_and_union_members_are_numbered` (tests/all/r3-naming.test.ts).
See #69 (the revised decision), Review §2.

## 116 · Cleaned path names can still collide, and #103's renames need a migration note — ✅ Fixed

**Symptom:** two distinct paths can clean to one root field and write the same Query field twice
(invalid GraphQL). #103 only separated token-bearing paths.

**OAS** (`cleaned-path-collision.yaml` — both collision classes):
```yaml
/foo-bar:            # formatPath splits on [:\-.+#] — both clean to fooBar
/foo.bar:
/things/{thing_id}:  # genParamName splits on any non-alphanumeric — both tokens -> ByThingId
/things/{thing.id}:
```
(Note the issue's original `/foo-bar` vs `/foo_bar` example was wrong — underscores survive
`formatPath`; only the Response type collided there, and #9's machinery already renamed it.)

**Fix:** a spec-wide numbering pass at the end of `OasGen.buildPaths` (`src/oas/oasGen.ts`):
per emitted root (Query vs Mutation, via `T.isMutationType`), a later op whose `getGqlOpName()`
is taken gets `op.renamedTo` — the same minimal-state pattern as `prop.renamedTo` (#69/#113),
with the numbering loop shared through `Naming.numberedName`. Each `getGqlOpName()` returns
`renamedTo` first, so downstream `<op>Response` names and connector selections follow the
numbered name with no further changes. The pass runs over the whole spec (not the selection) in
the already-sorted path order, so names are stable across selections and regenerations (#71).

**Measured inert elsewhere:** test_103's 8 paths and 17 corpus specs (github, stripe-curated,
digitalocean, …) produce zero renames from the pass.

**Also from the review:** the #103 migration note is in changelog.md under `[Unreleased]`
`### Changed`; stripe-curated fixture minimization deferred (its only consumer is a todo test
pending #73); rover left unpinned — a comment at `forceRover` (src/tests/runners.ts) documents
the 0.41 ELv2-acceptance failure mode instead of a hard gate.

**Refs:** `src/oas/oasGen.ts` (`buildPaths`), `src/oas/nodes/get.ts`/`post.ts`/`put.ts`/
`patch.ts`/`delete.ts` (`renamedTo` guard), `src/oas/utils/naming.ts` (`numberedName`).
Fixture `cleaned-path-collision.yaml`, test `test_116_cleaned_path_names_that_collide_are_numbered`
(tests/all/r3-naming.test.ts). See #103, #113, Review §5.

## 123 · A second inline `allOf` request body converges on the first body's `Input` name — ✅ Fixed

**Symptom:** whole-spec mutation composes failed `INVALID_BODY` (52 errors: digitalocean ×36,
docker ×10, sendgrid ×6): a later op's `@connect(http:{body:})` selects fields that don't exist
on the input type its argument references. Per-op each body was fine — first isolated catch of
the all-ops column (#122).

**OAS** (`inline-allof-body-collision.yaml` — inline `allOf` bodies, all unnamed → `Input`):
```yaml
/alphas:      post: requestBody: schema: { allOf: [ {props: alpha}, {props: alphaExtra} ] }
/alpha-twins: post: requestBody: schema: { allOf: [ {props: alpha}, {props: alphaExtra} ] }
/bravos:      post: requestBody: schema: { allOf: [ {props: bravo}, {props: bravoExtra} ] }
```

**Example** — before, one definition with two disagreeing consumers; after, each shape its own:
```graphql
input InputInput { alpha: String alphaExtra: String }
createAlphas(input: InputInput!)       # keeps the name
createAlphaTwins(input: InputInput!)   # identical body still converges on it
createBravos(input: BInputInput!)      # different body renames — was InputInput → INVALID_BODY
```

**Cause:** inline `Obj` bodies rename on collision and `Union` bodies are store-guarded
(#104/#112) — `Composed.visitAllOfNode` stored its name unconditionally, so a second inline
`allOf` body converged on the first's stored name with no shape check.

**Fix:** the same `ownedByOtherSide` / `collidesWithStoredType` / `resolveNameConflict` block
`Union.visit` got for #104/#112, at `visitAllOfNode`'s store site, scoped to
`this.parent instanceof Body`. Identical bodies still converge (`isSameInlineDefinition`: same
id + equal schemas); a different one takes `BInput`, `BInput2`, … (#104's family). The op's
argument line and its `body:` selection follow automatically (both read the body payload node).

**Measured-inert evidence (why the guard is Body-scoped):** applied globally the block is NOT
inert — prop-parented inline comps that converge silently today rename (box churns ~1700/~1300
lines GET/mutations, digitalocean GET 256). Body-scoped, 9 probe specs × both verb sets are
byte-identical; only the intended body renames appear in digitalocean/docker/sendgrid.
Post-fix sweep: docker and sendgrid all-ops flip to OK, `WHOLE:INVALID_BODY` leaves the
histogram, every per-op number unchanged, LINT-CORPUS 0 diagnostics. digitalocean's clear
unmasks `CONNECTORS_UNRESOLVED_FIELD` ×5 (`LoadBalancerRegion.*`) — logged as #124, not part
of this fix.

**Known residual corner (documented, not fixed):** a non-Body `Composed` named `Input` could
still overwrite a body comp's stored entry (its store stays unconditional). No corpus spec hits
it; the all-ops column would catch one.

**Refs:** `src/oas/nodes/comp.ts` (`visitAllOfNode` store guard), `src/oas/nodes/union.ts`
(#104/#112 twin block), `src/oas/nodes/typeUtils.ts` (helpers reused as-is). Fixture
`inline-allof-body-collision.yaml`, test `test_123_second_inline_allof_body_renames_instead_of_converging`
(tests/all/r3-naming.test.ts). See #104, #112, #122, #124.


## 108 · A map whose values are `anyOf: [enum, string]` drops the whole property — ✅ Fixed

**Symptom:** confluence's real `POST /content/convert-ids-to-types` generated a response type with
zero fields — invalid GraphQL on its own — and an empty selection.

**OAS** (confluence — a map whose values pick between an enum and a plain string):
```yaml
ContentIdToContentTypeResponse:
  properties:
    results:
      type: object
      additionalProperties:
        anyOf:
          - { type: string, enum: [page, blogpost, attachment, footer-comment, inline-comment] }
          - { type: string, description: "Custom content types" }
```

**Example:**
```graphql
# before — the property (and its whole selection) vanish
type ContentIdToContentTypeResponse {
}

# after — the map degrades to JSON, like #86's array-of-plain-values case
type ContentIdToContentTypeResponse {
  results: JSON
}
```

**Cause:** `Map.visitAdditionalProperties` called `Factory.fromSchema` on the value schema
unconditionally. For a 2-member `anyOf` of plain values, `fromSchema`'s "maybe-empty anyOf"
collapse only fires with exactly one real member, so it fell through to building a plain `Union` of
scalar/enum members — never legal GraphQL on its own. `T.isLeaf` has no `Union` case, so
`T.isWholeMapValue` answered `false`, so the selection collector never added the property's path —
the whole thing disappeared instead of erroring.

**Fix:** `Map.visitAdditionalProperties` now checks `Schemas.holdsPlainValues` (the same helper
`Factory.fromArrayItems` already uses for #86's array case) before calling `Factory.fromSchema`,
and degrades straight to `Scalar('JSON')` when it matches.

**Measured:** `confluence-full.json`'s full production selection gains exactly one new reachable
type (`map:type:ResultsEntry`, previously unreachable since the property vanished) — `327 → 328`.
No other type moves.

**Refs:** `src/oas/nodes/map.ts` (`visitAdditionalProperties`), `src/oas/utils/schemas.ts`
(`holdsPlainValues`, #86's precedent). Fixture `map-value-anyof-enum-string.yaml`, test
`test_108_map_with_anyof_enum_or_string_values_drops_the_map_and_selection`. See #86, #93/#95
(map value-type family).

**Correction (2026-08-19).** `test_108_confluence_full_production_selection` pinned
`composeFederationVersion: '2.14.0'` but, unlike `test_73`/`test_109`, never set `forceRover:
true` — `compose()` prefers a local patched composer binary when present, and that binary ignores
`federation_version` entirely, so the `2.14.0` pin was inert: the test never actually composed
against a real pre-2.15 plugin. Adding `forceRover: true` at `2.14.0` fails for real (322
`CONNECTORS_UNRESOLVED_FIELD` errors — the same #14/#16 mechanism #109 documents), confirming this
map fix was never the issue; composing at `2.15.1` (the suite's normal default) passes clean. Same
mistake as #109, just not propagated to this test.


## 109 · Omni's full spec failed with hundreds of unresolved fields — misdiagnosed; the real cause was a stale composer-version pin — ✅ Fixed

**Symptom:** generating Omni's real, full, unfiltered `openapi.json` and composing failed with
**359–361 `CONNECTORS_UNRESOLVED_FIELD` errors across ~71 types**. One traced case
(`AiGenerateQueryResponse`) had a `@connect(selection:)` that named every field correctly by
inspection, yet rover still reported all of them unresolved — looked like a parse/attach mystery.

**Cause:** the test pinned `composeFederationVersion: '2.14.0'` to match the schema's own `@link`
version, on the premise that they "must match." That premise was the actual bug: composition
tooling is backward-compatible with older `@link` declarations by design, and composing below
**2.15** loses two already-fixed-upstream credits — #14's `->entries` map transform and #16's
`field? { nested }` optional marker — which cascade into "unresolved" for everything nested
beneath. `AiGenerateQueryResponse`'s selection uses both patterns; that's the whole "mystery."

**Fix:** `test_109_omni_full_production_selection` composes at `composeFederationVersion: '2.15.1'`
(the suite's normal default) instead of pinning to the schema's own `@link` version. Confirmed
directly: the identical, byte-for-byte generated SDL goes from 361 errors at `2.14.0` to zero at
`2.15.1`. `servicePrefix: 'omni'` and `forceRover: true` stay — real, needed (`--service-prefix` is
a flag production always passes; the local composer ignores `federation_version` entirely).

**Not this issue's mechanism:** the original "cause not established" framing, and the standalone
`AiGenerateQueryResponse` trace, were both artifacts of the version-pin mistake, not a distinct
generator bug. #73's identical mistake was found independently the same day, on stripe's schema.

**Refs:** `tests/all/oas-core.test.ts` (`test_109_omni_full_production_selection`), `docs/FIXED.md`
#14, #16 (the credits lost below 2.15). See #73 (same mistake, same day), #127 (a real bug this
correction unmasked — a different, genuine defect that was hiding behind the same 361 errors).


## 110 · An array of a shapeless `$ref` in a request body was dropped, not degraded to `[JSON]` — ✅ Fixed

**Symptom:** PagerDuty's real `PUT /incidents/{id}/merge` generated `input InputInput { }` — zero
fields — and `body: """ $args.input { } """` — empty.

**OAS** (pagerduty — the body's one property is an array of a shapeless ref):
```yaml
requestBody:
  content:
    application/json:
      schema:
        properties:
          source_incidents:
            type: array
            items: { $ref: '#/components/schemas/IncidentReference' }
IncidentReference:
  type: object
  additionalProperties: true   # no declared properties — "shapeless"
```

**Cause:** `Factory.fromArrayItems` checked `Schemas.isShapelessObject` on the *raw, unresolved*
items schema. A bare shapeless ref correctly degrades to `JSON` standalone, but as an array's
`items` the `$ref` was still present when the check ran — `isShapelessObject` requires `$ref ==
null`, so it always failed for a ref'd item regardless of what it resolved to. It fell through to
`Factory.fromSchema`, which resolved the ref but routed on `type === 'object'` *before* reaching
its own shapeless check, building a plain empty `Obj` — which has no selectable leaf path as an
array item, so the whole property vanished.

**Fix:** `Factory.fromArrayItems` now resolves a `$ref` before the `isShapelessObject` check, the
same call-site idiom `get.ts` already uses for response-root schemas. Widened its parameter type to
`SchemaObject | ReferenceObject` to match `fromSchema`'s own signature (both existing callers
already passed that looser type).

**Measured:** no type-count change anywhere — a `Scalar` dependency adds no new emittable type, and
`unwrapRedundantArrayItems`'s existing ref-to-array unwrapping already stripped the `$ref` before
this code ran for that case, so it's unaffected.

**Refs:** `src/oas/nodes/factory.ts` (`fromArrayItems`), `src/oas/nodes/get.ts` (the resolve-before-check
precedent). Fixture `array-of-shapeless-ref-body-prop.yaml`, test
`test_110_array_of_shapeless_ref_body_prop_is_not_dropped`.

**Correction (2026-08-19).** `test_110_pagerduty_full_production_selection` had the same inert-pin
bug as #108: `composeFederationVersion: '2.14.0'` without `forceRover: true`, so it never composed
against a real pre-2.15 plugin. Adding `forceRover: true` at `2.14.0` fails for real — but on a
different error than #108/#109's field-resolution cascade: `INVALID_SELECTION`, a `nom` parser
error on `Query.incidents`'s selection, at the `??` default-coalesce syntax (`enabled: enabled ??
$(false)`) — a pre-2.15 plugin's connectors parser doesn't recognize it. Composing at `2.15.1`
passes clean. Same category as #108/#109 (composing below 2.15 breaks on syntax/behavior the older
plugin doesn't support), different specific gap.


## 125 · A field declared but never actually selected reached the SDL as a real, unprovided field — ✅ Fixed

**Symptom:** the same failure shape as #89 — `CONNECTORS_UNRESOLVED_FIELD: No connector resolves
field 'X.y'` — but for a field no route ever selects at all, not one lost to a cycle on some routes
and kept on others. #89's own entry flagged this as future work: *"Not fixed here: `Composed` never
consulted the overrides... a removed-and-kept field surfacing through an allOf would need the same
lookup in `comp.ts`."* This closes that gap, and a second one next to it — a field that's simply
never in any route's own selection (e.g. stripe's `Customer.sources`, declared on the schema but no
connector picks it) fell through #89's `removed`/`kept` check entirely: with no route ever recording
it as either, `!removed.has(name)` was true and the check returned early, so the field never got
commented out and stayed a real, always-unresolvable SDL field.

**Cause:**
- #89's fix only ever consulted `context.propOverrides` from `Obj.generate`/`select`/`dependencies`
  — `Composed` had no equivalent lookup, exactly as its own entry predicted.
- #89's `removed`/`kept` maps were only populated by routes that actually visited a field (kept it,
  or lost it to a cycle); a field no route's traversal ever reaches shows up in neither map, so the
  "removed on one route AND kept on another" check never fires for it — the field just never gets
  flagged at all.
- `TypesCollector.collect`'s reachability loop (#26) also only ran once — but commenting out a field
  can itself drop a type's only path to something else, so a single pass could miss types that only
  became unreachable *because* of a field this same commit removes.

**Fix:**
- `T.isFieldOwner` (`Obj | Composed`) replaces the old `instanceof Obj` guard everywhere
  `context.propOverrides` is read or written, bringing `Composed` to parity with `Obj` for #89's
  original mechanism.
- A new pass, `removeFieldsNeverSelected`, walks every field-owning type's own declared props
  (`dependencies(context, expanded)`) and comments out (same `PropCircRef`-swap `commentOutField`
  #89 already uses) any prop the route walk (`walkKeptAndRemoved`, #89's walk factored out and
  reused) never recorded as kept by any route — not just ones recorded as removed by some.
- `collect()`'s reachability-pruning loop now iterates to a fixed point
  (`for (let removedAny = true; removedAny; )`), re-running `collectReachable` and
  `removeFieldsNeverSelected` together until a pass changes nothing — since commenting out a field
  can shrink reachability, and shrinking `pendingTypes` can change what a field-owner's own
  `dependencies()` returns next time. Terminates: overrides only ever accumulate (never removed),
  bounded by the spec's finite field/type count.

**Measured:** no dedicated isolated fixture/test — this pass runs unconditionally inside every
`collect()` call, so it's exercised by the full suite (389 tests, 0 failures) rather than a single
repro case. Traced by code review, not independently reproduced against a live `Customer.sources`-shaped
spec.

**Refs:** `src/oas/generator/typesCollector.ts` (`removeFieldsNeverSelected`, `walkKeptAndRemoved`,
`commentOutField`, the fixed-point loop in `collect`), `src/oas/nodes/typeUtils.ts`
(`T.isFieldOwner`), `src/oas/nodes/comp.ts` (`generate`/`select`/`dependencies` now consult
`propOverrides`, matching `obj.ts`). See #89 (the original mechanism and its own "not fixed here"
note), #26 (the reachability walk this reuses).


## 129 · The all-ops coverage sweep double-counted every compose error — ✅ Fixed

**Symptom:** found auditing #126's box.yaml numbers — `COVERAGE.md`'s `all-ops` column reported
`box.yaml` at `GRAPH_QL_ERROR ×18` (GET) / `×10` (mutations); real `rover supergraph compose`
against the same generated schema reported `error[E029]: Encountered 9 build errors` / `5 build
errors`. Confirmed systemic on two other specs too: asana's reported `×12` was really 6, digitalocean's
reported `×2` was really 1 — every spec's `all-ops` figure in `COVERAGE.md`/`COVERAGE-mutations.md`
was exactly 2x the real count.

**Cause:** `compose()` (`tools/coverage-spec.mts`) built its captured error text as
`${e.stdout}\n${e.stderr}\n${e.message}`. Node's `child_process.exec` (promisified) constructs a
failed exec's `.message` as `"Command failed: <cmd>\n" + stderr` — i.e. `.message` already
re-embeds the full `stderr` text. `wholeVerdict()` (`tools/coverage-verdict.mts`) then does a
*global* regex scan (`matchAll`) over that concatenated string to tally each error code's
occurrences, so every real error line was counted once via `stderr` and again via the copy inside
`message` — doubling every tally. Per-op composition (`compose()`'s own `inner`/`outer` code
extraction, a few lines below) wasn't affected — it only reads the *first* match, so which code got
reported per-op was still correct; only the aggregate `all-ops` counts were wrong.

**Fix:** drop `e.message` from the concatenated string — `e.stdout`/`e.stderr` alone already carry
everything real, and `.message` is a redundant wrapper for this specific rejection shape.

**Effect on prior measurements:** any `all-ops` count recorded in `docs/issues.md`/`docs/FIXED.md`
before 2026-08-19 is 2x inflated (e.g. #126's own "34→18" was really "17→9" — corrected in that
entry). Historical *comparisons* (before/after a fix) stay directionally valid since both sides were
inflated equally; absolute counts don't.

**Refs:** `tools/coverage-spec.mts` (`compose()`), `tools/coverage-verdict.mts` (`wholeVerdict`).
Found and fixed while auditing #126's box.yaml residue.


## 126 · An inline-minted `Composed` name collided with a same-class real component — ✅ Fixed

**Symptom:** PagerDuty's full spec failed compose:
```
INVALID_GRAPHQL: [test_spec] Error: the type `User` is defined multiple times in the schema
```

**OAS** (pagerduty — `user` is an inline allOf, `User` is a real, unrelated component):
```yaml
IncidentNote:
  properties:
    user:                                   # inline allOf -> Composed, minted name "User"
      allOf:
        - { $ref: '#/components/schemas/Reference' }
        - { type: object, properties: { type: { enum: [user_reference, bot_user_reference] } } }
components:
  schemas:
    User:                                    # real component -> Composed, id from the $ref pointer
      allOf: [...]
```

**Cause:**
- `Composed.updateName` mints an inline allOf's name from its property key (#7):
  `Naming.genTypeName(Naming.getRefName('user'))` -> `"User"`.
- `Composed.visit` only collision-checked `collidesAcrossNodeClasses` — it renames when the stored
  occupant is a *different* node class only. Here both sides are `Composed` (same class), so no
  rename fired — #22's documented, deliberate scope: a same-class rename was tried once and
  reverted (box regressed 85->76, description-only twins got incorrectly split apart by visit order).
- #22's same-class case relied on the collector deduping by id — safe there because every instance
  minted from one property key shares one id. This case has no such safety net: the minted
  instance's id (`comp:type:User`) and the real component's id (`comp:type:#/components/schemas/User`)
  are different strings, so the collector kept both — two definitions that only collide once
  `Naming.genTypeName` renders them.

**Fix:** `T.collidesWithReservedComponentName` (already existed for #100's `Obj`-only case, reading
the static parsed spec's own `#/components/schemas` namespace rather than the mutable, visit-order-
dependent `context.types`) broadened to also accept `Composed`, wired into `Composed.visit`'s
existing `Prop`-gated check alongside `collidesAcrossNodeClasses`. Order-independent by
construction — an id-based `context.types` check was considered and rejected: PagerDuty's own
selection visits the inline mint before the real component, so no occupant would be stored yet at
rename-check time.

**Box regression checked** (`#22`'s exact concern): box has ~13 more instances of this same
`inline-property-name` collision pattern (`folder`→`Folder`, `file`→`File`, etc.), one already
concretely verified — `GroupMembership.user` renames to `GroupMembershipUser`, referenced correctly,
and the real `User` component keeps its own name. Aggregate: box's whole-spec `GRAPH_QL_ERROR` count
dropped **17→9** (2026-08-19 correction: the tool that measured this, `tools/coverage-spec.mts`,
double-counted every error — the entry originally read "34→18"; both figures were 2x inflated, see
`#129`). No new/different error codes. The other ~12 names weren't individually audited. The 9
remaining errors are a *different*, already-known problem — `#22`'s own same-class inline-vs-inline
collision (two unrelated shapes sharing one property-key-derived name, not colliding with a real
component), confirmed unrelated to this fix's scope. See `#22`'s reopened entry.

**Refs:** `src/oas/nodes/comp.ts` (`visit`), `src/oas/nodes/typeUtils.ts`
(`collidesWithReservedComponentName`, broadened guard). Fixture
`composed-vs-component-name-collision.yaml`, test
`test_126_inline_allof_prop_must_not_collide_with_real_component` (both visit orders, mirroring
#100's own dual-order discipline). See #22 (the same-class scope decision and its box regression),
#9/#12/#18 (the original `Obj`-only collision machinery), #100 (the reused mechanism).


## 127 · A numeric JSON default on a `string`-typed param wrote an unquoted default value — ✅ Fixed

**Symptom:** Omni's full spec failed compose under federation plugin 2.15.1 (2.14.0 let it through
silently — see #109):
```
INVALID_GRAPHQL: [test_spec] Invalid default value (got: 100) provided for argument
Query.omni_apiScimV2EmbedUsers(count:) of type String.
```
8 occurrences, all the same shape: `apiScimV2Groups`/`apiScimV2Users` (`count`/`startIndex`),
`apiV1ModelsByModelIdYaml` (`fullyResolved`, a boolean default), `apiV1Schedules` (`cursor`).

**OAS** (omni — the param's own `default` doesn't match its declared `type`):
```yaml
count:
  in: query
  schema:
    type: string
    pattern: '^-?\d*\.?\d+$'
    default: 100     # a JSON number, not "100" — the spec's own authoring inconsistency
```

**Cause:** `Param.writeDefaultValue` branched on the JS `typeof` of the raw `schema.default` value,
never on the argument's own declared GraphQL type. `default: 100` under a `string`-typed schema hit
the `typeof value === 'number'` branch and wrote `String = 100` (invalid) instead of `String =
"100"`; `default: false` under the same `type: string` hit the boolean branch the same way.

**Fix:** `writeDefaultValue` now checks the param's own resolved GraphQL scalar first
(`this.resultType`, a `Scalar` built in `visit()`): if it's `String` and the raw default is a JS
`number` or `boolean`, force-quote it. Every other case — including a `String` param's ordinary
`string` default, or any value under a non-`String` scalar — falls through to the original,
unchanged `typeof` branches in the same order.

**Measured:** `test_param_default_boolean_emits_literal`'s two existing cases are untouched
(`Boolean`/`Int` scalars never take the new branch) — traced, not just re-run.

**Refs:** `src/oas/nodes/param.ts` (`writeDefaultValue`). Fixture
`param-default-type-mismatch.yaml`, test
`test_127_string_typed_param_quotes_a_mismatched_numeric_or_boolean_default`. See #109 (the
composer-version correction that unmasked this).


## 131 · A mixed anyOf[string, object] array item silently drops the string branch — ✅ Fixed

**Symptom:** an "expandable" API field — unexpanded, a bare ID string per item; expanded, full
objects — loses the string branch entirely, generating a selection that assumes every item is an
object. At runtime, the unexpanded response comes back empty/wrong instead of the ID string a
caller actually needs. Found via graphos-service-factory's PagerDuty/Stripe connector-unit tests.

**OAS** (the real shape of Stripe's `expand[]`, and PagerDuty's equivalent):
```yaml
owners:
  type: array
  items:
    anyOf:
      - { type: string, maxLength: 5000 }
      - $ref: '#/components/schemas/Owner'        # { id, name }
      - $ref: '#/components/schemas/DeletedOwner'  # { id, deleted }
```

**Example:**
```graphql
# before — the string branch vanishes; every item is assumed to be an object
owners: [OwnersUnion]
# selection: owners? { id? name? deleted? }

# after — a mixed choice degrades to JSON, like #86's all-plain case
owners: [JSON]
# selection: owners?
```

**Cause:** `Factory.fromArrayItems` only degraded an `anyOf`/`oneOf` array item to `JSON` when
*every* member was a plain value (`Schemas.holdsPlainValues`) — correctly, by that check's own
design. A *mixed* choice (2 of 3 members real objects here) fell through to `Factory.fromSchema` ->
`createContainerType`, building a plain, discriminator-less `Union`. `Union.consolidate()` walks
each member's own `.props` into one merged object; the `String` Scalar member has no `.props`, so
it contributed nothing — the merge silently kept only the object members' fields
(`{ id, name, deleted }`), and the selection assumed every item matched that shape. The general
case of #108 (map value `anyOf` of only plain values), inverted: #108 was *all* members plain,
correctly caught; this is a *mix*, which `holdsPlainValues`'s `every` deliberately doesn't touch.

**Fix:** new `Schemas.holdsMixedPlainAndObjectValues` (true when a choice has at least one plain
member and at least one real, non-shapeless object member), checked in `Factory.fromArrayItems`
right after the existing `holdsPlainValues` check — degrades straight to `Scalar('JSON')`, the
same "can't cleanly represent in GraphQL" answer #19/#77/#86/#108/#110 already established, instead
of a real 3-way union with a synthetic scalar-wrapper member (a much bigger change, not attempted).

**Measured:** the fixture's `owners` field drops from 2 reachable types (`Thing` + the merged
`ownersUnion`) to 1 (`Thing` only) — the union no longer gets built at all once the array item
degrades directly to a scalar.

**Not touched — confirmed safe, not just assumed:** `Factory.fromSchema` itself and every other
caller through it (`Map` values, `Union` members, `Param` types, `Composed`/allOf members, plain
non-array properties). `Factory.fromProp`'s branches don't check `anyOf` either, so a plain
property shaped this way already falls to its own `PropScalar(..., 'JSON', ...)` catch-all today.
Whether those other paths can hit the same mixed-anyOf defect is undemonstrated (no repro, no
failing test) — a separate follow-up if one turns up, not folded in here.

**Refs:** `src/oas/nodes/factory.ts` (`fromArrayItems`), `src/oas/utils/schemas.ts`
(`holdsMixedPlainAndObjectValues`, next to `holdsPlainValues`). Fixture
`array-of-anyof-string-or-object-loses-string-branch.yaml`, test
`test_array_of_string_or_object_loses_the_string_case`. See #86, #108 (the same "degrade to JSON"
precedent, the all-plain case this generalizes).

## 105 · A 3-member anyOf's merged type silently drops a member the selection still names — ✅ Fixed, as a side effect of #131

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

**Cause was never pinned down as its own mechanism** — #131 was found and fixed the same day for
a different reported field (PagerDuty/Stripe's `owners: anyOf[string, Owner, DeletedOwner]`,
`expand[]`-style fields in general), and it turned out to be the exact same trigger shape as this
entry's `discounts`: a list item mixing one plain scalar with real object members. #131's new
`Schemas.holdsMixedPlainAndObjectValues` check (see `docs/FIXED.md #131`) now degrades `discounts`
straight to `[JSON]` before the buggy merged union is ever built, so the union that used to drop
`deleted` is never constructed. This entry stays honest about that: no dedicated fix landed here,
and the original investigation's own leads were dead ends —
- Not the `anyOf: [member, {}]` shapeless-member collapse (`factory.ts:80-87`, #20) — all three
  members here are real object/scalar shapes.
- Not `Union.dedupedSelectedProps`'s incompatible-kind guard (`union.ts:222-243`, #39/#44) — that
  replaces a colliding field with `JSON`, it does not drop the member outright.
- One real structural difference was found and ruled out: `discount`/`deleted_discount` has its
  own nested 3-member `anyOf` (`customer: anyOf[string, $ref customer, $ref deleted_customer]`),
  unlike the structurally similar working case `tax_id`/`deleted_tax_id` (plain scalars only). That
  nesting turned out not to matter — #131's fix fires on the outer array-item shape regardless of
  what the object members contain.

**Verified against the real, tracked fixture** (`tests/resources/oas/stripe-curated.yaml`), two
ways:
- `test_73_curated_multi_op_stripe_selection_composes` passes cleanly.
- The generated schema's `invoice`/`subscription`/`subscription_item`/`invoice_line_item`
  `discounts` fields all read `[JSON]!`, and `DiscountsUnion`/`InvoiceDiscountsUnion` appear
  nowhere in the schema — reverting #131's `holdsMixedPlainAndObjectValues` check brings both union
  types back, confirming the assertion is load-bearing.

**Refs:** see `docs/FIXED.md #131` for the fix itself. `src/oas/nodes/union.ts` (`visit`, `add`,
`generateMergedObject`), `src/oas/nodes/factory.ts` (`fromArrayItems`). #106 (the selection-linter
gap #105 surfaced) is a separate, still-open issue — its blind spot is real for other cases even
though this one is fixed.

## 133 · Four JSON-degrade sites now flag themselves in the generated schema, not just the build log — ✅ Fixed

**Symptom:** `warn()` already logged why a field gave up and became `JSON` (the standing rule from
2026-08-19), but that reason never reached anyone reading the schema itself — Apollo Studio,
GraphiQL, introspection, or a person scrolling the SDL saw a bare `JSON` field with no clue why.

**OAS** (docker-engine-shaped map in a request body — `factory.ts`'s A7):
```yaml
labels:
  type: object
  additionalProperties: { type: string }
```

**Example:**
```graphql
# before
labels: JSON

# after
"""
NEEDS ATTENTION: a map (object with arbitrary keys) can't be an input type in GraphQL — sent
as raw JSON instead of a typed structure.
"""
labels: JSON
```
The same text also reaches `warn()`, from one shared local variable at each site — a test asserting
the docstring and a test asserting the log line check the same string, so they cannot drift apart.

**Fix:** new `Schemas.withDegradeNote(schema, reason)` (`src/oas/utils/schemas.ts`, next to
`isMap`/`holdsMixedPlainAndObjectValues`) returns a copy of the schema with
`"NEEDS ATTENTION: <reason>"` appended to its `description` (or set as the whole description, if it
had none) — never mutated in place, since `context.lookupRef` can hand the same `SchemaObject`
instance to other callers. `Prop.generate()` already writes `this.schema.description` before the
field's value (`prop.ts:20-33`); the 4 sites below just had to pass the noted schema into the `Prop`
they were already constructing, no new writer plumbing:
- `factory.ts` **A7**/**A8** (`fromProp`, the typed and untyped branches of the same trigger): a map
  in GraphQL input position — same reason text both times.
- `factory.ts` **A9** (`fromProp`'s catch-all): a property whose shape matched no known pattern.
- `union.ts` **C2** (`dedupedSelectedProps`): two merged union members give the same field name
  incompatible kinds (see #39/#44) — `warn(null, '[union]', reason)`, matching this codebase's own
  precedent for a site with no `context` in scope (`factory.ts:60`'s dangling-`$ref` warn).

**Also fixed, found while building A8's fixture (unrelated to the note feature):** an
`additionalProperties`-only schema with **no `type` key** made `Factory.fromSchema` throw
(`createScalarType`'s catch-all `throw new Error('Cannot handle schema ...')`) instead of resolving
to a map — `fromSchema`'s container-type dispatch only recognised `Schemas.isMap()` when
`type: 'object'` was also present. Confirmed pre-existing: the same untyped-map fixture crashes
identically against unmodified `factory.ts`, with or without this phase's change. Fix: added
`Schemas.isMap(schemaObj)` to that dispatch condition (`factory.ts`, the `fromSchema` container-type
check) — an untyped map now takes the same `createContainerType` -> `Map` route the typed case
already took. One line, no behaviour change for any schema that already carried a `type`.

**Confirmed `withDegradeNote` appends, not replaces:** `map-input-suffix.yaml`'s `labels` property
was given a real OAS `description` (`key/value labels attached to the snapshot`); the generated
field carries both the original text and the new note in one `"""..."""` block, in that order.

**Tests** (each: SDL assertion for the docstring + `console.error` spy asserting `warn()`'s exact
3-argument call shape — `arguments[1]` the file tag, `arguments[2]` the reason, not a substring
check, since `runOasTest`'s own success-path `console.error(schema)` dump would otherwise also
contain the reason text once it's embedded in the SDL):
- `test_84_body_map_is_sent_as_json` (`map-input-suffix.yaml`) — A7, plus the append-not-replace check.
- `test_untyped_input_map_degrades_to_json_with_note` (new fixture `untyped-input-map.yaml`) — A8.
- `test_unrecognised_shape_degrades_to_json_with_note` (new fixture `unrecognised-shape.yaml`) — A9.
- `test_R2_union_merge_kind_collision_degrades_to_json` (`r2-union-nested-in-list.yaml`,
  `tests/all/r2-abstract.test.ts`) — C2.

Reverting `Schemas.withDegradeNote` and its 4 call sites reproduces every one of these assertions
failing (confirmed, not assumed) — including A8, which reproduces the pre-existing `fromSchema`
crash rather than a missing-docstring assertion failure, since that bug blocks generation entirely.

**Not done here:** 13 more JSON-degrade sites across `factory.ts`, `map.ts`, `union.ts`, `propObj.ts`
give no schema-level signal yet — each needs its own new writer plumbing (no `Prop` to hang a
description on, or the decision happens after the description already wrote). Tracked as
`docs/issues.md #132`, not folded in here.

**Refs:** `src/oas/utils/schemas.ts` (`withDegradeNote`), `src/oas/nodes/factory.ts` (`fromProp`,
`fromSchema`), `src/oas/nodes/union.ts` (`dedupedSelectedProps`). See #39/#44 (C2's kind-collision
precedent), #131 (the `withDegradeNote`-adjacent `holdsMixedPlainAndObjectValues`, same file), #132
(the 13 deferred sites).

## 128 · A pinned `composeFederationVersion` without `forceRover` composes against the wrong plugin — ✅ Fixed

**Symptom:** `compose()` (`src/tests/runners.ts`) prefers a gitignored local patched composer
(`tools/local/apollo-federation-cli`) over real Rover unless `forceRover: true` is set — and that
local build ignores `federation_version` entirely (patched past 2.15). A test that pins
`composeFederationVersion` below 2.15 without also setting `forceRover: true` never actually
composes against that older plugin — its pin is inert, and it silently passes regardless of real
pre-2.15 incompatibilities.

**Confirmed instances found before this audit, all three already fixed:**
`test_108_confluence_full_production_selection` and `test_110_pagerduty_full_production_selection`
both had this gap — real composition at `2.14.0` failed for real (confluence: 322
`CONNECTORS_UNRESOLVED_FIELD`, the same #14/#16 mechanism #109 hit; pagerduty: a `nom` parser error
on `??` default-coalesce syntax, a different specific gap in the same category). A third,
`test_recursive_schema_cut_composes_abstract_pass`, failed the same way at `2.14.3` on
`CONNECTORS_UNRESOLVED_FIELD: No connector resolves field 'Shared.label'` (the #16
optional-marker-on-nested-object gap via a different fixture). All three fixed the same way:
`forceRover: true` + bump `composeFederationVersion` to `2.15.1`.

**Full audit (2026-08-20), the remaining 15 sites:** grepped fresh — 22 real
`composeFederationVersion` pins total across `tests/all/oas-core.test.ts` (8) and
`tests/all/r2-abstract.test.ts` (14); 7 already had `forceRover: true` from the work above. Method
per site: confirm via the `run-rover.sh` scratch script (`compose()` already writes the exact
command run, naming either the local binary or real rover) that the local composer was in use
without the flag, add `forceRover: true`, keep the existing version pin, rerun.

- `test_entity_resolver_with_errors_emits_wellformed_schema` (`oas-core.test.ts`, pinned `2.14.3`):
  confirmed via the scratch script it was silently running the local composer despite a prior note
  claiming this was already checked — that note was stale, not the code. With `forceRover: true`
  added, confirmed the switch to real rover via the same script, then reran: passes clean at real
  `2.14.3`. Pin was accurate.
- All 14 `composeFederationVersion: '2.15.1'` pins in `tests/all/r2-abstract.test.ts`
  (`test_R2_*`): same treatment, all 14 pass clean against real Rover at `2.15.1`. No `#14`/`#16`
  gap or any other real composition defect found at any site.

**Outcome:** all 22 pins across the suite now carry `forceRover: true`; every one was verified
against real Rover and passes. No new bugs found, no site left with the silent bypass.

**Also resolved:** whether graphos-service-factory's production deploy can actually run composer
`2.15.1` — confirmed yes. `mdg-private/constellation-registry`'s real CI
(`connector-validation.yml` → `run-tests.sh` → `rover supergraph compose --config
supergraph.yaml`, Rover installed via `.../nix/latest`) has no external version ceiling; nothing
blocks committing `=2.15.1` in a service's own `supergraph.yaml`.

**Verified:** full suite (`oas-core.test.ts` + `r2-abstract.test.ts`) green — 200 pass, 0 fail, 2
todo (both pre-existing and unrelated: `#120`'s bare-enum-response case, and
`test_61_sanitised_at_type_must_not_collide` — the latter currently passes despite its stale
`{todo}` marker, a separate small cleanup outside this audit's scope). Rover
0.41.0 used throughout; `--elv2-license accept` already present in `compose()`, no ELv2 rejection
seen.

**Refs:** `src/tests/runners.ts` (`compose()`, `localComposer()`), `tests/all/oas-core.test.ts`,
`tests/all/r2-abstract.test.ts`. #108, #109, #110 (the confirmed instances and the shared #14/#16
mechanism), #73 (the same mistake, independently).

## 111 · `--service-prefix` crashes the whole CLI on SDL its own generator already wrote invalid — ✅ Fixed

**Symptom:** whenever the raw, pre-prefix SDL is already invalid GraphQL (an empty `type`/`input`
body — `#108`, `#110`, and presumably any future case in the same family), adding
`--service-prefix` turned a silent bad-output bug into a hard process crash:
```
GraphQLError: Syntax Error: Expected Name, found "}".
    at syntaxError (…/graphql/error/syntaxError.js:31:10)
    …
Node.js v26.7.0
```
Without `--service-prefix`, the same input just printed the (already broken) SDL and exited 0 — no
crash, no error, silently wrong.

**Cause:** `OasGen.generateSchema()` (`src/oas/oasGen.ts`) never validated its own raw output was
parseable GraphQL before optionally piping it through `Directives.apply()`/`Namespace.apply()`
(`src/oas/lint/directives.ts`, `src/oas/lint/namespace.ts`) — both call graphql-js's `parse(sdl)`
completely unconditionally, no try/catch. An uncaught `GraphQLError` from whichever ran first took
the whole process down with a raw stack trace instead of naming the real problem.

**New finding, not in the original report:** `Directives.apply` has the *identical* unguarded-parse
crash risk as `Namespace.apply` — it also calls `parse(sdl)` with zero error handling. It had never
been hit in practice because nobody had combined `--directives` with a spec that produces invalid
SDL. A fix scoped only to `--service-prefix` would have left this sibling crash site open.

**Fresh repro:** a plain object property whose schema is a bare `oneOf` of scalar/enum members —
`Factory.fromProp` used to build a `Union` of those members unconditionally, with no
`Schemas.holdsPlainValues`-style guard (unlike `fromArrayItems`'s own map/array-item equivalents,
#108/#110/#131). A union of scalars has no selectable leaf form, so the property's path never
reached the flattened selection list, the whole owning type became unreachable, and the operation's
own return type printed blank: `widgetsById(id: String!): ` — invalid GraphQL on its own. Filed as
**#134**, reused here as this fix's regression fixture. #134 is now itself fixed (see its own
`docs/FIXED.md` entry) — this issue's own test found a second, independent way to reach the same
symptom once #134 stopped reproducing it (see "Second review round" below).

**Fix (two independent gates, not one — Codex review, round two):**
1. `generateSchema()` validates `writer.flush()`'s raw output with `parse()` right after generation,
   before `Directives.apply`/`Namespace.apply` run — the first line of defense, closing the crash
   and the silent-bad-output path for the generator's own output.
2. A **second** gate validates the *final* string `generateSchema()` is about to return, after both
   `Directives.apply` and `Namespace.apply` have run (when either is configured). Reason: each of
   those only validates *its own input* before editing it — neither re-checks what its own
   splice/insertion logic produced. Real, reachable gap found by inspection, not invented: a
   user-supplied `--directives` string is only checked for a leading `@`
   (`Directives.parseDeclaration`'s `isDirectiveString`), never parsed — a malformed one (e.g.
   `{ "Widget": ["@tag(name: \"unterminated"] }`) is spliced straight into otherwise-valid SDL
   (`type Widget @tag(name: "unterminated {`), and used to reach `Directives.apply`'s own return
   value unvalidated.
3. `Namespace.apply` still wraps its own `parse(sdl)` call (explicitly asked for in #111's original
   report, so it stays regardless of the two gates above). `Directives.apply`'s equivalent wrap —
   added in the first round, never requested by the original report — was **reverted**: once (2)
   lands, a bug in its own splice logic is caught by the final-output gate anyway, so the extra wrap
   was speculative defense-in-depth with no repro proving it necessary.
4. Both gates' thrown message now includes the `GraphQLError`'s `.locations` (line/column) —
   previously dropped, even though graphql-js computes it, leaving a syntax error unlocatable in an
   often-thousand-line schema.

**Second review round — what Codex's first-pass review caught:** the original round shipped only
gate (1) and both wraps; a second, closer review found the final-output gate (2) was missing
entirely (nothing re-validated what `Directives`/`Namespace` themselves produced), the
`Directives.apply` wrap was unrequested scope creep, `test_72_browse_minted_path_resolves` had been
left `{ todo }`'d rather than actually fixed, and `#134`'s open/closed write-up needed independent
re-verification against the code (see `docs/FIXED.md #136`, itself found and fixed as a result).

**Verified, updated as `#134`/`#136` moved underneath it:** `test_111_invalid_generated_sdl_throws_
a_clear_error_instead_of_crashing` originally exercised the `#134` fixture both with and without
`servicePrefix`; once `#134` and then `#136` were independently fixed, that exact selection stopped
producing invalid SDL, so the test moved to `tests/all/regen.test.ts` (next to
`test_72_browse_minted_path_resolves`, reusing its helpers) as `test_111_bare_leaf_selection_still_
throws_invalid_sdl`, now exercising `docs/FIXED.md #135` instead — the two gates themselves are
unchanged and untouched by that move. `test_111_directives_apply_corrupting_sdl_is_caught_by_the_
final_gate` (`tests/all/oas-core.test.ts`) is the second gate's own failing-first regression: a valid
SDL plus the malformed-directive-string config above, asserting the second gate's distinct error
message. Revert-check on the second gate specifically: disabled, the new test fails with "Missing
expected exception"; restored, it passes again. Full suite (`tests/all/*.test.ts`) green — 0 fail,
only the pre-existing, unrelated `#120`/`test_61` todos remain.

**Refs:** `src/oas/oasGen.ts` (`generateSchema`, `describeParseError`), `src/oas/lint/namespace.ts`
(`Namespace.apply`), `src/oas/lint/directives.ts` (`Directives.apply`). Fixture
`oneof-scalar-members-empties-response-type.yaml` (no longer used by this issue's own test — see
`docs/FIXED.md #136`). #108, #110 (the original, now individually fixed, repro instances),
`docs/FIXED.md #134` (this fix's original regression fixture, now independently fixed),
`docs/FIXED.md #135` (this issue's test's current mechanism, since independently fixed —
`test_111_bare_leaf_selection_still_throws_invalid_sdl` was retired as a result, see that entry),
`docs/FIXED.md #136` (what `#134`'s fixture exercised in between, also fixed).

## 134 · A property whose schema is a bare `oneOf` of plain scalar/enum members vanishes, taking its whole type with it — ✅ Fixed

**Symptom:** a GraphQL `union` can only have Object type members — a `oneOf` of plain scalars/enums
(no discriminator, no object shape) has none, so whatever gets built has no selectable leaf form.
The property disappeared from the flattened selection, its owning type became unreachable, and the
operation's own return type printed blank:
```
widgetsById(id: String!): 
  @connect(... selection: """ """)
```
— invalid GraphQL on its own (`Expected Name, found "@"`). Same failure family as `#108` (map
value) and `#110` (array item).

**OAS** (minimal, not from a real API — not yet found in the corpus):
```yaml
Widget:
  type: object
  properties:
    kind:
      oneOf:
        - { type: string, enum: [alpha, beta, gamma] }
        - { type: string, description: "custom kind" }
```

**Cause:** `Factory.fromProp` built a `Union` unconditionally whenever a property's schema had
`oneOf`, in both the typed branch (`type: object` with `oneOf`) and the untyped branch — neither
checked whether the members were all plain values first, unlike `fromArrayItems`'s
`holdsPlainValues`/`holdsMixedPlainAndObjectValues` guards (`#86`, `#131`). A bare `anyOf` (no
`oneOf`, no `type`) on a property was not reachable through either branch and already fell through
to the safe JSON default (`#133`) — this was specifically about `oneOf`, and about `anyOf` when
`type: object` is also present.

**Fix:** mirrors `fromArrayItems`'s guard — before building the `Union` at either site in `fromProp`,
`Schemas.holdsPlainValues` on the `oneOf` members degrades to `Scalar('JSON')`, `warn()`s, and
carries a `Schemas.withDegradeNote` explaining why (`docs/FIXED.md #133`'s mechanism, same reason
string at both sites): *"a oneOf of only plain scalar/enum values has no GraphQL union member to
build — sent as raw JSON instead."*

**Example:**
```graphql
type Widget {
  "NEEDS ATTENTION: a oneOf of only plain scalar/enum values has no GraphQL union member to build — sent as raw JSON instead."
  kind: JSON
}
```

**Verified against the real regression fixture** (`tests/resources/oas/oneof-scalar-members-empties-
response-type.yaml`, `#111`'s own): given a selection that actually reaches into `Widget`
(`get:/widgets/{id}>**`, not just the bare operation), `kind` now degrades cleanly to `JSON` and
`Widget` composes as valid SDL — confirmed by generating the schema directly, not assumed from the
guard's presence alone.

**Not fixed by this, and did not need to be — a separate, unrelated bug (since also fixed):**
`#111`'s own test (`test_111_invalid_generated_sdl_throws_a_clear_error_instead_of_crashing`, at the
time) selected with `[...gen.paths.keys()]` — the *bare operation key alone*, no property path, no
`>**` — which never reached `Widget`/`kind` at all. That selection shape hit a different bug
entirely (the operation's own response type never got visited — `docs/FIXED.md #136`, filed and
fixed right after this entry), which is what was still making that test's fixture produce invalid
SDL. This fix and that test were never actually testing the same mechanism, despite `#111`'s
original write-up assuming they were — caught by independently re-verifying this entry against the
code rather than trusting the fixture's continued failure as proof #134 was still open. Once #136
was fixed too, `#111`'s test moved off this fixture entirely (see `docs/FIXED.md #111`).

**Refs:** `src/oas/nodes/factory.ts` (`fromProp`), `src/oas/utils/schemas.ts` (`holdsPlainValues`,
`withDegradeNote`). `#108`, `#110`, `#131` (the same empty-type family, already fixed for
map/array), `docs/FIXED.md #133` (the note-and-warn mechanism this reuses), `docs/FIXED.md #136`
(the real mechanism this fix's own regression test relied on, also since fixed — see that entry for
where `#111`'s test moved to), `docs/FIXED.md #111` (the safety net this was originally found while
building).

## 136 · A selection naming only the bare operation (no property path, no `>**`) silently answered an empty schema — ✅ Fixed

**Symptom:** found while re-verifying #134's write-up against the current code (it turned out #134
was already fixed — see its own entry above — so #111's own regression fixture no longer reproduced
#134's mechanism, and had to be re-diagnosed to find out what it *actually* still exercised). A
selection that names only the operation itself, with no property path segment and no `>**` glob —
`generateSchema(['get:/widgets/{id}'])` — answered a fully blank return type:
```graphql
widgetsById(id: String!): 
  @connect(... selection: """ """)
```
— invalid GraphQL on its own, same visible symptom as #134's original report, but a different cause.
Also reachable on a mutation body the same way (`Post`'s `body` has the identical structural
pattern), confirmed with its own separate repro, not assumed from "same shape."

**OAS** (`bare-op-nested-response.yaml`, response has a nested object one level down):
```yaml
/widgets/{id}:
  get:
    responses:
      '200':
        content:
          application/json:
            schema:
              type: object
              properties:
                id: { type: string }
                detail:
                  type: object
                  properties:
                    name: { type: string }
```

**Cause:** `Get.visit()` (`src/oas/nodes/get.ts`) builds the operation's `resultType` (a `Res` node)
but deliberately does not call `.visit()` on it — `visitResponseContent`'s own comment marks this
`// PENDING: do not visit anymore`, moving that to whenever the *selection's own walk* reaches it.
`TypesCollector`'s collect loop (`src/oas/generator/typesCollector.ts`) only calls `gen.expand()` on
nodes it walks *past* — for a selection whose only segment is the operation itself, the walk never
goes past it, so `Res.visit()` never ran and `Res.response` never got set. `Res.dependencies()` then
returned `[]`, so `collectReachable`'s BFS from the selected roots found nothing past the `Res`
wrapper. This failed **silently**, not with the internal consistency error one might expect
(`collectReachable: unvisited type ... — the collect walk missed a reference`) — that check only
fires for `T.isContainer` nodes, and `Res`'s id (`res:r`) is deliberately excluded from
`isContainer` (`obj:`/`comp:`/`union:`/`map:` only), so an unvisited `Res` passed the guard and just
contributed nothing. `Body` (mutation request bodies) has the identical pattern for the same reason.

**Fix:** `PathsCollector.collectExpandedPaths()` (`src/oas/generator/typesCollector.ts`) now treats a
bare-op selection entry (no `Naming.PATH_SEPARATOR` in it at all) the same as that entry with `>**`
appended — the existing, already-proven full-subtree-walk machinery every `<op>>**` selection
already gets (`collectPaths` cascades `gen.expand()` down to the root, then `T.traverse` visits
every descendant). `TypesCollector.collect()` itself needed no change. One condition, in one
function:
```ts
const isBareOp = (p: string) => !p.includes(Naming.PATH_SEPARATOR);
const expands = selection.filter((p) => p.endsWith('>**') || isBareOp(p));
const filtered = expands.map((p) => (p.endsWith('>**') ? p.replace('>**', '') : p));
```
A single `gen.expand()` call on just `resultType`/`body` was tried and rejected first — it runs
`Res.visit()`, exposing the response object as a child, but never visits *that* object, so
generation still came out broken (an empty `type X {}` this time, not a blank return type) — same
defect, one level deeper. The full-subtree walk is what actually closes it.

**Example:**
```graphql
# before: blank return type, invalid on its own
widgetsById(id: String!): 

# after
type Detail { name: String }
type WidgetsByIdResponse { detail: Detail id: String }
widgetsById(id: String!): WidgetsByIdResponse
```

**Ripple effect on `#111`'s own regression test:** `test_111_invalid_generated_sdl_throws_a_clear_
error_instead_of_crashing` relied on exactly this bug to make its fixture produce invalid SDL: fixing
#136 made that selection valid, breaking the test. `generateSchema([])` does not work as a
replacement (`OperationWriter` early-returns on an empty selection, emitting only boilerplate with no
`Query` type at all — `parse()` never complains, since a missing root type is a schema-build concern,
not a syntax one — confirmed, not assumed). Replaced with `docs/FIXED.md #135` (a different
mechanism, since independently fixed): the test moved to `tests/all/regen.test.ts`, next
to `test_72_browse_minted_path_resolves` (reusing its `mintPath`/`deepExpand`/`freshGen` helpers) as
`test_111_bare_leaf_selection_still_throws_invalid_sdl` — browses `/v2/apps` on `digitalocean.yaml`
first to drift-rename the deployments subtree, mints the literal leaf path with no `>**`, and asserts
`generateSchema([minted])` still throws `[gen] generated an invalid GraphQL schema`, both with and
without `servicePrefix` set.

**Verified:** `test_136_bare_op_selection_visits_the_full_response_subtree` (new fixture
`bare-op-nested-response.yaml`) and `test_136_bare_op_selection_visits_the_full_mutation_body` (new
fixture `bare-op-nested-body.yaml`, a POST body with the identical nested shape) both assert the
*nested* field survives, not just the flat top-level one — a fix that only visited one level deeper
would still pass a flat-only fixture. Revert-check: with `collectExpandedPaths`'s bare-op handling
disabled, both new tests fail (`0 is not equal to 2`/`3` types collected); restored, both pass. Full
suite green (396 tests, 394 pass, 0 fail, 2 todo — the same pre-existing `#120`/`test_61` as always),
runtime unaffected by bare-op selections now taking the same full-subtree-walk path `>**` already
does everywhere else.

**Refs:** `src/oas/generator/typesCollector.ts` (`PathsCollector.collectExpandedPaths`), `src/oas/
nodes/get.ts` (`visitResponseContent`, the disabled eager visit), `src/oas/nodes/res.ts` (`visit`,
`dependencies`), `src/oas/nodes/typeUtils.ts` (`isContainer`). Fixtures `bare-op-nested-response.yaml`,
`bare-op-nested-body.yaml`. `docs/FIXED.md #134` (the issue this replaced as #111's original
load-bearing fixture), `docs/FIXED.md #135` (#111's test's mechanism at the time, since
independently fixed), `docs/FIXED.md #111` (the safety net this was found re-verifying).

## 120 · A bare `$ref`-enum response drops the whole operation — ✅ Fixed

**Symptom:** an op whose 200 response is a component enum directly (no object wrapper) vanished
from the schema — no field, no error. Found writing `#115`'s coverage.

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

**Cause, three deep, all in the same bare-value-under-`Res` family `#32`/`#47` already cover for
scalars/arrays:**
1. `PathsCollector.collectExpandedPaths`'s leaf-case chain (`src/oas/generator/typesCollector.ts`)
   recognized a bare `Scalar` or `Arr`-of-`Scalar` directly under a `Res`, but not a bare `En` — so
   the selection walk found nothing to select and the whole op was dropped, the original diagnosis.
2. Once that leaf case was added, a second gap surfaced: `Factory.createScalarType`
   (`src/oas/nodes/factory.ts`) always named a bare enum the literal string `'enum'`, unlike its
   sibling branches (`createContainerType`'s `Obj`/`Union`/`Composed`/`Map`) which all keep the
   resolved `$ref` as the name — so every bare-enum response would have collided on one shared
   `enum Enum { … }` regardless of which component it came from.
3. A third gap: `En.generate()` had no reference-only branch for a bare enum reached through a
   `Res` (mirroring `Obj.generate()`'s `context.inContextOf(Res, this)` early return) — it always
   wrote the full `enum X { … }` body inline, so the field printed `status: enum StateCode { … }`,
   invalid GraphQL. `Res.select()` had the matching gap on the selection side: `En` didn't match
   `T.isScalar`, so it fell through to `En.select()` — a no-op — leaving `selection: """ """` blank
   instead of passing the bare value through with `$`.

**Fix:** one addition per gap, each mirroring the existing bare-scalar handling for its file:
```ts
// typesCollector.ts — new leaf case, alongside the existing Scalar-under-Res one
} else if (child instanceof En && child.parent instanceof Res) {
  newSelection.add(child.path());
}
// factory.ts — createScalarType now takes `ref` and keeps it as the enum's name
return new En(parent, ref ?? 'enum', schema, schema.enum! as string[]);
// en.ts — En.generate() references by name when reached through a Res, same as Obj.generate()
if (context.inContextOf(Res, this)) {
  writer.write(Naming.genTypeName(this.name));
  return;
}
// res.ts — Res.select() passes a bare En through as `$`, same as a bare Scalar
T.isScalar(response) || response instanceof En || ...
```

**Example:**
```graphql
enum StateCode {
 pending,
 active,
 done
}

type Query {
  status: StateCode
    @connect(... selection: """
      $
      """)
}
```

**Verified:** `test_115_bare_enum_response_must_not_drop_the_operation`
(`duplicate-enum-values-routes.yaml`, `get:/status>**`) — `{ todo }` marker removed, its existing
assertion (`/status: StateCode/`) is now the real regression check. Revert-check: with the
`typesCollector.ts` leaf case alone reverted, the test fails exactly as before (`0 is not equal to
1`, same assertion line); restored, it passes. Full suite green (397 tests, 396 pass, 0 fail, 1
todo — the pre-existing `test_61`).

**Refs:** `src/oas/generator/typesCollector.ts` (`PathsCollector.collectExpandedPaths`), `src/oas/
nodes/factory.ts` (`createScalarType`), `src/oas/nodes/en.ts` (`generate`), `src/oas/nodes/res.ts`
(`select`). `docs/FIXED.md #32` (bare scalar under `Res`, the same mechanism this enum case was
missing), `docs/FIXED.md #47` (bare scalar array under `Res`), `docs/FIXED.md #24` (`PropEn` leaves,
a different node than the bare `En` this fixes), `docs/issues.md #115` (found writing its coverage).

## 65 · An entity key whose OAS name is not a clean GraphQL name breaks R1 emission — ✅ Fixed

**Symptom:** an entity keyed on a property like `widget_id` emitted a connector that referenced names
nobody defines. Two separate leaks, same root:
- `@key(fields: "widget_id")` wrote the **raw OAS name**, but the type's field is the sanitised
  `widgetId` — composition rejected the `@key`.
- the resolver URL never got its `$this`: the rewrite regex `\{([a-zA-Z0-9]+)\}` (`obj.ts`,
  `writeEntityConnector`) did not match `_`, so the path stayed `GET: "/widgets/{widget_id}"`.

**OAS** — any by-id endpoint whose path param needs sanitising, e.g. (entity-aliased-key):
```yaml
/widgets/{widget_id}:
  get:
    parameters: [{ name: widget_id, in: path, required: true }]
Widget:
  properties: { widget_id: { type: string }, name: { type: string } }
```

**Cause:** `keyFields` carries raw path-param names (`entity.ts`) and stays that way on purpose —
#16 spots a key by Prop identity, matching `keyFields` against the raw `Prop.name`. The bug lived in
the two downstream write sites: `@key` wrote `keyFields` unsanitised, and the `$this` rewrite regex
predated non-identifier param names.

**Fix:** sanitise at both write sites in `obj.ts`, `keyFields`/`isEntityKey` untouched:
```ts
// generate() — @key(fields: …), each space-separated key field sanitised individually
const sanitisedKey = key.split(' ').map((field) => Naming.sanitiseField(field)).join(' ');
writer.write(` @key(fields: "${sanitisedKey}")`);
// writeEntityConnector() — widen the {param} class to match `_`, sanitise the captured name
const path = resolver.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, param) => `{$this.${Naming.sanitiseField(param)}}`);
```

**Example:**
```graphql
# before — @key names a field Widget does not have, and the URL kept the bare param
type Widget @key(fields: "widget_id")
    @connect(http: { GET: "/widgets/{widget_id}" } ...)
{ widgetId: String ... }
# after
type Widget @key(fields: "widgetId")
    @connect(http: { GET: "/widgets/{$this.widgetId}" } ...)
```

**Verified:** `test_R1_16_aliased_optional_key_plain_only_in_entity_selection`
(`entity-aliased-key.yaml`) moved onto `runOasTest`, per the issue's own instruction, so it now
actually composes; asserts both the sanitised `@key` and the sanitised `$this` URL. Revert-check:
with the `$this` regex/sanitise alone reverted, the test fails on the URL assertion; with the `@key`
sanitise alone reverted, it fails on composition (`KEY_INVALID_FIELDS`); restored, both pass. Full
suite green (397 tests, 396 pass, 0 fail, 1 todo — the pre-existing `test_61`).

**Refs:** `src/oas/nodes/obj.ts` (`generate`, `writeEntityConnector`), `Naming.sanitiseField`,
`docs/FIXED.md #2` (the same raw-name/regex leak, fixed there for `$args` — this closes the sibling
gap for `$this`), `docs/issues.md #16` (the by-identity key suppression this keeps in step with).

## 121 · A `oneOf` component used top-level by one op and nested by another fails the combined compose — ✅ Fixed

**Symptom:** each op composes alone; generate BOTH into one schema and rover rejects it with
`GROUP_SELECTION_IS_NOT_OBJECT`. Found building the all-ops coverage column — the first committed
per-op-green/whole-red case.

**OAS** (`per-op-green-whole-red.yaml`):
```yaml
/media:  get -> $ref Media                      # top level: real union + ->match (has discriminator)
/shelf:  get -> { featured: $ref Media, ... }   # nested: isFlat -> merged object
Media:   oneOf [Book, Movie], discriminator kind
```

**Cause:** `Union.id` is `union:${this.kind}:${this.name}` — `kind` defaults to `'type'` for any
response position, so the top-level `/media` union and the nested `/shelf.featured` union collide on
one id even though they're two separate node instances. `TypesCollector.collect()` dedupes by that
id into one `pendingTypes` entry, so only one instance ever gets `generate()` called — whichever
wins decides whether the SDL says `union Media = Book | Movie` or the flat `type Media { ... }`.
Selections, though, are written per-op from that op's own `resultType` — each op's own node, not the
deduped map — so `/media`'s selection always assumes the real-union form and `/shelf`'s always
assumes the flat form, regardless of which form the SDL settled on. This is the gap `#38` flagged
and deliberately left open.

**Fix:** a new `Union.forcedFlat` flag (same idiom as R2's `interfaceBaseRef`, set by a dedicated
post-collect pass, consulted next to `isFlat()`):
```ts
// union.ts
public isFlat(): boolean {
  return this.forcedFlat || this.kind === 'input' || !this.discriminator || !this.isTopLevelResponse();
}
```
`TypesCollector.resolveDivergentUnionForms()` groups every `Union` reachable from the selected ops'
own result/body roots by `id`, and when a group's members disagree on `isFlat()`, forces the whole
group flat. It runs inside `collect()`, before `consolidateRemovedFields`/`collectReachable` — unlike
`interfaceBaseRef`, `forcedFlat` changes what `dependencies()` returns, and those walks read
`dependencies()` before generation, so it can't wait for a post-collect pass the way
`promoteAllOfBase` does. Input- and output-position instances of the same ref already have different
ids (`union:input:X` vs `union:type:X`), so they land in different groups and are untouched — a union
used consistently across ops (always top-level, or always nested) has one `isFlat()` value in its
group and the pass is a no-op.

**Example:**
```graphql
# before: /media's SDL/selection wins the real-union form; /shelf's selection still speaks it —
# rover: GROUP_SELECTION_IS_NOT_OBJECT on Query.shelf's `featured { }` group
# after: forced flat everywhere
type Media { kind: String, pages: Int, minutes: Int }
```

**Verified:** `test_R2_union_diverges_top_level_vs_nested_forces_flat_everywhere`
(`tests/all/r2-abstract.test.ts`) — asserts no `union Media = ` line, one `type Media {` merge, and
no `->match` selection anywhere for `Media`. Revert-check: with the `union.ts`/`typesCollector.ts`
edits reverted, the test fails the same way it did before the fix (`typesSize` mismatch, then
`GROUP_SELECTION_IS_NOT_OBJECT` once the count is corrected); restored, it passes.
`test_coverage_all_ops_column_catches_per_op_green_whole_red` (`tests/all/coverage-tool.test.ts`),
which pinned the detection, is now renamed `test_coverage_all_ops_column_all_ops_green_when_forms_agree`
and asserts `OK` instead of the `GROUP_SELECTION_IS_NOT_OBJECT` failure. Full suite green (398
tests, 397 pass, 0 fail, 1 todo — the pre-existing `test_61`).

**Refs:** `src/oas/nodes/union.ts` (`forcedFlat`, `isFlat`), `src/oas/generator/typesCollector.ts`
(`resolveDivergentUnionForms`), `docs/FIXED.md #25` `#38` `#48` (the union-form family — #38 is the
entry that left this gap open), `src/oas/nodes/allOfBase.ts` (`interfaceBaseRef`/`promoteAllOfBase`,
the R2 idiom `forcedFlat` reuses), `docs/issues.md #122` (the umbrella this was already isolated out
of). Fixture `tests/resources/oas/per-op-green-whole-red.yaml`.

## 49 · A request body that reaches a big shared model makes composition run out of memory — ✅ Fixed, as a side effect of #89

**Symptom:** a write op whose request body pulled in a large, self-referencing model generated a
schema rover could not compose in bounded memory: the composing process grew by about 2 GB every 5s
and never finished, reaching 60–75 GB and taking the machine down twice. Three `confluence.json` ops
did it, e.g. `put:/wiki/rest/api/content/{id}/child/attachment/{attachmentId}` — its `version` field
reaches the whole `Content` model, a 12-schema self-referencing clique.

**OAS** — the body looks small, but `version` reaches the whole content model:
```yaml
AttachmentPropertiesUpdateBody:      # the request body: 8 fields
  properties:
    version: { $ref: '#/components/schemas/Version' }   # <- the door
Version:
  properties:
    content: { $ref: '#/components/schemas/Content' }   # <- the whole model
Content:                                                 # refers to 12 schemas, itself included
  properties:
    ancestors: { type: array, items: { $ref: '#/components/schemas/Content' } }
    space:     { $ref: '#/components/schemas/Space' }
    version:   { $ref: '#/components/schemas/Version' } # <- back to where we came from
```

**Cause was never pinned down as its own mechanism** — this entry's own investigation left it
undecided between two candidates (the 134 KB body selection, or the size of the input-type graph
itself, 87 types / 104 references) and stopped at a bisection plan. Before that bisection ran, #89
landed for an unrelated symptom (`CONNECTORS_UNRESOLVED_FIELD` on confluence's relation GETs) and
fixed the same underlying divergence from a different angle: cycle detection (#10) works per
selection *path*, so two instances of the same node could disagree on whether a field survived the
cut — one route's `Content.space` kept, another's cut. For a tightly-connected clique like
`Content`/`Version`/`Space`/`User`, that divergence multiplied the number of distinct container
instances the walk had to build. #89 made a field removed on any route removed on every route
(`context.propOverrides`, keyed by node id), which collapses that divergence and, incidentally,
bounds the walk this entry was tripping over.

**Verified** (2026-08-20), against the real op named in the issue, generated and composed fresh —
not read from a cached artifact:
- `put:/wiki/rest/api/content/{id}/child/attachment/{attachmentId}` now generates in under 1s (was
  ~1s / 293 KB / 173 types before; now 94,330 bytes / 148 types) and composes with `rover supergraph
  compose` in ~1s at negligible peak RSS — no growth, no timeout.
- All 65 mutation ops in `confluence.json`, including the other two ops this entry's "three ops"
  referred to (`post:`/`put:/wiki/rest/api/content/{id}/child/attachment`, 95 types each), compose
  OK — swept end to end with a fresh `OasGen` per op and real `rover` composes.
- The largest schema in that sweep is now 134,878 bytes (`put:/wiki/rest/api/relation/...`, a
  different op), composing in ~2.6s — nothing in the spec approaches the old failure's scale.

**Not independently bisected:** the two candidate causes this entry originally proposed (body
selection size vs. input-type graph size) were never isolated from each other, because the bug
stopped reproducing before that work started. #89's fix narrows but does not eliminate the
underlying risk — `Factory.cyclicAncestor` is still path-scoped by design, so a clique large enough
to blow up the walk even with consistent cycle-cuts remains possible in principle.

**Refs:** `docs/FIXED.md #89` (the actual fix: `src/oas/generator/typesCollector.ts`
`consolidateRemovedFields`, `src/oas/oasContext.ts` `propOverrides`), `#10` (the cycle cuts #89 made
consistent), `#48` (ruled out in the original investigation as this op's trigger). `ROADMAP.md` R15
(Selection externalisation) remains relevant future work for selection/tree size in general,
independent of this entry closing. `tools/coverage-spec.mts` keeps its 30s compose deadline and
big-schema serialization as defense in depth, not because this op still needs them.

## 93 · An inline map at the response root is always called `REntry` — ✅ Fixed

**Symptom:** github `get:/emojis` emitted its entry type as `REntry`, which said nothing about the
operation or the data. Every unnamed map at a response root got that same name.

**Cause:** `Map.updateName()` named an unnamed map `<parentName> + "Entry"`. A response-root map's
parent is the `Res`, and a `Res` is named `r` — so the answer was always `REntry`. The three sibling
container nodes all special-case this position and name themselves after the operation:

| node | unnamed, under a `Res` |
|---|---|
| `Obj.updateName` | `op.getGqlOpName() + 'Response'` |
| `Composed.updateName` | `op.getGqlOpName() + 'Response'` |
| `Union.updateName` | `op.getGqlOpName() + 'Response'` |
| `Map.updateName` | `'REntry'` — the `Res` branch was missing |

Only an *inline* map root minted `REntry`; one behind a `$ref` took the ref's name. github's
`/emojis` and `/repos/{owner}/{repo}/languages` each have exactly one, so nothing collided yet — but
two inline map roots in one spec would both have asked for `REntry` and landed on `#78`'s conflict
machinery, which renames by container, and both containers are `r`.

**Fix:** gave `Map.updateName` the same `parent instanceof Res` branch the other three containers
already had, with `Entry` instead of `Response`:
```ts
// map.ts
if (parent instanceof Res) {
  const op = parent.parent as Get;
  name = op.getGqlOpName() + 'Entry';
} else if (parentName) {
  name = Naming.genTypeName(Naming.getRefName(parentName) + 'Entry');
} else {
  name = '[inline:MapEntry]';
}
```
The name set here is the pre-`genTypeName` node id (`restrictionsEntry`); `Map.generate()` already
ran every written name through `Naming.genTypeName()` at write time (same as `Obj`), so the emitted
SDL type is capitalized without any extra step.

**Example** (`map-response-root.yaml`, `get:/restrictions`):
```graphql
type Query {
  restrictions: [RestrictionsEntry]
    @connect(... selection: "$->entries { key value }")
}
type RestrictionsEntry {
  key: String
  value: Restriction
}
```

**Verified:** `test_90_map_at_the_response_root_takes_entries` and
`test_92_map_of_plain_values_at_the_response_root_expands` (`tests/all/oas-core.test.ts`), updated
from asserting `REntry` to the operation-derived names — `RestrictionsEntry` (`/restrictions`),
`EmojiEntry` (`/emoji`), `LanguagesEntry` (`/languages`). Revert-check: with just the `Res` branch
removed from `map.ts`, both tests fail back to expecting the now-absent `REntry`; restored, they
pass. Full suite green (397 pass, 0 fail, 1 pre-existing todo).

**Refs:** `src/oas/nodes/map.ts` (`updateName`), mirroring `obj.ts` / `comp.ts` / `union.ts`
(`updateName`). `docs/FIXED.md #90` and `docs/FIXED.md #92` (the map-at-response-root mechanics this
collision was surfaced against).


## 95 · An array node is named after its parent, so it shares its parent's ref name — ✅ Fixed

**Symptom:** none on its own — it is what made #94 possible, and anything else keyed by node name
could trip on it the same way.

**OAS** (`union-body-array-member.yaml` — a request body that is a `oneOf` of an object and an array
of the same `$ref`):
```yaml
RestrictionArray:
  oneOf:
    - type: object
      properties: { results: { type: array, items: { $ref: '#/…/Restriction' } }, size: { type: integer } }
    - type: array
      items: { $ref: '#/…/Restriction' }
```

**Example** — the array member of the union, as built:
```
# before
array:#/components/schemas/Restriction   # id — from its items, correct
  name = '#/components/schemas/RestrictionArray'   # the *union's* own ref name

# after
array:#/components/schemas/Restriction
  name = 'RestrictionArray'   # resolved through the same Naming.getRefName the union itself uses
```

**Cause:** `Factory.createArrayType` did `new Arr(parent, parent.name)` — an array is a wrapper, so it
borrowed a name rather than minting one. Under a `Union` reached via a `$ref`, `parent.name` is the
literal ref string, so the `Arr` became indistinguishable from its parent in anything keyed by name
(`context.refCount`, `context.types`). #94 is exactly that: a decrement meant for the array member
landed on the union instead.

**Fix:** resolve the ref once, only for the reproduced case — a `Union` parent whose name is
ref-shaped — rather than changing the general borrowing behaviour:
```ts
// factory.ts, createArrayType
let parentName = parent.name;
if (parent instanceof Res) {
  const get = parent.parent as Get;
  parentName = _.upperFirst(get.getGqlOpName());
} else if (parent instanceof Union && T.isRef(parentName)) {
  // an Arr is a wrapper, not a component of its own — carrying the raw $ref would alias it with
  // the parent in name-keyed maps (context.refCount, context.types). #95
  parentName = Naming.getRefName(parentName);
}
const arr = new Arr(parent, parentName);
```
`Naming.getRefName` is idempotent on an already-resolved name (`RemoveRefConverter.process` only
strips a `#/components/.../` prefix if one is present), so `Obj.updateName`'s existing
`Naming.getRefName(parentName)` call for an array's inline item object produces the same string as
before — no second call site needed. `Arr.id` (used for identity/`path()`) derives from
`itemsType.name`, not `this.name`, so this is a lookup-key change only, not an identity change.

`Composed` and `Map` can structurally reach the same `parent` slot (an `allOf` member or
`additionalProperties` value that is itself an array) but no defect has been reproduced there, so
they are left alone — worth a reproduction pass if one turns up.

**Verified:** `test_95_array_member_does_not_borrow_its_parents_ref_name`
(`tests/all/oas-core.test.ts`), which pulls the `Arr` directly off the union's own children
(`union.children.find(c => c instanceof Arr)`, since `Union.visit` adds every member as a child) and
asserts its `.name` resolves to `RestrictionArray` instead of the raw
`#/components/schemas/RestrictionArray` ref. `getTypes()`'s id-keyed map can't be used for this — an
`Arr` is never `context.store`'d, so it never appears there. Revert-check: with just the `factory.ts`
branch removed, `test_95` fails with the raw ref string and `test_94` (SDL-level) still passes
byte-identical — confirming the bug was already invisible in generated output. Full suite green (398
pass, 1 pre-existing todo, 0 fail).

**Refs:** `src/oas/nodes/factory.ts` (`createArrayType`), `src/oas/nodes/arr.ts` (`Arr.id`),
`src/oas/utils/naming.ts` (`Naming.getRefName`, `REF_CONVERTER`). Fixture
`union-body-array-member.yaml`. See #94, the bug this made possible.

## 124 · A component reached both directly and via a `#/paths` ref survives as two definitions — ✅ Fixed

**Symptom:** digitalocean's whole-spec mutations compose failed with 5 build errors, one per field
of a single type:
```
CONNECTORS_UNRESOLVED_FIELD: No connector resolves field `LoadBalancerRegion.available`.
It must have a `@connect` directive or appear in `@connect(selection:)`.
```
(same for `.features`, `.name`, `.sizes`, `.slug`.) Per-op, all 145 mutation ops still composed
100% — a cross-op-only failure, previously masked by #123's `INVALID_BODY` errors.

**OAS** (digitalocean — `loadBalancers_update`'s response `$ref`s back to `loadBalancers_create`'s):
```yaml
/load_balancers:
  post:                                    # loadBalancers_create
    responses:
      '202':
        content:
          application/json:
            schema:
              properties:
                load_balancer:
                  allOf: [..., { properties: { region: { allOf: [..., { $ref: '#/…/region' }] } } }]
/load_balancers/{id}:
  put:                                     # loadBalancers_update
    responses:
      '200':
        content:
          application/json:
            schema:
              $ref: '#/paths/~1load_balancers/post/responses/202/content/application~1json/schema'
```

**Cause:** a node's raw internal `.name`/`.id` is not normalized the way its printed SDL name is.
`loadBalancers_create`'s own `load_balancer`/`region` fields build their `Composed` nodes directly
and get a clean raw name (`Naming.genTypeName` applied at print time). `loadBalancers_update`'s
response reaches the *same* shape through a raw `#/paths/...` JSON-pointer `$ref`, so its `Composed`
node keeps the entire raw pointer string as its name — `Composed.updateName()` short-circuits once a
name is already non-empty (the `$ref` string, set by the paths-ref resolution ahead of it). Both
print identically via `Naming.genTypeName()`, but their differing raw ids meant the two instances
were never recognized as the same type. Unlike `Obj.visit()`, `Composed.visit()` never checked
`T.collidesWithStoredType` (the same-class, different-id collision), only cross-class and reserved-
name collisions (#22, #126) — so both instances survived independently, writing two duplicate
`type LoadBalancer { }` blocks with divergently-renamed nested `region` types, leaving one orphaned
with no connector selecting its fields.

**Fix:** added `T.collidesWithStoredType(this, context)` to `Composed.visit()`'s existing
rename-check condition, mirroring the check `Obj.visit()` already had:
```ts
// comp.ts, visit()
if (
  this.parent instanceof Prop &&
  (T.collidesWithStoredType(this, context) ||
    T.collidesAcrossNodeClasses(this, context) ||
    T.collidesWithReservedComponentName(this, context))
) {
  T.resolveNameConflict(this, context);
}
```
The second (paths-ref-reached) instance is now detected as colliding and renamed through the
existing `resolveNameConflict`/`canConvergeOn` machinery.

**Verified:** fixture `paths-ref-shared-create-and-update.yaml` mirrors digitalocean's exact `$ref`
topology (an `allOf`-wrapped field built directly in one op vs. reached via a `#/paths` pointer in
another), test `test_124_paths_ref_shared_object_reached_nested_and_whole_composes`
(`tests/all/oas-core.test.ts`). Revert-check: with just the `comp.ts` change reverted, the fixture
fails `INVALID_GRAPHQL: type Thing is defined multiple times in the schema`; with it, it composes
cleanly, the wrapper and shared nested type are each emitted once, and the second instance is
renamed. The same same-class check also caught a genuine pre-existing latent instance in box.yaml:
`Collaboration.created_by` (`$ref User--Collaborations`) and `File.created_by` (`$ref User--Mini`)
were silently sharing the unqualified name `CreatedBy` despite different shapes —
`test_57_merged_union_defines_the_enum_it_references`'s expected type count moved 36→37. Full suite
green (399 pass, 1 pre-existing todo, 0 fail).

**Refs:** `src/oas/nodes/comp.ts` (`visit`), `src/oas/nodes/typeUtils.ts`
(`collidesWithStoredType`, already used by `Obj.visit`). Fixture
`paths-ref-shared-create-and-update.yaml`. See #22/#126 (the sibling `Composed` collision checks),
#123 (the unmasking fix), #122 (umbrella).

## 130 · Two unrelated inline shapes sharing one property-key-derived name — ✅ Fixed, as a side effect of #124

**Symptom:** after `#129`'s correction, box.yaml's whole-spec compose genuinely failed on 9 GET / 5
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
`"AssignedTo"`. Only the big File/Folder/WebLink-derived definition survived; selections expecting
the small shape's `login` field (e.g. `taskAssignmentCollection.entries.assignedTo.login`) no
longer matched anything.

**Cluster B — "Fields"** (the other 5 GET errors, `metadata_templates*` ops): two unrelated
array-item objects both named from the property key `fields` — one with
`{description, displayName, hidden, id, key, options, type}`, one with just `{key, sort_direction}`.
Only the smaller shape survived; the `metadata_templates*` ops' selections expecting the larger
shape's fields no longer matched.

**Cause was already fixed, unverified:** this is `#22`'s original, deliberately-unfixed scope — a
same-class collision (both `Composed`, or both `Obj`) between two *unrelated* inline shapes that
happen to mint the same property-key-derived name. `#124` landed `T.collidesWithStoredType` in
`Composed.visit()` for an unrelated symptom (digitalocean's `#/paths`-ref-reached duplicate), but
that check is class-agnostic — it flags any stored occupant with a different shape under the same
name, not just cross-class ones (`collidesAcrossNodeClasses`) or reserved-component ones
(`collidesWithReservedComponentName`) — so it also catches two same-class inline shapes that
collide only because they share a property-key-derived name, exactly this entry's scope.

**Verified:** fixtures `composed-collision-same-key-refs.yaml` (Cluster A) and
`composed-collision-array-items.yaml` (Cluster B) reproduce each cluster in isolation; tests
`test_130_composed_allof_same_key_collision_splits_by_container` and
`test_130_composed_array_item_same_key_collision_splits_by_container` (`tests/all/oas-core.test.ts`)
assert both colliding types are emitted, each keeping its own fields, with the second one
container-qualified and correctly referenced. Revert-check: with `comp.ts` reverted to pre-`#124`,
both new tests fail (the second shape is silently dropped instead of splitting). Full suite green
(402 tests, 401 pass, 1 pre-existing todo, 0 fail). `tools/coverage-spec.mts --pass both` on
box.yaml: 114/114 GET ops, 144/144 mutation ops, both `100.0%`/`composeFail=0`/`whole=OK` — the exact
9+5 errors this entry recorded are gone, fully accounted for by these two clusters (no third
source).

**Refs:** `docs/FIXED.md #124` (the actual fix: `src/oas/nodes/comp.ts` `Composed.visit`,
`src/oas/nodes/typeUtils.ts` `collidesWithStoredType`). Fixtures `composed-collision-same-key-refs.yaml`,
`composed-collision-array-items.yaml`. See `#22` (the same-class scope decision this closes), `#126`
(the sibling, already-fixed real-component case), `#129` (the measurement-tool bug found while
investigating this).

## 135 · A drift-recovered path segment answered empty because the selection string was never re-derived after recovery — ✅ Fixed

**Symptom:** found as a side effect of landing `#111`'s "own output must parse" safety net — a
previously-green test, `test_72_browse_minted_path_resolves` (`tests/all/regen.test.ts`), turned out
to have been comparing two empty, invalid schemas against each other the whole time. Selecting one
leaf field by its exact path, with no `>**` wildcard, after that leaf's name had drift-renamed
(digitalocean.yaml: browsing `/v2/apps` first claims the name `ActiveDeployment`, so the deployments
op's own same-shaped type renames to `inlinev2AppsByAppIdDeploymentsResponseActiveDeployment` — see
`#72`) produced `type ActiveDeployment {\n}\n`: the type was emitted, but the selected field
(`cause`) was missing entirely.

**Cause:** `TypesCollector.collect()` (`src/oas/generator/typesCollector.ts`) walks a selection path
segment by segment via `SelectionPath.resolveSegment` (`src/oas/utils/selectionPath.ts`). When a
segment's name has drifted, `resolveSegment` recovers the right node through its "only child of that
kind" fallback — but the walk never wrote that recovery back into the selection array; the stale,
literal string stayed as it was. `Type.selectedProps` (`src/oas/nodes/type.ts`) later matches a prop
by recomputing its own, fresh `.path()` against the selection's prefixes — a drift-recovered node's
fresh path never equals the stale string that found it, so the match silently failed and the field
was dropped, even though its parent type still got emitted. Only a bare, literal path was
vulnerable: a `>**` wildcard is immune because `PathsCollector.collectExpandedPaths` rebuilds every
leaf string from the same live walk that names it, so the string and the node it names can never
drift apart.

**Fix:** after the segment walk finishes for one literal (non-wildcard) selection entry, re-derive
the resolved node's current path and swap it into the selection array if it no longer matches the
string that found it:
```ts
if (!hitWildcard && current && current.path() !== path) {
  const idx = expanded.indexOf(path);
  if (idx !== -1) expanded[idx] = current.path();
}
```
`hitWildcard` is reset for every selection entry, so an earlier `>**` entry in the same run can't
suppress the correction for a later literal one.

**Example:**
```graphql
# before: the type is emitted, but the field it exists for is missing — invalid on its own
type ActiveDeployment {
}
# after
type ActiveDeployment {
  cause: String
}
```

**Verified:** new test `test_135_drift_recovered_bare_leaf_selection_resolves`
(`tests/all/regen.test.ts`) selects the drift-renamed leaf directly (no `>**`) and asserts both that
the output matches a fresh, un-drifted selection's output, and that the selected field is actually
present, not just its type. Revert-check: with the `typesCollector.ts` fix reverted, the new test
fails reproducing the issue's exact symptom (an empty type, no `cause` field); restored, it passes.
Full suite green: 401 pass, 0 fail, 2 todo (`test_61`, and `#111`'s own regression test — see below).

`#111`'s own regression test, `test_111_bare_leaf_selection_still_throws_invalid_sdl`
(`tests/all/regen.test.ts`), relied on this exact bug as its only known trigger for the "own output
must parse" gate it exists to protect — fixing #135 makes its selection valid GraphQL, so its
`assert.throws` calls stopped firing, correctly. Retired via Node's `test(name, { todo }, fn)` form
(mirroring `test_61`'s existing pattern), with its body removed and the reason recorded in the
`todo` string. No other known repro of that gate exists, so it was not left red.

**Refs:** `src/oas/generator/typesCollector.ts` (`TypesCollector.collect`), `src/oas/nodes/type.ts`
(`selectedProps`, `selectionPrefixes`), `src/oas/utils/selectionPath.ts` (`resolveSegment`, the
recovery this interacts with). `#111` (the safety net that surfaced this), `#134`/`#136` (found and
fixed in the same investigation), `#72` (the drift-rename mechanism this reuses as its repro).


## 13 · Path-dependent cycle cuts make same-named instances diverge — ✅ Fixed, superseded by #89

**Symptom:** with #10's per-route cycle cut in place, Confluence abstract fails compose with
`SELECTED_FIELD_NOT_FOUND: selection contains field 'history', which does not exist on 'Space'`
(later, same mechanism, on `homepage` instead).

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

**Cause:** #10's cycle cut runs per expansion path, so two `Space` instances built on different
routes can disagree on which fields survive; the writer emits only one `type Space`, and an op's
selection is the union of every route it reaches — a selection built from an un-cut instance can
name a field the emitted (cut) instance already commented out.

**First attempt (reverted 2026-06-10):** mutate `props` on the kept instance directly, merging in
whichever route still had the field. This leaked the field into the *cut* position's own selection
too — rover then rejected it with `CIRCULAR_REFERENCE`, since that position's selection now asked
for a field its own SDL comment says was removed.

**Fix that shipped (2026-06-11):** stay selection-guarded and SDL-only instead of touching `props`.
For each field a node lost to a cycle cut, find a selection path that already carries the real
field under the same type id and walk it there with the existing `collectPaths`; stash the found
node in `context.sdlPropOverrides` (`Map<writtenInstance, Map<fieldName, node>>`), read by
`Obj.generate` only. Every route's own selection keeps its own "field removed" comment — only the
written SDL type gets the field back, and only for fields some selection actually names. Runs once,
after the collect loop, over the final `expanded` set — an earlier version tracked instance pairs
*during* the collect loop, which meets the same pair once per route; Confluence has thousands of
routes, so that version went quadratic and hung the sweep.

**Not enough:** this "donation" only guaranteed a field was selected on *at least one* route
reaching the type, not on *every* route — the composer wants a declared field provided at every
position the type appears, a stricter requirement. That gap resurfaced on `Content.space` and was
written up as #89, which fixed it for real: a field removed on any route is now removed on *every*
route (SDL, every route's own selection, and reachability alike), instead of declared because one
route happened to keep it. #89 also deletes this entry's donation machinery
(`findSelectedFieldNode`, `sdlPropOverrides`) outright — it only ever fired when a route had lost
the field, which now just means removing it everywhere instead of donating it back.

**Verified:** no dedicated fixture of its own — tracked via Confluence corpus pass-rate sweeps
(`SELECTED_FIELD_NOT_FOUND` 8 → 1 when this landed, net pass-rate held at 69.2% until the R2
discriminator-less-union wall blocking the unblocked ops was separately fixed, later 93.8%). The
mechanism itself is exercised by #89's fixture and test instead: `cycle-cut-on-some-routes.yaml`,
`test_89_field_removed_on_any_route_is_removed_everywhere`.

**AST:** no new node shape at either stage — a collect-time SDL prop override here, replaced by
#89's collect-time removal-propagation; `PropCircRef` stands in for both.

**Refs:** `src/oas/generator/typesCollector.ts` (`consolidateRemovedFields`, #89's replacement for
this entry's `findSelectedFieldNode`), `src/oas/oasContext.ts` (`propOverrides`, replacing
`sdlPropOverrides`). See docs/FIXED.md #89 (the fix that actually landed), #10 (the cycle cut this
reacts to).

## 137 · A Swagger 2.0 `formData` request body is dropped entirely — ✅ Fixed

**Symptom:** an operation whose body is declared as `in: formData` parameters (the pre-OAS-3 way
to describe a form body) emitted with zero arguments and no body at all once there were 2+ such
parameters — not a compose failure, just a mutation nobody could actually send data to.

**OAS** (Swagger 2.0, `consumes: [multipart/form-data]`, two `formData` params):
```yaml
parameters:
  - { name: title, in: formData, type: string, required: true }
  - { name: description, in: formData, type: string, required: false }
```

**Example** — before, and after:
```graphql
# before — nothing to send
createUpload: CreateUploadResponse
  @connect(source: "api", http: { POST: "/upload" }, selection: """success: $(true)""")

# after
createUpload(input: InputInput!): CreateUploadResponse
  @connect(
    source: "api"
    http: {
      POST: "/upload"
      headers: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }]
      body: """
      $args.input {
        description
        title
      }
      """
    }
    selection: """success: $(true)"""
  )
```

**Correction to the issue's own framing:** the issue assumed `formData` parameters reach `gen` as
their own thing, distinct from `requestBody.content['multipart/form-data']`. Tracing the actual
data flow (`oasGen.ts` → `oas-normalize`'s `.convert()` → `swagger2openapi`) shows that isn't so:
`swagger2openapi` converts `formData` parameters into `requestBody.content[...]` before `gen` ever
reads the document — picking `multipart/form-data` when `consumes` lists it, else defaulting to
`application/x-www-form-urlencoded`. So the issue's repro landed in `Post.visitBody` as an ordinary
`multipart/form-data` body — the exact same path a hand-written OAS 3 multipart body takes, and
that path was (and still is, for anything but a plain-string form) dropped on purpose: multipart's
file/binary parts have no mapping this generator can write.

**Cause:** `Post.findSendableMediaType` only ever picks JSON or `application/x-www-form-urlencoded`
— `multipart/form-data` fell straight through to the drop+warn branch, with no check for whether
the body actually needed multipart's binary-part machinery or was just plain text fields wearing
that label because `consumes` said so.

**Fix:** a multipart body is no longer rejected outright. `Schemas.isPlainStringForm` checks the
schema is a flat object whose properties are all plain strings — no nesting, no `$ref`, no
`format: binary`. When a body's only available content type is `multipart/form-data` and it passes
that check, `Post.findSendablePlainMultipart` maps it through the exact same
`application/x-www-form-urlencoded` machinery #83 already built, for both Swagger-2-derived and
hand-written OAS 3 documents alike (nothing at this point in the code can tell the two apart, and
there's no reason to treat them differently). Anything else — a file field, a nested object, an
array, a non-string scalar — keeps the original drop+warn behavior.

**Known limitation — this is a deliberate contract deviation.** The generated connector sends
`Content-Type: application/x-www-form-urlencoded` for a body the source spec declared as
`multipart/form-data`. A server that strictly requires real multipart encoding, even for text-only
fields, could reject that. This is accepted because the alternative — silently dropping the whole
body, which is what happened before this fix — is strictly worse, and #83 already established this
same urlencoded mapping as the project's answer for plain-value form bodies. Real multipart wire
encoding (boundary, part headers) would remove the risk but is separate, larger work, not attempted
here.

**Verified:** generated-shape tests only (SDL, headers, argument mapping) — not verified against a
live server's acceptance of the substituted content type.

**AST:** no new node kind — `Post.visitBody` gains one more branch (`findSendablePlainMultipart`)
that reuses the existing `Body` node the same way #83's `application/x-www-form-urlencoded` path
does.

**Refs:** `src/oas/nodes/post.ts` (`findSendablePlainMultipart`), `src/oas/utils/schemas.ts`
(`isPlainStringForm`). Fixtures `swagger2-formdata.yaml` (plain-string form, a form mixing in a
file field, and `formData` with no `consumes`) and `form-encoded-body.yaml`'s `/receipt` case
(hand-written OAS 3 multipart, flat strings). Tests
`test_137_multipart_with_only_plain_strings_maps_as_a_form`,
`test_137_swagger2_formdata_maps_as_a_form`. Related: #83.
