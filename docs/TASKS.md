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
meant for it belongs there, not here. The 167 fixed/shipped ones live in `docs/FIXED.md`. Ids are
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

## 174 [BUG] [P4] · Generating one docusign mutation can need more than 8 GB of memory — ⬜ Open

**Symptom:** the coverage harness's per-op sweep of docusign's 247 mutation ops dies with
`ERR_WORKER_OUT_OF_MEMORY` below a 16 GB worker heap — generation alone, before any compose runs.

- The spec is 2 MB; whole-spec production generation emits a ~1-2 MB schema without drama.
- A peak three orders of magnitude above the output size is not explained by the spec being big.
- The harness now sweeps heavy specs one at a time (`HEAVY_SPEC_BYTES`, `tools/coverage-spec.mts`)
  so runs complete — that contains the symptom, it doesn't explain it.

- Narrowed 2026-08-27 (second failed sweep): per-op generation of all 247 fits under 16 GB — an
  in-process run finished every generation and 230 composes at that limit. The kill is the
  ALL-OPS pass: one generation holding all 247 mutation subtrees in a single tree passes 16 GB.
  The GET side's whole-schema generates fine, so the weight is the envelope INPUT trees.

**First step is measurement, not a fix:** find WHICH op peaks (`COV_TRACE=1` names each op as it
generates) and where the memory lives (`node --max-old-space-size` bisection, or a heap snapshot
around the worst op). File the real cause as its own entry once known.

**Correction 2026-09-01:** the sweep worker mutes `console.log` (`tools/coverage-spec.mts:27-29`),
so its OOM was never the trace flood — see #180 for what remains.

**Refs:** `tools/coverage-spec.mts` (`COV_WORKER_HEAP_MB`, the heavy-sweep token),
`tests/resources/oas/docusign.json` (local vendor spec), `TEST_CORPUS.md` (DocuSign).

## 180 [BUG] [P3] · All-ops mutations generation OOMs even with logging muted — real memory growth in the combined-selection walk — ⬜ Open

**Symptom:** ONE `generateSchema` over all 247 docusign mutation selections, `trace()` muted,
16 GB heap: genuine OOM at ~27.7 minutes ("Ineffective mark-compacts near heap limit", the
V8 heap-limit signature). External 10 s RSS sampling reads lower (11.7 GB) but demonstrably
misses the final spike — it under-read the unmuted crash the same way while V8's own GC log
showed 16.37 GB right before death. This is the bug that blocks docusign's all-ops mutations
column in the sweep.

- Per-op cost is fine: all 247 ops generated individually total 387 MB SDL, max RSS 3.9 GB,
  worst single op 62 s. The combined walk is the problem, not the trees.
- Hot pattern in the walk: `compositeTemplates > inlineTemplates > documents > tabs >
  notarySealTabs > notarySeal` re-expands each sibling `*Metadata` field (all the same
  `propertyMetadata` shape) per path — the same path-multiplicity class as #174/#10, but on the
  input/body side, compounding across templates × documents × tabs.
- Where per-op bytes live (heaviest op, 27.1 MB SDL): 25 MB is `body: """..."""` mapping
  blocks; the 155 `input` defs are 1 MB. #174's "envelope INPUT trees" hypothesis refined: the
  weight is the body mapping selections, not the input type definitions.

**Not the same bug as #179:** muting trace does NOT prevent the crash, it only delays it —
12.2 min to OOM unmuted, 27.7 min muted (~2.3x). The two problems stack but are independent;
fixing #179 alone leaves this one killing the pass. Raising `COV_WORKER_HEAP_MB` is unproven
relief at best — growth reached 16 GB steadily, so more heap likely buys minutes.

**2026-09-01:** Stack leak ruled out as the driver (#181): 1 leak per spec, not per op. Re-run
of the 247-op all-ops pass after the fix was inconclusive: killed at 2h02m with the machine
23 GB into swap (other sessions running); RSS read 3.2 GB at the 1 h mark — lower than the 16 GB
seen at the earlier crash, but not comparable under thrashing. Next: rerun on a quiet machine
with `--trace-gc` for V8's own heap numbers. Prime suspect to measure first:
`collector.expanded` — the `everythingUnder` expansion keeps one full path string per selection
line (a million-line op is hundreds of MB of paths), held for all 247 ops in one `collect`;
second: the `Writer` buffer (one array entry per write).

**2026-09-01 (cont'd):** `collector.expanded` measured directly instead of estimated — all 247
docusign mutation ops, `getTypes`-only (skips writer/parse), one process: **9,123,861 path
strings, 4.38 GB of raw string bytes, 11.4 min wall, 4.81 GB peak RSS.** Per-op top is
`put:/v2.1/accounts/{accountId}/templates/{templateId}/documents/{documentId}` at 372 MB /
688,688 paths — the heaviest op by expanded-path bytes is NOT the heaviest by SDL bytes (that
was `post:/v2.1/.../envelopes` at 27.1 MB SDL); correcting that assumption here. The capped
`--max-old-space-size=6144 --trace-gc` all-ops run was judged unnecessary and skipped — these
numbers already answer the question.

**Conclusion so far:** `collector.expanded`'s path-string list is the measured prime suspect —
the real all-ops `generateSchema` builds it in one combined `collect()` call across all 247
selections at once, so (unlike this sequential per-op measurement, which disposes between
calls) that one array would hold something close to the full 4.38 GB simultaneously, on top of
the rest of the tree/Writer. Fix design is still open — not yet acted on.

**2026-09-08:** Built and parked, not merged — branch `issue-180-shared-input-shapes` at
`e4105af`. One `InputShape` per schema identity now stands in for a fresh subtree per position,
for a wildcard (`>**`) body selection. What it achieved: the gate op
(`post:/v2.1/.../envelopes`) went from 24 MB SDL / 62 s to 1.1 MB / 5 s; the first 62 of the 247
mutations, combined in one `generateSchema` call, went from 80 MB / 217 s to 3 MB / 1 s. What
stopped it: one digitalocean response type (`Alerts`, from `/v2/monitoring/alerts`) prints as
four separate names instead of one shared name in a combined multi-op build, cause not found;
an explicit (non-`>**`) body field selection never moved onto the shared path, still builds
per-position; and the full 247-mutation run still peaks at 5.2 GB against the 2 GiB bar this
entry set — a heap snapshot at the heaviest quarter placed the remaining cost on the response
side (`Scalar`/`PropScalar` nodes, 99.98%+ `kind: 'type'`), which this fix never touched, since
it only shares request-body input types. The next attempt needs a fresh design, not a cleanup of
this branch.

**Refs:** #179 (the crash half), #174 (superseded narrowing — the sweep OOM was the pipe
flood, not tree weight), #181 (the stack leak — real but ruled out as #180's driver),
docs/DEFERRED.md #139 (granularity mode — the likely product-level relief for docusign-class
specs), measurement scripts in the session scratchpad, branch `issue-180-shared-input-shapes`.

