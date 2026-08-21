# Generator tasks log

Curated, numbered log of non-obvious generator bugs, OAS edge cases, and scoped feature work. Code
comments stay short and cite an entry instead of carrying the full rationale inline. Every entry
carries a type label and, where it fits the kind of work, an **OAS:** snippet showing the input
schema that triggers it, a concrete **before → after** example, and an **AST:** note stating how
(or whether) the node tree changed.

**Type label.** Every entry's heading carries a bracketed label naming what kind of work it is —
`[BUG]` (a generator defect) or `[FEAT]` (planned/scoped feature work) today, with room for more
(`[CHORE]`, `[DOCS]`, `[REFACTOR]`, …) as they come up. The label is not a priority signal by
itself — a `[FEAT]` can still be P1 if it blocks something real, a `[BUG]` can be P5 if it's
theoretical.

**This file holds the open, loop-actionable entries only** — every entry here is `⬜`/`🔴` Open and
carries a `[P1]`-`[P5]` tag. Non-actionable entries (parked, noted, upstream-blocked, theoretical,
or resolved without a dedicated code change) live in `docs/DEFERRED.md` instead — the fix-the-issues
loop (`~/bin/issue-loop.sh`) only ever selects an `⬜`/`🔴` entry from *this* file, so anything not
meant for it belongs there, not here. The 127 fixed/shipped ones live in `docs/FIXED.md`. Ids are
global across all three files, shared by bugs and features alike, and never reused:
- open, loop-actionable — `// see docs/TASKS.md #N`
- deferred, not in the work queue — `// see docs/DEFERRED.md #N`
- fixed — `// see docs/FIXED.md #N`

When an entry is fixed/shipped, move it to `FIXED.md` (with its fixture under `tests/resources/oas/`
and its test) and repoint the comments that cite it. When an entry turns out not to be active work —
parked, theoretical, upstream-blocked, or already covered by tests with no code change — move it to
`DEFERRED.md` instead and drop its priority tag (it no longer needs one there).

This is the **committed, canonical** list. (`KNOWN_ISSUES.md` at the repo root is gitignored local
scratch — not this.) `ROADMAP.md` still tracks the large, ongoing, multi-slice architectural items
(R4/R5/R6/R7/R10 — error handling, dynamic headers, batch resolution, richer JSONSelection, reusable
`@mapping`) that are deliberately NOT in this file: they're too large/partially-implemented to be a
single loop-actionable pickup, and this file's loop treats every open entry as equally eligible by
default (no opt-in gate) — dropping a big-bang architectural item in here would let it get attempted
unsupervised. Smaller, well-scoped R-items do move here once they're ready to be picked up
loop-style — see #138-#142, migrated 2026-08-21.

Style: keep entries scannable — short labeled bullets, **one fact per line**, example near the top;
no paragraph-blobs. The example carries the weight; prose only adds what the example can't show. For
`[BUG]` entries the labeled bullets are typically `**Symptom:**`/`**OAS:**`/`**Cause:**`/`**Refs:**`;
for `[FEAT]` entries, where "symptom"/"cause" don't fit, use `**Why:**` (the motivation) and
`**Shape:**` (the proposed mechanism) instead — `**OAS:**`/example stays wherever a concrete input
shape exists, `**Refs:**` always stays.

Status: ⬜ Open · 🔴 Open. (`docs/DEFERRED.md` has the rest: 🟡 Partly done · ⏸ Parked · 📋 Noted ·
✅ Covered.)

Priority (assigned 2026-08-20, extended 2026-08-21 to the migrated feature entries; every entry in
this file has one): P1 real production risk · P2 confirmed compose failure, narrower blast radius ·
P3 tracking/umbrella, not independently actionable · P4 low real-world impact / DX only · P5
latent/theoretical or explicitly out of scope.

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

## 61 [BUG] [P5] · `@type` and `type` on the same object both emit as `type` — ⬜ Open

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

## 122 [BUG] [P3] · All-ops sweep findings: four cross-op failure classes invisible to per-op coverage — ⬜ Open (umbrella)

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

## 132 [BUG] [P4] · Most JSON-degrade sites still give no signal in the generated schema, only the build log — ⬜ Open (umbrella)

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

**Shape:** two groups, each needing its own new writer plumbing (folded in from `ROADMAP.md`'s
former R16 — same 13-site scope, no separate id; merged into this entry 2026-08-21):
- **11 sites produce a bare `Scalar` node or write the literal string `'JSON'` directly into a
  type/operation body** — no existing comment channel at all. Landing position varies and needs a
  design per shape: `Map.generate()`'s `value:` line (its own type body, not a `Prop`), a `Union`'s
  zero-field merge written straight into an operation's return-type slot (natural home: extend the
  operation-level docstring in `get.ts`/`post.ts`, already computed before `resultType.generate()`
  runs), a `Param`'s degraded arg type (GraphQL supports argument descriptions syntactically, never
  used anywhere in this codebase today), and several bare-`Scalar` sites in `factory.ts` whose
  landing spot depends entirely on the caller (`Res` return type, `Union` member, `Map` value,
  `Param` type).
