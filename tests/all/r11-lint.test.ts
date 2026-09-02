import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { lintSelections } from '../../src/oas/lint/index.js';
import { SchemaReader } from '../../src/oas/lint/schemaReader.js';
import { ResponseShape } from '../../src/oas/lint/responseShape.js';
import { ResponseCoverageCheck } from '../../src/oas/lint/checks/responseCoverage.js';
import { SelectionPath } from '../../src/oas/utils/selectionPath.js';
import { oasBasePath } from '../../src/tests/runners.js';
import './_setup.js';

// --- R11: connector selection linting --------------------------------------

/** Minimal SDL around one `@connect` selection, the shape every v0.4 schema has. */
function connectSchema(selection: string): string {
  return `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(url: "https://specs.apollo.dev/connect/v0.4", import: ["@connect", "@source"])
  @source(name: "api", http: { baseURL: "https://example.com" })

type Pet {
  id: Int
  name: String
}

type Query {
  pet: Pet
    @connect(source: "api", http: { GET: "/pet" }, selection: """
    ${selection}
    """)
}
`;
}

const codes = (sdl: string): string[] => lintSelections(sdl).map((d) => d.code);

test('test_R11_unknown_arrow_method_is_reported', () => {
  const found = lintSelections(connectSchema('id\nname->trimStrt'));
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'UNKNOWN_ARROW_TARGET');
  assert.ok(found[0].message.includes('trimStrt'));
});

test('test_R11_builtin_methods_are_accepted', () => {
  for (const method of ['first', 'last', 'map', 'match', 'entries', 'slice', 'trimStart']) {
    assert.deepEqual(codes(connectSchema(`id\nname->${method}`)), [], `->${method} should be clean`);
  }
});

test('test_R11_non_public_router_methods_are_reported', () => {
  // implemented in the router but filtered out by is_public(), so a schema using them is rejected
  for (const method of ['typeof', 'keys', 'values', 'has', 'matchIf']) {
    assert.deepEqual(
      codes(connectSchema(`id\nname->${method}`)),
      ['UNKNOWN_ARROW_TARGET'],
      `->${method} is not public and must be reported`,
    );
  }
});

test('test_R11_diagnostic_offsets_point_at_the_method_name', () => {
  const sdl = connectSchema('id\nname->nope');
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_unparsable_sdl_is_silent', () => {
  assert.deepEqual(codes('type Pet { id: Int'), []);
  assert.deepEqual(codes(''), []);
});

test('test_R11_half_typed_entry_is_silent', () => {
  // mid-keystroke: an arrow with no method yet must not be read as anything
  assert.deepEqual(codes(connectSchema('id\nname->')), []);
  assert.deepEqual(codes(connectSchema('id\ncategory {')), []);
});

test('test_R11_method_arguments_are_not_walked', () => {
  // `$->map(@->Pet)` — the inner arrow belongs to map's scope; only `map` is checked here.
  // Assert the field was read first: before the reader understood a value-only selection this
  // came back unreadable, so "no complaints" was true for the wrong reason.
  const sdl = connectSchema('$->map(@->Pet)');
  const field = SchemaReader.read(sdl).selections[0].fields[0];
  assert.equal(field.unreadable, false, 'the selection should be readable');
  assert.equal(field.readsFrom.startsAt, 'dollar');
  assert.deepEqual(field.methods.map((method) => method.name), ['map']);
  assert.deepEqual(codes(sdl), []);
});

test('test_R11_a_selection_that_is_only_a_value_is_read', () => {
  // what a v0.5 `@connect(selection: "$->Pet")` looks like: no name, just the value
  const sdl = connectSchema('$->Pet');
  const field = SchemaReader.read(sdl).selections[0].fields[0];
  assert.equal(field.unreadable, false);
  assert.equal(field.outputName, undefined, 'it names nothing of its own');
  assert.equal(field.readsFrom.startsAt, 'dollar');
  assert.deepEqual(field.methods.map((method) => method.name), ['Pet']);
});

test('test_R11_reads_names_paths_and_blocks', () => {
  const sdl = connectSchema('alias: some.path\ncategory { id name }\n...@->Pet');
  const parsed = SchemaReader.read(sdl);
  const fields = parsed.selections[0].fields;
  assert.equal(fields.length, 3);
  assert.equal(fields[0].outputName?.name, 'alias');
  assert.equal(fields[0].readsFrom.startsAt, 'fieldName');
  assert.equal(fields[1].nested?.length, 2);
  assert.equal(fields[2].isMerge, true);
  assert.equal(fields[2].readsFrom.startsAt, 'atSign');
  assert.ok(fields.every((field) => !field.unreadable));
});

