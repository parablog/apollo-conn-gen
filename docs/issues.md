# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry here (`// see docs/issues.md #N`) instead of carrying the full rationale inline. Every
entry has a concrete **before → after** example, an **AST:** note stating how (or whether) the node
tree changed, and fixed ones have an executable companion fixture under `tests/resources/oas/`.

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` tracks priority/gaps and may link to these ids.

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
**Example** — OAS `{ "2fa_enabled": true, "full name": "x" }`:
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
**Example** — OAS path `/engines/{engine_id}`:
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
**Example** — OAS property `latest: { items: { anyOf: [...] } }` (no `type`):
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
**Example** — OAS path `/v2/1-clicks`:
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
**Example** — OAS `meta: { allOf: [ { properties: { total } }, { required: [total] } ] }`:
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
**Example** — `widget: { $ref: '#/paths/~1widgets/get/.../properties/widgets/items' }`:
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
**Example** — Google Books volume `saleInfo` vs `offers` (now split, both compose):
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
**Cause:** two independent defects, neither an actual infinite loop:
1. **Quadratic selection matching.** `selectedProps` re-ran `prop.path()` (rebuild `ancestors()` + join +
   regex) once per selection entry, per prop: Confluence's descendant op legitimately expands to ~2,700
   types and a ~20,000-entry selection (path multiplicity: `User` is reached via `createdBy`,
   `contributors`, `version.by`, … each minting fresh inline copies), so generation cost was
   O(types × props × 20k) — finite but hours.
2. **Recursion never cut.** True schema cycles (`User → personalSpace → Space → … → results: [User]`) were
   only caught when the *property name* coincidentally repeated (`results` under `results`): the existing
   checks compare node ids, which are name-derived, and the recursion mints distinct synthesized names per
   depth — so cycles entered the connector selection and rover rejected it (`CIRCULAR_REFERENCE`).
**Fix:**
1. `selectedProps` indexes the selection once into a `Set` of its `>`-boundary prefixes (`selectionPrefixes`,
   cached per selection array) — membership is O(1) per prop. Generation drops from hours to seconds.
2. Cycle detection by **schema identity**: a recursive schema can only close through a component `$ref`,
   and `lookupRef` returns the *same `SchemaObject` instance* per ref — so `Factory.cyclicAncestor` walks
   `parent.ancestors()` comparing `a.schema === resolvedSchema`. Scoped to the current expansion path
   (never a global seen-set), so a shared non-recursive component used by sibling fields is *not* cut.
   The cut node renders **commented in both artifacts** (SDL + selection) — see the node structure below.

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
**Example**:
```graphql
sshKeyIdentifier: !          # ✗ before  → INTERNAL_ERROR (no type before `!`)
sshKeyIdentifier: String!    # ✓ after
```
**AST:** shape change — the param's value type is built differently:
`Param → Union(int | string)` becomes `Param → Scalar(String)`.
**Refs:** `src/oas/nodes/param.ts` (`visit`), fixture `param-anyof.yaml`.

## 12 · Inline object collides with a component's *emitted* name — ⬜ Open
**Symptom:** rover rejects the Confluence abstract pass with `CIRCULAR_REFERENCE: type User appears more
than once in …users.personalSpace.permissions.subjects.user` — even after the real recursion is cut (#10).
**Cause:** `SpacePermission.subjects.user` is an *inline* pagination wrapper (`{results: [$ref User],
size, start, limit}`). It keeps its property key as its name (`user`) and emits as `type User` — the same
GraphQL name as the component `#/components/schemas/User`. The #9 collision guard compares *raw* stored
names (`context.types.has('user')` vs the stored `'#/components/schemas/User'`), so the cross-namespace
collision is invisible; two different shapes emit under one name, and rover sees `User` nested inside
`User` and calls it circular.
**Proposed fix:** extend the #9 occupancy check to compare **emitted** names (`Naming.genTypeName`) so the
inline `user` wrapper is qualified (e.g. `SubjectsUser`), exactly like same-namespace collisions are today.
**Example**:
```graphql
users: [User]                 # component #/c/s/User
…  subjects { user: User }    # ✗ inline wrapper also emits `type User` → rover: CIRCULAR_REFERENCE
…  subjects { user: SubjectsUser }   # ✓ goal: qualified like a #9 collision
```
**AST (proposed):** identity-only, like #9 — rename the inline wrapper (`obj:type:user` →
`obj:type:SubjectsUser`); no shape change.
**Refs:** `src/oas/nodes/obj.ts` (`visit` #9 guard / `resolveNameConflict`), `oasContext.ts`
(`context.types` raw-name occupancy). Surfaced by the #10 Confluence re-measure; until fixed the harness
keeps `confluence.json::abstract` skipped.