## 183 [BUG] [P3] · `ResponseCoverageCheck` reports a false `RESPONSE_NOT_READ` when the spec's own `responses` was empty — ⬜ Open

**Symptom:** #176's check, run on `malformed-response-schema-crashes.yaml`'s `get:/markers` (an
op that documents no responses at all — `responses: {}`), reports `` `get:/markers` returns
`success` but its selection reads none of them `` even though the generated selection is exactly
`success: $(true)`, the intended, legitimate synthetic-response shape.

**Cause:** `checkAndFixMalformedResponses` (`src/oas/oasGen.ts:42-55`, #148) runs before
validation and, for any operation whose raw `responses` is `{}`, mutates the parsed document in
place: `responses['200'] = SYN_SUCCESS_RESPONSE`. `ResponseCoverageCheck.declared()`
(`src/oas/lint/checks/responseCoverage.ts`) reads `op.operation.schema.responses` — the same,
now-patched document — so it can no longer tell "the spec truly declared nothing" apart from
"this is #148's own placeholder," and treats the synthetic `{ success: Boolean }` shape as real
spec content. Separately, `success: $(true)` is a value literal (`readsFrom.pathParts` is empty),
so even the placeholder's own field is never credited as "read" by `readKey()`, which only looks
at `pathParts[0]`, not the alias — the same shape as the `#176` plan's own deliberate `$(true)`
skip in `run()`, just missed here because the field has an alias (`success:`) and so is not the
bare-`$` case that skip is written for.

**Fix direction:** either have `declared()` recognize `SYN_SUCCESS_RESPONSE`'s own marker
(`format: '__apollo_synthetic'`, `APOLLO_SYNTHETIC_OBJ` in `src/oas/schemas/index.ts`) and treat
it as "nothing declared" the same way an empty `responses` would answer, or have `checkAndFixMalformedResponses`
leave a distinguishable trace instead of writing the literal synthetic response object into the
parsed document. One corpus hit today; any spec with a genuinely empty `responses: {}` on some
operation reproduces it.

**Refs:** `src/oas/oasGen.ts` (`checkAndFixMalformedResponses`), `src/oas/lint/checks/
responseCoverage.ts` (`declared`, `run`'s bare-passthrough skip), `src/oas/schemas/index.ts`
(`SYN_SUCCESS_RESPONSE`), #148 (the fix that introduced the mutation), #176 (the check this
affects), `tests/resources/oas/malformed-response-schema-crashes.yaml`.

## 184 [BUG] [P4] · Two contradictory nullable-`oneOf` shapes vanish with no trace — ⬜ Open

**Symptom:** #176's check flags `required-nullable-oneof.yaml`'s `doubleNull` and `constrained`
fields as declared-but-unread. Both are already commented in the fixture as deliberately
unhandled: `doubleNull: oneOf: [null, null]` ("two null choices cancel out... left alone") and
`constrained: { type: string, oneOf: [string, null] }` ("`type: string` ANDs with it, so null is
rejected... left alone"). Confirmed intentional — #57/#60 gave every other nullable-`oneOf` shape
in the same fixture a real field or a documented `JSON` degrade; these two are the only ones with
neither, and no comment marks them as cut.

**Cause:** same family as #182 — a shape #60's nullable-`oneOf` handling recognizes as
unbuildable is dropped silently rather than JSON-degraded (the way `nullOnly: oneOf: [null]`
already is, one line above `doubleNull` in the same fixture) or commented (the way a cycle is).

**Fix direction:** route these two through the same `JSON`-with-a-reason fallback `nullOnly`
already gets, for consistency — a self-contradictory schema is exactly what that fallback exists
for.

**Refs:** `tests/resources/oas/required-nullable-oneof.yaml`, #57 (enum promotion), #60 (the
nullable-`oneOf` fix this is the unhandled edge of), #176.

## 186 [REFACTOR] [P4] · Three copies of the "choice of plain values" member test — ⬜ Open

**Where:** `Schemas.holdsPlainValues` (`src/oas/utils/schemas.ts:50-67`),
`Schemas.holdsMixedPlainAndObjectValues` (`schemas.ts:72-87`), `Map.holdsPlainValuesOrEmptyObject`
(`src/oas/nodes/map.ts:237-252`).

**What repeats:** reading `oneOf ?? anyOf`, resolving each `$ref` member through
`context.resolvePointer`, dropping `type: 'null'` members, and the same `isPlainValue` check
(`member.enum != null || GqlUtils.gqlScalar(member.type) !== false`) — copied three times.

**What differs:** only which member shapes each one is asking about — a plain value
(scalar/enum), an object with no properties (`Schemas.isShapelessObject`), or a real object
(anything else).

**Also the wrong home:** the third one is a schema-shape check living as a private static on
`Map`, and pulled the `GqlUtils`/`ReferenceObject` imports into `map.ts` just for it. When it
moves, name it like its siblings — `holds<what>Values`, e.g. `holdsPlainAndEmptyObjectValues`.

**Same smell one level up:** the twin reason ladders `PropArray.jsonReason`
(`propArray.ts:86-106`) and `Map.arrayValueJsonReason` (`map.ts:~257-275`) repeat the same
pattern — their strings are the user-facing NEEDS ATTENTION text tests assert on, so they can
only move together with the tests that pin them.

**Acceptance:** one shared member check, every caller's output byte-identical (corpus counts
unchanged), `map.ts` loses the helper and the two imports it only needed for it.

**lookupRef vs resolvePointer:** settled in #185 — inspect-only code uses `resolvePointer`, so the
shared version this entry plans doesn't bring the old bug back.

**Refs:** #86, #131, #182, #185.

## 192 [FEAT] [P4] · R1: key entities returned inside a one-field envelope — ⬜ Open

**Where:** `unwrapToObj` (`src/oas/nodes/entity.ts`).