test('test_R11_block_string_offsets_survive_indentation', () => {
  // graphql-js dedents block strings; positions must still land on the real source bytes
  const sdl = connectSchema('id\n    name->nope');
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_ordinary_quoted_selection_offsets_are_exact', () => {
  const sdl = `type Query { pet: Pet @connect(selection: "id name->nope") }\ntype Pet { id: Int name: String }`;
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

// --- check 7: the path must exist in the response the operation returns --------------------

const PETSTORE_OPTIONS = {
  skipValidation: false,
  showParentInSelections: false,
  connectorSpecVersion: 'v0.4',
  federationVersion: 'v2.14',
  skipOptionalArgs: false,
} as never;

async function petstoreSchema(): Promise<{ gen: OasGen; sdl: string }> {
  const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, PETSTORE_OPTIONS);
  await gen.visit();
  return { gen, sdl: gen.generateSchema(['get:/pet/findByStatus>**']) };
}

test('test_R11_generated_selection_matches_its_own_response', async () => {
  const { gen, sdl } = await petstoreSchema();
  assert.deepEqual(lintSelections(sdl, gen), [], 'the generator never writes a path the spec lacks');
});

test('test_R11_unknown_path_is_reported_against_the_response', async () => {
  const { gen, sdl } = await petstoreSchema();
  const broken = sdl.replace('      photoUrls\n', '      photoUrls: photoUrlz\n');
  const found = lintSelections(broken, gen);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'PATH_NOT_IN_RESPONSE');
  assert.equal(broken.slice(found[0].from, found[0].to), 'photoUrlz');
  assert.ok(found[0].message.includes('get:/pet/findByStatus'));
});

test('test_R11_a_parameterized_operation_is_checked_too', async () => {
  // the URL writes the parameter as its argument (`/pet/{$args.petId}`), the spec spells it
  // `/pet/{petId}` — the two must still match up, or every such operation goes unchecked
  const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, PETSTORE_OPTIONS);
  await gen.visit();
  const sdl = gen.generateSchema(['get:/pet/{petId}>**']);
  const broken = sdl.replace('      photoUrls\n', '      photoUrls: photoUrlz\n');
  const found = lintSelections(broken, gen);
  assert.equal(found.length, 1, 'the check must reach an operation with a path parameter');
  assert.equal(found[0].code, 'PATH_NOT_IN_RESPONSE');
});

