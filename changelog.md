# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- New `skipOptionalMarkers` option (CLI `--skip-optional-markers`) leaves the `?` optional-field
  markers out of selections, so the generated schema composes with the latest stable composition
  release (`2.14.3`). Markers are still emitted by default. Issue #16.

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