**OAS** (digitalocean) — a by-id GET wrapping the resource in a single named field:
```yaml
/v2/droplets/{droplet_id}:
  get:
    parameters: [{ name: droplet_id, in: path, required: true, schema: { type: string } }]
    responses:
      '200':
        content:
          application/json:
            schema:
              properties:
                droplet: { $ref: '#/components/schemas/Droplet' }
Droplet:
  properties: { id: { type: string }, name: { type: string } }
```
Generates a response type `v2DropletsByDropletIdResponse { droplet: Droplet }`. `Droplet` itself
has `id`, but `unwrapToObj` peels only one `Res` layer and stops at the envelope object — it never
looks at the envelope's own single field.

**What's missing:** an entity reachable one level deeper, behind a single-field wrapper, never
gets a `@key` at all, not even a wrong one — it's silently skipped.

**Counts** (corpus sweep, `--infer-entity-resolvers` on, 2026-09-04): digitalocean 26/26 by-id
GETs miss this way; asana 26/26 (`{ data: ... }` wrapper); sendgrid 6 of 43.

**Direction:** when the response unwraps to a plain `Obj` with exactly one field whose own type is
itself a plain `Obj` (or a list of one), key the *inner* entity instead, with a type-level
`@connect` whose selection starts at the envelope field (`droplet: { id }`, not a bare `{ id }`).

**Note:** `--infer-entity-resolvers` is opt-in; nothing here changes default output.

**Refs:** `src/oas/nodes/entity.ts` (`unwrapToObj`), `docs/FIXED.md #161`, `docs/FIXED.md #189`.

## 193 [FEAT] [P4] · R1: key allOf-composed responses — ⬜ Open

**Where:** `unwrapToObj` (`src/oas/nodes/entity.ts`).

**OAS** (box) — an allOf-composed by-id response:
```yaml
/files/{file_id}:
  get:
    parameters: [{ name: file_id, in: path, required: true, schema: { type: string } }]
    responses:
      '200':
        content:
          application/json:
            schema:
              allOf:
                - $ref: '#/components/schemas/FileBase'
                - $ref: '#/components/schemas/FileFullExtra'
```
Generates a `Composed` type (`File--Full`) merging both branches' properties, one of which is
`id`. `unwrapToObj` rejects any `Composed` outright, before any id/alias check ever runs.

**What's missing:** the entity-resolver check never looks at the composed type's own merged
fields — a real `id` sitting in one of the `allOf` branches is never considered.

**Counts** (corpus sweep, `--infer-entity-resolvers` on, 2026-09-04): box 16 of 34 by-id GETs,
including its three headline resource types (File, Folder, User); sendgrid 11 of 43.

**Direction:** run `findKeyField` over the composed type's own merged property set (the same set
`Composed` already exposes for field generation), the way it runs over a plain `Obj`'s `props`.

**Note:** `--infer-entity-resolvers` is opt-in; nothing here changes default output.

**Refs:** `src/oas/nodes/entity.ts` (`unwrapToObj`), `src/oas/nodes/comp.ts` (`Composed`),
`docs/FIXED.md #161`.

## 194 [FEAT] [P4] · R1: widen the id alias beyond `<TypeName>Id` — ⬜ Open

**Where:** `isIdAlias` / `findKeyField` (`src/oas/nodes/entity.ts`, from #189).

**Cases** (corpus sweep, `--infer-entity-resolvers` on, 2026-09-04):
- a synthesized response type name that no type-name rule can ever match, since the name is built
  from the whole op path, not the resource: incidentio 39/39 by-id GETs (`IncidentsShowResultV2`
  for `GET /v2/incidents/{id}`), mailchimp 20, omni 8, sendgrid's `AlertsByAlertIdResponse` for
  `GET /alerts/{alert_id}`.
- a real, named type whose name just isn't the param's stem: openai's `OpenAIFile` for
  `GET /files/{file_id}`, box's `MetadataTemplate` for `GET /metadata_templates/{template_id}`.
- asana's `task_gid` path param against a field literally named `gid`, not `id`.

**Directions** (not yet chosen between):
- match the path's own last static segment (singularized, the same way #161's link-field naming
  already singularizes a segment) against `<segment>Id`, e.g. `/incidents/{id}` -> "incident" +
  "Id".
- a `<TypeName><keyField>` form, so a case like asana's `gid` isn't hardcoded to `id`.

**Known rejection:** widening to accept any bare `*Id`-named param regardless of the type was
already considered and rejected while building #189 — it produces false positives on sub-resource
paths (e.g. `/customer/{customerId}/account` would key `Account` on `customerId`).

**Note:** `--infer-entity-resolvers` is opt-in; nothing here changes default output.

**Refs:** `src/oas/nodes/entity.ts` (`isIdAlias`, `findKeyField`), `docs/FIXED.md #189`.

## 195 [FEAT] [P4] · Confluence-style shared result types: known no-key case, no direction yet — ⬜ Open

**Where:** `inferEntityResolvers` (`src/oas/nodes/entity.ts`).

**OAS** (confluence) — three unrelated by-id GETs answering the same shape:
```yaml
/wiki/rest/api/user/watch/content/{contentId}:
  get: { parameters: [{ name: contentId, in: path, required: true, schema: { type: string } }],
         responses: { '200': { content: { application/json: { schema: { $ref: '#/components/schemas/UserWatch' } } } } } }
/wiki/rest/api/user/watch/label/{labelName}:
  get: { parameters: [{ name: labelName, in: path, required: true, schema: { type: string } }],
         responses: { '200': { content: { application/json: { schema: { $ref: '#/components/schemas/UserWatch' } } } } } }
/wiki/rest/api/user/watch/space/{spaceKey}:
  get: { parameters: [{ name: spaceKey, in: path, required: true, schema: { type: string } }],
         responses: { '200': { content: { application/json: { schema: { $ref: '#/components/schemas/UserWatch' } } } } } }
```
All three by-id GETs resolve to the same `UserWatch` type, with three different, unrelated path
param names (`contentId`, `labelName`, `spaceKey`), none of which name a real key on `UserWatch`
itself — it's a boolean-ish "am I watching this" answer, not an identified resource.

**Symptom:** none of the three qualifies for `@key` today, correctly — but it isn't obvious
whether that's simply correct (this type genuinely isn't a keyable entity) or a shape worth its
own rule.

**Status:** recorded as a known no-key case from the corpus sweep (`--infer-entity-resolvers` on,
2026-09-04); no proposed direction yet.

**Refs:** `src/oas/nodes/entity.ts`, `docs/FIXED.md #161`.

## 198 [BUG] [P4] · `--transform-rules` renames a field but not its own response type — ⬜ Open

**Where:** `writeOpName` (`src/oas/nodes/get.ts:206-214`).