test('test_R11_16_optional_markers_read_clean', async () => {
  // #16 writes `?` in every position — plain (`id?`), before a block (`category? {`), on an
  // aliased key (`amountOff: amount_off?`) and mid-path (`currency_options?->entries`). The
  // reader must take them all without a diagnostic.
  const gen = await OasGen.fromFile(`${oasBasePath}/map-key-aliasing.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/coupons>**']);
  assert.match(sdl, /currency_options\?->entries \{/, 'the marker sits before ->entries, not after');
  assert.deepEqual(codes(sdl), [], 'a fully marked generated schema lints clean');
});

test('test_R11_unknown_nested_path_is_reported', async () => {
  const { gen, sdl } = await petstoreSchema();
  const broken = sdl.replace('category? {', 'category: catgory? {');
  const found = lintSelections(broken, gen);
  assert.equal(found.length, 1);
  assert.equal(broken.slice(found[0].from, found[0].to), 'catgory');
});

test('test_R11_path_check_is_skipped_without_a_spec', async () => {
  const { sdl } = await petstoreSchema();
  const broken = sdl.replace('      photoUrls\n', '      photoUrls: photoUrlz\n');
  assert.deepEqual(lintSelections(broken), [], 'no spec loaded means nothing to compare against');
});

test('test_R11_a_missing_key_is_only_an_error_when_extras_are_banned', () => {
  const closed = { properties: { id: {} }, additionalProperties: false } as never;
  const openEnded = { properties: { id: {} } } as never;
  const freeForm = { properties: { id: {} }, additionalProperties: true } as never;
  assert.equal(ResponseShape.look(closed, 'nope'), 'forbidden');
  assert.equal(ResponseShape.look(openEnded, 'nope'), 'notDocumented');
  assert.equal(ResponseShape.look(freeForm, 'nope'), 'cannotTell');
  assert.equal(ResponseShape.look(openEnded, 'id'), 'found');
  assert.equal(ResponseShape.look(undefined, 'anything'), 'cannotTell');
});

test('test_R11_a_key_in_any_oneOf_choice_is_accepted', () => {
  const branched = {
    oneOf: [
      { properties: { a: {} }, additionalProperties: false },
      { properties: { b: {} }, additionalProperties: false },
    ],
  } as never;
  assert.equal(ResponseShape.look(branched, 'a'), 'found');
  assert.equal(ResponseShape.look(branched, 'b'), 'found');
  assert.equal(ResponseShape.look(branched, 'c'), 'forbidden');
});

// --- negative tests: prove the checks actually fire on real generated output ----------------
// A clean corpus sweep only means something if the linter can fail. Each of these takes a real
// generated schema, breaks it the way a hand-edit would, and asserts the complaint.

test('test_R11_a_clean_generated_schema_is_actually_read', async () => {
  const { gen, sdl } = await petstoreSchema();
  const parsed = SchemaReader.read(sdl);
  const fieldCount = parsed.selections.reduce((total, selection) => total + selection.fields.length, 0);

  // the guard against a quiet pass: "no complaints" must mean "checked", not "saw nothing"
  assert.equal(parsed.selections.length, 1, 'the @connect selection should be found');
  assert.ok(fieldCount >= 5, `expected the selection's fields to be read, got ${fieldCount}`);
  assert.deepEqual(lintSelections(sdl, gen), []);
});

test('test_R11_every_check_fires_on_a_broken_generated_schema', async () => {
  const { gen, sdl } = await petstoreSchema();

  const breakages: [string, string, string][] = [
    // [what we broke, the broken SDL, the code we expect]
    ['a misspelt method', sdl.replace('      photoUrls\n', '      photoUrls->fist\n'), 'UNKNOWN_ARROW_TARGET'],
    ['an arrow to a type with no @mapping', sdl.replace('      photoUrls\n', '      photoUrls->Category\n'), 'TARGET_HAS_NO_MAPPING'],
    ['a path the response does not have', sdl.replace('      photoUrls\n', '      photoUrls: photoUrlz\n'), 'PATH_NOT_IN_RESPONSE'],
    ['a nested path the response does not have', sdl.replace('category? {', 'category: catgory? {'), 'PATH_NOT_IN_RESPONSE'],
  ];

  for (const [what, broken, code] of breakages) {
    assert.notEqual(broken, sdl, `the test did not actually break anything for: ${what}`);
    const found = lintSelections(broken, gen);
    assert.ok(
      found.some((diagnostic) => diagnostic.code === code),
      `expected ${code} for ${what}, got ${JSON.stringify(found.map((d) => d.code))}`,
    );
  }
});

test('test_R11_a_misspelt_method_offers_the_right_spelling', async () => {
  const { gen, sdl } = await petstoreSchema();
  const broken = sdl.replace('      photoUrls\n', '      photoUrls->trimStrt\n');
  const found = lintSelections(broken, gen);
  assert.equal(found[0].fix?.insert, 'trimStart');
  assert.equal(broken.slice(found[0].fix!.from, found[0].fix!.to), 'trimStrt');
});

test('test_R11_a_fix_can_be_applied_straight_to_the_document', async () => {
  const { gen, sdl } = await petstoreSchema();
  const broken = sdl.replace('      photoUrls\n', '      photoUrls->trimStrt\n');
  const fix = lintSelections(broken, gen)[0].fix!;
  const repaired = broken.slice(0, fix.from) + fix.insert + broken.slice(fix.to);

  assert.ok(repaired.includes('photoUrls->trimStart'));
  assert.deepEqual(lintSelections(repaired, gen), [], 'applying the fix should leave a clean schema');
});

// --- the cases the plan asked for that were still missing --------------------------------

test('test_R11_an_unclosed_quote_is_silent', () => {
  // a key being typed: `photo: "photo-ur` with no closing quote yet
  assert.deepEqual(codes(connectSchema('id\nphoto: "photo-ur')), []);
  assert.deepEqual(codes(connectSchema('id\nname->trim("')), []);
});

test('test_R11_escapes_in_a_quoted_selection_do_not_shift_offsets', () => {
  // an ordinary "..." selection, so GraphQL escapes are in play: the two \" before the mistake
  // each take two characters in the SDL but one in the selection, and the underline has to land
  // on the real bytes regardless.
  const sdl =
    'type Pet { id: Int name: String }\n' +
    'type Query { pet: Pet @connect(selection: "photo: \\"photo-url\\" name->nope") }';
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_a_newline_escape_does_not_shift_offsets', () => {
  // an ordinary "..." selection separates its fields with \n, which is two characters in the SDL
  // and one in the selection — every position after it shifts by one
  const sdl =
    'type Pet { id: Int name: String }\n' +
    'type Query { pet: Pet @connect(selection: "id\\nname->nope") }';
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_a_stray_backslash_stops_the_reader_rather_than_guessing', () => {
  // `\\odd` decodes to `\odd`, which is not a path the reader can make sense of — it marks the
  // field unreadable and says nothing further about that selection, mistake after it included
  const sdl =
    'type Pet { id: Int name: String }\n' +
    'type Query { pet: Pet @connect(selection: "path: \\\\odd name->nope") }';
  assert.deepEqual(lintSelections(sdl), []);
});

test('test_R11_a_repeated_type_anchors_each_finding_to_its_own_selection', () => {
  // two @connects in the document: each diagnostic must point at its own text, not the first match
  const sdl = `type Pet { id: Int name: String }
type Query {
  one: Pet @connect(selection: "id name->nope")
}
extend type Query {
  two: Pet @connect(selection: "id name->alsoNope")
}`;
  const found = lintSelections(sdl);
  assert.equal(found.length, 2);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
  assert.equal(sdl.slice(found[1].from, found[1].to), 'alsoNope');
  assert.ok(found[0].from < found[1].from, 'findings should come back in document order');
});

test('test_R11_a_mutation_selection_is_checked_too', async () => {
  const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, PETSTORE_OPTIONS);
  await gen.visit();
  const sdl = gen.generateSchema(['post:/pet>**']);

  const parsed = SchemaReader.read(sdl);
  assert.ok(parsed.selections.length > 0, 'the mutation @connect selection should be found');
  assert.deepEqual(lintSelections(sdl, gen), [], 'generated mutation output should lint clean');
});

