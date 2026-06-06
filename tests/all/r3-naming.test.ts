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