**Symptom:** `context.generateOptions.mapper.operationName(name)` runs on the SDL field text only,
after `getGqlOpName()` already returned and named that op's synthesized (non-`$ref`) response
type. A transform rule that renames `createPet` to `addPet` renames the field, but the response
type stays `CreatePetResponse` — field and type drift apart.

**Direction:** move the mapper call (or an equivalent one) inside `getGqlOpName()` itself, the way
`docs/FIXED.md #197` does for `useOperationIds`, so every consumer of the name — the field and any
synthesized response/input type — reads the same, already-mapped string.

**Refs:** `src/oas/nodes/get.ts` (`getGqlOpName`, `writeOpName`), `src/oas/mapper/`,
`docs/FIXED.md #197`.

## 199 [DOCS] [P5] · Renaming flags don't document their effect on saved selections — ⬜ Open

**Where:** `README.md`, the `servicePrefix` and `keepFieldNames` rows of `### OasGen options`.

**Symptom:** `--service-prefix` and `--keep-field-names` both rename nodes that a saved selection
can descend into, and both go through the same `SelectionPath.resolveSegment` recover-or-fail path
(#72/#135) that `docs/FIXED.md #197` documents for `useOperationIds` — recover to the same node
when the rename left exactly one candidate it could still mean, or an explicit `Could not find
type` error otherwise. Neither option's README row says so.

**Direction:** one shared paragraph describing the recover-or-fail behaviour, linked from every
renaming flag's row, instead of restating it per flag.

**Refs:** `README.md` (`### OasGen options`), `src/oas/utils/selectionPath.ts`,
`docs/FIXED.md #197`.

## 202 [FEAT] [P3] · Explicit body field selections through the shared input type — ⬜ Open

**Why:** #180 only builds a shared input type for a wildcard (`>**`) body selection — the one
place that triggers it is the body branch of the wildcard-selection walk. An explicit field
selection on a body (naming fields instead of `>**`) still builds a fresh type per position, so
the same schema selected both ways, once wildcard and once explicit, never shares, and if it's
the same schema identity the two paths can print the type twice under the same name.

**OAS:** two operations sharing one `$ref`'d body schema, one selected `op1>body:b>**`, the other
`op2>body:b>fieldName`.

**Shape:** the double-declaration case to test first — pick a fixture with two ops on one shared
body schema, select one op with `>**` and the other by explicit field name, and check the
generated SDL declares the input type once. This is the same failure mode #180 hit and fixed for
pagerduty's `ServiceCustomFieldsFieldOptionUpdateModel` (one schema reached once through the
shared path, once through the old per-position walk), just triggered by an explicit selection
instead of an old-walk Composed/Union member.

**Refs:** `src/oas/nodes/inputShape.ts`, `src/oas/generator/typesCollector.ts`
(`collectExpandedPaths`), `src/oas/io/writer.ts` (the shared `generatedSet` dedup) — all on branch
`issue-180-shared-input-shapes`, #180.

## 203 [FEAT] [P3] · Response-side type sharing, for the docusign memory bar — ⬜ Open

**Why:** #180 shares only request-body input types; response types still build a fresh subtree
per position. Measured on all 247 docusign mutations combined in one `generateSchema` call: peak
5.2 GB RSS at an 8 GiB cap, still over the 2 GiB bar #180 was measured against. A heap snapshot at
the heaviest quarter (62 of the 247 ops) found the two dominant node types are `Scalar`
(1,003,176 instances) and `PropScalar` (745,171 instances), 99.98%+ of them read `kind: 'type'`
(response), not `kind: 'input'` — the shape objects #180 built held only 176 instances,
negligible next to those. #180's fix does not touch this.

**OAS:** any schema reused across many operations' responses — docusign has hundreds of
mutations returning overlapping shapes.

**Shape:** the design #180 built for request bodies (one representative node per schema
identity, memoised once, walking only the real selection instead of every position) is the
starting point, not something to reuse outright — a response has no `>**`-or-explicit split the
way a body does, and #180's fix only ever looked at `kind: 'input'` nodes.

**Refs:** `src/oas/nodes/inputShape.ts` (branch `issue-180-shared-input-shapes`), `docs/TASKS.md
#180` (the parked branch and its measured numbers), `docs/FIXED.md #47`, `docs/FIXED.md #120`
(existing response-side leaf rules a fix here would need to keep).

## 205 [FEAT] [P3] · All-POST RPC-style specs get no Query root — ⬜ Open

**Why:** every Ashby op is POST — 197 ops, 0 GET. `writeOpName`'s method check
(`src/oas/nodes/get.ts`) puts every field under `Mutation`, including read ops like
`application.list` and `application.info`. A connector with no `Query` root at all is unusable for
plain reads.

**OAS:** ashby.json paths `/application.list`, `/application.info`, `/application.listHistory`, …
— all `post`, none `get`.

**Shape:** undecided, needs a measurement pass first. Two directions: a name-pattern heuristic on
POST op names (`.list`, `.info`, `.search`, `.get` → Query) or an explicit per-op override, the way
`root` already forces an op to the other side regardless of its HTTP verb
(`tests/all/r15-graphql-root.test.ts`, `docs/FIXED.md #150`) — that override just isn't driven by
any RPC-style naming convention yet. `--use-operation-ids` (`docs/FIXED.md #197`) is the nearest
existing per-op naming machinery.

**Refs:** `tests/all/corpus.test.ts` `test_corpus_ashby`, `tests/all/r15-graphql-root.test.ts`,
`docs/FIXED.md #150`, `docs/FIXED.md #197`.

## 206 [BUG] [P4] · Mixed `anyOf` routing — closed by #220 for property and list-item positions.

---

## 209 [FEAT] [P3] · Remaining JSON-fallback mapping slices, after the mixed-`oneOf` wrapper — ⬜ Open

**Where:** follows `docs/FIXED.md #208` (the property-position wrapper for a mixed `oneOf`). Four
slices, in this order — each depends on groundwork the previous one lays down.

