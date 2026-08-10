import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import { Naming } from '../../src/oas/utils/naming.js';
import {
  genParamName as jsonGenParamName,
  sanitiseFieldForSelect as jsonSanitiseForSelect,
} from '../../src/json/walker/naming.js';
import './_setup.js';

// --- R3: field-name sanitisation edge cases --------------------------------

const GQL_IDENTIFIER = /^[_A-Za-z][_0-9A-Za-z]*$/;

test('test_R3_oas_genParamName_edge_cases', () => {
  const cases: [string, string][] = [
    ['created_at', 'createdAt'], // snake -> camel
    ['media-metadata', 'mediaMetadata'], // kebab
    ['foo.bar', 'fooBar'], // dotted
    ['fooBar', 'fooBar'], // already camel (idempotent)
    ['name', 'name'], // plain
    ['2fa_enabled', '_2faEnabled'], // leading digit -> prefixed
    ['123', '_123'], // all digits
    ['50%off', '_50Off'], // leading digit + illegal char
    ['full name', 'fullName'], // space
    ['cost$', 'cost'], // trailing illegal char
    ['__typename', 'typename'], // reserved-ish prefix collapsed
    ['', '_'], // empty
    ['---', '_'], // separators only
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(Naming.genParamName(input), expected, `genParamName(${JSON.stringify(input)})`);
    assert.ok(GQL_IDENTIFIER.test(Naming.genParamName(input)), `not a valid identifier: ${JSON.stringify(input)}`);
  }
});

test('test_R3_oas_sanitiseFieldForSelect_aliases', () => {
  // Already-valid keys pass through bare (no alias).
  assert.strictEqual(Naming.sanitiseFieldForSelect('id'), 'id');
  assert.strictEqual(Naming.sanitiseFieldForSelect('userName'), 'userName');
  // Everything else aliases the safe field back to the original key: bare when it is an
  // identifier, the `$."key"` path step when not — a quoted key would be a literal (#62).
  assert.strictEqual(Naming.sanitiseFieldForSelect('created_at'), 'createdAt: created_at');
  assert.strictEqual(Naming.sanitiseFieldForSelect('_id'), 'id: _id');
  assert.strictEqual(Naming.sanitiseFieldForSelect('media-metadata'), 'mediaMetadata: $."media-metadata"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('2fa_enabled'), '_2faEnabled: $."2fa_enabled"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('full name'), 'fullName: $."full name"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('cost$'), 'cost: $."cost$"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('say "hi"'), 'sayHi: $."say \\"hi\\""');
  assert.strictEqual(Naming.sanitiseFieldForSelect('back\\slash'), 'backSlash: $."back\\\\slash"');
});

test('test_R3_json_walker_naming_edge_cases', () => {
  assert.strictEqual(jsonGenParamName('created_at'), 'createdAt');
  assert.strictEqual(jsonGenParamName('2fa_enabled'), '_2faEnabled');
  assert.strictEqual(jsonGenParamName('full name'), 'fullName');
  assert.strictEqual(jsonGenParamName('cost$'), 'cost');
  for (const k of ['2fa', 'full name', 'cost$', '$', '---', '']) {
    assert.ok(GQL_IDENTIFIER.test(jsonGenParamName(k)), `not a valid identifier: ${JSON.stringify(k)}`);
  }
  assert.strictEqual(jsonSanitiseForSelect('id'), 'id');
  assert.strictEqual(jsonSanitiseForSelect('full name'), 'fullName: $."full name"');
  assert.strictEqual(jsonSanitiseForSelect('cost$'), 'cost: $."cost$"');
  assert.strictEqual(jsonSanitiseForSelect('_id'), 'id: _id');
  assert.strictEqual(jsonSanitiseForSelect('say "hi"'), 'sayHi: $."say \\"hi\\""');
  assert.strictEqual(jsonSanitiseForSelect('back\\slash'), 'backSlash: $."back\\\\slash"');
});