test('test_R11_a_unicode_escape_does_not_shift_offsets', () => {
  // \u0020 is a space: six characters in the SDL, one in the selection
  const sdl =
    'type Pet { id: Int name: String }\n' +
    'type Query { pet: Pet @connect(selection: "id\\u0020name->nope") }';
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_interfaces_are_read_like_object_types', () => {
  // R2 promotes a shared allOf base to an interface, so a selection can point at one
  const sdl = `interface Animal { id: Int name: String }
type Pet implements Animal { id: Int name: String friend: Animal }
type Query { pet: Pet @connect(selection: "id friend: friend->Animal") }`;
  const found = lintSelections(sdl);

  // the interface is a known type, so this is "you forgot @mapping", not "never heard of it"
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'TARGET_HAS_NO_MAPPING');
  assert.ok(found[0].message.includes('Animal'));

  const parsed = SchemaReader.read(sdl);
  assert.deepEqual(parsed.types.get('Animal')?.fields.map((field) => field.name), ['id', 'name']);
});

// --- selection syntax the generator and the router actually use ---------------------------
// Each of these made the reader give up mid-selection, which silently skipped every field after
// it. Found by the corpus sweep's "fields read" count, not by anything failing.

test('test_R11_a_comment_is_skipped', () => {
  // what the generator writes where it cut a cycle, e.g. (recursive-cycle.yaml)
  const sdl = connectSchema('# children: circular reference omitted (re-visit schema)\nid\nname->nope');
  const found = lintSelections(sdl);
  assert.equal(found.length, 1, 'the field after the comment must still be checked');
  assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
});

test('test_R11_a_missing_value_fallback_is_read', () => {
  // e.g. (digitalocean) `available: available ?? $(true)` — `??` uses the right side when the left
  // is missing, `?!` when it is null
  for (const selection of ['available: available ?? $(true)', 'available: available ?! $(false)']) {
    const sdl = connectSchema(`${selection}\nname->nope`);
    const found = lintSelections(sdl);
    assert.equal(found.length, 1, `the field after \`${selection}\` must still be checked`);
    assert.equal(sdl.slice(found[0].from, found[0].to), 'nope');
  }
});

test('test_R11_a_router_supplied_value_is_read', () => {
  // `$this`/`$args` name a value the router supplies, so there is no response key to look up
  const sdl = connectSchema('id: $this.id\nname->nope');
  const parsed = SchemaReader.read(sdl);
  assert.equal(parsed.selections[0].fields[0].readsFrom.startsAt, 'dollar');
  assert.equal(lintSelections(sdl).length, 1);
});