**1. Safe merging for the remaining `anyOf` cases (#212).**
Example: `anyOf: [integer(int64), object required {code}, object optional {code}]` must not produce `code: String!`.
#220 handles buildable mixed output properties and list items.
Object-only and unbuildable mixed `anyOf` still keep JSON until #212 makes the ordinary field merge safe.
Non-null is valid only when every represented branch supplies a non-null value.
Existing fixtures are `anyof-objects-only-refs.yaml` and `anyof-mixed-wide-integer-required-mismatch.yaml`.
The remaining expandable-reference case needs bounded traversal before Stripe's broad selections can complete.
A named-schema `anyOf` member, at either the property or list-item position, waits for #223.

**2. Scalar-only choices, list items, and map values.** `mapValuesPlainChoice`
(`Map.visitAdditionalProperties`, `map.ts:223`) returns `Scalar('JSON')` before a map value ever
reaches the factory — it needs its own guard update, not just removal, and it also covers a
propertyless-object alternative, not only plain scalars. List items (`Factory.fromArrayItems`,
`factory.ts:230`) have no response-only boundary yet — an input list item going through the same
routing this slice adds could reintroduce #208's silent branch loss on the input side. Do this
after #208's wrapper is settled, since both reuse its node shapes at a different position.
Constraint: output routing changes must not change input behaviour by accident — an unsupported
input choice keeps its complete payload as JSON with a reason, not a silent drop; this applies to
map values here too, not only to map inputs below.

**3. Map inputs, with an explicit omission/null/empty contract.** `mapAsInput`'s reconstruction
expression needs five distinguished cases specified and tested, not silently collapsed to one:
missing map, null map, empty map, an entry missing its `value`, and an entry with `value: null`.
A missing `metadata` property and an entry with no `value` both collapse to `{}` today (the
missing-entry case also emits malformed-JSON mapping problems), which is not the same as an
explicit `null`. Guard the expression before
building JSON text; do not paper over the five cases by converting all of them to `{}`. Add
escaped keys, duplicate keys, and nested transformed values to the body test expectations.
No fixture cut yet for this one — write it from the five distinguished cases above when this slice
starts. Constraint: guard the expression before building JSON text — the five cases (missing map,
null map, empty map, entry missing value, entry with null value) must not collapse to one.

**4. Tuples (`prefixItems`), through the full schema factory.** #204 sends every tuple to JSON;
a real mapping needs each position typed through the complete factory (not just `type`, which
misses `$ref`, enum-only, composed, nested-object, and nested-list/tuple positions), recognized
*before* the homogeneous-array dispatch that currently examines `items` first (`factory.ts:91` and
the property route at `factory.ts:381` both need the fix, not only the two JSON-fallback sites),
and `minItems`/`maxItems`/`items: false`/a schema-valued tail preserved or explicitly retained as
JSON rather than silently truncated to a fixed two-field pair. A tuple with no positional schema
at all can stay `[JSON]`. Test bodies at the root and under a property. Fixture already cut:
`prefix-items.yaml`. Constraint: recognise positional schemas before the homogeneous-array dispatch
runs, not only at the two JSON-fallback sites — a position with a tail `items` schema still needs
its own type.

**Also open, not yet slotted:** `incompatibleMergedField` (`union.ts`, the "different branches
declare this field differently" JSON fallback) is exactly the unsafe-merge case slice 1 above
needs to fix before widening routing — a scratch-only prototype fixture exists from this work's
own research (not yet in the repo); cut it into `tests/resources/oas/` once that work starts.

**Also open: no Union-level "read as JSON".** A wide-integer member blocks `analyzeMixedValue()`
(`schemas.ts`) outright, so today that union always falls back to the lossy flat merge instead of
a clean `JSON` scalar for the whole field — there's no way for a `Union` to say "give up entirely
and read as JSON," only per-field JSON fallbacks. `mixed-value-list-items-wide-integer-gap.yaml`
asserts today's (unchanged) merge behaviour for this reason, not because a better answer exists yet.

**No claim that any other JSON-degrade reason is unmappable.** The full corpus sweep behind this
task (ashby, stripe, and ~35 other vendor specs) is context for sizing these slices, not a
separate open item — see `docs/FIXED.md #208`'s corpus-count note for the one shape it already
touched (PagerDuty's `priority` input field).

**Refs:** `docs/FIXED.md #208`, `docs/FIXED.md #220`, `docs/TASKS.md #212`.

---

## 210 [FEAT] [P3] · User rules for how a field is read (`selectionSuffix` overrides) — ⬜ Open

**Why:** `IType.selectionSuffix()` (`iType.ts`, the hook `PropComp`/`PropObj`/`PropArray`'s
`select()` and `Map.selectEntries()` all consult, via `Prop.writeFieldHead()` as of
`docs/FIXED.md #208`) is answered today only by the mixed-value `Union` from `docs/FIXED.md #208`.
The same seam can carry a user-supplied rule, per type or per type+field, the way
`--transform-rules` already renames ops and fields through `src/oas/mapper` — a schema author knows
a field's real read shape better than any inference the generator could do, and every writer
consulting the hook means such a rule reaches a field, a list item, or a map value alike.

**OAS:** any field on any type — e.g. a corpus field the generator reads as a bare scalar today,
where the user wants `->jsonParse` or a custom `->echo(...)` wrapper applied on read instead.

**Shape:** the mapper (`src/oas/mapper`) gains a `selectionSuffix(typeName, fieldName)` lookup from
the rules file, alongside its existing rename rules. `Prop.writeFieldHead()` asks the mapper first,
then falls back to the node's own `selectionSuffix()`. A rule's expression goes through
`lintSelections` (`src/oas/lint`) before it's written — a bad expression composes fine but fails at
runtime, so catching it at generation time matters. The runtime harness (`src/tests/connectors.ts`) proves one
rule end to end, composing and running a real sample body through it.

**Refs:** `src/oas/nodes/propComp.ts`, `propObj.ts`, `propArray.ts` (`select()`), `map.ts`
(`selectEntries()`), `src/oas/mapper`, `docs/FIXED.md #208`, `tests/all/json-fallback-runtime.test.ts`.

## 211 [FEAT] [P4] · Merge two same-named objects' fields into a superset type, not just the first one — ⬜ Open

**Why:** `Union.declaresEveryKeptField` (`docs/FIXED.md #208`) keeps the first object typed when the
other object declares every field it has, but any field only the *other* object declares is simply
dropped — the flat union merge one level up already unions every member's own fields into one type,
so a field's own object-vs-object merge dropping the second side's extra fields is the one place
this codebase still discards a real, typed field instead of keeping it (nullable).

**OAS:** `detail: $ref Basic { summary }` next to `detail: $ref Rich { summary, deep }` — today
`detail: Basic { summary }`, `deep` gone entirely; a superset merge would keep `detail: Merged
{ summary, deep }`, `deep` nullable since not every branch has it.

**Shape:** `declaresEveryKeptField`'s field-by-field walk already visits every field both sides
declare; a superset merge would also collect each side's *un*matched fields into the merged type's
own field set, cloning them the way `MixedValue.buildObjectType` (`docs/FIXED.md #208`) already
clones an object member's fields, `required` flipped to `false`. Name collisions with the flat
union's own top-level dedupe need the same field-name-clash treatment this entry's own
`declaresEveryKeptField` machinery already applies.

**Refs:** `src/oas/nodes/union.ts` (`declaresEveryKeptField`, `dedupeByName`), `docs/FIXED.md #208`,
`tests/resources/oas/merge-object-refs.yaml` (`/compatible`, where `deep` is dropped today).

## 212 [BUG] [P3] · A merged non-object field keeps a required marker the optional branch doesn't have — ⬜ Open

**Symptom:** `dedupeByName` (`union.ts`) only calls `declaresEveryKeptField` — which checks
required-ness before keeping a field typed — for a group where every prop is an object. A group of
scalars, arrays, or enums instead falls straight to a bare `shapeOf` equality check, with no
required-ness comparison at all: `code: String!` on one member next to `code: String` on another,
same written shape, keeps the `!` from whichever member was visited first.

**OAS:** member A: `code: string`, required; member B: `code: string`, not required. Merged field
today: `code: String!`. A body matching member B's own shape (`code` omitted) fails GraphQL
execution on that non-null field — the same class of bug `declaresEveryKeptField`'s own
required-ness check exists to catch, just unreached here.

**Cause:** `dedupeByName`'s branch on "every prop in the group is an object" only reaches
`declaresEveryKeptField` for the object case; the non-object `shapeOf`-equality branch (`union.ts`,
the group compatibility check) never runs any required-ness comparison.

**Shape:** apply the same required-ness check `declaresEveryKeptField` already runs on an object
pair to every group in `dedupeByName`, not only object groups — measure the corpus type counts it
moves before landing it, the same way `docs/FIXED.md #208`'s own changes were measured.

`objectOnlyAnyOf` and `unbuildableMixedAnyOf` keep these `anyOf` fields as JSON until this fix; an unbuildable mixed `oneOf` retains its existing merge-with-warning behavior until both keywords are covered.

**Refs:** `src/oas/nodes/union.ts` (`dedupeByName`, `declaresEveryKeptField`), `docs/FIXED.md #208`.

## 214 [BUG] [P3] · A single-member allOf wrapping a scalar-only oneOf drops the field silently, no warning — ⬜ Open

**Symptom:** Ashby `post:/assessment.start`'s `value` property vanishes from both the type and
the selection, with no warning.

**OAS:** `value: { allOf: [{ $ref: AssessmentValue }] }`, `AssessmentValue: oneOf: [string,
number, boolean]` (the real schema also carries a second allOf member, `{ example: 10 }`; the
field drops the same way with or without it). Smallest reproduction: `value: { allOf: [{ $ref:
MixedValue }] }`, `MixedValue: oneOf: [string, number, boolean]`.

**Cause:** a scalar-only `oneOf` is meant to land as `JSON` with a warning
(`JsonDegradeReasons.scalarOnlyOneOf()`, reached from `fromProp` in `factory.ts`), but the allOf
wrapper never reaches that check. `Factory.findAllOfSchema` (`factory.ts`) refuses to collapse a
single-member allOf whose resolved target has a `oneOf` — it counts that as object-like — so the
property takes the generic `PropComp` + `Composed` path instead of `fromProp`'s scalar-only check.
`Composed.consolidate()` (`comp.ts`) then folds each non-`Prop` member's `props` map into its own;
a `Union` member's `props` map is still empty at that point (a union only fills it inside its own
`generate()`/`select()`), so the property folds away as if it declared no fields at all. Nothing
warns.

**Shape:** either route a collapsed allOf whose only real member is a scalar-only `oneOf` through
the same `scalarOnlyOneOf` path (`JSON` plus a warning, same as a bare scalar-only `oneOf` today —
#209's mapping slice can pick it up from there later), or have `Composed.consolidate()` refuse to
fold in a `Union` member whose `props` map is still empty instead of silently treating it as
contributing nothing.

**Refs:** `src/oas/nodes/factory.ts` (`findAllOfSchema`, `fromProp`), `src/oas/nodes/comp.ts`
(`consolidate`), `src/oas/nodes/union.ts` (`consolidateMembers`). See `docs/FIXED.md #208` (the
scalar-only-oneOf JSON-plus-warning path this should reuse) and `docs/TASKS.md #209` (the mapping
slice, not this silent drop).

Pinned by fixture `allof-wrapping-scalar-oneof.yaml` and test `test_gap_214_allof_wrapping_scalar_oneof_vanishes`
(`tests/all/lint-known-gaps.test.ts`).

## 215 [BUG] [P3] · A oneOf mixing a plain scalar with a shapeless object vanishes, and so does a container whose only property is one — ⬜ Open

**Symptom:** a property whose `oneOf` mixes a plain scalar with a shapeless object (`{}`, or
`{ type: object, additionalProperties: true }` with no declared `properties`) vanishes from both
the type and the selection — no `JSON`, no warning. When that property is the *only* declared
property of a container — a list item's own type, or a plain nested object — the whole container
vanishes the same way, not just the one property.

**OAS** (github) `Deployment.payload`: `oneOf: [{ type: object, additionalProperties: true },
{ type: string }]`. Same shape at a list item (confluence) `Message.args` items: `oneOf: [{ type:
string }, { type: object, additionalProperties: true }]`; at a plain property (motion)
`DataItem.value`: `oneOf: [{}, { type: number }]`; and the whole-container drop on a list item
whose only property is this shape (motion) `charts/query`'s `data` array, and on a plain nested
object (confluence) `WebResourceDependencies._expandable`, whose own sole declared property is a
`uris: oneOf [string, shapeless object]` child — distinct from the real `uris` data field #216
below.

**Cause, traced:** `Schemas.analyzeMixedValue`'s real-object check and
`Schemas.holdsMixedPlainAndObjectValues` (`schemas.ts:93`, `:110`) both exclude a shapeless object
on purpose (`Schemas.isShapelessObject`, `schemas.ts:33`), and no plain-values helper accepts one
either — a shapeless object is neither a usable object member nor a plain value, so the property
matches nothing and folds away. The same mechanism, one level up, drops a container once every one
of its own properties has folded away this way, on two different kinds of container: a list
item's type losing its only property, and a plain nested object losing its only property.

**Shape:** give `analyzeMixedValue`/`holdsMixedPlainAndObjectValues` a branch for "plain scalar
plus shapeless object" that lands on `JSON` with a warning, the same fallback a scalar-only
`oneOf` already gets, instead of matching nothing.

**Refs:** `src/oas/utils/schemas.ts` (`analyzeMixedValue`, `holdsMixedPlainAndObjectValues`,
`isShapelessObject`). Pinned by fixture `oneof-plain-and-shapeless-object.yaml` and test
`test_gap_215_plain_or_shapeless_object_vanishes` (`tests/all/lint-known-gaps.test.ts`).

## 217 [BUG] [P4] · A property named the empty string is read fine but still reported unread — ⬜ Open

**Symptom:** not a generator gap — a property literally named `""` sanitises to `_` and is
correctly selected (`_: $.""?`). `ResponseCoverageCheck` still reports it `RESPONSE_FIELD_NOT_READ`,
a checker false positive, not a data loss. A future reader should look for this in the checker,
not the generator.

**OAS** (sendgrid) `status[]` and `contact_response.custom_fields` both declare a property named
`""` alongside normally-named siblings.

**Cause, traced:** `ResponseCoverageCheck.walk()`'s "what got read" map is built with `if (key) {
read.set(key, field); }` (`responseCoverage.ts:108`). An empty string is falsy in JS, so a field
that legitimately reads the `""` key is never recorded as read, and `""` shows up in `missing`
even though the selection asked for it.

**Shape:** change the guard to check presence, not truthiness (`if (key != null)`).

**Refs:** `src/oas/lint/checks/responseCoverage.ts` (`walk`, line 108). Pinned by fixture
`empty-string-property-name.yaml` and test `test_gap_217_empty_string_property_name_is_a_checker_false_positive`
(`tests/all/lint-known-gaps.test.ts`).

## 218 [BUG] [P3] · An allOf of two plain scalar members vanishes — ⬜ Open

**Symptom:** an `allOf` of two plain scalar members (a `$ref` to a string plus an inline nullable
string) vanishes from both the type and the selection, with no warning.

**OAS** (digitalocean) `region_slug`: `allOf: [{ $ref: <a plain string schema> }, { type: string,
nullable: true }]`.

**Cause:** same entry point as #214 — `Factory.findAllOfSchema` (`factory.ts`) returns nothing
unless the `allOf` has exactly one non-empty member, and this one has two, so the property takes
the generic `PropComp` + `Composed` path. Downstream of that entry point was not traced here —
both members are plain scalars, not a `Union`, so #214's specific "empty `Union.props`" mechanism
may not be the same one.

**Shape:** trace `Composed.consolidate()` on a two-scalar-member allOf directly before assuming
it is #214's mechanism repeated.

**Refs:** `src/oas/nodes/factory.ts` (`findAllOfSchema`). See `docs/TASKS.md #214` (the sibling
entry point; whether the downstream mechanism is the same was not traced). Pinned by fixture
`allof-two-plain-members.yaml` and test `test_gap_218_allof_two_plain_members_vanishes`
(`tests/all/lint-known-gaps.test.ts`).

## 219 [PERF] [P3] · Type.ancestors() rebuilds the whole parent chain on every call, no memoisation — ⬜ Open

**Symptom:** on a large, deep request body (around 4000 schema nodes) a CPU profile of one
generation run shows a third of the time inside three functions: `Type.ancestors()` 16%,
`TypesCollector.collect()` 12%, `Type.path()` 9%.

**Cause:** `ancestors()` (`type.ts`) is `return this.parent ? [...this.parent.ancestors(), this] :
[this]` — unmemoised, it rebuilds the whole parent chain from scratch on every call. `path()`
(`type.ts`) calls `this.ancestors()` three separate times internally, so building one path costs
three full chain walks instead of one.

**Shape:** build the path from a single walk instead of `path()`'s three separate `ancestors()`
calls, or memoise the chain while a node's parent is fixed.

**Refs:** `src/oas/nodes/type.ts` (`ancestors`, `path`), `src/oas/generator/typesCollector.ts`
(`collect`).

## 222 [BUG] [P4] · Synthetic `keyString` fields carry the wrong JSON reason — ⬜ Open

**OAS:** Ashby `PostalAddress: { properties: { city: string }, additionalProperties: {} }`.
**Symptom:** `Obj.visitProperties` adds a synthetic `[key: string]` property beside explicit fields and sends its empty schema through `Factory.fromProp`.
The emitted `keyString: JSON` field carries `unknownShape`, although the schema explicitly permits arbitrary JSON values.
JSON is appropriate for that synthetic value; its reason should describe `additionalProperties: {}`.
Ashby's per-operation census contains 106 such fallback occurrences before #220 and 189 after, across 25 and 29 distinct emitted type-and-field names respectively.
The increase comes from the newly emitted custom-field object members, all four of which declare `additionalProperties: {}`.
**Shape:** give the synthetic field an additional-properties reason without changing its type or mapping.
**Refs:** `src/oas/nodes/obj.ts` (`visitProperties`), `src/oas/utils/jsonReasons.ts`, #220.

## 223 [PERF] [P2] · Named anyOf/oneOf members rebuild their shared schema on every branch — ⬜ Open

**Symptom:** Stripe's `Customer.default_source: anyOf [string, Card]` and `Card.customer: anyOf
[string, Customer]` rebuild `Card`/`Customer` from scratch on every branch instead of reusing the
shared schema — an isolated two-schema repro (`file` 1416 copies, `address` 1411, `links` 1416,
`Type.ancestors()` called 40 million times) takes 45 seconds without finishing. The same referenced
types recur through the array position too: `customer.sources.data` and `account.external_accounts.data`.

**Cause:** every `$ref` occurrence builds a fresh `Obj` — there is no run-scoped registry of
already-built types, so a schema reachable from many branches or many array positions is rebuilt
once per occurrence instead of once per run.

**Shape:** a run-scoped registry of built types by `$ref`, reused instead of rebuilt, with the
existing per-branch cycle cut kept. Once rebuilding is cheap, lift #220's `namedMembersAnyOf` guard
at both call sites (`fromProp` and `fromArrayItems`) and revisit the `items.anyOf`-only restriction
on the list-item guard at the same time — a named-ref `oneOf` list item would presumably get the
same typed treatment once the rebuild cost is gone.

One more gap the same fix should close: `map.ts`'s `arrayValueJsonReason()` re-derives a list
item's JSON reason the same stale way `propArray.ts` did before #220 — a map whose value is a list
of a named-ref `anyOf` shows the wrong docstring text today. Needs a fixture and the same
`inner.jsonReason`-first fix `propArray.ts` got, not folded into #220 for lack of a failing test to
prove it.

**Refs:** `src/oas/nodes/factory.ts` (`fromSchema`, `fromProp`, `fromArrayItems`),
`src/oas/nodes/propArray.ts` (`jsonReason`), `src/oas/nodes/map.ts` (`arrayValueJsonReason`),
`src/oas/nodes/obj.ts` (`visitProperties`), `src/oas/generator/typesCollector.ts`
(`collectLeafPaths`), #219, #220.

## 231 [BUG] [P4] · A twin whose only difference sits inside a nested inline object still renames apart — ⬜ Open

**Symptom:** #231's fix dedups identical inline twins by comparing them once both sides' own
properties are normalised. A twin whose only raw-vs-normalised difference sits inside a *nested*
inline object still renames apart, since that nested object is normalised by its own later visit,
not by its parent's. On Ashby this leaves four twins split: `ApplicationListResultOpeningsItem`,
`ApplicationListResultOpeningsItemLatestVersion`, `ApplicationUpdateHistoryResultOpeningsItem`,
`ApplicationUpdateHistoryResultOpeningsItemLatestVersion`.

**OAS:** the twin item carries a nested inline object with a 3.1-nullable field, e.g. `address: {
properties: { city: { type: [string, 'null'] } } }`.

**Shape:** the nested object would need normalising before the parent's own collision check runs —
that normalisation is what construction already does, just one visit later.

**Refs:** #231, `src/oas/nodes/obj.ts` (`visit`).

## 235 [BUG] [P4] · [union] warnings carry no path/operation and repeat per call site, not per clash — ⬜ Open

**Symptom:** every `[union]` warning is `warn(null, '[union]', reason)` — `warn()` itself never
prints a path regardless of what's passed, so there's no way to tell from the log which field or
operation a clash came from. Worse, `dedupeByName` reruns once per call site that touches a shared
union (once per operation that reaches it), so the same clash is logged once per operation instead
of once per distinct union/field — Omni's spec produced 138 `[union]` lines for what is actually 13
distinct (union, field) pairs.

**Real-world hit:** same Omni run as #234 — `FiltersUsedInSqlEntryUnion.type` alone fires 6 times
for `get:/api/v2/documents/{identifier}` and 5 more for its `/draft/{draftIdentifier}` variant, all
the same clash.

**Shape:** two independent fixes — pass the node context through so `warn` can print a path, the way
`factory.ts`'s "Object has no properties" warnings already do; and cache `dedupeByName`'s clash
result per (union, field) so repeat call sites for the same shared union reuse it instead of
re-warning.

**Refs:** `src/oas/nodes/union.ts` (`dedupeByName`), `src/oas/log/trace.ts` (`warn`).

## 236 [BUG] [P3] · A discriminated `oneOf` request body drops a field one branch doesn't share, and the body mapping still selects it — ⬜ Open

**Symptom:** motion.json's mutations all-ops compose fails with three `INVALID_BODY` errors. Every
op passes on its own (241/241 per-op); only the all-ops (whole-spec) compose surfaces it — confirmed
byte-identical on `main` before #221's changes, so this is pre-existing, not something #221 caused:
```
INVALID_BODY: [test_spec] In `@connect(http: {body:})` on `Mutation.patchV2TasksById`: `TasksV2UpdateRequestInput.*.data.*` doesn't have a field named `archivedTime`
INVALID_BODY: [test_spec] In `@connect(http: {body:})` on `Mutation.createV2UsersMeSettingsTaskDefaults`: `UserTaskDefaultSettingsPostRequestInput.*.data.*` doesn't have a field named `level`
INVALID_BODY: [test_spec] In `@connect(http: {body:})` on `Mutation.patchV2UsersMeSettingsTaskDefaults`: `UserTaskDefaultSettingsPatchRequestInput.*.data.*` doesn't have a field named `level`
```

**OAS:** `PATCH /v2/tasks/{id}`'s body is `data: oneOf` of four branches discriminated by `type`;
only the `NORMAL` branch declares `archivedTime`:
```yaml
data:
  oneOf:
    - properties: { type: { enum: [NORMAL] }, archivedTime: { ... }, name: { ... }, ... }   # has it
    - properties: { type: { enum: [RECURRING_INSTANCE] }, ... }                             # doesn't
    - properties: { type: { enum: [CHUNK] }, ... }                                          # doesn't
    - properties: { type: { enum: [RECURRING_TASK] }, ... }                                 # doesn't
```
The two task-defaults ops (`POST`/`PATCH /v2/users/me/settings/task-defaults`) shape the same way,
but their `level` field is itself the discriminator — a single-value enum that differs per branch:
```yaml
data:
  oneOf:
    - properties: { level: { type: string, enum: [GLOBAL] }, ... }
    - properties: { level: { type: string, enum: [WORKSPACE] }, ... }
```
In both cases the generated `*Input` type merges the branches into one flat input object, and
`archivedTime`/`level` don't make it into that merged shape — but the `@connect` body mapping still
selects them, so rover rejects the body at compose time.

**Cause:** not traced.

**Shape:** none yet.

**Refs:** `COVERAGE-mutations.md` (all-ops column), `tools/coverage-spec.mts`.

## 237 [BUG] [P4] · An input-side, discriminator-free `oneOf [string, [string]]` field vanishes with no fallback — ⬜ Open

**Symptom:** the #221 fixture's `/thing.create` request body carries a `oneOf [string, array of
string]` field (`flat`). Spelled `oneOf`, it disappears entirely — no field, no `JSON` fallback, no
warning — worse than the `anyOf` spelling of the exact same shape, which degrades to `JSON` with a
"NEEDS ATTENTION" note as intended. With nothing else in the body, the whole input type comes out
empty (`input CreateThingCreateInput {}`), which the generator then rejects as invalid GraphQL.

**OAS** (`/thing.create` request body):
```yaml
requestBody:
  content:
    application/json:
      schema:
        type: object
        properties:
          flat:
            oneOf:
              - type: string
              - type: array
                items:
                  type: string
```

**Cause:** the same drop #221's fix traced for the output side, now hit from the input side.
`Factory.fromProp`'s `oneOf` branch builds a real `Union`-backed field for this shape on both input
and output alike — unlike its `anyOf` sibling, it never checks whether the parent is an input type
before doing so. The leaf-selection pass only keeps that field when `Union.analyzeMixedValue` returns
a shape, and that method always returns nothing for an input-kind union, by design — GraphQL has no
input unions. So the field gets built, then never selected, and vanishes with nothing said about it.

**Shape:** the input catch-all in `Factory.fromProp`'s `oneOf` branch should send this shape to
`JSON` with a reason, the way the `anyOf` branch already does for the same shape.

**Refs:** `docs/FIXED.md` #221, #216.