- **2 sites (`propObj.ts:58`, `propObj.ts:62`)** decide "this is JSON" *inside* `getValue()`, which
  runs after `Prop.generate()` has already written the description — needs a new overridable hook
  on the `Prop` base class (e.g. `effectiveDescription()`) rather than a static field read.

**AST:** none of the 13 — this only changes what a `Prop`/writer emits alongside an already-JSON
field, never which node kind gets built.

**Refs:** `docs/FIXED.md #133` (the 4 sites already done, same design: `warn()` and the schema note
share one reason string, `Schemas.withDegradeNote`).

## 138 [FEAT] [P4] · Accept a folder of independent OAS specs, not just a single file — ⬜ Open

**Why:** JSON mode already accepts `<file|folder>` (`src/cli/json.ts`), but OAS mode is
single-file. Real APIs publish multiple independent OAS documents in one folder (e.g.
Sanity's query + mutation specs). `oas-normalize` and `oas`'s `Oas` class are strictly
single-document, so folder support means merging the docs into one `OASDocument` before
parsing — nothing downstream changes.

**Shape (designed, approved, parked before this migration):** `OasGen.fromFolder` (per-file
normalize via the existing `fromFile` pipeline) + a merge helper in `src/oas/utils/` + CLI
stat-dispatch on the `<source>` arg. Compatibility gate (same 3.x minor, deep-equal `servers` and
`jsonSchemaDialect`), root-`security` push-down onto operations before merging, any collision
(paths, components, operationIds) is a hard error naming both files, non-OAS files sniffed
(`openapi`/`swagger` root key) and skipped with a warning. Tests run off small committed fixtures
under `tests/resources/oas/folder/`.

**Priority rationale:** no OAS document in the current corpus needs this — real-world-motivated
(Sanity) but nothing in-repo is blocked on it today, so P4 (capability gap, not a failure).

**Refs:** `src/cli/json.ts` (the existing folder-input precedent for JSON mode), `src/oas/oasGen.ts`
(`fromFile`, the per-file pipeline `fromFolder` reuses). A prior detailed plan draft exists at
`/Users/fernando/.claude-personal/specs/loop-JNRpnSgn/plan.md` (local, uncommitted — re-verify it's
still current before relying on it, it predates this migration).

## 139 [FEAT] [P3] · Selections are flat emitted-name path lists, not spec-position addressed — ⬜ Open (umbrella)

**Why:** selections are flat lists of leaf-path strings whose segments embed *emitted* names. That
one representation is behind three standing problems: `docs/DEFERRED.md #73` (name-derived ids make
stored selections fragile to browse order — the parked structural-ids cure lands here),
`docs/FIXED.md #49`-adjacent (selection size scales with tree size: hubspot lists is 38,300 path
strings for "everything under this op", measured in `docs/FIXED.md #118`), and
`docs/DEFERRED.md #119`'s deferred collect-walk map (the per-path re-resolve disappears with the
representation). Decided during `docs/FIXED.md #118` (2026-08-18): staged — the prefix-set fix
shipped first; this is the durable half.

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

