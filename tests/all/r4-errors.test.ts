import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureErrors } from './_setup.js';

// --- R4 (baseline): @connect(errors: { extensions }) carrying $status, opt-in + v0.2-gated ---

test('test_R4_errors_emitted_for_numeric_codes_and_composes', async () => {
  // GET /widgets/{id} documents 404/500 -> with emitConnectorErrors on, the connector emits
  // errors: { extensions: """ statusCode: $status """ } and still composes (rover).
  const schema = await runOasTest('r4-errors.yaml', ['get:/widgets/{id}>**'], 3, 1, false, false, undefined, false, false, {
    emitConnectorErrors: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('errors: { extensions: """'), 'expected an errors.extensions block');
  assert.ok(schema!.includes('statusCode: $status'), 'expected statusCode: $status in extensions');
});

test('test_R4_errors_emitted_for_range_keys', async () => {
  // GET /gadgets documents OAS range keys 4XX/5XX (not concrete codes) -> must also opt in.
  const schema = await runOasTest('r4-errors.yaml', ['get:/gadgets>**'], 3, 1, false, false, undefined, false, false, {
    emitConnectorErrors: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('errors: { extensions: """'), 'range-key error responses must opt into errors');
});

test('test_R4_errors_off_by_default_is_unchanged', async () => {
  // Flag off (default): no errors block at all, even though the op documents 404/500.
  const schema = await runOasTest('r4-errors.yaml', ['get:/widgets/{id}>**'], 3, 1);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('errors: {'), 'default path must not emit errors');
});

test('test_R4_errors_not_emitted_when_no_error_responses', async () => {
  // GET /health documents only 200 -> never gets an errors block, even with the flag on.
  const schema = await runOasTest('r4-errors.yaml', ['get:/health>**'], 3, 1, false, false, undefined, false, false, {
    emitConnectorErrors: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('errors: {'), '200-only op must not emit errors');
});

test('test_R4_errors_below_v0_2_downgrades_with_warning', async () => {
  // errors is connect v0.2+. Opted-in but targeting v0.1 -> skip + a loud (logged) downgrade,
  // never silent-invalid output. The notice is routed through the project logger (console.error).
  let schema: string | undefined;
  const errors = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/r4-errors.yaml`, {
      skipValidation: false,
      consolidateUnions: true,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.1',
      emitConnectorErrors: true,
    });
    await gen.visit();
    schema = gen.generateSchema(['get:/widgets/{id}>**']);
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('errors: {'), 'must not emit errors below connect v0.2');
  assert.ok(
    errors.some((w) => /requires connect v0\.2/.test(w)),
    `expected a v0.2 downgrade warning, got: ${errors.join(' | ')}`,
  );
});
