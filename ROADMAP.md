# apollo-conn-gen — Connector Feature Roadmap

Gap analysis of what the **Apollo Router** (`main` branch, v2.15.x) supports in the
connectors spec versus what **apollo-conn-gen** currently emits, plus a prioritized,
version-gated plan to close the gaps. Verified against the emitter source.

Source of truth for the spec surface:
`<router>/apollo-federation/src/connectors/` (router `main`, v2.15.x).

## Current state

| | Router `main` | apollo-conn-gen today |
|---|---|---|
| Connect spec | v0.1–v0.3 stable, **v0.4 preview** | **v0.3** default (`src/versions.ts`, since R0) |
| Federation | current | **v2.12** default (since R0) |

What `gen` already emits well:

- `@source(name, http.baseURL)` — baseURL from OAS `servers[0]`.
- `@connect` with `GET/POST/PUT/PATCH/DELETE`.
- Path params as `{$args.x}`.
- `queryParams` block (`$args { ... }`), required + optional.
- Static request `headers` (example values).
- Request `body` as a **full JSONSelection** (`$args.input { ... }`) for POST/PUT/PATCH.
- Response `selection`: field selection + nesting + `->entries` for maps.

### Verified state of the emitter (grounding for the items below)

- `body.ts` (`Body.select`) already emits a **full JSONSelection request body**:
  `body: """ $args.input { <payload selection> } """`. So `ConnectHTTP.body` is
  **largely implemented** — the gap is only computed/literal bodies that are not a
  straight `$args.input` mapping (see R9).
- `operationWriter.ts` emits `queryParams: """ $args { … } """`, does path templating
  via `{$args.<name>}` substitution, and emits a `headers: [ … ]` list from OAS
  `header` params. These are simple `$args`-rooted forms, not the full computed
  JSONSelection the spec allows (see R8).
- `entity`/`$this`/`@key` are now emitted (R1, done) and `$config` auth headers are
  emitted on `@source` (R5 slice 1, done). `$env`, `$request.headers`, `$status`,
  `$batch` are still not emitted — see the per-item status below.

---

## Major requirement: per-feature version gating (cross-cutting)

The features below span v0.1 → v0.4-preview. The generator MUST treat the selected
connector spec version as a hard constraint on output, not just a `@link` URL string:

- Every emitter records the **minimum spec version** its output requires (e.g.
  unions/interfaces ⇒ v0.4; `errors`/`isSuccess` ⇒ v0.2; aliasing ⇒ v0.1).
- Before emission, the generator compares each feature's minimum against the selected
  target version. If the target is lower, the generator MUST either:
  - **downgrade explicitly** — emit a documented fallback (e.g. the consolidate-unions
    workaround instead of real unions) and record the downgrade in output/log, or
  - **reject explicitly** — fail with an actionable error naming the feature and the
    version it needs.
- The generator MUST NOT silently emit a construct the target version cannot parse.
- The version table/gate plumbing (**R0**) is a prerequisite for ALL version-sensitive
  items; the requirement is then satisfied incrementally as each item lands.

## Cross-cutting requirement: variable support

JSONSelection / StringTemplate variables are NOT a standalone execution step — each is
unlocked by, and is acceptance criteria *for*, the item that first needs it. An item is
not "done" until the variables in its row below are emittable and tested.

| Variable | Required by item(s) | Notes |
|---|---|---|
| `$args` | (already done) | path/queryParams/body roots |
| `$this` | R1 (entity, 1b) | type-level entity lookups |
| `$config` | R5 (auth), R9 (computed bodies) | secret/config interpolation |
| `$env` | R5 (auth) | environment-backed secrets |
| `$batch` | R6 (batch) | array of requested entities |
| `$request.headers` | R5 (auth) | inbound header passthrough |
| `$response.headers` | R4 (errors) | response-derived fields |
| `$status` | R4 (errors) | HTTP status → `isSuccess`/errors |
| `@` | R4 (errors), R7 (richer selection) | current-value reference |
| `$context` | — (non-goal) | deferred; no clean OAS source to infer from |

---

## Spec-surface coverage matrix