test('test_R3_oas_edge_fixture_composes_with_safe_names', async () => {
  // End-to-end: a schema full of awkward JSON keys must produce valid, composable GraphQL
  // with each safe field aliased back to its original key. runOasTest composes via rover,
  // so an invalid identifier here would fail composition.
  const schema = await runOasTest('r3-edge-cases.yaml', ['get:/things>**'], 1, 3);
  assert.ok(schema !== undefined);
  // path-step form for non-identifier keys; a quoted key after an alias is a literal (#62)
  assert.ok(schema!.includes('_2faEnabled: $."2fa_enabled"'), 'leading-digit field aliased');
  assert.ok(schema!.includes('cost: $."cost$"'), 'dollar-sign field aliased');
  assert.ok(schema!.includes('fullName: $."full name"'), 'space field aliased');
  // renamed-but-valid keys reference the key bare
  assert.ok(schema!.includes('createdAt: created_at'), 'snake_case key referenced bare');
  assert.ok(schema!.includes('id: _id'), 'renamed identifier key referenced bare');
  assert.ok(!schema!.includes(': "_id"') && !schema!.includes(': "created_at"'), 'no literal alias left');
});

test('test_R3_aliased_container_and_escaped_keys_compose', async () => {
  // The `$."key"` spelling on containers (`pageInfo: $."page info" { count }`) and the two
  // escaping cases the router grammar allows: `\"` and `\\`. see docs/issues.md #62
  const schema = await runOasTest('r3-edge-cases.yaml', ['get:/things>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('pageInfo: $."page info"? {'), 'object under a non-identifier key');
  assert.ok(schema!.includes('itemList: $."item list"? {'), 'array under a non-identifier key');
  assert.ok(schema!.includes('sayHi: $."say \\"hi\\""'), 'double quote escaped in the key');
  assert.ok(schema!.includes('backSlash: $."back\\\\slash"'), 'backslash escaped in the key');
});

test('test_R3_type_name_leading_digit_is_sanitised', async () => {
  // A type name derived from a digit-leading path/field (e.g. /1-clicks -> 1ClicksItem) is not a
  // valid GraphQL identifier; the composer rejects it (INTERNAL_ERROR). genTypeName must prefix it
  // (_1ClicksItem) at both the definition and references. runOasTest composes via rover.
  const schema = await runOasTest('type-name-digit.yaml', ['get:/1-clicks>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type _1ClicksItem'), 'leading-digit type name prefixed at definition');
  assert.ok(schema!.includes('_1Clicks: [_1ClicksItem]'), 'reference uses the same sanitised name');
});

test('test_R3_oas_formatPath_strips_hash_from_sub_resource_path', () => {
  // `#` is valid in an OAS path but not in a GraphQL field name. It splits the field name only;
  // underscores stay as-is.
  assert.strictEqual(Naming.formatPath('/items#weblinks', []), 'ItemsWeblinks');
  assert.strictEqual(Naming.formatPath('/shared_items#web_links', []), 'Shared_itemsWeb_links');
  assert.strictEqual(
    Naming.formatPath('/items/{item_id}#get_shared_link', ['ByItemId']),
    'ItemsByItemIdGet_shared_link',
  );
  // No `#` survives in any field name derived from these paths.
  for (const p of ['/items#weblinks', '/shared_items#web_links', '/files/{file_id}#get_shared_link']) {
    const name = Naming.formatPath(p, p.includes('{') ? ['ByFileId'] : []);
    assert.ok(!name.includes('#'), `formatPath(${JSON.stringify(p)}) retained '#': ${name}`);
  }
});

test('test_R8_hash_sub_resource_path_field_name_and_composes', async () => {
  // End-to-end: `/items#weblinks` becomes the GraphQL field `itemsWeblinks`, while the connector
  // still calls `GET: "/items#weblinks"`. If `#` leaks into the field line, SDL treats the rest of
  // the line as a comment and composition cannot bind the response fields.
  const schema = await runOasTest('r8-hash-path.yaml', ['get:/items#weblinks>**'], 2, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('itemsWeblinks: ItemsWeblinksResponse'), 'hash stripped from field name');
  assert.ok(schema!.includes('GET: "/items#weblinks"'), 'runtime HTTP path retains the # fragment');
  assert.ok(!/^\s*items#weblinks\s*:/m.test(schema!), 'field name must not contain #');
});

// --- Inline allOf array item naming -------------------------------------------------------
//
// Mirrors Box's `get:/metadata_query_indices`: `MetadataQueryIndex.fields[]` is an inline
// single-member allOf with no `$ref`. It must become `type Fields { ... }`, and the parent field
// must still reference it as `fields: [Fields]`.

const GQL_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID', 'JSON']);

// Collect object type names defined in the SDL (`type NAME {`), excluding the Query root.
function definedObjectTypes(schema: string): Set<string> {
  return new Set(
    [...schema.matchAll(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s/gm)]
      .map((m) => m[1])
      .filter((n) => n !== 'Query'),
  );
}

// From each object type body, collect the type names referenced by its fields
// (`field: X`, `field: [X]`, `field: [X!]`, `field: X!`). Skips the Query op (its body carries
// @connect directive content, not plain field declarations) and scalars.
function referencedObjectTypes(schema: string): Set<string> {
  const referenced = new Set<string>();
  // match `type NAME { ... }` bodies (object types have no nested braces in their field list)
  for (const m of schema.matchAll(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/gm)) {
    if (m[1] === 'Query') continue;
    for (const f of m[2].matchAll(/^\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?\s*:\s*\[?\s*([A-Za-z_][A-Za-z0-9_]*)/gm)) {
      referenced.add(f[1]);
    }
  }
  return referenced;
}

test('test_B2_inline_allof_array_item_is_named_not_skipped', async () => {
  const schema = await runOasTest(
    'inline-allof-array-item.yaml',
    ['get:/metadata_query_indices>**'],
    1,
    3,
  );
  assert.ok(schema !== undefined);

  // Naming only at `isRef()` would avoid the crash but still allow a blank definition.
  assert.ok(!/\btype\s+\{/.test(schema!), 'no blank-named type definition emitted');

  // Every object type referenced by a field must have a definition.
  const defined = definedObjectTypes(schema!);
  const referenced = referencedObjectTypes(schema!);
  const dangling = [...referenced].filter((t) => !GQL_SCALARS.has(t) && !defined.has(t));
  assert.deepStrictEqual(dangling, [], 'field references a type with no definition (dangling)');

  // The inline allOf item is present, named, and still referenced by `fields`; passing composition
  // by dropping the field would fail these checks.
  for (const t of ['MetadataQueryIndices', 'MetadataQueryIndex', 'Fields']) {
    assert.ok(schema!.includes(`type ${t} {`), `expected named type definition: ${t}`);
  }
  assert.ok(schema!.includes('entries: [MetadataQueryIndex]'), 'entries array field preserved');
  assert.ok(schema!.includes('fields: [Fields]'), 'fields array field preserved and points at named type');
  // The generated `Fields` type carries the properties from the inline allOf member.
  assert.ok(/type Fields \{[^}]*key:[^}]*sortDirection:/s.test(schema!), 'Fields type retains key + sortDirection fields');
});

test('test_R8_path_param_snake_case_templated_with_args', async () => {
  // snake_case path params ({thing_id}) must be templated against the sanitised GraphQL arg name
  // ({$args.thingId}), not emitted raw. Rover rejects a raw {thing_id} with INVALID_URL. runOasTest
  // composes, so a regression here fails composition. (Top coverage gap: COMPOSE-FAIL [INVALID_URL].)
  const schema = await runOasTest('path-param-snake.yaml', ['get:/things/{thing_id}/parts/{part_id}>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('GET: "/things/{$args.thingId}/parts/{$args.partId}"'), 'snake path params templated as $args');
  // raw snake params may remain in the descriptive comment, but never in the connect GET URL
  assert.ok(!/GET: "[^"]*\{thing_id\}/.test(schema!), 'raw snake path param must not survive in the GET URL');
});
