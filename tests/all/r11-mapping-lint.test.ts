import { test } from 'node:test';
import assert from 'node:assert';
import { lintSelections } from '../../src/oas/lint/index.js';
import './_setup.js';

// --- R11: the checks that only apply to a connect v0.5 `@mapping` -----------
// The checks shared with main live in r11-lint.test.ts, which stays identical there so the merge
// brings it down untouched.

/** Minimal v0.5 SDL around some mapped types, with a `@connect` that returns the first of them. */
function mappingSchema(types: string, root = 'Pet'): string {
  return `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(url: "https://specs.apollo.dev/connect/v0.5", import: ["@connect", "@source", "@mapping"])
  @source(name: "api", http: { baseURL: "https://example.com" })

${types}

type Query {
  pet: ${root}
    @connect(source: "api", http: { GET: "/pet" }, selection: "$->${root}")
}
`;
}

/** A Pet whose `@mapping` body is `selection`, plus the Category and Tag it points at. */
function petMapping(selection: string): string {
  return mappingSchema(`type Pet @mapping(selection: """
  ${selection}
  """) {
  id: Int
  status: String
  category: Category
  tags: [Tag]
}

type Category @mapping {
  id: Int
  name: String
}

type Tag @mapping {
  id: Int
  name: String
}`);
}

const codes = (sdl: string): string[] => lintSelections(sdl).map((d) => d.code);

// --- check 2: the arrow has to give back what the field holds ---------------

test('test_R11_an_arrow_to_the_wrong_type_is_reported', () => {
  const sdl = petMapping('category: category->Tag');
  const found = lintSelections(sdl);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'ARROW_TYPE_MISMATCH');
  assert.equal(sdl.slice(found[0].from, found[0].to), 'Tag');
  assert.equal(found[0].fix?.insert, 'Category');
});

test('test_R11_an_arrow_to_the_right_type_is_clean', () => {
  assert.deepEqual(codes(petMapping('category: category->Category')), []);
});

test('test_R11_a_list_field_takes_the_bare_arrow', () => {
  // the router applies the mapping to every element, so no `map` wrapper is needed — and the
  // generator writes exactly this form
  assert.deepEqual(codes(petMapping('tags: tags->Tag')), []);
});

test('test_R11_a_list_field_also_takes_the_explicit_map', () => {
  assert.deepEqual(codes(petMapping('tags: tags->map(@->Tag)')), []);
});

test('test_R11_an_arrow_to_a_type_on_a_scalar_field_is_reported', () => {
  const found = lintSelections(petMapping('status: status->Category'));
  assert.equal(found.length, 1);
  assert.equal(found[0].code, 'ARROW_TYPE_MISMATCH');
  assert.ok(found[0].message.includes('not an object'));
  assert.equal(found[0].fix, undefined, 'there is no arrow that would make a String right');
});

test('test_R11_builtin_methods_on_a_scalar_field_are_clean', () => {
  assert.deepEqual(codes(petMapping('status: status->trim->toString')), []);
});

test('test_R11_a_connect_selection_is_checked_against_the_field_it_returns', () => {
  const sdl = mappingSchema(`type Pet @mapping {
  id: Int
  name: String
}

type Category @mapping {
  id: Int
}

type Query2 {
  pet: Pet
    @connect(source: "api", http: { GET: "/pet" }, selection: """
    id
    name: name->Category
    """)
}`);
  assert.deepEqual(codes(sdl), ['ARROW_TYPE_MISMATCH']);
});

// --- check 5: a bare @mapping cannot expand an object field ----------------

test('test_R11_a_bare_mapping_over_an_object_field_is_reported', () => {
  const sdl = mappingSchema(`type Pet @mapping {
  id: Int
  category: Category
}

type Category @mapping {
  id: Int
}`);
  const found = lintSelections(sdl);
  assert.deepEqual(found.map((d) => d.code), ['BARE_MAPPING_OBJECT_FIELDS']);
  assert.ok(found[0].message.includes('category'));
  assert.equal(sdl.slice(found[0].from, found[0].to), '@mapping');
});

test('test_R11_a_bare_mapping_over_scalars_only_is_clean', () => {
  assert.deepEqual(
    codes(mappingSchema(`type Pet @mapping {
  id: Int
  name: String
  status: String
}`)),
    [],
  );
});

test('test_R11_an_object_field_written_out_in_full_is_clean', () => {
  assert.deepEqual(codes(petMapping('id\n  category: category->Category')), []);
});

test('test_R11_a_bare_mapping_over_a_union_field_is_reported', () => {
  const sdl = mappingSchema(`type Pet @mapping {
  id: Int
  result: Result
}

union Result = Cat | Dog

type Cat @mapping {
  id: Int
}

type Dog @mapping {
  id: Int
}`);
  assert.deepEqual(codes(sdl), ['BARE_MAPPING_OBJECT_FIELDS']);
});