Every router-spec surface maps to a roadmap item (R#) or an explicit non-goal.
"Done" = already emitted; "Partial" = emitted in a narrow form.

| Spec surface (router) | Sub-field / detail | Status in `gen` | Mapped to |
|---|---|---|---|
| `@source` directive | `name` | Done | — |
| `@source` directive | `http.baseURL` (from `servers[0]`) | Done | — |
| `SourceHTTP` | static `headers` | Partial (static examples) | R5 |
| `SourceHTTP` | `path` as JSONSelection | Missing | R8 |
| `SourceHTTP` | `queryParams` as JSONSelection | Missing | R8 |
| `@source` | `errors` (ConnectorErrors) | Missing | R4 |
| `@connect` directive | `source` ref | Done | — |
| `@connect` directive | `http.{GET,POST,PUT,PATCH,DELETE}` | Done | — |
| `ConnectHTTP` | path templating `{$args.x}` | Done | — |
| `ConnectHTTP` | `path` as full JSONSelection | Partial (literal only) | R8 |
| `ConnectHTTP` | `queryParams` block / JSONSelection | Partial (`$args{…}`) | R8 |
| `ConnectHTTP` | `headers` (per-op) | Partial (static) | R5 |
| `ConnectHTTP` | `body` (full JSONSelection) | Done (`$args.input`) | R9 (computed/literal only) |
| `@connect` | `entity: true` (Query-field resolver) | Missing | R1 (1a) |
| `@connect` | type-level on OBJECT + `$this` | Missing | R1 (1b) |
| `@connect` | `errors`/`isSuccess` | Missing | R4 |
| `@connect` | `batch` (ConnectBatch) | Missing | R6 |
| `ConnectorErrors` | `message`, `extensions` | Missing | R4 |
| `ConnectBatch` | `maxSize` | Missing | R6 |
| `HTTPHeaderMapping` | `name` | Partial | R5 |
| `HTTPHeaderMapping` | `value` (StringTemplate `{$config}`/`{$env}`/`{$context}`) | Missing | R5 |
| `HTTPHeaderMapping` | `from` (response-header extract) | Missing | R5 |
| `@key` (federation) | key-field emission | Missing | R1 (1c) |
| JSONSelection | field selection + nesting + `->entries` | Done | — |
| JSONSelection | aliasing / quoted keys / camelCase | Missing | R3 |
| JSONSelection | methods, literals, spreads, `??`/`?!`, optional chaining | Missing | R7 |
| OAS `oneOf`/`anyOf` + discriminator | unions/interfaces | Partial (real `union` + consolidate downgrade both implemented; no discriminator/`__typename`, no interfaces) | R2 |
| Variables | `$args` | Done | — |
| Variables | `$this`, `$config`, `$env`, `$batch`, `$request.*`, `$response.*`, `$status`, `@` | Missing | Cross-cutting (see variable table; lands with R1/R4/R5/R6/R7/R9) |
| Variables | `$context` | Missing | Non-goal |
| Version enum / `@link` | v0.1–v0.4 selection + gating | Missing | R0 |

**Explicit non-goals (named so they are not mistaken for missed work):**

- `$context` / request-scoped context values — deferred; no clean OAS source to infer
  from. Tracked in the variable table as a non-goal, not a roadmap item.
- Non-HTTP transports — out of scope; `gen` is REST/OAS-driven only.
- Hand-tuning of generated JSONSelection beyond inferable intent — out of scope (R7 is
  opportunistic only).

If a future router version adds a directive/input/field not in this matrix, the matrix
must be extended before the roadmap is re-approved.

---

## Roadmap items (priority order == execution order)

Items are numbered R0–R9 in execution order. **R0 (version gating) is first because
every v0.2+/v0.4 item depends on it.** Variable support is cross-cutting (see above),
not a numbered item — its rows are acceptance criteria inside the consuming items.

**Status legend:** ✅ Done · 🟡 Partial · ⬜ Not started

| Item | Status | Summary |
|---|---|---|
| R0. Version gating | ✅ Done | defaults v0.3/v2.12, version table + gate plumbing |
| R1. Entity resolution | ✅ Done | `entity`/`@key`/`$this` (`--infer-entity-resolvers`) |
| R2. Unions & interfaces | 🟡 Partial | real `union` + discriminator→`__typename` + **`oneOf`+shared-`allOf`-base → `interface`/`implements`** (all `->match`, v0.4) + consolidate downgrade done; broader `allOf`→interface, real-union fix for allOf members, + auto version-gate pending |
| R3. Selection aliasing | ✅ Done | safe-name aliasing + camelCase, OAS + JSON paths |
| R4. Error handling | ⬜ Not started | `errors`/`isSuccess` never emitted |
| R5. Dynamic headers / auth | 🟡 Partial | slice 1 done (global `@source` `$config` header); per-op, `$env`, `from:`, `$request.headers` remain |
| R6. Batch entity resolution | ⬜ Not started | depends on R1 |
| R7. Richer JSONSelection | ⬜ Not started | methods/literals/spreads/coalescing |
| R8. `path`/`queryParams` JSONSelection | ⬜ Not started | computed segments/objects |
| R9. Computed / literal bodies | ⬜ Not started | base `$args.input` body done; computed remainder open |

### Foundation (must precede version-sensitive items)

### R0. Spec version gating — ✅ Done

**Why:** v0.4-dependent items (unions) and v0.2-dependent items (errors, batch) can't be
emitted safely without a version gate.

**Status:** Done (commit `72f625e`). Defaults bumped to connect v0.3 / federation v2.12;
version table, `parseVersion`/`compareVersions`/`meetsMinimum`, and the
reject-or-downgrade gate plumbing live in `src/versions.ts` and are consumed by later
items (e.g. R1).

**Scope:**
- Version table + per-feature minimum-version gate (the "Major requirement" above).
- Default `connectorSpecVersion` → **v0.3**; allow **v0.4** opt-in.
- Emit matching `@link(url: ".../connect/vX.Y", import: ["@connect", "@source"])`.
- Provide the reject-or-downgrade plumbing every later item plugs into.

**Files:** `src/versions.ts`, `@link` emission in `src/oas/io/schemaWriter.ts`.
(gate: foundational)

### High value

### R1. Entity resolution — `entity: true`, `@key`, `$this` — ✅ Done

**Status:** Done (commit `47ed1bf`, opt-in via `--infer-entity-resolvers`). Type-level
`@connect` on objects using `$this`, `@key` emission, and the inference are implemented
(`src/oas/nodes/entity.ts`, `obj.ts`, `schemaWriter.ts`); the project favours type-level
`$this` resolvers over Query-field `entity: true`. Tested (`test_R1_*`).

**Why:** Biggest functional gap — makes generated subgraphs actually federate. Splits
into three separately-emittable cases; conflating them produces invalid schemas.

- **(1a) Query-field entity resolver** — root `Query` field resolving one entity by its
  key arguments; field-level `@connect` with `entity: true`:
  ```graphql
  type Query {
    user(id: ID!): User
      @connect(
        source: "api"
        http: { GET: "/users/{$args.id}" }
        selection: "id name email"
        entity: true
      )
  }
  ```
  Valid only on a `Query` field whose args correspond to the returned type's `@key`.
  Requires (1c).
- **(1b) Type-level `@connect` on an OBJECT using `$this`** — second-pass lookup that
  resolves more fields of an already-identified entity, via `$this` (NOT `$args`, NOT
  `entity: true`):
  ```graphql
  type Product
    @key(fields: "id")
    @connect(
      source: "api"
      http: { GET: "/products/{$this.id}" }
      selection: "id name price"
    ) { id: ID! name: String price: Float }
  ```
  `$this.*` only resolves against fields in the object's `@key`. Requires (1c).
- **(1c) `@key` emission** — emit `@key(fields: "…")` on an OBJECT **only when** entity
  semantics are actually required (1a targets the type, 1b is on the type, or batch R6
  is enabled). Do NOT emit `@key` on plain nested/output types — it wrongly promotes
  them to entities and changes query-planner behaviour. Key fields must match the
  resolver args (1a) or `$this` references (1b).

**Files:** `src/oas/io/operationWriter.ts`, `src/oas/io/schemaWriter.ts`,
`src/oas/nodes/obj.ts`, `src/oas/nodes/get.ts`. (gate: v0.2+)

> Do 1c alongside 1a/1b — never standalone.

### R2. Unions & interfaces (OAS `oneOf` / `anyOf` + discriminators) — 🟡 Partial

**Why:** Router v0.4 adds interface/union support. `gen` already has substantial union
machinery; this item finishes the gaps and ties the fallback to the version gate.

**Verified state of the emitter (read `src/oas/nodes/union.ts`):**
- ✅ **Real `union X = A | B`** (`Union.generate`, `consolidateUnions: false` branch),
  filtered to selected members. `Factory` builds `Union` nodes from `oneOf`/`anyOf`.
- ✅ **Discriminator → `__typename`** (DONE this slice): `Union` now stores the OAS
  `discriminator` (`propertyName` + `mapping`), wired through `Factory`. `Union.select`
  emits the composable connect-v0.4 abstract-type form —
  `... <discr>->match(["book", $ { __typename: $("Book") … }], …)` — with a string-literal
  `__typename` per member, value resolved from the discriminator `mapping`. Verified to
  compose at fed 2.13 / connect v0.4 (`test_R2_union_discriminator_*`). See
  [[connectors-abstract-type-selection]].
- ✅ **Consolidate-unions downgrade** unchanged and still the **default**
  (`consolidateUnions: true`): merges members into one replacement OBJECT with the
  `#### NOT SUPPORTED YET BY CONNECTORS!!! union …` marker. The new abstract path only
  triggers when `consolidateUnions: false` AND a discriminator exists, so default output
  is byte-identical (`test_R2_union_consolidate_downgrade_unchanged`).
- ⚠️ **Still not driven by the spec version.** The real-union vs. consolidate choice keys
  off the `consolidateUnions` *option*, not the selected connector version — R0's gate is
  not wired in, and the downgrade is not logged as a downgrade.
- ❌ **`allOf` → interfaces** not done: `Composed` (`comp.ts`) flattens `allOf` into a
  merged OBJECT `type`; no `interface` / `implements` emitted. High blast radius (every
  TMF/allOf fixture) — deferred to its own slice.
- ⚠️ **Unions without a discriminator** still fall back to the flat (invalid-for-union)
  selection; only discriminated unions get the correct `->match` form.

**Done this slice — `oneOf` + shared `allOf` base → `interface`:** when a discriminated `oneOf`'s
members are all `allOf` compositions sharing **exactly one** common base ref, the base is promoted to
a GraphQL `interface`, members emit `… implements Base`, the field returns the interface, and the
connector reuses the `->match` selection (rover-verified to compose at fed 2.13 / connect v0.4). It is
an **id-neutral post-collect pass** (`src/oas/nodes/interfacePromotion.ts`, wired in `writer.ts` next
to `inferEntityResolvers`): flags `Obj.emitAsInterface` / `Composed.implementsInterface` /
`Union.interfaceBaseRef` rather than mutating `kind` (which is embedded in node ids). Rule 3 skips
promotion (loudly) when the base is used concretely elsewhere among the selected ops. Tested
(`test_R2_interface_*`).

**Remaining scope:**
- **Broader `allOf` → interface** beyond the discriminated-`oneOf` case (e.g. promote shared bases
  like `Extensible`/`Entity` used across many TMF types). Large blast radius; own slice.
- **Fix the real-union path for `allOf`-composed members.** Discovered during this slice: with
  `consolidateUnions:false`, a `oneOf` whose members are `allOf` `Composed` and that is *not* promoted
  (no discriminator, or rule-3 skip) emits an empty `union X = ` and may drop a concretely-used shared
  base. Only the committed plain-object-member union path and the promoted interface path are sound.
  Interface promotion *is* the fix for the discriminated allOf case; the generic fallback still needs
  work.
- **Wire the real-union/interface vs. consolidate choice to the version gate** (connect ≥ v0.4 →
  abstract types; < v0.4 → consolidate downgrade, logged) instead of the bare `consolidateUnions`
  flag, and make `consolidateUnions` derived from `connectorSpecVersion`. Rationale: connect **v0.4 is
  preview-only** — verified in source: `apollo-router` `connectors.preview_connect_v0_4` +
  `feature_gate_enforcement.rs`; federation PR #3413 (RH-1321) marks `connect/v0.4` preview so
  composition won't inject it unless a subgraph uses it. So consolidate stays as the < v0.4 downgrade
  and can be retired only once v0.4 is GA. (Default is still connect v0.3.)
- Discriminator-less unions (no `mapping`): infer the tag from member enums, or warn.

**Test infra:** `runOasTest` gained an `opts` arg
(`{ consolidateUnions, connectorSpecVersion, federationVersion, composeFederationVersion }`)
so v0.4/fed-2.13 paths can be generated and composed; existing callers default to the old
behaviour (consolidate + fed 2.12).

**Files:** `src/oas/nodes/union.ts`, `src/oas/nodes/factory.ts` (done);
`src/oas/nodes/comp.ts`, `src/oas/io/schemaWriter.ts` (interfaces + version gate, pending).
(gate: v0.4; else explicit downgrade)

### R3. Selection aliasing / renaming (non-GraphQL-safe keys, snake↔camel) — ✅ Done

**Status:** Done (commit `a9a897b`). `safeName: "original-key"` aliasing + camelCase
normalisation are applied across the OAS prop nodes (`src/oas/nodes/prop*.ts`,
`utils/naming.ts`) and the JSON walker (`src/json/walker/naming.ts`). Tested
(`test_R3_*`).

**Why:** Correctness. JSON keys that aren't valid GraphQL identifiers (kebab-case,
leading digit, reserved words) or snake_case keys produce invalid/awkward schemas today.