**Not independently actionable as filed** — this is a module rewrite with a real cross-repo
migration surface (the web app's stored selections), not a single-PR fix. P3 (umbrella/tracking)
rather than a normal bug priority; whoever picks this up should expect to split it into sub-steps
before implementing, the same way #122/#132 are handled.

**Refs:** `docs/DEFERRED.md #73` (parked cures, sized), `docs/DEFERRED.md #119`; `docs/FIXED.md #118`
(the #49-adjacent measurements). Related: `docs/FIXED.md #13`/`#89` (path-dependent divergence
family).

## 140 [FEAT] [P4] · Hand-authored content has no way to survive regeneration (no CUSTOM-region round-trip) — ⬜ Open

**Why:** found comparing `gen`'s output against `tools/connect-gen` (Rust)'s committed output for
the 5 real connectors in `graphos-service-factory` (see that repo's `docs/ts-gen-comparison.md`).
Rust's round-trip mechanism (`tools/connect-gen/src/emit/regions.rs`) lets a human correct output
the OpenAPI spec itself gets wrong — Omni's real API disagrees with its own spec on one shape
(`omni_foldersListLive`); a human wrote the correct field by hand, inside a `# === CUSTOM
extra-query-fields === ... # === END CUSTOM extra-query-fields ===` marker pair. On the next
regen, Rust extracts that block from the old file and splices it back into the new one. `gen` has
no equivalent at all: hand-editing generated output is a dead end today, since the next run
silently overwrites it with no error and no signal that anything was lost.

**Distinct from #132's JSON-degrade comments, not overlapping:** #132 documents *why the generator
itself* fell back to `JSON` — it's automatic, spec-derived, and fires when the spec is ambiguous.
CUSTOM regions are for when the spec is not ambiguous but *wrong*, or when the desired output has no
corresponding OAS operation at all (net-new fields, or infrastructure like an extra `@link`/
`@source` the derivation logic has no way to infer) — nothing a degrade-note can annotate, because
there's no automatically-derived output to attach a comment to in the first place.

**Shape (ported from Rust, `regions.rs`):**
- `extract(content)`: scan committed output for `# === CUSTOM <name> ===` / `# === END CUSTOM
  <name> ===` marker pairs (five known names: `extra-links`, `extra-sources`, `extra-types`,
  `extra-query-fields`, `extra-mutation-fields`); body is every line between them.
- `splice(skeleton, regions)`: same marker scan over the freshly generated output; insert each
  non-empty extracted body between its matching marker pair. A region name outside the known five
  is a hard error, never silently dropped.
- Unlike Rust, TS's raw output has no markers in it at all (Rust's skeleton is templated with them
  built in; TS's isn't) — so `splice` also needs to decide *where* each marker pair goes in fresh
  output: `extra-types` just before the first of `type Query {`/`type Mutation {`;
  `extra-query-fields`/`extra-mutation-fields` as the last field(s) inside their respective root
  type, before the closing `}`; `extra-links`/`extra-sources` after the existing `@link`/`@source`
  blocks. Only implement an insertion point once a real non-empty example exists for it — hard-fail
  naming the region rather than guessing.

**A working prototype already exists, external to `gen`:** `graphos-service-factory/scripts/gen-ts.mjs`
(`extractCustomRegions`/`injectCustomRegions`) implements exactly this, as a post-processing bolt-on
around raw `gen` CLI output. It only implements injection for the two regions any of the 5 real
committed schemas actually use non-empty today (`extra-types`, `extra-query-fields`) and hard-fails
on the other three rather than guess — worth reusing that same scoping discipline, and possibly the
fixture tests, when this lands inside `gen` proper (`scripts/gen-ts.test.mjs` in that repo has the
TDD cases: splice + hard-fail-on-unknown).

**Refs:** `tools/connect-gen/src/emit/regions.rs` (the Rust mechanism to port);
`graphos-service-factory/scripts/gen-ts.mjs` + `gen-ts.test.mjs` (the external prototype);
`graphos-service-factory/docs/ts-gen-comparison.md` (the comparison that surfaced this).

## 141 [FEAT] [P4] · OAS parameter `default` values never become a GraphQL argument default — ⬜ Open

**Why:** found in the same Rust-comparison audit. Rust reads an OAS parameter's declared `default`
and emits a real GraphQL argument default (`limit: Int = 50`); `gen` never does, across every one of
the 5 real connectors compared (249 instances found by the field-level structural-equivalence walk
in `graphos-service-factory/scripts/semantic-diff.mjs`). A client that omits the argument gets
materially different behavior between the two tools — Rust supplies the spec's own default, `gen`
supplies none (`null`/absent, whatever the connector's HTTP layer does with a missing query param).

**OAS** (the shape that triggers it):
```yaml
parameters:
  - name: limit
    in: query
    schema: { type: integer, default: 50 }
```

**Shape:** the `default` value is already read from the spec during param/argument construction
(`Param`-related nodes) — this is plumbing that existing value through to the emitted GraphQL
argument's `defaultValue`, not new spec-reading. Should compose the same way scalar/enum defaults
already do elsewhere in the emitter — literal value, printed via the existing value-node printing
path.

**Refs:** `graphos-service-factory/docs/ts-gen-comparison.md`; the 249-instance count came from
running `semantic-diff.mjs`'s `structuralDiff()` against all 5 committed schemas.

## 142 [FEAT] [P4] · Identifier-shaped string properties emit as `String`, never `ID` — ⬜ Open

**Why:** found in the same comparison. Rust promotes properties that are clearly identifiers
(`*Id`-suffixed, or an `id` field itself) from `String` to GraphQL's `ID` scalar; `gen` emits
`String` for all of them (954 instances found across the 5 real connectors — the single largest
difference category in the whole comparison). `ID` is more than a style choice to GraphQL tooling:
cache normalization (Apollo Client's `__typename`+id keying), codegen, and persisted-query tooling
all treat `ID` fields as identifier-shaped signals that plain `String` doesn't carry.

**OAS/example:** `Confluence_AdminKeyResponse.accountId` is `ID` in the committed Rust schema,
`String` in `gen`'s output, for the identical OAS input.

**Shape:** needs the exact trigger condition read out of Rust's source first — likely a
name-pattern heuristic (property name ends in `Id`/`_id`, or is literally `id`) rather than
anything OAS's `type: string` schema itself signals structurally. Port the heuristic, then validate
it against the same 5 real specs for false positives (a string property that merely *contains* "id"
but isn't actually a reference/identifier) before shipping it as a default-on behavior.

**Refs:** `graphos-service-factory/docs/ts-gen-comparison.md`.