// --- check 4: a mapping that comes back to itself --------------------------

test('test_R11_a_two_type_mapping_cycle_is_reported', () => {
  const sdl = mappingSchema(`type Pet @mapping(selection: """
  owner: owner->Owner
  """) {
  owner: Owner
}

type Owner @mapping(selection: """
  pet: pet->Pet
  """) {
  pet: Pet
}`);
  const found = lintSelections(sdl);
  assert.deepEqual(found.map((d) => d.code), ['MAPPING_CYCLE']);
  assert.ok(found[0].message.includes('Pet -> Owner -> Pet'), found[0].message);
});

test('test_R11_a_type_mapping_to_itself_is_reported', () => {
  const sdl = mappingSchema(
    `type Comment @mapping(selection: """
  id
  replies: replies->Comment
  """) {
  id: Int
  replies: [Comment]
}`,
    'Comment',
  );
  assert.deepEqual(codes(sdl), ['MAPPING_CYCLE']);
});

test('test_R11_a_bare_mapping_can_close_a_cycle_too', () => {
  const sdl = mappingSchema(`type Pet @mapping(selection: """
  owner: owner->Owner
  """) {
  owner: Owner
}

type Owner @mapping {
  pet: Pet
}`);
  // the bare `@mapping` is reported in its own right, and it is also the step back to Pet
  assert.deepEqual(codes(sdl).sort(), ['BARE_MAPPING_OBJECT_FIELDS', 'MAPPING_CYCLE']);
});

test('test_R11_the_same_type_reached_twice_is_not_a_cycle', () => {
  const sdl = mappingSchema(`type Pet @mapping(selection: """
  category: category->Category
  breed: breed->Category
  """) {
  category: Category
  breed: Category
}

type Category @mapping {
  id: Int
}`);
  assert.deepEqual(codes(sdl), []);
});

// --- check 6: `$` and `@` are the parent, not the field --------------------

test('test_R11_dollar_on_a_named_field_is_reported', () => {
  const sdl = petMapping('category: $->Category');
  const found = lintSelections(sdl);
  assert.deepEqual(found.map((d) => d.code), ['RECEIVER_IS_PARENT']);
  assert.equal(found[0].severity, 'warning');
  assert.equal(sdl.slice(found[0].from, found[0].to), '$');
});

test('test_R11_at_sign_on_a_named_field_is_reported_the_same_way', () => {
  const sdl = petMapping('category: @->Category');
  const found = lintSelections(sdl);
  assert.deepEqual(found.map((d) => d.code), ['RECEIVER_IS_PARENT']);
  assert.equal(sdl.slice(found[0].from, found[0].to), '@');
});

test('test_R11_the_parent_receiver_fix_names_the_field', () => {
  const sdl = petMapping('category: $->Category');
  const fix = lintSelections(sdl)[0].fix!;
  const fixed = sdl.slice(0, fix.from) + fix.insert + sdl.slice(fix.to);
  assert.ok(fixed.includes('category: category->Category'), fixed);
  assert.deepEqual(codes(fixed), []);
});

test('test_R11_an_anonymous_spread_of_the_parent_is_allowed', () => {
  // the flattened-response idiom: merge another mapping's shape into this one on purpose
  assert.deepEqual(codes(petMapping('id\n  ...@->Category')), []);
});

test('test_R11_a_dollar_at_the_connect_root_is_allowed', () => {
  assert.deepEqual(codes(petMapping('id')), [], 'the wrapper itself uses `$->Pet`');
});

test('test_R11_a_dollar_map_at_the_connect_root_is_allowed', () => {
  const sdl = mappingSchema(`type Pet @mapping {
  id: Int
}

type Query2 {
  pets: [Pet]
    @connect(source: "api", http: { GET: "/pets" }, selection: "$->map(@->Pet)")
}`);
  assert.deepEqual(codes(sdl), []);
});

test('test_R11_a_definition_body_is_allowed_to_use_the_at_sign', () => {
  // in a definition `@` is whatever the definition was applied to, so it is never the parent
  const sdl = mappingSchema(`type Pet @mapping(selection: """
  ($low, $high) => @->slice($low, $high)
  """) {
  id: Int
}`);
  assert.deepEqual(codes(sdl), []);
});

test('test_R11_a_path_off_the_parent_is_not_the_parent', () => {
  assert.deepEqual(codes(petMapping('category: $.category->Category')), []);
});

test('test_R11_a_router_supplied_value_is_not_the_parent', () => {
  assert.deepEqual(codes(petMapping('category: $this->Category')), []);
});

test('test_R11_a_nested_block_is_not_the_top_level', () => {
  // inside `category { ... }` the receiver is the category, so `@` there is correct
  assert.deepEqual(codes(petMapping('category: category { ...@->Category }')), []);
});