test('test_R11_an_optional_step_is_read', () => {
  // `image?.slug` means "carry on if image is missing" — the key asked for is unchanged
  const sdl = connectSchema('slug: image?.slug\nname->nope');
  const parsed = SchemaReader.read(sdl);
  assert.deepEqual(
    parsed.selections[0].fields[0].readsFrom.pathParts.map((part) => part.name),
    ['image', 'slug'],
  );
  assert.equal(lintSelections(sdl).length, 1);
});

test('test_R11_a_fallback_is_not_looked_up_in_the_response', async () => {
  // the right side of `??` is not read from the response, so it must not be reported as missing
  const { gen, sdl } = await petstoreSchema();
  const withFallback = sdl.replace('      photoUrls\n', '      photoUrls: photoUrls ?? $(nothingHere)\n');
  assert.notEqual(withFallback, sdl);
  assert.deepEqual(lintSelections(withFallback, gen), []);
});

test('test_R11_escaped_quoted_keys_resolve_to_their_json_key', async () => {
  // `$."back\\slash"` names the JSON key `back\slash` — the quotes carry escapes the key itself
  // does not have, so the response lookup must unescape before comparing. see #64
  const gen = await OasGen.fromFile(`${oasBasePath}/r3-edge-cases.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/things>**']);
  assert.ok(sdl.includes('backSlash: $."back\\\\slash"'), 'the escaped key is in the selection');
  assert.deepEqual(lintSelections(sdl, gen), []);
});

// --- #176: every spec-declared response field is read or accounted for --------------------
// Unlike PATH_NOT_IN_RESPONSE above (selection -> spec: "is this a real key?"), this check goes
// the other way, spec -> selection: "did the selection ask for everything the spec offered?" It
// needs the raw SDL text (to read cycle-cut comments), so it is not one of the CHECKS lintSelections
// runs on every keystroke -- it is called directly, the way tools/lint-corpus.mts calls it.

test('test_176_a_stubbed_response_is_an_error', async () => {
  // (unread-media-type.yaml) the spec's /reports response is a real object under application/xml,
  // a media type the generator never reads (only a JSON type or */*) -- the exact #175 shape: the
  // generator falls back to `success: $(true)` on a spec that actually described id/name.
  const gen = await OasGen.fromFile(`${oasBasePath}/unread-media-type.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/reports>**']);
  assert.ok(sdl.includes('success: $(true)'), 'the generator produced the stub shape, not the test');

  const parsed = SchemaReader.read(sdl);
  const found = ResponseCoverageCheck.run(sdl, parsed, gen);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'RESPONSE_NOT_READ');
  assert.equal(found[0].severity, 'error');
  assert.ok(found[0].message.includes('id'), 'names the first field the spec declared');
  assert.ok(found[0].message.includes('name'), 'names the second field the spec declared');
  assert.ok(found[0].message.includes('get:/reports'), 'names the operation');
});

test('test_176_generated_petstore_reads_every_declared_field', async () => {
  const { gen, sdl } = await petstoreSchema();
  const parsed = SchemaReader.read(sdl);
  assert.deepEqual(ResponseCoverageCheck.run(sdl, parsed, gen), []);
});

test('test_176_a_dropped_field_is_reported', async () => {
  const { gen, sdl } = await petstoreSchema();
  const broken = sdl.replace('      photoUrls\n', '');
  assert.notEqual(broken, sdl, 'the test did not actually break anything');

  const parsed = SchemaReader.read(broken);
  const found = ResponseCoverageCheck.run(broken, parsed, gen);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'RESPONSE_FIELD_NOT_READ');
  assert.ok(found[0].message.includes('photoUrls'));
  assert.ok(found[0].message.includes('get:/pet/findByStatus'));
});

test('test_176_a_dropped_nested_field_is_reported', async () => {
  const { gen, sdl } = await petstoreSchema();
  // the first `name?` in the generated selection belongs to `category { id? name? }`; `tags` has
  // an identical inner block further down, so dropping only the first one is what proves the walk
  // is looking at category's own properties, not tags'.
  const broken = sdl.replace('       name?\n', '');
  assert.notEqual(broken, sdl, 'the test did not actually break anything');

  const parsed = SchemaReader.read(broken);
  const found = ResponseCoverageCheck.run(broken, parsed, gen);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'RESPONSE_FIELD_NOT_READ');
  assert.ok(found[0].message.includes('name'));
  assert.equal(broken.slice(found[0].from, found[0].to), 'category', 'anchored on the field that owns the block');
});

