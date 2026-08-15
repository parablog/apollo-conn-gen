import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureErrors } from './_setup.js';

// --- R4 (baseline): @connect(errors: { extensions }) carrying $status, opt-in + v0.2-gated ---

test('test_R4_errors_emitted_for_numeric_codes_and_composes', async () => {
  // GET /widgets/{id} documents 404/500 -> with emitConnectorErrors on, the connector emits
  // errors: { extensions: """ statusCode: $status """ } and still composes (rover).
  const schema = await runOasTest('r4-errors.yaml', ['get:/widgets/{id}>**'], 5, 1, { emitConnectorErrors: true });
  assert.ok(schema !== undefined);
  // the Error schema documents `message: string` -> it becomes the GraphQL error message.
  // pin the exact (indented) block so the layout can't silently regress again.
  assert.ok(
    schema!.includes(
      '      errors: {\n' +
        '        message: "$.message"\n' +
        '        extensions: """\n' +
        '        statusCode: $status\n' +
        '        """\n' +
        '      }\n',
    ),
    'expected the fully-expanded errors block with message',
  );
});

test('test_R4_errors_emitted_for_range_keys', async () => {
  // GET /gadgets documents OAS range keys 4XX/5XX (not concrete codes) -> must also opt in.
  const schema = await runOasTest('r4-errors.yaml', ['get:/gadgets>**'], 5, 1, { emitConnectorErrors: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('errors: {'), 'range-key errors must opt in too');
  assert.ok(schema!.includes('message: "$.message"'), 'range-key errors carry the message field');
});

test('test_R4_errors_off_by_default_is_unchanged', async () => {
  // Flag off (default): no errors block at all, even though the op documents 404/500.
  const schema = await runOasTest('r4-errors.yaml', ['get:/widgets/{id}>**'], 5, 1);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('errors: {'), 'default path must not emit errors');
});

test('test_R4_errors_not_emitted_when_no_error_responses', async () => {
  // GET /health documents only 200 -> never gets an errors block, even with the flag on.
  const schema = await runOasTest('r4-errors.yaml', ['get:/health>**'], 5, 1, { emitConnectorErrors: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('errors: {'), '200-only op must not emit errors');
});

test('test_R4_errors_message_falls_back_to_error_field', async () => {
  // /legacy's error shapes document only `error: string` -> message falls back to it
  const schema = await runOasTest('r4-errors.yaml', ['get:/legacy>**'], 5, 1, { emitConnectorErrors: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('message: "$.error"'), 'falls back to the error field');
});

test('test_R4_errors_message_omitted_when_shapes_disagree', async () => {
  // /mixed: 404 has `message`, 500 only `code` -> no field common to all shapes, no message
  const schema = await runOasTest('r4-errors.yaml', ['get:/mixed>**'], 5, 1, { emitConnectorErrors: true });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes(
      '      errors: {\n' + '        extensions: """\n' + '        statusCode: $status\n' + '        """\n' + '      }\n',
    ),
    'extensions still emitted, without a message line',
  );
  assert.ok(!schema!.includes('message:'), 'no message when the shapes disagree');
});

// (removed test_R4_errors_below_v0_2_downgrades_with_warning: the v0.2 errors gate is unreachable now
// that the connector spec is floored at v0.4 — connect < v0.4 is rejected at the entrypoint, covered by
// versions.test.ts test_066/069.)
