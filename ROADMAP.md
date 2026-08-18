# apollo-conn-gen — Connector Feature Roadmap

Gap analysis of what the **Apollo Router** (`main` branch, v2.15.x) supports in the
connectors spec versus what **apollo-conn-gen** currently emits, plus a prioritized,
version-gated plan to close the gaps. Verified against the emitter source.

Source of truth for the spec surface:
`<router>/apollo-federation/src/connectors/` (router `main`, v2.15.x).

## Current state

| | Router `main` | apollo-conn-gen today |
|---|---|---|
| Connect spec | v0.1–v0.3 stable, **v0.4 preview** | **v0.4 only** — floor, not a default (`SUPPORTED_CONNECT_VERSIONS = ['v0.4']`; below is rejected at the entrypoint, `d39095a`) |
| Federation | current | **v2.14** default (latest released; v0.4 floor is v2.13) |

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

## Connect spec version floor (cross-cutting)

Connect is floored at v0.4 program-wide (`feat/drop-consolidate-unions`, commit `d39095a`):
`SUPPORTED_CONNECT_VERSIONS = ['v0.4']` in `src/versions.ts`, and `validateVersionOptions`
(called from `OasGen.fromData`/`fromFile` and `JsonGen`) rejects anything below v0.4 — or
federation below v2.13 — at the entrypoint, before generation starts. There is no
per-feature downgrade-or-reject path anymore; the tool has no real users to carry v0.1–v0.3
backwards-compat for. A feature that needs *more* than the v0.4 floor (e.g. R7's `??`,
which also needs federation v2.14) still self-gates its own output with
`meetsMinimum(target, min)`.

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
| `ConnectHTTP` | `path` as full JSONSelection | Done (templated + per-op override) | R8 |
| `ConnectHTTP` | `queryParams` block / JSONSelection | Done (`$args{…}` + serialization joins + per-op override) | R8 |
| `ConnectHTTP` | `headers` (per-op) | Partial (static examples + per-op override w/ `$config` templates + per-op auth from `security`) | R5 |
| `ConnectHTTP` | `body` (full JSONSelection) | Done (`$args.input` inferred + per-op override) | R9 |
| `@connect` | `entity: true` (Query-field resolver) | Deliberately not emitted (type-level `$this` favoured — R1 note) | R1 (1a) |
| `@connect` | type-level on OBJECT + `$this` | Done (`--infer-entity-resolvers`) | R1 (1b) |
| `@connect` | `errors` | Done opt-in (`message: "$.message"` heuristic + `extensions`/`$status`; `isSuccess` not in the spec SDL) | R4 |
| `@connect` | `batch` (ConnectBatch) | Done opt-in (`--batch`; single key + one scalar-array input; composite/object-array deferred) | R6 |
| `ConnectorErrors` | `message`, `extensions` | Done (opt-in; `message` heuristic + `extensions`) | R4 |
| `ConnectBatch` | `maxSize` | Done (default `100`, file-overridable) | R6 |
| `HTTPHeaderMapping` | `name` | Partial (global `@source` + per-op `@connect` auth) | R5 |
| `HTTPHeaderMapping` | `value` (StringTemplate `{$config}`/`{$env}`/`{$context}`) | Partial (`{$config.*}` on global `@source` + per-op `@connect` auth; `$env`/`$context` pending) | R5 |
| `HTTPHeaderMapping` | `from` (response-header extract) | Missing | R5 |
| `@key` (federation) | key-field emission | Done (entity inference, R1) | R1 (1c) |
| JSONSelection | field selection + nesting + `->entries` | Done | — |
| JSONSelection | aliasing / quoted keys / camelCase | Done (responses R3; request bodies #28/#32) | R3 |
| JSONSelection | methods, literals, spreads, `??`/`?!`, optional chaining | Partial (`->entries`, `->match`, `->joinNotNull`, `??` coalesced defaults, `$(literal)`/`__typename` done; spreads/`?!`/chaining pending) | R7 |
| OAS `oneOf`/`anyOf` + discriminator | unions/interfaces | Done (real `union` + `->match` `__typename` + interface promotion; merged-object degrade for input-position or discriminator-less `oneOf`, shape-derived not version-derived) | R2 |
| Variables | `$args` | Done | — |
| Variables | `$this` (R1), `$config` (R5), `$status` (R4), `$batch` (R6) | Done | — |
| Variables | `$env`, `$request.*`, `$response.*`, `@` | Missing | Cross-cutting (lands with R4/R5/R7/R9) |
| Variables | `$context` | Missing | Non-goal |
| Version enum / `@link` | v0.4 fixed, rejected below | Done (R0 plumbing; floor enforced at the entrypoint, `d39095a`) | R0 |

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
every item inherits the v0.4 floor it establishes at the entrypoint.** Variable support
is cross-cutting (see above), not a numbered item — its rows are acceptance criteria
inside the consuming items.

**Status legend:** ✅ Done · 🟡 Partial · ⬜ Not started

| Item | Status | Summary |
|---|---|---|
| R0. Version gating | ✅ Done | connect floored at v0.4 / federation floored at v2.13 (`SUPPORTED_CONNECT_VERSIONS = ['v0.4']`, `d39095a`); below-floor targets rejected at the entrypoint, no per-feature gate |
| R1. Entity resolution | ✅ Done | `entity`/`@key`/`$this` (`--infer-entity-resolvers`) |
| R2. Unions & interfaces | ✅ Done (one deferral) | real `union`/`->match`/interface promotion, unconditional at the v0.4 floor; shape-derived merged-object degrade for input-position or discriminator-less `oneOf` (#25); allOf-member unions (#34); broader `allOf`→interface deferred to its own slice |
| R3. Selection aliasing | ✅ Done | safe-name aliasing + camelCase, OAS + JSON paths |
| R4. Error handling | 🟡 Partial | opt-in `@connect(errors:)` done: `message` heuristic (corpus-ranked field) + `extensions`/`$status`; only `@source`-level errors pending |
| R5. Dynamic headers / auth | 🟡 Partial | slices 1-3 done (global `@source` + per-op `@connect` header auth via per-source mode switch + apiKey-in-query on `@connect` queryParams); `$env`, `from:`, `$request.headers`, apiKey cookie remain |
| R6. Batch entity resolution | 🟡 Common case done | infer from OAS (`--batch` op-id file); single key + one scalar-array input; composite/object-array deferred |
| R10. Reusable `@mapping` | 🟡 In progress (branch `feat/r10-reusable-mappings`) | `--reusable-mappings`, connect v0.5 |
| R7. Richer JSONSelection | 🟡 Partial | `??` coalesced defaults (connect v0.4 + fed v2.14, both directions); envelope unwrap/spreads/chaining have no OAS signal |
| R8. `path`/`queryParams` JSONSelection | ✅ Done | serialization joins (inferred) + per-op `overrides` for path/queryParams (user intent) |
| R9. Computed / literal bodies | ✅ Done | inferred `$args.input { … }` + `overrides[opId].body` raw JSONSelection (replace/drop) |
| R12. OAS folder input | ⬜ Parked | accept a folder of independent OAS specs (OAS mode only): per-file normalize, merge into one OASDocument pre-parse; fail on collisions, sniff+skip non-OAS files |
| R14. Manual directive declarations | ✅ Done | `--directives` file: `Type` / `Type.field` selectors (field part globs) -> verbatim directive strings, added over the parsed output; federation directives join the `@link` import; a selector that names nothing throws |

### Foundation (must precede version-sensitive items)

### R0. Spec version gating — ✅ Done

**Why:** unions/interfaces, errors, batch, and computed bodies all need real spec support
under them; the version gate is what made it safe to build those without emitting
constructs older connect versions can't parse.

**Status:** Done. Originally a per-feature reject-or-downgrade gate (commit `72f625e`);
superseded by a hard floor (`feat/drop-consolidate-unions`, commit `d39095a`, 2026-06-25):
connect is floored at v0.4, federation at v2.13, both rejected at the entrypoint before
generation starts. `parseVersion`/`compareVersions`/`meetsMinimum` and the version
constants live in `src/versions.ts` and are consumed by later items (e.g. R1, R7).

**Scope:**
- Version table + hard floor enforced at the entrypoint (the "Connect spec version
  floor" section above).
- `connectorSpecVersion` is v0.4 only; anything below is rejected before generation starts.
- Emit matching `@link(url: ".../connect/v0.4", import: ["@connect", "@source"])`.
- A feature needing more than the floor still self-gates with `meetsMinimum` (see R7).

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
`src/oas/nodes/obj.ts`, `src/oas/nodes/get.ts`.

> Do 1c alongside 1a/1b — never standalone.

### R2. Unions & interfaces (OAS `oneOf` / `anyOf` + discriminators) — ✅ Done (one deferral)

**Why:** Router v0.4 adds interface/union support. `gen` already has substantial union
machinery; this item finishes the gaps. Connect v0.4 is now the floor for the whole
generator (`feat/drop-consolidate-unions`, commit `d39095a`), so union form no longer
needs a fallback tied to a version gate — it is derived purely from the shape of the OAS
input.

**Verified state of the emitter (read `src/oas/nodes/union.ts`):**
- ✅ **Real `union X = A | B`** (`Union.generate`), filtered to selected members. `Factory`
  builds `Union` nodes from `oneOf`/`anyOf`.
- ✅ **Discriminator → `__typename`**: `Union` stores the OAS `discriminator`
  (`propertyName` + `mapping`), wired through `Factory`. `Union.select` emits the
  composable connect-v0.4 abstract-type form —
  `... <discr>->match(["book", $ { __typename: $("Book") … }], …)` — with a string-literal
  `__typename` per member, value resolved from the discriminator `mapping`. Verified to
  compose at fed 2.13+ / connect v0.4 (`test_R2_union_discriminator_*`). See
  [[connectors-abstract-type-selection]].
- ✅ **Union form is unconditional, derived from shape, not version** — `Union.isFlat()`
  decides it: an input-position `oneOf` (GraphQL has no input unions, any version), a
  discriminator-less `oneOf` (no tag for `->match` to dispatch on), or a `oneOf` nested under a
  named field rather than being the op's own response (rover won't credit fields through a
  `->match` reached that way — #38) always emits the merged object (`#### union degraded to a
  merged object: …`); a bare, discriminated `oneOf` sitting directly as the op's response always
  emits a real `union`/interface. There is no `consolidateUnions` toggle anymore — connect is
  floored at v0.4 program-wide (rejected below that at the entrypoint), so the only question is
  the shape of the input, never the target version. (`test_R2_union_without_discriminator_degrades_to_merged_object`,
  `test_R2_input_union_consolidated_kind_is_intentional`,
  `test_R2_union_form_derived_from_connect_version`, `test_R2_union_nested_in_array_*`.)
- (the earlier gaps here — discriminator-less fallback, allOf-member unions — are closed
  below; broader `allOf` → interface remains the one deferral)

**Done this slice — `oneOf` + shared `allOf` base → `interface`:** when a discriminated `oneOf`'s
members are all `allOf` compositions sharing **exactly one** common base ref, the base is promoted to
a GraphQL `interface`, members emit `… implements Base`, the field returns the interface, and the
connector reuses the `->match` selection (rover-verified to compose at fed 2.13 / connect v0.4). It is
an **id-neutral post-collect pass** (`src/oas/nodes/allOfBase.ts`, wired in `writer.ts` next
to `inferEntityResolvers`): flags `Obj.emitAsInterface` / `Composed.implementsInterface` /
`Union.interfaceBaseRef` rather than mutating `kind` (which is embedded in node ids). Rule 3 skips
promotion (loudly) when the base is used concretely elsewhere among the selected ops. Tested
(`test_R2_interface_*`).

**Closed 2026-06-12 (#34 + #25, details in `docs/issues.md`):**
- ✅ real-union path for `allOf` members: shared `selectedMembers` filter + unique twin-member
  ids (`Type.withUniqueName`); the rule-3-skip case now lists its members and DO's
  `oneOf`-of-`allOf` bodies generate.
- ✅ union form derived from OAS shape, not the connect version: `Union.isFlat()`
  replaced the version-derived `resolveConsolidateUnions` helper and the `consolidateUnions`
  option (both removed by `d39095a`) — real unions/interfaces are now unconditional at connect
  v0.4, the only supported version. The CLI never hardcoded consolidation to begin with.
- ✅ discriminator-less unions: superseded by #25 — they degrade to the merged object (a tag
  cannot be inferred reliably; `->match` needs one).

**Closed 2026-07-04 (#38, details in `docs/issues.md`):**
- ✅ a discriminated union nested under a named field (not the op's own response) degrades to
  the merged object — rover doesn't credit fields through a `->match` reached that way. Same
  upstream limitation as #14, one method (`->match`) instead of another (`->entries`).
  launch_library abstract pass: 76.7% → 86.2%.

**Closed 2026-07-04 (#39, details in `docs/issues.md`):**
- ✅ a merged union's shadowed same-name member field (two members sharing a field name but
  disagreeing on its type — only the first is ever written to the merged object) was still
  treated as reachable by the collector, emitting its type's whole orphan subtree with no
  connector coverage. `Union.dependencies()` now dedupes the same way `generate()`/`select()`
  already did. Closes all of #38's Residue. launch_library abstract pass: 86.2% → 98.3%.

**Closed 2026-07-04 (#40, details in `docs/issues.md`):**
- ✅ an object-typed (or array-of-object) query param emitted a full `type X { ... }` body inline
  inside the argument list — invalid GraphQL, breaking box.yaml's `get:/search`. `Param.visit()` now
  degrades an object/`allOf`-shaped param schema (or just an array's `items`) to the existing
  shapeless-object → `JSON` scalar fallback (#19), preserving array cardinality. box.yaml: 114/114
  (100.0%).

**Remaining scope (own slice):**
- **Broader `allOf` → interface** beyond the discriminated-`oneOf` case (e.g. promote shared bases
  like `Extensible`/`Entity` used across many TMF types). Large blast radius.

**Test infra:** `runOasTest` gained an `opts` arg
(`{ connectorSpecVersion, federationVersion, composeFederationVersion }`) so different
compose targets can be generated and composed; the `consolidateUnions` knob was removed
along with the option itself (`d39095a`) — existing callers default to connect v0.4 / fed
2.14 (real unions).

**Files:** `src/oas/nodes/union.ts`, `src/oas/nodes/factory.ts` (done);
`src/oas/nodes/comp.ts`, `src/oas/io/schemaWriter.ts` (interfaces + version gate, pending).
(connect floored at v0.4 program-wide; no per-feature gate)

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
`src/json/walker/naming.ts`.

### Medium value

### R4. Error handling — `errors: { message, extensions }` — 🟡 Partial (source-level only)

**Spec shape (verified against the connect spec + docs):** `errors` is a single input
`ConnectorErrors { message: JSONSelection, extensions: JSONSelection }` on **both** `@connect` and
`@source` — NOT an array keyed by status code. `extensions` must evaluate to an **object**, `message`
to a **string**; `$status`/`$response.headers`/`$`/`@` are available in both. `isSuccess` also exists on
`@connect`/`@source` (maps chosen status codes to success) — the spec tool's directive SDL omits it, so
its compose-version is unverified.

**Done — baseline slice (opt-in `emitConnectorErrors`):** for operations that document
HTTP error responses, the connector emits `errors: { extensions: """ statusCode: $status """ }` (surfaces
the HTTP status in the GraphQL error extensions). Opt-in (default output byte-identical, like R1); connect
is floored at v0.4 program-wide, so no per-feature gate is needed here. The error-response predicate matches
numeric `4xx/5xx` and the OAS range keys `4XX`/`5XX` (case-insensitive), excluding `default`. Verified to compose
(rover). Files: `src/oas/io/operationWriter.ts` (`writeConnector` +
`hasDocumentedErrors`), options threaded in `oasGen.ts`/`oasContext.ts`/`runners.ts`. Tested
(`tests/all/r4-errors.test.ts`).

**B — heuristic `errors.message` (✅ done):** the error body's string message field becomes
`errors: { message: "$.message" … }` (the `$.` path form — a bare `message` selection builds an
object, which the composer rejects with `INVALID_ERRORS_MESSAGE`). Field priority is
corpus-measured: `message` (755 error schemas), `error` (362), `detail` (7); the field must be a
string on EVERY documented JSON error shape of the op, else no message is emitted (a partial
field would yield null messages on some statuses). Non-JSON/shapeless error responses don't
veto. Resolution is read-only (`resolvePointer`, not `lookupRef` — no refCount bumps).

**C — `isSuccess`: dropped from scope** — the spec's `ConnectorErrors` SDL has only `message`
and `extensions` (re-verified 2026-06-12); `isSuccess` appears in docs but not in the
composable directive, and OAS gives no reliable success-code signal anyway. Revisit only if
it lands in the SDL.

**Remaining:**
- **`@source`-level `errors`** applied across all connectors of a source (needs cross-op
  uniformity analysis to be worth lifting).

**Requires:** `$status` (done), `$response.headers`, `@` (see variable table).

**Files:** `src/oas/io/errorsWriter.ts` (all errors emission);
`src/oas/io/schemaWriter.ts` (source-level, pending).

### R5. Dynamic headers / auth from OAS security schemes — 🟡 Partial

**Why:** Headers are emitted as static example values. OAS `securitySchemes` (apiKey,
bearer, oauth2) should become templated `HTTPHeaderMapping`s.

**Status:** Slices 1-2 done. Slice 1 maps the spec's **global** `security` scheme to a templated
`@source` header. Slice 2 adds **per-operation** auth on `@connect` via a **per-source mode
switch**: when any operation declares its own `security`, the shared `@source` header is suppressed
and every `@connect` carries its *effective* auth (own requirement, the inherited global, or nothing
for a `security: []` public op). This is the OAS-correct model — a `@connect` header cannot remove a
`@source` one, so a shared header would leak on public ops and double up on different-named overrides.
Slice 3 adds **apiKey in query** on each `@connect`'s `queryParams` (a JSONSelection sibling of the
`$args { … }` block, e.g. `"api_key": $config.apiKey`) — no mode gate, since `SourceHTTP` has no
`queryParams` field so query auth can never live on `@source`. Shared logic lives in
`src/oas/io/security.ts` (`mapSchemeToAuth`/`resolveAuth`/`anyOperationDeclaresSecurity`), reused by
both writers. Deferred cases (cookie only) still warn, never drop. Tested (`test_R5_*`, default
v0.4/fed-2.14, rover-composed).

**Scope:**
- ✅ apiKey/header → `{ name: "N", value: "{$config.apiKey}" }` (slice 1).
- ✅ http bearer / oauth2 / openIdConnect → `Authorization: Bearer {$config.token}`;
  http basic → `Authorization: Basic {$config.token}` (slice 1).
- ✅ Per-operation auth on `@connect` — own/inherited/public resolved per op; per-source mode
  switch suppresses the `@source` header when any op declares its own `security` (slice 2).
- ✅ apiKey in **query** → `"N": $config.apiKey` on each `@connect`'s `queryParams` (slice 3).
- ⬜ apiKey in **cookie** (warned + deferred — no spec field, only a `Cookie:` header hack).
- ⬜ `$env`-backed secrets; `from:` response-header extraction; `$request.headers`
  passthrough.

**Requires:** `$config` (done), `$env`, `$request.headers` (see variable table).

**Files:** `src/oas/io/security.ts` (shared), `src/oas/io/schemaWriter.ts`,
`src/oas/io/operationWriter.ts`.

### Lower value / advanced

### R6. Batch entity resolution — `$batch` + `batch: { maxSize }` — 🟡 Common case done

**Status:** Done for the single-key common case (branch `feat/r6-batch-infer`); the config-driven
first draft (`feat/r6-batch`, deleted) is gone. A batch `@connect` is the R1 type-level resolver
with **`$batch` in place of `$this`** — same `@key`, same selection, but the keys come from the
batch endpoint's array input. Everything is inferred from a thin op-id file plus the entity's R1
`@key`; only `maxSize` is a knob.

**Why:** Reduces N+1 entity lookups. Builds on R1 (reuses its `@key`) and R8 (`arrayJoin`).

**Input — `--batch <file>`, keyed by op id** (the one thing OAS can't give: *which* op is the
batch endpoint). The endpoint must also be in the selection — like R1's by-id endpoint, it's
emitted as a normal field AND wired as the entity's batch resolver. Reuses the `--overrides`
JSON-load pattern. `{}`/`null` = defaults:
```json
{ "post:/products/batch": {}, "get:/products": { "maxSize": 50 } }
```

**How it works** (`applyBatchResolvers` in `src/oas/nodes/batch.ts`, a post-collect pass after
`inferEntityResolvers`, reading the selected op's node graph — like `inferEntityResolvers` /
`promoteAllOfBase`, never re-parsing OAS):
- entity = the op's response array item (`[Product]` or `{ results: [Product] }`), resolved via
  `op.resultType` → `Res`/`Arr`/`Obj` and matched by `types.get(item.id)` — so its R1 `@key` is
  reused, never invented.
- request = the single scalar-array input (`op.params` / `op.body.payload`), `$batch`-rooted:
  - exploded query array → `queryParams: "id: $batch.id"`;
  - comma/space/pipe-packed query array → `+ ->joinNotNull(",")` (R8's `arrayJoin`, shared);
  - named body array → `body: "ids: $batch.id"`.
- selection reuses the entity's R1 selection (wrapped as `$.results { … }` for a wrapped response).
- always emits `batch: { maxSize: 100 }` (no OAS signal; file-overridable).

**Skipped (warns via the project logger, never guesses):** an unselected endpoint, composite keys,
object-array request bodies, top-level array bodies, endpoints with path params, more than one array
input, an unknown op, or an entity with no R1 `@key`.

**Deferred to a follow-up slice:** composite keys + object-array bodies (`body: "items: $batch { … }"`
with renames) and the full required-input gate. The single-key path covers the common batch
endpoint; these add real complexity for the long tail.

**Requires:** `$batch`.

**Files:** `src/oas/nodes/batch.ts` (derivation), `src/oas/nodes/obj.ts` (`writeBatchConnector`),
`src/oas/utils/params.ts` (shared `arrayJoin`), `src/cli/oas.ts` (`--batch`), threaded via
`oasContext.ts`/`oasGen.ts`/`writer.ts`. Tested (`tests/all/r6-batch.test.ts`, rover-composed).

### R7. Richer JSONSelection — methods, literals, spreads, coalescing, optional chaining — 🟡 Partial

**Why:** Handles real response shapes: envelope unwrapping (`data.items`), literal
`__typename`, fallbacks.

**Done:** OAS `default:` values now coalesce instead of replacing — `tag: tag ?? $("latest")`
keeps the real value and falls back (response and body directions; the synthetic `success`
field keeps its pure `$(true)`). Bare literals remain below the gate — `??` needs connect
v0.4 AND federation v2.14: the 2.13 composer rejects the grammar (verified on 2.13.0
vs 2.14.1). `->match` literals already land via R2; `->entries` via maps; `->joinNotNull` via R8.

**Remaining (no OAS signal — needs a heuristic or user intent):** envelope unwrapping
(`data.items`), `->first`, spreads (`...$args`), `?!`, optional chaining (parked as #16,
archived branch `feat/optional-chaining-operator`).

**Files:** `src/oas/nodes/scalar.ts` (`??` defaults), `src/oas/nodes/prop*.ts`,
`src/oas/nodes/body.ts`. (`??` gated to connect v0.4 + federation v2.14)

### R8. `path` / `queryParams` as full JSONSelection — ✅ Done (one deferral)

**Why:** More flexible than the current `{$args.x}` / `$args { … }` forms — computed
segments and computed query objects with renaming/methods, on both `SourceHTTP` and
`ConnectHTTP`. (Base `{$args.x}` / `$args { … }` forms already emitted; this is the
computed extension.)

**Done:** OAS array-param serialization — a non-exploded array param emits the matching
join (`"ids": ids->joinNotNull(",")`; `spaceDelimited` → `" "`, `pipeDelimited` → `"|"`).
Exploded arrays (the OAS default) already work as plain array values.

**Done (user intent):** per-operation `overrides` (`--overrides <file>` / API object, keyed by
op id) replace the HTTP path and add/replace/drop query params (raw JSONSelection values) and
headers (string templates) — the explicit-intent channel for everything OAS cannot express.
`--base-url` overrides the `@source` URL. Unmatched override keys warn (typo guard).

**Remaining:** a dropped query param keeps its GraphQL argument (unsent); prune it from the
operation signature if that proves annoying.

**Files:** `src/oas/io/operationWriter.ts` (`arrayJoin`, override merge),
`src/oas/oasContext.ts` (`RequestOverride`).

### R9. Computed / literal request bodies — ✅ Done

**Why:** `ConnectHTTP.body` is already emitted as a straight `$args.input { … }`
mapping (done). The remaining gap was bodies that are not a direct passthrough.

**Done:** `overrides[opId].body` (R8 channel) — a raw JSONSelection replaces the whole
inferred mapping (`name: $args.input.name` + `source: $("web")` literals, `$config`/`$this`
values, renamed keys); `null` drops the body. No OAS signal expresses computed bodies, so
this is user intent by design, like the rest of the overrides.

**Files:** `src/oas/io/operationWriter.ts` (`writeBodyOverride`).

### R10. Reusable `@mapping` emission (connect v0.5) — 🟡 In progress

**Status:** Branch `feat/r10-reusable-mappings` (commits `b7dfff6`, `fe3277d`). Emits reusable
`@mapping` selections under `--reusable-mappings`, gated to connect v0.5; tests compose against a
local composer build (`tests/all/r10-mappings.test.ts`). Not yet in the coverage matrix above —
add the spec-surface row when it merges.

**Files:** `src/oas/nodes/typeUtils.ts`, `propArray.ts`/`propComp.ts`/`propObj.ts`,
`src/oas/io/writer.ts`, `src/versions.ts`. (gate: v0.5)

### R12. OAS folder input — ⬜ Parked

**Why:** JSON mode already accepts `<file|folder>` (`src/cli/json.ts`), but OAS mode is
single-file. Real APIs publish multiple independent OAS documents in one folder (e.g.
Sanity's query + mutation specs). `oas-normalize` and `oas`'s `Oas` class are strictly
single-document, so folder support means merging the docs into one `OASDocument` before
parsing — nothing downstream changes.

**Shape (designed, approved, parked):** `OasGen.fromFolder` (per-file normalize via the
existing `fromFile` pipeline) + a merge helper in `src/oas/utils/` + CLI stat-dispatch on
the `<source>` arg. Compatibility gate (same 3.x minor, deep-equal `servers` and
`jsonSchemaDialect`), root-`security` push-down onto operations before merging, any
collision (paths, components, operationIds) is a hard error naming both files, non-OAS
files sniffed (`openapi`/`swagger` root key) and skipped with a warning. Tests run off
small committed fixtures under `tests/resources/oas/folder/`.

**Detailed plan:** `/Users/fernando/.claude-personal/specs/loop-JNRpnSgn/plan.md`

### R14. Manual directive declarations — ✅ Done

**Landed** (`feat/r14-directives`, merged with the R11 linter): generalised from `@tag` to *any*
directive. A `--directives` JSON file (library: `GenerateOptions.directives`) maps selectors to
verbatim directive strings — `"Mutation.*"`, `"User.email"`, or a bare `"User"` for the type line.
`Directives.apply` (`src/oas/lint/directives.ts`) runs over the parsed output — the same document
the linter reads — so the writers stay directive-unaware and every other byte is untouched.
Federation-spec directives join the federation `@link` import automatically; unknown ones are
written as-is. A declaration that names nothing, or a file that does not parse, stops the run.
Example: `tests/resources/oas/r14-directives.json`.

The original idea and the evidence that shaped it:

**Why:** governance. Contracts filter the supergraph by `@tag`, and which operations (or types)
belong to which audience is pure user intent — OAS carries no signal for it, so gen cannot infer
it. Today a hand-added `@tag` does not survive regeneration; the user needs a way to declare
"this op / this type is tagged X" that is durable across regenerations, the same way per-op
`overrides` are for paths/params/bodies.

**Open questions (deliberately unsettled):**
- **Granularity** — operations first (the concrete ask); types may follow, but tagging a shared
  type has fan-out that op-level tags don't, so they may want different mechanisms.
- **Mechanism** — candidates, not exclusive: a `tags: […]` key on the per-op `overrides` entry
  (the R13 `selectionRoot` pattern: user intent in the existing file, emitted at generation);
  a post-processing step (the Sanity converter's pattern — keeps gen's core tag-unaware);
  or linter-assisted — the R11 selection linter already walks emitted ops/selections, so it could
  verify declared tags against the schema (unknown op, tag on a dropped field) or even carry the
  declarations.
- **Emission** — `@tag` needs the federation `@link` import wired only when used, and tags on a
  shared type must compose across every op that reaches it.

Decide the shape when the first real consumer (a contracts-using customer) pins the requirements.

**A real consumer now exists, and it has already answered most of the open questions above.**
`mdg-private/constellation-registry`'s service-catalog is a governance product built on `@tag`, and its
sibling generator (`tools/connect-gen`, OpenAPI → catalog entry, Rust) emits them from a declarative
manifest. Measured across its 11 published connectors:

| Evidence | Value |
|---|---|
| Connectors carrying `@tag` | **10 of 11** (github 252, slack 176, ashby 147, gong 130, omni 103, confluence 82, hubspot 81, pagerduty 51, incidentio 40) |
| Vocabulary in use | `require-approval` ×984, `pii-high` ×39, `sensitive-readable` ×16, `sensitivity-high` ×10, `approval-gated` ×10, `managers-only` ×8, `pii-medium` ×7, `sensitivity-low` ×5 |
| Declaration shape | `manifest.yaml` → `tags: [{ selector, tags }]`, selector globs: `Query.*`, `Mutation.*`, `Type.field*`, or exact |

What that settles:

- **Granularity** — one selector syntax covers operations *and* type fields, so they do not need
  different mechanisms. The bulk usage is op-level (`Mutation.*` → `require-approval`, 984 of 1109 tags);
  the field-level usage is PII on leaf scalars (`name`, `email` → `pii-high`).
- **Mechanism** — declarative config consumed at generation, i.e. the `overrides`-key candidate rather
  than post-processing. A glob selector is what makes it tolerable to write: `Mutation.*` is one line for
  what would otherwise be hundreds of per-op entries.
- **Emission** — worth noting the consumer *strips* `@tag` from the SDL at publish and stores the
  `coordinate -> tags` map as catalog defaults, so gen's obligation is only that the tagged SDL composes.

**Why it is not cosmetic:** that registry's policy reconciler validates rules against the classifications
actually tagged in a service's published schema, and rejects unknown ones. A connector that emits no tags
cannot have *any* classification policy applied to it — so for a governance consumer, untagged output is
not a missing nicety, it is an unusable artifact.

Observed while building the Sanity connector, which needed exactly this and had to hand-roll it: see
`constellation-connectors/sources/sanity`.

### R15. Selection externalisation — ⬜ Planned

**Why:** selections are flat lists of leaf-path strings whose segments embed *emitted* names.
That one representation is behind three standing problems: #73 (name-derived ids make stored
selections fragile to browse order — the parked structural-ids cure lands here), #49 (selection
size scales with tree size: hubspot lists is 38,300 path strings for "everything under this op",
measured in FIXED.md #118), and issues.md #119's deferred collect-walk map (the per-path
re-resolve disappears with the representation). Decided during #118 (2026-08-18): staged —
the prefix-set fix shipped first; this item is the durable half.

**Shape:** extract selection handling into its own module with **spec-position addressing**
(paths derived from the OAS document structure, not from emitted node names), and a
**selectable granularity mode** — the consumer chooses the selection algorithm per run:
- **operations** — an op is the unit; "everything under this op" is one fact, no field paths.
  The cheap mode for whole-spec generation and the CLI's `-n` default.
- **leaf fields** — today's per-field selection, for the web app's field picking and curated
  production connectors.
Op-only as the *only* mode was considered and rejected (breaks web field picking, makes
always-everything the default); as a *chosen* mode it is the right cost model.

**Migration surface to design for:** web app localStorage selections, saved selection JSON
files (`--load-selections`), test-pinned paths — all carry emitted-name paths today.

**Refs:** docs/issues.md #73 (parked cures, sized), #119; docs/FIXED.md #49-adjacent
measurements in #118. Related: #13/#89 (path-dependent divergence family).

---

## Coverage findings — robustness backlog (from `COVERAGE.md`)

`tools/coverage-spec.mts` runs **every GET op** of the corpus through generate + rover-compose
(see `COVERAGE.md` for the live per-spec table, regenerate with `make coverage`). The failures,
triaged **generator-bug vs input-quality**. (The harness, `COVERAGE.md`, and the real-world vendor
specs are kept **local-only** — gitignored — because the published specs embed example secrets that
block pushes; this section is the committed summary of what they showed.)

**Corpus status (re-measured 2026-08-10, full `make coverage` sweep — connect v0.4 / fed 2.15.1,
stock rover 0.40; the fed pin moved off 2.14.1 because the #14 `->entries` fix ships in the
supergraph plugin from 2.15.0):**

| Spec | GET ops | pass-rate |
|---|--:|--:|
| googlebooks | 30 | 100.0% |
| slack | 80 | 98.8% |
| digitalocean | 145 | 99.3% |
| box | 114 | 100.0% |
| openai | 10 | 100.0% |
| asana | 79 | 100.0% |
| sendgrid | 154 | 100.0% |
| github | 444 | 98.9% |
| 1password connect/events | 12 | 100.0% |
| ably control | 7 | 100.0% |
| amadeus flight offers | 1 | 100.0% |
| docker engine | 43 | 100.0% |
| nasa / nytimes / openfigi / visualcrossing | 14 | 100.0% |
| spotify | 58 | 100.0% |
| square | 84 | 100.0% |
| stripe | 210 | 99.0% |
| trello | 143 | 100.0% |
| quickbooks online | 8 | 100.0% |
| adobe commerce | 242 | 100.0% |
| launch library | 116 | 99.1% |
| common room core † | 9 | 100.0% |
| mindbody † | 8 | 100.0% |
| TMF632 party | 4 | 100.0% |
| TMF637 inventory | 2 | 100.0% |
| TMF666 account | 14 | 100.0% |
| TMF680 recommendation | 2 | 100.0% |
| TMF717 customer360 | 3 | 33.3% (#61) |
| js-mva consumer/product-selector | 4 | 100.0% |
| most popular product | 4 | 100.0% |
| omni † | 54 | 98.1% |
| confluence | 65 | 93.8% |
| mercedes CCS | 43 | 100.0% |
| incident.io | 101 | 100.0% |
| sanity projects † | 11 | 100.0% |

Overall GET: **99.3% OK (2301/2318)**. The fed 2.15.1 bump alone recovered **+83 ops** (stripe +37,
CCS +26, github +7, docker-engine +6, incident.io +4, square +2, omni +1) by closing the
`CONNECTORS_UNRESOLVED_FIELD` bucket (89 → 4, github residue). Top remaining category is GEN-EMPTY
(4 ops).

> **`#40` re-measurement (2026-07-04):** box **98.2% → 100.0% (+1 op, `get:/search`)** — an
> object-typed (array-of-`$ref`-object) query param was emitted as a full `type X { ... }` body
> inline inside the argument list (invalid GraphQL); now degrades to the existing JSON-scalar
> fallback (`#19`), preserving array cardinality (`[JSON]`). This was the second half of a
> previously-undocumented local-only finding ("B3"); its other half (`get:/files/.../boxSkillsCards`)
> was already fixed as a side effect of `#39`. Box is now fully clean (114/114).

> **`#39` re-measurement (2026-07-04):** launch library **86.2% → 98.3% (+14 ops)**, closing all of
> `#38`'s Residue — a merged union's shadowed same-name member field (e.g. two members' `rocket`
> field pointing at different types) was still treated as reachable by the collector even though
> only the first one is ever written to the merged object; the shadowed one's orphan subtree (and,
> transitively, schemas it alone re-references elsewhere) is no longer collected. The 2 ops still
> failing (`GRAPH_QL_ERROR`, `SELECTED_FIELD_NOT_FOUND`) are unrelated, pre-existing gaps.

> **`#38` re-measurement (2026-07-04):** launch library **76.7% → 86.2% (+11 ops)** — a discriminated
> union nested under a field (`results: [PolymorphicX]`, not the op's own response) now degrades to a
> merged object instead of a real union rover can't resolve fields through. Every other delta below
> vs the last snapshot predates this fix — `df783ed` ("stop dropping ops whose response is a bare
> scalar", already committed) landed between measurements: adobe commerce 89.7%→97.9% (+20), sendgrid
> 97.4%→98.7% (+2), TMF666 42.9%→100.0% (+8), openai 90.0%→100.0% (+1). Mercedes CCS unchanged at
> 39.5% (still blocked on upstream #14); TMF632/TMF637 unchanged at 0.0% (pre-existing, input-quality
> per prior triage).

> **v0.4-floor re-measurement (2026-07-02):** the consolidate/real-unions split retired with
> `feat/drop-consolidate-unions` (`d39095a`) — there's only one pass now
> (`Union.isFlat()` derives the form from OAS shape, not a toggle). Net **+19 ops**
> vs the prior real-unions snapshot (1472 → 1491), driven by adobe commerce (88.0→89.7%, +4),
> launch library (69.0→76.7%, +9), sendgrid (95.5→97.4%, +3), confluence (89.2→93.8%, +3): the old
> check (`consolidateUnions || !discriminator`) never looked at `kind`, so an **input-position**
> `oneOf` with a discriminator still attempted a real `union` (invalid GraphQL — no input unions) and
> failed compose. `isFlat()`'s `kind === 'input'` check fixes that as a side effect of
> the floor refactor, not a targeted fix.

> **Box fix (B1+B2):** `#` in an OAS path leaked into the GraphQL field name (an SDL line comment,
> breaking `@connect` binding) and an inline single-member `allOf` array item reached the emit loop
> nameless (`startsWith` of undefined). B1 adds `#` to the field-name split class (HTTP path
> untouched); B2 names the inline-allOf `Composed` at its construction site + a writer-level
> name/emittability invariant + null-safe `isRef`. Box **86.8→90.4% consolidate (99→103 OK)** and
> **93.0→98.2% real unions (106→112 OK)** — exactly the 5 `#` ops + the 1 GEN-throw, verified by
> per-op dump. **2 real-unions ops remain** (`get:/search`, `get:/files/{file_id}/metadata/global/boxSkillsCards`,
> both `CONNECTORS_UNRESOLVED_FIELD`, neither has a `#`) = **B3**, a separate union-member-field
> coverage follow-up (see `docs/box-fix-plan.md`). No other corpus spec has a `#` path, so B1/B2 move
> only box; overall totals updated by box's delta (+4 consolidate, +6 real unions).

> **Realignment finding:** the `default` pass moved v0.3 → v0.4 to match the shipping default
> (`9ca5ce7`). Headline: at v0.4 **real unions now beats consolidate** (93.5% vs 90.6%) — the
> consolidate pass dropped ~32 ops vs the prior v0.3 snapshot (1135 → 1103). **Mercedes CCS went
> 100% → 39.5% on the consolidate pass**: the v0.3 composer accepted its consolidated-union shapes,
> but v0.4's stricter shape validator (#14) rejects them — so the old 100% was a v0.3 artifact that
> hid the #14 block. Mercedes is now 39.5% on **both** passes (`CONNECTORS_UNRESOLVED_FIELD`, 26 ops).
> In the expanded corpus, the gap histogram's #1 bucket is still `CONNECTORS_UNRESOLVED_FIELD`
> (119 across both passes), now including the new low-scoring Launch Library and TMF cases.
> Historical increments — #23/#24 +67/pass, #26 +76, #33 +26 GETs — were measured against the
> pre-realignment v0.3 baseline; see git history.


**Mutations corpus (post:/put:/patch:/del:, full sweep re-measured 2026-08-10 at fed 2.15.1;
sweep via `--verbs mutations`; fast guard: `tests/all/corpus-mutations.test.ts`):**

| Spec | mutation ops | pass-rate |
|---|--:|--:|
| googlebooks | 21 | 100.0% |
| slack | 94 | 100.0% |
| digitalocean | 145 | 98.6% |
| box | 144 | 93.8% |
| openai | 18 | 100.0% |
| asana | 88 | 100.0% |
| sendgrid | 180 | 96.7% |
| github | 401 | 98.5% |
| 1password connect/events | 6 | 83.3% |
| ably control | 15 | 100.0% |
| amadeus flight offers | 1 | 100.0% |
| docker engine | 61 | 96.7% |
| openfigi | 1 | 0.0% |
| plaid | 198 | 99.5% |
| spotify | 30 | 100.0% |
| square | 116 | 96.6% |
| stripe | 236 | 97.9% |
| trello | 181 | 98.9% |
| quickbooks online | 7 | 100.0% |
| adobe commerce | 344 | 100.0% |
| common room core † | 13 | 76.9% |
| mindbody † | 3 | 66.7% |
| TMF632 party | 16 | 100.0% |
| TMF637 inventory | 10 | 100.0% |
| TMF666 account | 51 | 100.0% |
| TMF680 recommendation | 6 | 100.0% |
| TMF717 customer360 | 5 | 100.0% |
| omni † | 92 | 92.4% |
| confluence | 65 | 90.8% |
| mercedes CCS | 1 | 100.0% |
| incident.io | 112 | 95.5% |
| sanity projects † | 18 | 100.0% |

Overall mutations: **97.7% OK (2618/2679)** — up from 96.2% (2451/2549) at fed 2.14.1: the fed bump
recovered +42 legacy ops and the two new specs added 125/130. `CONNECTORS_UNRESOLVED_FIELD` is down
to 1 op (confluence); the leading buckets are now `INVALID_GRAPHQL` (29) and `INVALID_BODY` (19).

> **`#38` re-measurement (2026-07-04):** `#38` is GET-only (launch library, the only spec it touches,
> has 0 mutation ops). adobe commerce 54.9%→99.1% (+152) and TMF666 92.2%→100.0% (+4) are `df783ed`
> ("stop dropping ops whose response is a bare scalar", already committed), not `#38` — same as the
> GET-table note above.

(launch library, js-mva ×2, most popular product, nasa, nytimes ×2, and visualcrossing have 0
mutation ops — read-only spec surfaces, not a gap.)

Mutations overall: **85.8% OK (1456/1697)**. Not comparable 1:1 to the prior 1249-op snapshot
below — the corpus grew to match the GET sweep's expanded spec list (adobe commerce +344,
plus TMF/common-room-core/mindbody/CCS newly swept for mutations).

> **v0.4-floor re-measurement (2026-07-03):** the standout finding is **adobe commerce at
> 54.9%** (189/344) — 152 of the corpus-wide 153 `GEN-EMPTY` ops come from this one spec, by
> far the dominant gap-histogram bucket now (vs. `INVALID_GRAPHQL`/`INVALID_SELECTION`/
> `INVALID_BODY` compose-fails elsewhere, ~30/22/17 ops). Not yet triaged — generator-bug vs
> input-quality is unknown; a `COV_DUMP` per-op dump (see `docs/box-fix-plan.md` for the
> pattern) is the next step if this is worth chasing. digitalocean (87.6→92.4%), box
> (86.1→91.7%), and github (96.0→97.3%) all improved, consistent with the same
> input-position-union fix noted in the GET re-measurement above.

Historical fix arc (measured against the pre-expansion, v0.3-era 1249-op corpus — see git
history for exact deltas): **47% → 90.2% default (1127/1249) · 92.2% abstract — TARGET MET** in one
arc — #27 one argument list
(+389/pass), #28/#29 body alias direction + default literals (+66/pass), #30 body-arg name
(#15 discipline) + #31 empty-response synthetic (+63/pass), #32 JSON-only ops + quoted body
keys (+26/pass, deliberately narrowed: the broad leaf rule diverged shared-type selections —
see the entry's Care note), #33 four crash families (+37 mutations, +26 GETs). Every fix
matrix-verified (0 pass→fail). Remaining (as of that snapshot): asana/box/confluence composeFail
residue, DO's oneOf-of-allOf bodies (2, the R2 allOf-member gap), DEGRADED unions (by design on v0.3).

#18 measured corpus-wide: **+36 ops/pass** (github +20, box +9, confluence +4, DO +2, slack +1).

With the **#14 patch** applied to composition (verified via local `apollo-federation-cli` + rover
shim), the abstract pass recovers **~69 ops corpus-wide** (CCS +26, github +15, box +14, confluence
+7, DO +4, omni +2, asana +1): overall abstract **73.5% → 79.1%**.

**Issue queue (post-triage 2026-06-10; priority = measured impact; details in `docs/issues.md`):**

| Rank | Item | Ops (both passes) | Status |
|--:|---|--:|---|
| 1 | ~~**#17** — param defaults dangle ` = `~~ | — | ✅ fixed `aae14ca` |
| 2 | ~~**R-collector** — identical inline schemas rename instead of dedup → orphan types (#18)~~ | — | ✅ fixed `0cff45d`, +36 ops/pass corpus-wide; residue split into the two rows below |
| 2a | ~~**#22** — `Composed` skips the #9/#12 collision check → duplicate type definitions~~ | — | ✅ fixed `1669c6a`; the 9 box ops fail on a second bug (#13-family cycle cut) the duplicate was hiding |
| 2b | **R-options-pairing** (open research) — same-named array items split (`Options` vs `OptionsItem`) but field/selection pair with the wrong half (box `/metadata_templates` family); #13-adjacent | 5/pass (box) | mechanism unpinned — likely the #13 collect-time prop-merge resolves it; verify when slicing #13 |
| 3 | ~~**#19** — typeless `{}` schemas throw~~ | — | ✅ fixed `aae14ca` (sendgrid's 3 throws were this shape too; omni's 3 persist → R-genthrow-tail confirmed distinct) |
| 4 | ~~**R-anyof-empty** (#20) — `anyOf: [$ref, empty-closed-object]` → zero types~~ | — | ✅ fixed (working tree): single-real-member collapse, +6 ops / 0 regressions once #26 cleared the collector orphans that blocked it |
| 5 | ~~**R-genthrow-tail** — omni(3) GEN-THROW ops~~ | — | ✅ fixed `00c0d4b` (#23): OAS 3.1 type arrays collapse to the first non-null entry; omni 83.3→88.9 |
| 6 | ~~**#13** — path-dependent cycle cuts diverge same-named instances~~ | — | ✅ mechanism fixed `3525085` (SDL-only overrides from sibling routes); the gated ops then fell to #25 (`b061b80`) and #26 (`824b1c2`) — confluence abstract 69.2→83.1 |

GEN-EMPTY resolution: of the non-Slack residue (25 ops/pass), 15 are legit input quality (non-JSON
file endpoints on DO/confluence/github; scalar-rooted responses — the latter a possible future
enhancement, not a bug) and 10 are R-anyof-empty. Slack's stubs turned out to be **#24** (enum
fields silently dropped from `>**` expansion), not input quality: fixed, 46.3→96.3 both passes;
the residual 3 are real file endpoints.
Bucket labels (INVALID_GRAPHQL/INTERNAL_ERROR/GROUP_SELECTION) shift across composition versions —
re-derive counts per fix; don't trust the histogram labels.

**Enhancements (not bugs — ideas only, mechanism untriaged):**
- ~~**E-slack-ok**~~ — resolved by **#24** (it was a bug: `>**` dropped enum props; slack
  46.3→96.3, +40 ops/pass — beating the estimate).
- **E-scalar-roots** — scalar/Map-rooted responses (github `/emojis` string-map,
  `/gitignore/templates` `[string]`) yield nothing today; emitting scalar/Map roots is the companion
  enhancement (4 ops).

**Fixed since the last refresh** (entries + fixtures in `docs/issues.md`): #8 `#/paths` pointer names
(DO 35→74%), #9 inline-shape collisions (`SELECTED_FIELD_NOT_FOUND`), #10 abstract-pass "hang"
(quadratic `selectedProps` + uncut recursion → cycle cuts commented in both artifacts), #11 `anyOf`
params, #12 inline-vs-component emitted-name collision (cleared Confluence `CIRCULAR_REFERENCE`),
**#15** def/ref type-name divergence (`44b628d` — sendgrid 77.9→89.0, box 57→66.7, DO 86.2→91.7,
`INVALID_GRAPHQL` 143→39), **#18** identical-inline-schema dedup + convergent renames (`0cff45d` —
box 66.7→74.6, DO 92.4→93.8, both passes).

**Mutation arc (2026-06-12, details per id in `docs/issues.md`):** #27 one argument list
(`4e5e479`), #28-#31 body direction/literals/names/empty responses (`4b5c986`), #32 JSON-only
ops + quoted body keys (`556f302`), #33 four crash families (`0c7c450`), #34 allOf-member
unions + version-derived union form (working tree).

**Upstream / parked:**
- **#14** (upstream): composition's v0.4 shape validator drops `Array` shapes → `->entries`
  sub-selections spuriously unresolved. Fix drafted + verified on router branch
  `fix/connect-v04-array-shape-seen-fields` (`212e35b60`); awaiting internal PR. Affects every
  OAS `additionalProperties` dictionary.
- **#16** (⏸ parked): mark OAS-optional fields with `?` in selections. Semantically correct and the
  plumbing exists (`Prop.required`), but `?`-groups don't compose on released toolchains
  (2.13/2.14) — gate: composition ≥ 2.15 ships in rover. Do not emit earlier or upgrades from
  2.11 onwards regress. The old implementation is archived on the remote branch
  `feat/optional-chaining-operator` (kept through the 2026-06-12 branch cleanup).

**Input quality (NOT our bug — don't chase):** Slack's published spec declares ~146 methods with
*"a verbose schema is not available for this method"* — stub responses with nothing to generate;
omni/confluence needed fixture patches (dangling `$ref`s, protocol-relative `servers[].url`), see
TEST_CORPUS.md. Regenerate `COVERAGE.md` after each fix to watch the numbers move.

## Sequencing notes

- **R0 (version gating) is first** — it establishes the v0.4 floor every item now
  inherits at the entrypoint, and resolves the prior ordering inconsistency (v0.4-dependent
  unions used to precede the version bump).
- **Variable support is cross-cutting**, not a trailing item — each variable's row in
  the table is acceptance criteria inside its consuming item (R1/R4/R5/R6/R7/R9).
- **R3 and R2** most affect *validity* of output (currently invalid/unsupported); R2's
  union form is shape-derived and unconditional at the v0.4 floor (no downgrade path).
- **R1** most affects *functionality* (makes the connector actually federate); do 1c
  alongside 1a/1b — never standalone.
- **R6** depends on R1; parts of **R7/R8/R9** build on R1 and the selection work.

## Verification

This is a documentation deliverable. Verify by:
- Reading this file for accuracy/order (version gating first; variables cross-cutting).
- Confirming the **coverage matrix** accounts for every spec surface in the "Reference
  (router source)" files, and that every "Mapped to" cell names a real item R0–R9 or an
  explicit non-goal — no dangling references.
- Confirming the "Connect spec version floor" section accurately reflects the
  hard-reject-at-entrypoint behavior — no per-item version gate remains to check for.
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
