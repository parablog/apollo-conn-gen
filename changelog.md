# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.26.0]

### Added

- New `--keep-field-names` option to keep the API's own field and argument spellings
  (`owner_id`, `page_size`) where they are already valid GraphQL names, instead of
  camelCasing them. Spelling twins (`foo_bar` + `fooBar`) each keep their own name.
  Details in README.md. Issues #158, #162.
- New `--skip-arg-defaults` option to move argument defaults out of the SDL and into prose:
  each operation documents its defaults, ranges and allowed values in a `Params:` docstring
  line. Issue #159.
- New `--doc-response-fields` option to document each operation's top-level response fields
  in a `Returns:` docstring line. Issue #160.
- New per-operation override to place an operation under Query or Mutation when the HTTP
  method disagrees with its real semantics. Format details in README.md. Issue #150.
- Sparse-by-default REST reads (`fields=`-style query params) can now default that
  parameter to the generated selection. Details in README.md. Issue #151.
- Hand-authored schema content can now survive regeneration: a marked CUSTOM region
  round-trips unchanged. Details in README.md. Issue #140.

### Changed

- **Migration note (#157):** an operation with an inline request body now names its input
  type after the operation (`CreateAuthTokensInput`), replacing the placeholder-`b` names.
  Update clients pinned to the old names.
- **Composition requirement:** default-value (`??`) selections fail to compose only on
  plugin 2.14.0. Use composition/router 2.15 or newer — the README's Versions section has
  the measured details. Issue #163.

### Fixed

- Targeting `--federation-version v2.13` no longer replaces real response values with
  their OAS defaults — the field emits plain and keeps its optional marker. Issue #165.
- Identifier-shaped fields (`id`, `*_id`) are now typed `ID`, even when the spec declares
  another scalar type. Issues #142, #146.
- A 200 response declared with no body no longer collapses to a synthetic Boolean that
  loses real payload data — it degrades to `JSON`. Issue #147.
- A response schema that is present but `null` no longer crashes the CLI — it degrades
  cleanly. Issue #148.
- A request body declared only under a non-`application/json` media type now ships with
  its declared `Content-Type` instead of a mislabeled one. Issue #149.
- An "everything under this op" selection stays one compact wildcard instead of expanding
  into one string per field. Issue #153.
- A selection saved before a spec reorder finds its renamed inline `allOf` member again
  instead of failing outright. Issue #154.
- A selection path recovered after an identity drift no longer answers empty — its segment
  string is re-derived after recovery. Issue #135.
- A Swagger 2.0 `formData` request body is no longer dropped — it maps as a form body.
  Issue #137.
- Every remaining field degraded to `JSON` now carries its reason in the schema docstring —
  parameters, union members, and the last object sites join 0.25.0's first pass, with
  cleaner note text. Issues #132, #145, #152, #156.

## [0.25.0]

### Added

- A field degraded to `JSON` because its shape can't map cleanly to GraphQL now carries a
  `NEEDS ATTENTION` docstring in the schema itself, not just a build-log warning — docker's
  map-shaped `Labels` argument reads its reason inline. Issue #133.

### Fixed

- An array item mixing a plain string with real object choices no longer merges into an
  object-only union that silently drops the string branch — stripe's and pagerduty's
  `expand[]`-style fields degrade cleanly to `JSON` instead. Issue #131.
- Invalid GraphQL SDL the generator's own output already produced no longer crashes the
  whole CLI when `--service-prefix` (or `--directives`) is set — both paths now fail with a
  clear, located parse error instead of an unhandled `GraphQLError` stack trace. Issue #111.
- A property whose schema is a bare `oneOf` of plain scalar/enum members no longer
  disappears and takes its whole owning type down with it — it now degrades to `JSON`, the
  same fallback already used for the equivalent map and array-item shapes. Issue #134.
- A selection that names only the operation itself — no property path, no `>**` wildcard —
  no longer answers a blank, invalid return type; it now walks the full response (and
  mutation body) subtree the same way an explicit `>**` selection already does. Issue #136.
- An operation whose response is a bare enum, with no object wrapper, no longer drops the
  whole operation from the schema — it's kept, named after its own component instead of the
  generic `enum`, and its value is selected directly. Issue #120.
- An entity's `@key` fields and the `$this` params in its resolver URL are now sanitised to
  match the type's actual, GraphQL-clean field names instead of the API's raw ones — a key
  like `widget_id` no longer leaves the connector referencing names nobody defines. Issue #65.
- A `oneOf` component reached top-level by one operation and nested by another no longer
  composes two conflicting SDL forms — the shared, flat merged form is now forced across
  every reaching operation once they disagree. Issue #121.
- An inline map (dictionary) at an operation's response root no longer takes the generic,
  always-colliding name `REntry` — github's `/emojis` and `/languages` maps are named after
  their own operation instead. Issue #93.
- An array node built as a union member no longer borrows its parent's raw `$ref` name for
  its own identity — the aliasing this allowed already broke confluence's
  `content/{id}/restriction` mutations (Issue #94); this closes the underlying identity bug
  itself. Issue #95.
- A component reached both directly and through a `#/paths` JSON-pointer `$ref` no longer
  survives as two divergently-named definitions — digitalocean's whole-spec mutations sweep
  cleared its last 5 `CONNECTORS_UNRESOLVED_FIELD` errors, all on one type's fields. Issue #124.

## [0.24.0]

### Changed

- **Migration note (#103):** every operation with path parameters has a new public field name —
  each `{token}` now adds its own `By…` suffix in place (`gists/{gist_id}` becomes
  `gistsByGistId`, previously `gists`). Update transform-rule files and clients pinned to the
  old names. Additionally (#116), root fields whose cleaned names still collide (`/foo-bar` +
  `/foo.bar`) now take numbered names (`fooBar`, `fooBar2`) instead of writing duplicates.
- **Composition requirement:** composing this schema needs the supergraph composition plugin at
  version **2.15.0 or later** if the spec has any map/dictionary value — an older plugin silently
  under-validates `->entries` selections with no available workaround, and rejects connectors that
  are actually correct (this is what issues #73 and #109 turned out to be, not generator bugs).
  Optional-field (`?`) selections have the same gap below 2.15 but can be avoided with
  `--skip-optional-markers` (composes down to 2.14.3). Default-value (`??`) selections fail only
  on plugin 2.14.0 (#163). Use composition 2.15 or newer.

### Added

- Coverage reports gain an **all-ops** column: every selected op of a sweep composed as one
  schema (what production does), beside the per-op numbers — per-op composes are structurally
  blind to cross-op failures. First catch logged as issue #121.

### Fixed

- A second inline `allOf` request body with a different shape now takes its own input type
  instead of converging on the first body's — cleared all 52 `INVALID_BODY` errors in the
  mutations all-ops sweep (digitalocean, docker, sendgrid). Issue #123.
- Root fields whose cleaned path names collide are numbered instead of writing the same Query
  field twice — `/foo-bar` + `/foo.bar` become `fooBar` and `fooBar2`, response types and
  connectors following along. Issue #116.
- Sibling keys that clean to one field name are numbered instead of dropped — trello's
  `prefs/background` and `prefs_background` become `prefsBackground` and `prefsBackground2`,
  each reading its own wire key; twins folded through allOf or a flattened union no longer
  write duplicate fields. Issue #113.
- An object stamped with `items` beside it is now repaired on the property route too — the
  nested field keeps its items' shape instead of vanishing from type and selection. Issue #114.
- A mutually-recursive `oneOf` reached through arrays no longer expands forever — hubspot's
  lists filter tree generates in seconds instead of never returning (a union member-set cycle
  cut, plus the #10 prefix-set fix applied to four missed selection filters). Issue #118.

- A by-id operation now takes its name from its path tokens — github's `GET /gists/{gist_id}`
  becomes `gistsByGistId` instead of colliding with `GET /gists` — so a whole-spec github
  selection composes without duplicate fields. Issue #103.
- A `oneOf` request body no longer repeats an object body's input name — github's gist update
  writes `BInputInput` beside `InputInput` instead of defining it twice. Issue #104.
- A dictionary's inline value type now follows its renamed container — github's two gist models
  each keep their own `files` values, and the whole github spec composes clean. Issue #107.
- A response union no longer takes a body union's stored name, so a later body union renames
  instead of keeping a name already in use. Issue #112.
- A map value that is a choice of only enum/scalar values no longer drops the whole property —
  confluence's `POST /content/convert-ids-to-types` returns its `results`. Issue #108.
- An array item that is a shapeless `$ref` in a request body now degrades to `JSON` instead of
  vanishing — pagerduty's incident-merge mutation can send `source_incidents`. Issue #110.
- An inline `allOf` property that mints a name matching a real, unrelated component now renames
  instead of colliding with it — pagerduty's `IncidentNote.user` no longer redefines `User`
  twice. Issue #126.
- A parameter default value now matches its declared type instead of the spec's raw JSON type —
  omni's `count` parameter (declared `string`, defaulting to the number `100`) now quotes it
  correctly instead of failing composition. Issue #127.
- A field no operation ever actually selects is now consistently left out of the schema instead
  of appearing as a real, always-unresolvable field — extends the existing "removed on some
  routes" fix to fields removed on every route, and to `allOf` types, not just plain objects.
  Issue #125.

## [0.23.0]

### Added

- `--service-prefix acme` namespaces a connector: every name it generates carries the service's,
  so `type Widget` becomes `type Acme_Widget` and the query field `widgets` becomes
  `acme_widgets`. Several connectors can then live in one graph without sharing names.

### Fixed

- An operation on the API root, `/`, now has a field name — github's `GET /` becomes `metaRoot`,
  taken from its operationId. Issue #88.
- A response that is a dictionary now answers a list of key/value entries, so confluence's
  `content/{id}/restriction/byOperation` returns its restrictions. Issue #90.
- A dictionary of plain values as the whole response is no longer dropped, so github's `/emojis`
  and `/languages` return their entries. Issue #92.
- A request body that is either an object or a list of the same items keeps its argument defined,
  so confluence's two `content/{id}/restriction` mutations can send their update. Issue #94.
- A field that had to be removed in one place to stop a loop is now removed everywhere it
  appears, so confluence's three relation reads return their results. Issue #89.
- A field holding a list of lists of plain values is no longer dropped, so digitalocean's
  `droplet_neighbors_ids` returns its lists and docker's `top` sends its `Processes`. Issue #96.
- A made-up type such as common-room's `type: url`, or a `$ref` that points nowhere, no longer
  stops the whole generation — the field is kept as free-form `JSON`. Issues #98, #99.
- An inline object that would take a component schema's name now gets its own, so confluence's
  two space mutations can create spaces. Issue #100.
- A type left with no fields after loop-breaking is kept as free-form `JSON` instead of an empty
  definition, so confluence's version and attachment mutations work. Issue #101.
- An enum value the spec lists twice is written once, so openfigi's `post:/mapping` works.
  Issue #102.
- Two sibling fields whose names clean to the same one — trello's `prefs/background` and
  `prefs_background` — are written once, so `post:/boards` and `put:/boards/{idBoard}` work.
  Issue #69.
- slack's `reactions.get` answered nothing; its response — an object with a stray `items` level
  around the real shape — now reads that shape and returns the reactions. Issue #97.

## [0.22.0]

### Fixed

- A request body the API takes as a form is now sent: the mutation gets its argument, its mapping
  and the `Content-Type` header the router form-encodes on, so stripe's `post:/v1/customers` and
  slack's `post:/admin.apps.approve` can post data. Issue #83.
- A body field that takes any key the caller wants is now one `JSON` argument and reaches the API,
  so docker's `post:/containers/create` sends its `Labels`. Responses are unchanged. Issue #84.
- An operation that documents only `201` (or another success code) now answers with the schema the
  API really sends, so github's `post:/app-manifests/{code}/conversions` returns its integration
  instead of `success: true`. Issue #85.
- A list that holds one of several plain values, such as confluence's `contentIds`, is kept as a
  list of `JSON` instead of disappearing from the type and the mapping. Issue #86.
- A field holding a list of lists, such as box's `name_conflicts`, now names the type at the bottom
  of the lists and selects its fields inside one block, so the operation composes. Issue #59.

### Added

- New `skipOptionalMarkers` option (CLI `--skip-optional-markers`) leaves the `?` optional-field
  markers out of selections, so the generated schema composes with the latest stable composition
  release (`2.14.3`). Markers are still emitted by default. Issue #16.
- New `authValuePrefix` option (CLI `--auth-value-prefix`) writes text in front of an API-key header
  value, such as PagerDuty's `Token token=`. The text is written exactly as given. Issue #87.

## [0.21.0]

### Fixed

- An array request body now takes a list of its item type; before, the argument named an
  input type that was never defined and composition failed. Issue #66.
- An `allOf` that only decorates a single non-object schema now means that schema, so
  digitalocean's firewall `tags` comes out `[String]` and the body sends it. A body with nothing
  to send drops its argument, its mapping and its type; a body that is one value is sent whole
  as `input: JSON!` with `body: "$args.input"`. Issue #67.
- A map entry's `value:` now ends in `Input` like the definition it points at; 14 specs'
  mutations failed composition over this. Issue #68.
- A request body now keeps a map of plain values, so docker's `post:/containers/create` can
  send its `Labels`. Issue #70.
- Generating twice on the same instance returned different schemas — names depended on what
  ran before. Every generation now starts fresh; repeated generation on large specs is also
  much faster (stripe: about 7 minutes down to 1). Issue #71.
- A selection saved while browsing now resolves even when a fresh run names its type
  differently, as long as only one node can be meant. Issue #72.
- A request body written as `requestBody: { $ref: … }` now produces the same mutation the inline
  spelling does, argument and body mapping included. Issue #74.
- A parameter that carries `content:` instead of `schema:` now takes the same route a `schema:`
  parameter takes: an object becomes `JSON`, a string or enum stays a scalar. Issue #75.
- A map whose values cycle back to the type holding them now drops the field, so Mercedes CCS's
  `Amount.alternatives` composes. Issue #76.
- A map value written as an `allOf` of empty objects now reads whole as `JSON`, the same as the
  plain empty object spelling. Issue #77.
- Two maps sharing a field name over different value types now take distinct entry types, the
  second named after its container (`RestrictionsCurrencyOptionsEntry`); maps over the same
  schema still share one, so stripe's many `metadata` maps keep a single `MetadataEntry`.
  Issue #78.
- A union whose members are themselves unions now merges their fields into one object, and a
  merge with no fields to take answers `JSON` and passes the whole value through. Issue #80.
- Every `{token}` in a path now has an argument of the same name: a parameter the spec named
  differently is renamed to the token it serves (omni declares `/v1/labels/{labelName}` as
  `name`), and a token the spec left undeclared gets a required `String`. Issue #81.
- A response or request-body key that starts with `null` is now written as a path step, so the
  router reads the whole key (omni's `null_sort`). Issue #82.

### Removed

- **Breaking**: `OasContext.reset()` — no longer needed; each generation runs on a fresh context.

## [0.19.0]

### Changed

- **Breaking**: selections mark each optional field with `?` (`name?`, `category? { … }`), stating
  which fields the API may leave out of a response. Composing the generated schema now needs
  federation 2.15 or newer.

## [0.18.0]

### Added

- New `--directives` option to apply directives to types, queries or mutations in the generated
  schema. Format details in README.md. Note that a declaration that matches nothing stops the run.
- Every connector selection is now checked against what the API really returns, reporting
  mismatches at generation time instead of in the router (`lintSelections` for editors).

### Changed

- **Breaking**: `RequestOverride` type is now called `OverrideEntry`.
- Config files passed in the CLI that cannot be read stop the run instead of being quietly ignored.

## [0.17.0]

### Fixed

- A field that is both `required` and `nullable: true` was emitted non-null, so the router errored
  on a legitimately-null value; it now stays nullable, arguments included. Issue #55.
- `items: { type: object }` dropped the field instead of degrading to `[JSON]`. Issue #56.
- An inline (non-`$ref`) enum silently degraded to `String`; it is now promoted to a real enum,
  named after its owning type and field (`Order.status` -> `OrderStatus`), bumping past stored
  types and reserved component names. Enum query parameters stay `String` as before. Issue #57.
- A discriminated `oneOf` whose members share an `allOf` base emitted the base as an orphan
  concrete type when the union came back inside a list, failing composition; the base is promoted
  to an interface there too. Issue #58.
- A required property spelled `oneOf: [string, null]` lost its field entirely; the null arm now
  folds into nullability and the field is kept. Issue #60.
- Every aliased response key was written as a quoted string — which `connect/v0.4` reads as a
  string literal, so the router returned the key's own name as the field value. Aliased keys are
  now bare identifiers (`id: _id`) or path steps (`fullName: $."full name"`). Issue #62.

## [0.16.1]

### Fixed

- An enum query parameter was written as a whole enum block instead of a plain `String`, in bundled
  builds only. Petstore `findByStatus`, issue #53.

## [0.16.0]

### Changed

- Added 'kind' to union (e.g.: `union:type:LineUnion`) for input bodies. Issue #48.

### Fixed

- The same `oneOf` used by a request body and by a response was written only once, so the response
  referred to a type that was never defined; found in QuickBooks mutations, issue #48.
- A real union listed its members, and matched `__typename`, under the raw `$ref` name rather than
  the name each member is written as, so a snake_case component made every member field
  unresolvable to rover; found in ably (`http_rule_response`), issue #43.
- A merged union whose members gave one field name two different kinds (an enum in one, a plain
  string in another) emitted the field twice resulting in invalid SDL. Incompatible kinds now
  degrade to the `JSON` scalar fallback; same-kind collisions keep the first member as before.
  TMF717, issue #44.
- A schema named `Query`, `Mutation` or `Subscription` collided with the GraphQL root type and
  failed compose; those three names are now suffixed. Stripe, issue #45.
- An array whose items held another array nested a second array node, so the field named a type
  that was never defined and its selection lost its braces. A genuine list of lists still stays
  nested. Found in docker-engine (`ContainerSummary`) and slack (`messages`), issues #46 and #52.
- An op whose response is a bare array of scalars was dropped from the schema entirely — no field
  at all, not even a degraded one. Spotify, issue #47.
- A request body written as an `anyOf` with no `oneOf` lost every member, emitting an input type
  with no fields and sending nothing. Digitalocean, issue #50.
- A write whose response object has no fields emitted an empty type and an empty selection. Turning
  a fieldless object into `JSON` only happened when the whole operation had nothing to select, and
  a write's body nearly always does. The response and the body are now checked separately. Asana,
  issue #51.

## [0.15.3]

### Fixed

- A merged union's shadowed same-name member field (two members sharing a field name but disagreeing
  on its type, e.g. `rocket: RocketNormal` vs `rocket: RocketDetailed`) was still treated as reachable,
  emitting its type's whole subtree with no connector coverage. Closes the remaining residue from
  #38; launch library corpus: 86.2% → 98.3% (#39).
- An object-typed (or array-of-object) query parameter emitted a full type definition inline inside
  the argument list — invalid GraphQL. Degrades to the existing `JSON` scalar fallback, preserving
  array cardinality; box corpus: 98.2% → 100.0% (#40).
- Only the first entry in an OAS `servers[]` array was ever consulted for the `@source` base URL. A
  relative or protocol-relative leading server (no usable host) is now skipped in favor of a later,
  usable one, in declared order; docker-engine corpus: 0.0% → 86.0% (#41).
- A map (`additionalProperties`) field whose JSON key needed snake_case→camelCase aliasing wrote the
  alias twice, producing an invalid selection rover couldn't parse (#42).

## [0.15.1]

### Fixed

- A `#` in an OAS path (a sub-resource convention like `/shared_items#web_links`) no longer leaks
  into the GraphQL field name, where it started an SDL line comment and broke `@connect` selection
  binding. `#` is now a field-name separator; the runtime HTTP path is untouched (B1).
- An inline single-member `allOf` used as an array's `items` (no `$ref`, e.g. box
  `MetadataQueryIndices.…fields`) no longer reaches the emit loop nameless and crashes generation.
  The `Composed` type is now named at its construction site; the writer fails fast on any nameless
  type that still slips through, and `isRef` is null-safe (B2).
- Cycle detection now compares the resolved schema, not the field name: a field was wrongly cut as
  circular when a same-named field sat above it on the path, even for unrelated types (Adobe
  `extension_attributes`), emptying the type and failing compose. Both legacy name-based cut sites
  are now schema-identity (#36).
- An inline wrapper whose key matches the component it lists (Confluence `subjects.group` listing
  `Group`) no longer emits a second `type Group` that rover reads as circular. The wrapper is
  renamed after its container (`group` → `SubjectsGroup`); the component keeps its name (#37).

## [0.15.0]

### Added

- **`--skip-auth` CLI flag**: omit all auth from the generated connector — no `headers` on
  `@source`, no auth header or `queryParams` entry on any `@connect` — even when the spec
  declares security schemes. Useful when auth is handled upstream, or for local/mock generation.

### Fixed

- A `oneOf` discriminator without an explicit `mapping` now emits the OAS-spec-correct tag — the
  bare ref name (e.g. `"Book"`, not the lowercased `"book"`) — so the emitted `->match` branch
  matches real payloads (C1).
- `@connect`'s `http.body` is now emitted only when targeting connect ≥ v0.2; below v0.2 it is
  skipped with a logged downgrade instead of violating the contract (C2).
- The global-security dropped-scheme warning is emitted once per generation, not once per
  inheriting operation (C3).
- Removed a stray debug `console.log` (fired for every map-typed property) and an unused `esbuild`
  import from a runtime module (C4+C5).

## [0.14.0]

### Added

- **apiKey-in-query auth on `@connect`** (R5 slice 3): a global or per-op `apiKey` security scheme
  with `in: query` is emitted on the op's `queryParams` (a JSONSelection sibling of the
  `$args { … }` block), since `SourceHTTP` has no `queryParams` and can't carry it on `@source`.
  An auth-only op still emits a `queryParams` block (no `$args {}`).

### Changed

- Improved `@connect` http-block indentation: `queryParams`/`headers`/`body` sit one level under
  `http:` (was flush with it); the request `body` no longer carries a stray comma. Compact
  `{ GET: "/x"}` form unchanged.
- Internal: `@connect` auth resolution is consolidated into a single `SecurityPlan` (computed once
  per generation, then queried by `@source` and per-`@connect`) instead of re-scanning the spec per
  operation. No output change.

### Fixed

- Security resolution only warns for genuinely unresolvable schemes (undefined, apiKey-in-cookie,
  or an unmappable type such as http/digest); a legitimate OR alternative — a non-winning
  `security` option — is now silent instead of noisy.
- The per-op auth mode switch scans only the emitted methods (get/post/put/patch/delete), so a
  `security` declared solely on an un-emitted HEAD/OPTIONS op no longer suppresses the shared
  `@source` header.

## [0.13.1]

### Fixed

- A `$ref` reached two ways — as an array item (`obj:type`) and as a single-member `allOf`
  (`comp:type`) — emitted `type X` twice (invalid SDL). The emit-once gate now keys on the
  emitted type name, not the node id, so output `X` and request `XInput` stay distinct
  (regression from #26).

### Changed

- Internal: removed `any` casts across the CLI and JSON walker (no output change).

## [0.13.0]

### Added

- **Per-operation auth on `@connect`** (R5 slice 2): when an op declares its own OAS `security`,
  each `@connect` carries its effective auth (own / inherited global / none for `security: []`)
  and the shared `@source` header is suppressed. Shared scheme→header logic in `src/oas/io/security.ts`.

### Changed

- Per-op header de-dup is case-insensitive (an explicit override wins, else the resolved auth
  replaces an inferred header of the same name).
- Tidied the generated `@connect` `http`/`errors` block indentation.

## [0.12.0]

### Added

- **Per-operation request overrides** (R8/R9): `--overrides <file>` (or API object), keyed by
  op id, replaces the HTTP `path`, adds/replaces/drops `queryParams` (raw JSONSelection) and
  `headers` (string templates, incl. `{$config.*}`), and replaces or drops the request `body`
  (`null` drops it). The explicit-intent channel for what OAS cannot express; unmatched override
  keys warn (typo guard).
- **`--base-url`**: overrides the `@source` base URL inferred from OAS `servers[0]`.
- **R4 `errors.message` heuristic** (opt-in `emitConnectorErrors`, connect v0.2+): the error
  body's string message field becomes `errors: { message: "$.message" }`, with corpus-ranked
  field priority (`message`/`error`/`detail`); emitted only when that field is a string on every
  documented JSON error shape of the op.
- **R7 coalesced defaults**: OAS `default:` values now coalesce (`tag: tag ?? $("latest")`)
  instead of replacing, in both response and body directions (gated to connect v0.4 +
  federation v2.14).
- **R8 array-param serialization joins**: non-exploded array params emit the matching join
  (`ids->joinNotNull(",")`; `spaceDelimited` → `" "`, `pipeDelimited` → `"|"`).

### Fixed

Details per id in `docs/issues.md`:

- #20 `anyOf: [$ref, empty-closed-object]` collapses to its single real member instead of
  producing zero types.
- #21 typeless/empty `{}` schemas are treated as a JSON scalar instead of throwing.
- #35 same-named objects across multiple documents no longer diverge on their fields.

### Changed

- Internal: dropped `as unknown as` casts across the oas/json paths (no output change).

## [0.11.0]

### Changed

- **Defaults follow LATEST**: no version asked for now means connect **v0.4** + federation
  **v2.14** (was v0.3/v2.12). Real unions, `->match` `__typename` selections and interface
  promotion are the default output; pass `--connector-spec-version v0.3` for the previous
  consolidate-downgrade behaviour. The union form is derived from the connect version
  (`resolveConsolidateUnions`) — an explicit ask for real unions below v0.4 downgrades with
  a warning.
- Heads-up: on stock (released) tooling, v0.4 schemas with `additionalProperties` maps hit an
  upstream composition bug (`->entries` sub-selections, issue #14 — fix awaiting release).
- Mutations corpus first measured and overhauled: **47% → 90.2%** pass-rate (1249 ops);
  GETs 93.2%. Fast guards: `tests/all/corpus-mutations.test.ts`.

### Fixed

Details per id in `docs/issues.md`:

- #27 mutations with params AND a body emitted two argument lists (invalid GraphQL)
- #28 request-body selections used the response alias direction
- #29 default values emitted as bare paths (`$(latest)`); `0`/`false` defaults dropped
- #30 the body argument referenced the raw payload name, not the sanitised definition
- #31 fieldless response schemas (googlebooks `Empty`) produced zero types
- #32 ops whose only content is a JSON field emitted an empty type; body keys with colons
  broke the parser
- #33 four generation crashes: pointers INTO components, non-JSON responses, OAS 3.1 null
  union members, `$ref`'d no-content responses
- #34 real unions of `allOf` members emitted an empty member list; twin inline members
  collapsed onto one id

## [0.10.0]

### Changed

- Generated schemas change visibly on regeneration: enum fields now appear in selections and
  SDL (#24), types nothing references are no longer emitted (#26), and discriminator-less
  `oneOf`s degrade to the merged-object form in connect v0.4 too (#25).
- Corpus pass-rate (per-op generate + compose, 1218 GET ops): default 84.2% → 91.5%,
  abstract 81.4% → 91.7%.

### Fixed

Details per id in `docs/issues.md`:

- #18 identical inline schemas dedup instead of renaming; renamed twins converge on one name
- #22 inline `allOf` comps colliding with a stored type of another class are renamed
- #23 OAS 3.1 type arrays (`type: [string, 'null']`) collapse to their first non-null entry
- #24 enum fields were silently dropped from `>**` expansion; non-identifier enum values
  degrade to scalars, `+1`/`-1` fields disambiguate to `plus1`/`minus1`
- #13 fields cut by cycle detection on one route are emitted from a sibling route's version
- #25 discriminator-less `oneOf` no longer emits a `union` its selection cannot satisfy (v0.4)
- #26 the collector keeps exactly the types the written schema references — orphaned
  definitions dropped, over-deleted ones restored (driven by per-node `dependencies()`)

## [0.9.1]

### Added

- Entity resolution (R1): opt-in `--infer-entity-resolvers` emits type-level `@connect`
  with `@key`/`$this` lookups.
- Abstract types (R2, connect v0.4): real unions with discriminator → `__typename` via
  `->match`; discriminated `oneOf` with a shared `allOf` base promotes to a GraphQL
  `interface`. Default output (consolidate downgrade) unchanged.
- Error handling (R4): opt-in `emitConnectorErrors` emits
  `@connect(errors: { extensions })` surfacing `$status` (connect v0.2+).
- Auth headers (R5): a spec's global `security` scheme maps to a templated `@source`
  header (`{$config.apiKey}` / `Authorization: Bearer {$config.token}`). Deferred cases
  warn instead of dropping silently.
- Coverage harness: real-world vendor corpus sweep (generate + rover-compose per GET op).

### Fixed

Details per id in `docs/issues.md`:

- #1 non-identifier field names sanitised + aliased back to the JSON key
- #2 snake_case path params templated as `{$args.…}`
- #3/#8 `$ref` pointers into `#/paths` resolved, with clean type names
- #4 schemas with `items` but no `type: array` treated as arrays
- #5 contentless `allOf` members skipped
- #6 leading-digit type names prefixed
- #7 inline `allOf`-property composed types named from the property key
- #9/#12 inline type-name collisions (same-shape and vs-component) split/renamed
- #10 recursive schema cycles cut and commented instead of looping
- #11 `anyOf`/`oneOf` params coerced to `String`
- #15 Composed/Union definition vs reference names converge via `genTypeName`
- #17 boolean param defaults rendered (no dangling `= `)
- #19 shapeless `{}` schemas become `JSON` scalars instead of throwing

## [0.8.4]

### Added

- Added `verbose` option and `-v --verbose` CLI flag to enable debug logging (default: silent)

## [0.8.1]

### Added

- Added `queryField` option and `--query-field` CLI flag to override the query field name

## [0.8.0]

### Added

- Added `baseURL` option and `--base-url` CLI flag to customize the `@source` base URL
- Added `relativePath` option and `--relative-path` CLI flag to customize the `@connect` HTTP path
- List type support: pass `rootType: '[User]'` or `--root-type [User]` to generate `[User]` return type

## [0.7.0]

### Added

- Added `rootType` option to `JsonGen` and `--root-type` to the JSON CLI to customize the generated root type name

## [0.6.2]

## Fixed

- `skipOptionalArgs` was only working for selections, now fixed in operation params too

### Added

- Added `--skip-optional-args` to OAS CLI and `skipOptionalArgs` to `OasGen` to skip optional arguments in generated queries (default: `false`)

### Fixed

- Fixed parameter filtering logic in `Get` class (and inherited classes) to correctly skip optional parameters when `skipOptionalArgs` is enabled

## [0.6.0]

### Added

- Initial support for OpenAPI `additionalProperties` - automatically converts map/dictionary patterns into GraphQL-compatible key-value entry arrays
- Enhanced test infrastructure with organized temporary file management and rover script generation

### Fixed

- Fixed transform rules for operation name mapping to include missing patterns

## [0.5.1]

### Changed

- We can now create a `Mapper` with `OpNameMapper.fromString`

## [0.5.0]

Added support for loading transformation rules from JSON files. This allows loading multiple transformation rules from a JSON file to apply complex name transformations to operation names (e.g., `createPet` → `create_Pet`, `updateUserByUsername` → `updateUser`, etc.). Check `tests/resources/transform-rules-example.json` for example rules.

### Added

- Support for name transformation rules

### Deprecated

- **BREAKING**: Removed `postName` property from `GenerateOptions` and `IGenOptions` interfaces

### Changed

- **BREAKING**: `PUT` operations now correctly generate an `update` GQL operation
- **BREAKING**: `PATCH` operations now generate a `patch` GQL operation to avoid collisions with `PUT`

## [0.4.11]

### Added

- Added `--post-name` CLI option to apply regex transformations to operation names (e.g., `"apiV1(.*):api_v1_$1"` to convert `"apiV1SomeOperation"` to `"api_v1_SomeOperation"`)
- Added `--transform-rules` CLI option to load multiple transform rules from a JSON file for complex name transformations
- Added `--federation-version` CLI option to specify Federation version (default: `v2.11`)
- Added `--connector-spec-version` CLI option to specify Connector spec version (default: `v0.2`)
- Added transform rules system with support for multiple rules, rule descriptions, and enable/disable flags
- Renamed `OperationNameTransformer` to `OperationNameMapper` for better clarity
- Updated README documentation with complete CLI options reference and transform rules documentation

## [0.4.10]

### Added

- Added missing type exports to `src/oas/index.ts` to ensure all types from `internal.ts` are properly re-exported: `Post`, `Put`, `Patch`, `Delete`, `Body`, `PropComp`, `PropCircRef`, `PropEn`, and `Op`

## [0.4.8]

### Changed

- Improved query parameter handling in Apollo Connectors by using the `queryParams` field instead of appending parameters to the URL
- updated Federation to version `2.11` and connectors to `0.2`

## [0.4.7]

### Added

- Added `visitSync()` method to `OasGen` for synchronous path visiting

### Changed

- Improved reference counting in `Writer` class by using a copy of the refCount map
- Simplified `reset()` method in `OasContext` to only clear the generatedSet
- Improved state management in `OasGen` with better context handling
- Updated test cases to reflect new reset behavior
- Cleaned up unused imports and commented code

## [0.4.6]

### Added

- Added `reset()` method to `OasGen` class to properly reset generator state between generations
- Added test case to verify reset functionality works correctly

### Changed

- CLI now always uses `consolidateUnions` and `showParentInSelections` options
- Cleaned up test suite by removing commented-out test cases

## [0.4.5]

### Added

- Added `reset()` method to `OasContext` class to properly reset the context state between generations

## [0.4.4]

### Fixes

- Fixed issues with unions and their handling in the schema generation
- Improved collection of paths and expanded selections
- Added test spec for Launch Library 2 API and fixed issues with it

## [0.4.3]

### Fixes

- Name conflict resolution for synthetic object types. Conflicting names will be renamed with the first non-parent prop. Selections are updated accordingly.
- Fixed issue in body input selection (uppercase to lowercase mapping in body input fields)
- OAS CLI can now print selection and paths

## [0.4.2]

### Fixes

- Treat null values in fields as string fields

## [0.4.1]

### Changes

- Improved indentation handling in code generation
- Centralized indentation logic in `JsonContext` class
- Removed redundant indentation methods from `JsonType` class
- Fixed indentation in selection and type writing

## [0.4.0]

### Changes

- Refactored `writer` and cleaned up for better maintainability

## [0.3.2]

### Changes

- Made options public for better accessibility
- Passed options to context for improved configuration handling

## [0.3.1]

### Changes

- minor change to add two options to `OasGen`:
  1. `consolidateUnions`: consolidate all `OneOf` types into a single GraphQL `type`. This is a work-around until the Connectors spec supports `union`s.
  2. `showParentInSelections`: adds a comment in each field of the selection section to identify where the field is being pulled from. Useful for debugging purposes only.

## [0.3.0] Removed `Ref` node (breaking)

### Changes

- **Breaking change**: not using `Ref` anymore - expanding a type that has a `ref` will go directly into the type. This affects all generated `paths` and a type's `path()`. Tests have been rebuilt to reflect this change
- _Breaking_: renamed `anonymous` for `inline` to better reflect the nature of the object
- Two modes are supported for `Union`s: generated either a single object (the default behaviour as Connectors does not support `unions` yet) or to generate `union`s will which yield a more correct (yet unsupported) schema. If a Union is _consolidated_ in a single type, all references (and any container child node) will be removed so it's not generated in the schema
- Proper _circular ref_ checks; now also work for `props`. Even in the case when a selection includes a circular ref, it should still work properly and the node should be ignored

### Fixes

- All tests and more. Better support for `mutations` (`POST`, `PUT`, etc.)

### Pending

- Unions should use `->match` and the `discriminator` in the `selection` bit, instead of selecting all fields.

## [0.2.1]

### Fixed

- Fixed unions: now we don't overwrite the fields when we consolidate them, but rather add a new one. This is because `union` is not yet supported by the Connector spec.

### Pending

## [0.1.3]

### Fixed

- Fixed `DELETE` paths with `boolean` responses. Note that these mostly return `application/json` media, which might require additional work in the resulting schema to work properly.

## [0.1.1]

### Added

- Support for `PUT`, `PATCH` and `DELETE` requests

## [0.0.13]

### Added

- Initial support for `POST` requests

### Changed

- **BREAKING CHANGE**: the internal format for a `path` now contains the type, either `type` or `input`. This is needed to generate the correct `GraphQL` type and for the body selection in `POST` operations. To fix this, replace the following in your selection `JSON` payloads:
  - `>obj:` => `>obj:type:` - i.e.: `post:/user>res:r>obj:type:userResponse>prop:scalar:success`
  - `>comp:` => `>comp:type:`
  - `>union:` => `>union:type:`

### Deprecated

- None

### Fixed

- Empty responses from GET now return a default `Response` GraphQL type with a `success: Boolean` field mapped to `$(true)` in the selection. Consumers can ignore this value.

### Security

- N/A

## [0.0.12] - 2025-03-19

### Added

- First version, supports `GET` requests only.
