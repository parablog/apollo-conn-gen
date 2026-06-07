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
  // Everything else aliases the safe field back to the original (quoted) JSON key.
  assert.strictEqual(Naming.sanitiseFieldForSelect('created_at'), 'createdAt: "created_at"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('media-metadata'), 'mediaMetadata: "media-metadata"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('2fa_enabled'), '_2faEnabled: "2fa_enabled"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('full name'), 'fullName: "full name"');
  assert.strictEqual(Naming.sanitiseFieldForSelect('cost$'), 'cost: "cost$"');
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
  assert.strictEqual(jsonSanitiseForSelect('full name'), 'fullName: "full name"');
  assert.strictEqual(jsonSanitiseForSelect('cost$'), 'cost: "cost$"');
});

test('test_R3_oas_edge_fixture_composes_with_safe_names', async () => {
  // End-to-end: a schema full of awkward JSON keys must produce valid, composable GraphQL
  // with each safe field aliased back to its original key. runOasTest composes via rover,
  // so an invalid identifier here would fail composition.
  const schema = await runOasTest('r3-edge-cases.yaml', ['get:/things>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('_2faEnabled: "2fa_enabled"'), 'leading-digit field aliased');
  assert.ok(schema!.includes('cost: "cost$"'), 'dollar-sign field aliased');
  assert.ok(schema!.includes('fullName: "full name"'), 'space field aliased');
  assert.ok(schema!.includes('createdAt: "created_at"'), 'snake_case field aliased');
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

test('test_R8_path_param_snake_case_templated_with_args', async () => {
  // snake_case path params ({thing_id}) must be templated against the sanitised GraphQL arg name
  // ({$args.thingId}), not emitted raw — rover rejects a raw {thing_id} with INVALID_URL. runOasTest
  // composes, so a regression here fails composition. (Top coverage gap: COMPOSE-FAIL [INVALID_URL].)
  const schema = await runOasTest('path-param-snake.yaml', ['get:/things/{thing_id}/parts/{part_id}>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('GET: "/things/{$args.thingId}/parts/{$args.partId}"'), 'snake path params templated as $args');
  // raw snake params may remain in the descriptive comment, but never in the connect GET URL
  assert.ok(!/GET: "[^"]*\{thing_id\}/.test(schema!), 'raw snake path param must not survive in the GET URL');
});
