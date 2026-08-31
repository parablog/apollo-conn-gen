import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// GraphQL Int is spec-defined as signed 32-bit. An OpenAPI integer that declares format: int64,
// or whose minimum/maximum/exclusive bounds exceed Int32 range, cannot round-trip through Int:
// the router fails to parse out-of-range argument literals and cannot return out-of-range values.
// Such integers widen to String. Response selections must then coerce the upstream JSON number
// with ->jsonStringify or the field resolves null under the String type; input/body mappings are
// left alone. Fields short-circuited to ID are excluded — ID already accepts numeric JSON values.

const PATHS = ['get:/cards', 'post:/cards'];

const run = (opts: { keepFieldNames?: boolean } = {}) =>
  runOasTest('int64-widening.yaml', PATHS, 2, 2, { skipValidation: true, ...opts });

test('test_widens_and_coerces_response_fields', async () => {
  const schema = await run({ keepFieldNames: true });
  // card_number has no format, but its declared maximum exceeds Int32 — bounds alone widen it
  assert.ok(schema!.includes('card_number: String'), 'out-of-Int32-bounds integer widens to String');
  // card_number is optional in Card, so the coercion carries the `?` optional marker
  assert.ok(
    schema!.includes('card_number: card_number->jsonStringify?'),
    'widened response field coerces the upstream JSON number',
  );
  // cvv_number's bounds fit in Int32: untouched
  assert.ok(schema!.includes('cvv_number: Int'), 'in-range integer stays Int');
  assert.ok(!schema!.includes('cvv_number->jsonStringify'), 'in-range integer is not coerced');
});

test('test_id_fields_are_exempt', async () => {
  const schema = await run({ keepFieldNames: true });
  // `id` is format: int64 but the id-name short-circuit maps it to ID, which accepts numbers
  assert.ok(schema!.includes('id: ID'), 'id-named field keeps the ID type');
  assert.ok(!schema!.includes('id->jsonStringify'), 'ID field is not coerced');
});

test('test_input_side_widens_without_coercion', async () => {
  const schema = await run({ keepFieldNames: true });
  // the create body's card_number is format: int64 — the input field widens too...
  assert.ok(schema!.includes('card_number: String!'), 'required int64 input widens to String!');
  // ...but the body mapping must pass the value through untouched
  const body = schema!.match(/body: """([\s\S]*?)"""/)?.[1] ?? '';
  assert.ok(body.includes('card_number'), 'body mapping still sends the field');
  assert.ok(!body.includes('jsonStringify'), 'body mapping is not coerced');
});

test('test_coercion_composes_with_camelcase_alias', async () => {
  // default mode (no --keep-field-names): the selection already aliases back to the wire key,
  // and the coercion appends to that alias instead of duplicating it
  const schema = await run();
  assert.ok(schema!.includes('cardNumber: String'), 'widened field still camelCases');
  assert.ok(schema!.includes('cardNumber: card_number->jsonStringify'), 'coercion appends to the existing alias');
});