**Scope:**
- Emit `safeName: "original-key"` aliasing for non-identifier keys.
- Optionally normalize snake_case → camelCase via alias / `->keysToCamelCase`.
- Apply in both the OAS path and the JSON-walker path.

**Files:** `src/oas/nodes/prop*.ts` (`select()`), `src/oas/utils/` naming helpers,
`src/json/walker/naming.ts`. (gate: v0.1+)

### Medium value

### R4. Error handling — `errors: { message, extensions }` and `isSuccess` — ⬜ Not started

**Why:** Available since v0.2 but never emitted. OAS documents 4xx/5xx schemas that can
drive these mappings. (Verified: no `errors`/`isSuccess`/`$status` tokens emitted today.)

**Scope:**
- Emit `errors: { message, extensions }` derived from documented error responses.
- Optionally emit `isSuccess` when success is signalled in the body, not the status.

**Requires:** `$response.headers`, `$status`, `@` (see variable table).

**Files:** `src/oas/io/schemaWriter.ts`, `src/oas/io/operationWriter.ts`. (gate: v0.2+)

### R5. Dynamic headers / auth from OAS security schemes — 🟡 Partial

**Why:** Headers are emitted as static example values. OAS `securitySchemes` (apiKey,
bearer, oauth2) should become templated `HTTPHeaderMapping`s.

