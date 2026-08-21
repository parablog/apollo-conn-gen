# Generator issues log

Curated, numbered log of non-obvious generator bugs / OAS edge cases. Code comments stay short and
cite an entry instead of carrying the full rationale inline. Every entry has an **OAS:** snippet
showing the input schema that triggers it, a concrete **before → after** example, and an **AST:**
note stating how (or whether) the node tree changed.

**This file holds the open, loop-actionable entries only** — every entry here is `⬜`/`🔴` Open and
carries a `[P1]`-`[P5]` tag. Non-actionable entries (parked, noted, upstream-blocked, theoretical,
or resolved without a dedicated code change) live in `docs/DEFERRED.md` instead — the fix-the-issues
loop (`~/bin/issue-loop.sh`) only ever selects an `⬜`/`🔴` entry from *this* file, so anything not
meant for it belongs there, not here. The 127 fixed ones live in `docs/FIXED.md`. Ids are global
across all three files and never reused:
- open, loop-actionable — `// see docs/issues.md #N`
- deferred, not in the work queue — `// see docs/DEFERRED.md #N`
- fixed — `// see docs/FIXED.md #N`

When an entry is fixed, move it to `FIXED.md` (with its fixture under `tests/resources/oas/` and
its test) and repoint the comments that cite it. When an entry turns out not to be active work —
parked, theoretical, upstream-blocked, or already covered by tests with no code change — move it to
`DEFERRED.md` instead and drop its priority tag (it no longer needs one there).

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` tracks priority/gaps and may link to these ids.

Style: keep entries scannable — short labeled bullets, **one fact per line**, example near the top;
no paragraph-blobs. The example carries the weight; prose only adds what the example can't show.

Status: ⬜ Open · 🔴 Open. (`docs/DEFERRED.md` has the rest: 🟡 Partly done · ⏸ Parked · 📋 Noted ·
✅ Covered.)

Priority (assigned 2026-08-20; every entry in this file has one): P1 real production risk · P2
confirmed compose failure, narrower blast radius · P3 tracking/umbrella, not independently
actionable · P4 low real-world impact / DX only · P5 latent/theoretical or explicitly out of scope.

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

## 61 [P5] · `@type` and `type` on the same object both emit as `type` — ⬜ Open

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

## 122 [P3] · All-ops sweep findings: four cross-op failure classes invisible to per-op coverage — ⬜ Open (umbrella)

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

## 132 [P4] · Most JSON-degrade sites still give no signal in the generated schema, only the build log — ⬜ Open (umbrella)

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