test('test_176_a_cycle_comment_excuses_only_its_own_key', async () => {
  // (recursive-cycle.yaml) Node has two cycle cuts (parent, children) and two identical, non-cyclic
  // fields (meta, extra) that both point at Shared { label }. The generated selection carries a
  // cut comment for parent and for children; dropping a field from meta or extra must still be
  // reported -- their sibling's comment must not excuse them too.
  const gen = await OasGen.fromFile(`${oasBasePath}/recursive-cycle.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
  });
  await gen.visit();
  const sdl = gen.generateSchema(['get:/nodes>**']);
  assert.deepEqual(ResponseCoverageCheck.run(sdl, SchemaReader.read(sdl), gen), [], 'the generated selection is clean');

  const droppedMeta = sdl.replace('      meta? {\n       label?\n      }\n', '');
  assert.notEqual(droppedMeta, sdl);
  const foundMeta = ResponseCoverageCheck.run(droppedMeta, SchemaReader.read(droppedMeta), gen);
  assert.equal(foundMeta.length, 1);
  assert.equal(foundMeta[0].code, 'RESPONSE_FIELD_NOT_READ');
  assert.ok(foundMeta[0].message.includes('meta'));

  const droppedExtraLabel = sdl.replace('      extra? {\n       label?\n      }\n', '      extra? {\n      }\n');
  assert.notEqual(droppedExtraLabel, sdl);
  const foundExtra = ResponseCoverageCheck.run(droppedExtraLabel, SchemaReader.read(droppedExtraLabel), gen);
  assert.equal(foundExtra.length, 1);
  assert.ok(foundExtra[0].message.includes('label'));
  assert.equal(droppedExtraLabel.slice(foundExtra[0].from, foundExtra[0].to), 'extra', 'not meta, whose comment sits at the top level');
});

test('test_176_documented_degrades_are_accounted_for', async () => {
  // Every one of these is a field move this check was told, on purpose, not to have a rule for:
  // map entries, a whole-response map root, an unknown scalar type, an undescribed body read as
  // raw JSON, a shapeless object, a lone 201, a composed oneOf/allOf response (unjudged, silently),
  // and twin field renames with and without --keep-field-names. None of them is a real loss.
  const cases: [string, string, Record<string, unknown>?][] = [
    ['cycle-cut-on-some-routes.yaml', 'get:/graph'],
    ['map-key-aliasing.yaml', 'get:/coupons'],
    ['map-response-root.yaml', 'get:/restrictions'],
    ['map-response-root.yaml', 'get:/pages'],
    ['map-response-root.yaml', 'get:/emoji'],
    ['map-response-root.yaml', 'get:/languages'],
    ['unknown-scalar-response.yaml', 'get:/avatar', { skipValidation: true }],
    ['undescribed-2xx-response.yaml', 'get:/manuscripts/{id}'],
    ['undescribed-2xx-response.yaml', 'del:/notebooks/{id}'],
    ['undescribed-2xx-response.yaml', 'del:/labels/{id}'],
    ['undescribed-2xx-response.yaml', 'get:/widgets/{id}'],
    ['undescribed-2xx-response.yaml', 'post:/reports'],
    ['empty-response-with-body.yaml', 'post:/goals/{goalId}/removeSupportingRelationship'],
    ['response-201-only.yaml', 'post:/widgets'],
    ['simple-oneOf-example.yaml', 'get:/item'],
    ['simple-allOf-example.yaml', 'get:/user'],
    ['keep-twin-fields.yaml', 'get:/widgets', { keepFieldNames: true }],
    ['keep-twin-fields.yaml', 'get:/widgets', { keepFieldNames: false }],
    ['map-recursive-value.yaml', 'get:/prices'],
    ['wildcard-keeps-every-property.yaml', 'get:/networks'],
    ['map-value-ref-choice.yaml', 'get:/networks'],
  ];

  for (const [file, op, extra] of cases) {
    const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
      skipValidation: false,
      showParentInSelections: false,
      ...extra,
    } as never);
    await gen.visit();
    const sdl = gen.generateSchema([SelectionPath.everythingUnder(op)]);
    const parsed = SchemaReader.read(sdl);
    // the guard against a quiet pass: "no complaints" has to mean "the selection was found and
    // checked", not "there was nothing there to check"
    assert.ok(parsed.selections.length > 0, `${file} ${op}: the selection should be found`);
    assert.deepEqual(
      ResponseCoverageCheck.run(sdl, parsed, gen),
      [],
      `${file} ${op}: a documented degrade must not be reported`,
    );
  }
});