**Status:** Slice 1 done — the spec's **global** `security` scheme is mapped to a
templated `@source` header (`src/oas/io/schemaWriter.ts`); deferred cases are warned, not
dropped. Tested (`test_R5_*`).

**Scope:**
- ✅ apiKey/header → `{ name: "N", value: "{$config.apiKey}" }` (slice 1).
- ✅ http bearer / oauth2 / openIdConnect → `Authorization: Bearer {$config.token}`;
  http basic → `Authorization: Basic {$config.token}` (slice 1).
- ⬜ Per-operation auth on `@connect` (specs whose security is per-op emit only warnings
  today).
- ⬜ apiKey in **query** / **cookie** (warned + deferred today).
- ⬜ `$env`-backed secrets; `from:` response-header extraction; `$request.headers`
  passthrough.

**Requires:** `$config` (done), `$env`, `$request.headers` (see variable table).

**Files:** `src/oas/io/schemaWriter.ts`, `src/oas/io/operationWriter.ts`. (gate: v0.1+)

### Lower value / advanced

### R6. Batch entity resolution — `batch: { maxSize }` + `$batch` — ⬜ Not started

**Why:** Reduces N+1 entity lookups. Depends on R1 (reuses the `@key` from 1c; R1 is
done). (Verified: no `batch`/`$batch`/`maxSize` emitted today.)

