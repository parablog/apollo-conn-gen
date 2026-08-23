import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import { captureErrors } from './_setup.js';

// #151: --sparse-fieldsets-param names a REST query param (e.g. "fields") that only returns a
// vendor's narrow default set of fields when omitted. applySparseFieldsets gives every read op
// declaring that param a default listing every field its selection maps, so an omitted argument
// still asks for everything the selection needs.

const PARAM = 'fields';
const PATHS_SIZE = 7;

const run = (paths: string[], typesSize: number, sparseFieldsetsParam?: string) =>
  runOasTest('sparse-fieldsets.yaml', paths, PATHS_SIZE, typesSize, { sparseFieldsetsParam });

test('test_151_get_default_lists_selection_fields', async () => {
  // GET /products/{id} -> Product { id, name, price }, sorted and comma-joined
  const schema = await run(['get:/products/{id}>**'], 1, PARAM);
  assert.ok(schema!.includes('fields: String = "id,name,price"'), 'default lists every selected field');
});

test('test_151_list_default_uses_wrapper_item_fields', async () => {
  // GET /products -> { results: [Product], total } — the default comes from Product, not the wrapper
  const schema = await run(['get:/products>**'], 2, PARAM);
  assert.ok(schema!.includes('fields: String = "id,name,price"'), 'default reads the wrapped item type');
});

test('test_151_disabled_by_default', async () => {
  // no --sparse-fieldsets-param given -> byte-parity with plain param pass-through
  const schema = await run(['get:/products/{id}>**'], 1);
  assert.ok(!schema!.includes('fields: String ='), 'no default emitted when the flag is off');
  assert.ok(schema!.includes('fields: String'), 'the plain param is still there, just without a default');
});

test('test_151_no_matching_param_is_noop', async () => {
  // GET /categories/{id} declares no `fields` param at all
  const schema = await run(['get:/categories/{id}>**'], 1, PARAM);
  assert.ok(!schema!.includes('fields:'), 'unaffected — there is no fields param to default');
});

test('test_151_unmappable_response_warns_and_skips', async () => {
  // GET /products/{id}/price returns a bare number — no fields to list
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await run(['get:/products/{id}/price>**'], 0, PARAM);
  });
  assert.ok(!schema!.includes('fields: String ='), 'no default added');
  assert.ok(
    warnings.some((w) => /response is not an object/.test(w)),
    `expected a "response is not an object" warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_151_array_param_warns_and_skips', async () => {
  // GET /products/search declares `fields` as an array (?fields=a&fields=b) -> [String], no
  // comma-string default syntax to write
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await run(['get:/products/search>**'], 1, PARAM);
  });
  assert.ok(!schema!.includes('[String] = '), 'array param is left without a default');
  assert.ok(
    warnings.some((w) => /is not a plain string parameter/.test(w)),
    `expected a "not a plain string parameter" warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_151_explicit_default_is_not_overridden', async () => {
  // GET /products/{id}/details already declares `fields: { default: id }` in the OAS
  const schema = await run(['get:/products/{id}/details>**'], 1, PARAM);
  assert.ok(schema!.includes('fields: String = "id"'), 'the authored default is kept verbatim');
  assert.ok(!schema!.includes('fields: String = "id,name,price"'), 'not replaced by the computed field list');
});

test('test_151_mutation_op_is_ineligible', async () => {
  // POST /products shares the `fields` param name with the GET, but writes never qualify
  const schema = await run(['post:/products>**'], 2, PARAM);
  assert.ok(!schema!.includes('fields: String ='), 'no default synthesized for a write op');
});
