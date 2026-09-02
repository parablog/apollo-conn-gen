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

**Refs:** #179 (the crash half), #174 (superseded narrowing — the sweep OOM was the pipe
flood, not tree weight), #181 (the stack leak — real but ruled out as #180's driver),
docs/DEFERRED.md #139 (granularity mode — the likely product-level relief for docusign-class
specs), measurement scripts in the session scratchpad.

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