**Scope:** For bulk endpoints (e.g. `POST /things/batch`), emit a type-level `@connect`
with `batch: { maxSize }` and a `$batch`-based selection.

**Requires:** `$batch`.

**Files:** `src/oas/io/operationWriter.ts`, entity detection (shared with R1).
(gate: v0.2+)

### R7. Richer JSONSelection — methods, literals, spreads, coalescing, optional chaining — ⬜ Not started

**Why:** Handles real response shapes: envelope unwrapping (`data.items`), literal
`__typename`, fallbacks.

**Scope (opportunistic, inferable intent only):** methods (`->first`, `->match`,
`->joinNotNull`, …), literals (`__typename: "Book"`), spreads (`...$args`),
null-coalescing `??` / `?!`, optional chaining `author?.name`.

**Requires:** `@`.

**Files:** `src/oas/nodes/prop*.ts`, `src/oas/nodes/body.ts`, JSON walker selection.
(gate: v0.1+; `??`/`?!`/extended grammar best on v0.4)

### R8. `path` / `queryParams` as full JSONSelection — ⬜ Not started

**Why:** More flexible than the current `{$args.x}` / `$args { … }` forms — computed
segments and computed query objects with renaming/methods, on both `SourceHTTP` and
`ConnectHTTP`. (Base `{$args.x}` / `$args { … }` forms already emitted; this is the
computed extension.)

