# apollo-conn-gen — Connector Feature Roadmap

Gap analysis of what the **Apollo Router** (`main` branch, v2.15.x) supports in the
connectors spec versus what **apollo-conn-gen** currently emits, plus a prioritized,
version-gated plan to close the gaps. Verified against the emitter source.

Source of truth for the spec surface:
`<router>/apollo-federation/src/connectors/` (router `main`, v2.15.x).

## Current state

| | Router `main` | apollo-conn-gen today |
|---|---|---|
| Connect spec | v0.1–v0.3 stable, **v0.4 preview** | **LATEST** default (v0.4 today — `LATEST_CONNECT_VERSION`, 2026-06-12) |
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
| `ConnectHTTP` | `path` as full JSONSelection | Done (templated + per-op override) | R8 |
| `ConnectHTTP` | `queryParams` block / JSONSelection | Done (`$args{…}` + serialization joins + per-op override) | R8 |
| `ConnectHTTP` | `headers` (per-op) | Partial (static examples + per-op override w/ `$config` templates) | R5 |
| `ConnectHTTP` | `body` (full JSONSelection) | Done (`$args.input`) | R9 (computed/literal only) |
| `@connect` | `entity: true` (Query-field resolver) | Deliberately not emitted (type-level `$this` favoured — R1 note) | R1 (1a) |
| `@connect` | type-level on OBJECT + `$this` | Done (`--infer-entity-resolvers`) | R1 (1b) |
| `@connect` | `errors`/`isSuccess` | Partial (`errors.extensions` + `$status`, opt-in; `message`/`isSuccess` pending) | R4 |
| `@connect` | `batch` (ConnectBatch) | Missing | R6 |
| `ConnectorErrors` | `message`, `extensions` | Partial (`extensions` done; `message` pending) | R4 |
| `ConnectBatch` | `maxSize` | Missing | R6 |
| `HTTPHeaderMapping` | `name` | Partial | R5 |
| `HTTPHeaderMapping` | `value` (StringTemplate `{$config}`/`{$env}`/`{$context}`) | Partial (`{$config.*}` on global `@source` auth; `$env`/`$context` pending) | R5 |
| `HTTPHeaderMapping` | `from` (response-header extract) | Missing | R5 |
| `@key` (federation) | key-field emission | Done (entity inference, R1) | R1 (1c) |
| JSONSelection | field selection + nesting + `->entries` | Done | — |
| JSONSelection | aliasing / quoted keys / camelCase | Done (responses R3; request bodies #28/#32) | R3 |
| JSONSelection | methods, literals, spreads, `??`/`?!`, optional chaining | Partial (`->entries`, `->match`, `->joinNotNull`, `??` coalesced defaults, `$(literal)`/`__typename` done; spreads/`?!`/chaining pending) | R7 |
| OAS `oneOf`/`anyOf` + discriminator | unions/interfaces | Done (real `union` + `->match` `__typename` + interface promotion on v0.4; consolidate/merged-object downgrades below; version-derived) | R2 |
| Variables | `$args` | Done | — |
| Variables | `$this` (R1), `$config` (R5), `$status` (R4) | Done | — |
| Variables | `$env`, `$batch`, `$request.*`, `$response.*`, `@` | Missing | Cross-cutting (lands with R4/R5/R6/R7/R9) |
| Variables | `$context` | Missing | Non-goal |
| Version enum / `@link` | v0.1–v0.4 selection + gating | Done (R0 plumbing; union form version-derived, #34) | R0 |

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
| R2. Unions & interfaces | ✅ Done (one deferral) | real `union`/`->match`/interface promotion (v0.4), consolidate downgrade (< v0.4), discriminator-less merged-object degrade (#25), allOf-member unions (#34), version-derived form (`resolveConsolidateUnions`); broader `allOf`→interface deferred to its own slice |
| R3. Selection aliasing | ✅ Done | safe-name aliasing + camelCase, OAS + JSON paths |
| R4. Error handling | 🟡 Partial | baseline `@connect(errors: { extensions })` w/ `$status` (opt-in, v0.2+); `message`/`isSuccess`/source-level pending |
| R5. Dynamic headers / auth | 🟡 Partial | slice 1 done (global `@source` `$config` header); per-op, `$env`, `from:`, `$request.headers` remain |
| R6. Batch entity resolution | ⬜ Not started | depends on R1 |
| R7. Richer JSONSelection | 🟡 Partial | `??` coalesced defaults (connect v0.4 + fed v2.14, both directions); envelope unwrap/spreads/chaining have no OAS signal |
| R8. `path`/`queryParams` JSONSelection | ✅ Done | serialization joins (inferred) + per-op `overrides` for path/queryParams (user intent) |
| R9. Computed / literal bodies | ⬜ Not started | base `$args.input` body done; computed remainder open |

### Foundation (must precede version-sensitive items)

### R0. Spec version gating — ✅ Done

**Why:** v0.4-dependent items (unions) and v0.2-dependent items (errors, batch) can't be
emitted safely without a version gate.

**Status:** Done (commit `72f625e`; defaults re-bumped 2026-06-12: no version asked for
means LATEST — connect v0.4 / federation v2.14, via `LATEST_CONNECT_VERSION`). Originally:
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

### R2. Unions & interfaces (OAS `oneOf` / `anyOf` + discriminators) — ✅ Done (one deferral)

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
- (the earlier gaps here — version-gate wiring, discriminator-less fallback, allOf-member
  unions — are closed below; broader `allOf` → interface remains the one deferral)

**Done this slice — `oneOf` + shared `allOf` base → `interface`:** when a discriminated `oneOf`'s
members are all `allOf` compositions sharing **exactly one** common base ref, the base is promoted to
a GraphQL `interface`, members emit `… implements Base`, the field returns the interface, and the
connector reuses the `->match` selection (rover-verified to compose at fed 2.13 / connect v0.4). It is
an **id-neutral post-collect pass** (`src/oas/nodes/interfacePromotion.ts`, wired in `writer.ts` next
to `inferEntityResolvers`): flags `Obj.emitAsInterface` / `Composed.implementsInterface` /
`Union.interfaceBaseRef` rather than mutating `kind` (which is embedded in node ids). Rule 3 skips
promotion (loudly) when the base is used concretely elsewhere among the selected ops. Tested
(`test_R2_interface_*`).

**Closed 2026-06-12 (#34 + #25, details in `docs/issues.md`):**
- ✅ real-union path for `allOf` members: shared `selectedMembers` filter + unique twin-member
  ids (`Type.withUniqueName`); the rule-3-skip case now lists its members and DO's
  `oneOf`-of-`allOf` bodies generate.
- ✅ version-gate wiring: `resolveConsolidateUnions` derives the union form from the connect
  version (v0.4+ → abstract types; below → consolidate downgrade); an explicit ask for real
  unions on < v0.4 downgrades with a warning. The CLI no longer hardcodes consolidation.
- ✅ discriminator-less unions: superseded by #25 — they degrade to the merged object on v0.4
  too (a tag cannot be inferred reliably; `->match` needs one).

**Remaining scope (own slice):**
- **Broader `allOf` → interface** beyond the discriminated-`oneOf` case (e.g. promote shared bases
  like `Extensible`/`Entity` used across many TMF types). Large blast radius.

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

### R4. Error handling — `errors: { message, extensions }` (+ `isSuccess`) — 🟡 Partial

**Spec shape (verified against the connect spec + docs):** `errors` is a single input
`ConnectorErrors { message: JSONSelection, extensions: JSONSelection }` on **both** `@connect` and
`@source` — NOT an array keyed by status code. `extensions` must evaluate to an **object**, `message`
to a **string**; `$status`/`$response.headers`/`$`/`@` are available in both. `isSuccess` also exists on
`@connect`/`@source` (maps chosen status codes to success) — the spec tool's directive SDL omits it, so
its compose-version is unverified.

**Done — baseline slice (opt-in `emitConnectorErrors`, connect v0.2+):** for operations that document
HTTP error responses, the connector emits `errors: { extensions: """ statusCode: $status """ }` (surfaces
the HTTP status in the GraphQL error extensions). Opt-in (default output byte-identical, like R1) and
version-gated — below v0.2 it skips with a logged downgrade. The error-response predicate matches numeric
`4xx/5xx` and the OAS range keys `4XX`/`5XX` (case-insensitive), excluding `default`. Verified to compose
(rover, fed 2.12 / connect v0.3). Files: `src/oas/io/operationWriter.ts` (`writeConnector` +
`hasDocumentedErrors`), options threaded in `oasGen.ts`/`oasContext.ts`/`runners.ts`. Tested
(`tests/all/r4-errors.test.ts`).

**Remaining:**
- **B — heuristic `errors.message`:** detect a string message field in the documented error body
  (`message` / `error` / `error.message` / `detail` / `title`) and emit `errors.message`. Heuristic; the
  composer rejects a non-string result.
- **C — `isSuccess`:** verify its compose-version first; inferring success-codes from OAS is unreliable.
- **`@source`-level `errors`** applied across all connectors of a source.

**Requires:** `$status` (done), `$response.headers`, `@` (see variable table).

**Files:** `src/oas/io/operationWriter.ts` (done); `src/oas/io/schemaWriter.ts` (source-level, pending).
(gate: v0.2+)

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
`src/oas/nodes/body.ts`. (gate: v0.1+; `??` gated to connect v0.4 + federation v2.14)

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
`src/oas/oasContext.ts` (`RequestOverride`). (gate: v0.2+; joins on all versions)

### R9. Computed / literal request bodies — ⬜ Not started

**Why:** `ConnectHTTP.body` is already emitted as a straight `$args.input { … }`
mapping (done). The remaining gap is bodies that are not a direct passthrough.
(Verified: `body.ts` emits only the `$args.input` form — no `$config`/`$this`/literals.)

**Scope:** Literal object fields, renamed keys, and values from variables other than
`$args.input` (e.g. `$config`, `$this`). Builds on existing `body.ts` machinery.

**Requires:** `$config`.

**Files:** `src/oas/nodes/body.ts`. (gate: v0.2+)

---

## Coverage findings — robustness backlog (from `COVERAGE.md`)

`tools/coverage-spec.mts` runs **every GET op** of the corpus through generate + rover-compose under
two configs (see `COVERAGE.md` for the live per-spec table). The failures, triaged **generator-bug vs
input-quality**. (The harness, `COVERAGE.md`, and the real-world vendor specs are kept **local-only**
— gitignored — because the published specs embed example secrets that block pushes; this section is the
committed summary of what they showed.)

**Corpus status (measured 2026-06-12 post-#33, stock rover 0.40 / composition 2.13):**

| Spec | GET ops | default (v0.3) | abstract (v0.4) |
|---|--:|--:|--:|
| googlebooks | 30 | 100% | 100% |
| asana | 79 | 100% | 100% |
| mercedes CCS | 43 | 100% | 39.5% → **100% with the #14 patch** |
| digitalocean | 145 | 97.9% | 97.9% (#33 file endpoints) |
| slack | 80 | 96.3% | 96.3% |
| sendgrid | 154 | 95.5% | 95.5% |
| github | 444 | 92.1% | 95.0% |
| omni | 54 | 92.6% | 90.7% |
| openai | 10 | 90.0% | 90.0% |
| box | 114 | 87.7% (#33) | 93.9% |
| confluence | 65 | 75.4% (16 DEGRADED) | 89.2% (#33) |

Overall GET: **default 93.2% (1135/1218) · abstract 93.3% (1137/1218)**, abstract ~96%+ once
the #14 patch ships. Increments: #23+#24 +67/pass, #25 +6 abstract, #26 +76 (76 fail→pass /
0 pass→fail), #33 +26 GETs (file endpoints → synthetic success).


**Mutations corpus (post:/put:/patch:/del:, 1249 ops/pass — first measured 2026-06-12, sweep via
`--verbs mutations`; fast guard: `tests/all/corpus-mutations.test.ts`):**

| Spec | mutation ops | default (v0.3) | abstract (v0.4) |
|---|--:|--:|--:|
| googlebooks | 21 | 100% | 100% |
| slack | 94 | 100% | 100% |
| sendgrid | 180 | 95.6% | 95.6% |
| github | 401 | 92.8% | 96.0% |
| omni | 92 | 92.4% | 92.4% |
| digitalocean | 145 | 87.6% | 87.6% |
| box | 144 | 81.9% | 86.1% |
| asana | 88 | 83.0% | 83.0% |
| openai | 18 | 100% | 100% |
| confluence | 65 | 70.8% | 76.9% |

Mutations overall: **47% → 90.2% default (1127/1249) · 92.2% abstract — TARGET MET** in one
arc — #27 one argument list
(+389/pass), #28/#29 body alias direction + default literals (+66/pass), #30 body-arg name
(#15 discipline) + #31 empty-response synthetic (+63/pass), #32 JSON-only ops + quoted body
keys (+26/pass, deliberately narrowed: the broad leaf rule diverged shared-type selections —
see the entry's Care note), #33 four crash families (+37 mutations, +26 GETs). Every fix
matrix-verified (0 pass→fail). Remaining: asana/box/confluence composeFail residue, DO's
oneOf-of-allOf bodies (2, the R2 allOf-member gap), DEGRADED unions (by design on v0.3).

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
