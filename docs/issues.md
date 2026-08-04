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

Status: ✅ Fixed · ⬜ Open · ⏸ Parked (blocked on an external gate, noted in the entry).

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
component is stored won't see the collision. Components are reached at shallower depths first in practice
— but #36's visit-order change broke that for array-reached wrappers; re-fixed structurally in #37.

**AST:** identity-only, like #9 — `obj:type:user` → `obj:type:SubjectsUser`; no shape change.
**Refs:** `src/oas/nodes/obj.ts` (`collidesWithStoredType`/`resolveNameConflict`), `oasContext.ts`
(`store`). Fixture `inline-vs-component-name.yaml`, test
`test_inline_renamed_when_colliding_with_component_emitted_name`. Next Confluence blocker: #13.

## 13 · Path-dependent cycle cuts make same-named instances diverge — 🟡 Mechanism fixed (working tree); ops gated behind the R2 union wall
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

**Fix (2026-06-11, working tree — incorporates the lessons of the reverted 06-10 attempt):**
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

**Refs:** `src/oas/generator/typesCollector.ts` (`collect` + `findSelectedFieldNode`),
`src/oas/oasContext.ts` (`sdlPropOverrides`), `src/oas/nodes/obj.ts` (`generate` override
lookup).

## 14 · connect v0.4 composition doesn't credit `->entries` sub-selections — ⏸ Parked (upstream fix accepted, pending router release)
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

## 16 · Selections don't mark OAS-optional fields with `?` — ⏸ Parked (until composition ≥ 2.15 ships)
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

**AST:** untouched — emission-only (`select()` in the `Prop` subclasses appends `?` from
`prop.required`). Care points: aliased keys (`safe: "raw key"?`), arrays (`tags? {`), method chains
(`alternatives?->entries`).
**Refs:** `src/oas/nodes/prop*.ts` (`select`), `obj.ts` (`visitProperties` sets `required`). Gate: the
abstract pass needs composition ≥ 2.15 (or the patched toolchain) before this is corpus-safe on v0.4.

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

## 20 · `anyOf: [$ref, empty-closed-object]` → zero types — ✅ Fixed (working tree)
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
**AST:** shape change for the collapsing case only — the member's node replaces an empty Union.
**Refs:** `src/oas/nodes/factory.ts` (`fromSchema` collapse + `isShapelessObject`).

## 21 · JSON walker: empty `{}` value emits a dangling type reference — ✅ Fixed (working tree)
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

## 23 · OAS 3.1 type array (`type: [string, 'null']`) throws — ✅ Fixed (working tree)
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

## 24 · `>**` expansion silently drops every enum field — ✅ Fixed (working tree)
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

## 25 · Discriminator-less `oneOf` emits a real union the selection cannot satisfy — ✅ Fixed (working tree)
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

## 26 · Collector keeps types the output never references, drops ones it does — ✅ Fixed (working tree)
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

## 27 · Mutations with params AND a body emit two argument lists — ✅ Fixed (working tree)
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

## 28 · Request-body selections use the response alias direction — ✅ Fixed (working tree)
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

## 29 · Default values emit as bare paths, and falsy defaults vanish — ✅ Fixed (working tree)
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

## 30 · Body arg references the raw payload name — ✅ Fixed (working tree)
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

## 31 · Empty response schemas produce zero types — ✅ Fixed (working tree)
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

## 32 · Ops whose only content is a JSON field emit an empty type; body keys with colons break the parser — ✅ Fixed (working tree)
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

## 33 · Four generation crashes: nested component pointers, non-JSON responses, null union members, $ref'd no-content responses — ✅ Fixed (working tree)
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

## 34 · Real unions of allOf members: empty member list, twin member ids — ✅ Fixed (working tree)
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


## 35 · JSON walker: same-named objects across documents diverge on fields — ✅ Fixed (working tree)
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

## 36 · Fields that share a name are wrongly treated as circular, leaving an empty type — ✅ Fixed (working tree)
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

**Separate, still open:** a type whose *only* field is a *genuine* cycle still degrades to an empty type
(e.g. an inline `{ back: $ref Self }`). That is the "never emit a fieldless type" concern, not this fix.

**Tests:** `tests/resources/oas/same-name-fields.yaml` (false positive, exercises both sites — fails
before, composes after) and `cycles-by-route.yaml` (a genuine cycle per route, each still cut), both
wired in `tests/all/oas-core.test.ts`. The CCS `additionalProperties` tests gained one legitimately
un-cut type (`Ingredient`, 22→23).

**Files:** `src/oas/nodes/factory.ts` (`fromProp`), `src/oas/nodes/type.ts` (`Type.add`); ids are
name-based (`src/oas/nodes/propObj.ts` etc.). Related: #10, #13.

## 37 · Inline wrapper named after the component it lists re-collides after #36 — ✅ Fixed (working tree)
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

## 38 · A discriminated union nested under a field never gets its fields credited — ✅ Fixed (working tree)

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

## 39 · A merged union's shadowed same-name member field still counts as reachable — ✅ Fixed (working tree)

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

## 40 · An object-typed (or array-of-object) query param emits an invalid inline type body — ✅ Fixed (working tree)

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

## 41 · Only servers[0] is ever consulted for @source baseURL — ✅ Fixed (working tree)

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

## 42 · A map field needing a JSON-key alias writes it twice, breaking the selection — ✅ Fixed (working tree)

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

## 43 · Real-union member list and `__typename` use the raw ref name, not the sanitised one — ✅ Fixed (working tree)

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

## 44 · Merged-union field dedup keys on Prop kind, not field name — and ignores type compatibility — ✅ Fixed (working tree)

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

## 45 · No reserved-GraphQL-name guard: an OAS resource literally named "Subscription" collides with the root type — ✅ Fixed (working tree)

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

## 46 · An array `$ref` to another array-typed schema nests an `Arr` inside a `PropArray`, breaking both the field's type name and its selection brackets — ✅ Fixed (working tree)

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

## 47 · A bare array-of-scalar op response is dropped entirely (no Query field, empty selection) — ✅ Fixed (working tree)

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

## 48 · The same `oneOf` used by a request body and by a response is only written once — ✅ Fixed (working tree)

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

## 50 · An `anyOf` with no `oneOf` loses all its members and writes an empty block — ✅ Fixed (working tree)

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

## 51 · An empty response object is left empty when the op's body is selectable — ✅ Fixed (working tree)

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

## 52 · An array whose items wrap another array, written inline, breaks the field name and its selection — ✅ Fixed (working tree)

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

## 53 · A bundled build asks "where am I?" by class name, so every context check answers no — ✅ Fixed (working tree)

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

## 55 · A field that is both `required` and `nullable: true` is emitted non-null — ✅ Fixed (working tree)

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

## 56 · `items: { type: object }` drops the field instead of degrading to `[JSON]` — ✅ Fixed (working tree)

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

## 58 · A discriminated `oneOf` whose members share an `allOf` base emits an orphan base type — ✅ Fixed (working tree)

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

