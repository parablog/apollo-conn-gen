# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry here (`// see docs/issues.md #N`) instead of carrying the full rationale inline. Every
entry has a concrete **before → after** example, and fixed ones have an executable companion fixture
under `tests/resources/oas/`.

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` tracks priority/gaps and may link to these ids.

Status: ✅ Fixed · ⬜ Open.

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
**Refs:** `src/oas/nodes/comp.ts` (`updateName`), fixture `inline-allof-prop.yaml`.

---

## 8 · Resolved `#/paths` schema refs leak the raw pointer as the type name — ⬜ Open
**Symptom:** `INTERNAL_ERROR` / `INVALID_GRAPHQL` / `CONNECTORS_UNRESOLVED_FIELD`. ~82/145 DigitalOcean
ops; gates DigitalOcean at ~35%.
**Cause:** #3 made `lookupRef` *resolve* `#/paths/…` schema refs, but the resolved type is named by the
raw pointer; the ref-name extractor (`RemoveRefConverter`) only strips `#/components/…`.
**Proposed fix:** derive a clean name from the `#/paths` pointer tail. Low risk; same family as #3.
Expected: DigitalOcean ~35% → ~80%.
**Example** — `sshKey: { $ref: '#/paths/~1v2~1account~1keys/get/.../properties/sshKeys/items' }`:
```graphql
type #/paths/~1v2~1account~1keys/get/responses/200/.../properties/sshKeys/items { … }  # ✗ now
type SshKeysItem { … }                                                                  # ✓ goal
```
**Refs:** `src/oas/utils/naming.ts` (`RemoveRefConverter`/`getRefName`), `factory.ts` naming of resolved
refs.

## 9 · Inline-type name collisions collapse distinct shapes — ⬜ Open
**Symptom:** selection references a field missing on a type → `SELECTED_FIELD_NOT_FOUND` (~109;
googlebooks, github).
**Cause:** two structurally-different inline objects derive the same property-based name and are deduped
by name, losing fields. (The historical "duplicate Addressable/Extensible" problem.)
**Proposed fix (sketch):** real collision handling — structural distinction or deterministic suffixing
for inline types that share a name but differ in shape.
**Example** — Google Books volume `saleInfo` vs `offers`:
```graphql
# saleInfo.listPrice -> { amount }      offers[].listPrice -> { amountInMicros }
# both named ListPrice; the {amount} one wins:
type ListPrice { amount: Float }
# selection for offers.listPrice still asks for amountInMicros -> SELECTED_FIELD_NOT_FOUND
# goal: two distinct types (e.g. ListPrice + ListPrice2 / structural suffix)
```
**Refs:** `src/oas/nodes/obj.ts` (`updateName`/`resolveNameConflict`), naming.

## 10 · Abstract-types (v0.4) path infinite-loops on recursive schemas — ⬜ Open
**Symptom:** `consolidateUnions:false` + connect v0.4 busy-loops (100% CPU) on Confluence's recursive
`Content`/`relation` schemas; the coverage harness skips the whole Confluence abstract pass. Default
v0.3 path is fine.
**Cause:** missing recursion/cycle guard in the abstract-types generation path.
**Proposed fix:** bound recursion / cycle-detect before the abstract path can be trusted.
**Example**:
```
get:/wiki/rest/api/content/{id}/descendant   (abstract pass)
# Content -> children -> Content -> …  : no cycle guard -> hang
```
**Refs:** abstract path in `union.ts` / `interfacePromotion.ts`; harness `tools/coverage-spec.mts`.