**Files:** `src/oas/io/operationWriter.ts`. (gate: v0.2+)

### R9. Computed / literal request bodies — ⬜ Not started

**Why:** `ConnectHTTP.body` is already emitted as a straight `$args.input { … }`
mapping (done). The remaining gap is bodies that are not a direct passthrough.
(Verified: `body.ts` emits only the `$args.input` form — no `$config`/`$this`/literals.)

**Scope:** Literal object fields, renamed keys, and values from variables other than
`$args.input` (e.g. `$config`, `$this`). Builds on existing `body.ts` machinery.

**Requires:** `$config`.

**Files:** `src/oas/nodes/body.ts`. (gate: v0.2+)

---

## Sequencing notes

- **R0 (version gating) is first** — it unblocks the per-feature gate every v0.2+/v0.4
  item relies on, and resolves the prior ordering inconsistency (v0.4-dependent unions
  used to precede the version bump).
- **Variable support is cross-cutting**, not a trailing item — each variable's row in
  the table is acceptance criteria inside its consuming item (R1/R4/R5/R6/R7/R9).
- **R3 and R2** most affect *validity* of output (currently invalid/unsupported); R2
  must respect the gate (real unions on v0.4, documented downgrade otherwise).
- **R1** most affects *functionality* (makes the connector actually federate); do 1c
  alongside 1a/1b — never standalone.
- **R6** depends on R1; parts of **R7/R8/R9** build on R1 and the selection work.

## Verification

This is a documentation deliverable. Verify by:
- Reading this file for accuracy/order (version gating first; variables cross-cutting).
- Confirming the **coverage matrix** accounts for every spec surface in the "Reference
  (router source)" files, and that every "Mapped to" cell names a real item R0–R9 or an
  explicit non-goal — no dangling references.
- Confirming each item carries a version gate and that the "Major requirement"
  (reject-or-downgrade, never silent-invalid) is reflected here.
- Spot-checking the "Verified state of the emitter" claims against `src/oas/nodes/body.ts`
  and `src/oas/io/operationWriter.ts`.

No code changes, tests, or builds are involved.

## Reference (router source)

- Versions / spec: `apollo-federation/src/connectors/spec/mod.rs`
- Directive & type schemas: `.../spec/type_and_directive_specifications.rs`
- `@connect` / `@source` parsing: `.../spec/connect.rs`, `.../spec/source.rs`
- HTTP: `.../spec/http.rs`
- Errors: `.../spec/errors.rs`
- JSONSelection grammar + methods: `.../json_selection/README.md`,
  `.../json_selection/methods.rs`
- Variables: `.../variable.rs`
- Entity/resolver models: `.../models.rs`
