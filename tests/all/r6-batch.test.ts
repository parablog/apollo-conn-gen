import { test } from 'node:test';
import fs from 'fs';
import assert from 'node:assert';
import { BatchConfig, OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureErrors } from './_setup.js';

// R6: a batch @connect is the R1 resolver with $batch in place of $this. Like R1, the batch
// endpoint is part of the selection (so it's expanded); the --batch file marks it as the batch
// endpoint, and applyBatchResolvers reads its node graph to wire the entity's batch resolver.
// Default v0.4 / fed 2.14, rover-composed. Product gets its R1 @key("id") from /products/{id}.

const PRODUCT = 'get:/products/{id}>**';

const run = (paths: string[], batch: BatchConfig, typesSize: number) =>
  runOasTest('r6-batch.yaml', paths, 9, typesSize, false, false, undefined, false, true, { batch });

test('test_R6_batch_query_array_emits_queryParams', async () => {
  // ?id=1&id=2 (exploded) -> queryParams: "id: $batch.id", no join
  const schema = await run([PRODUCT, 'get:/products>**'], { 'get:/products': {} }, 1);
  assert.ok(schema!.includes('id: $batch.id'), 'maps the query param to $batch');
  assert.ok(!schema!.includes('joinNotNull'), 'exploded array needs no join');
  assert.ok(schema!.includes('batch: { maxSize: 100 }'), 'default maxSize emitted');
});

test('test_R6_batch_comma_packed_query_array_joins', async () => {
  // explode:false -> "id: $batch.id->joinNotNull(",")"
  const schema = await run([PRODUCT, 'get:/products/search>**'], { 'get:/products/search': {} }, 1);
  assert.ok(schema!.includes('id: $batch.id->joinNotNull(",")'), 'non-exploded array is joined');
});

test('test_R6_batch_body_array_emits_body', async () => {
  // { "ids": [...] } -> body: "ids: $batch.id" (the batch op also emits its own input type)
  const schema = await run([PRODUCT, 'post:/products/batch>**'], { 'post:/products/batch': {} }, 2);
  assert.ok(schema!.includes('ids: $batch.id'), 'maps the body array to $batch');
});

test('test_R6_batch_wrapped_response_unwraps_selection', async () => {
  // { results: [...] } -> selection wraps as `$.results { … }`
  const schema = await run([PRODUCT, 'post:/products/lookup>**'], { 'post:/products/lookup': {} }, 3);
  assert.ok(schema!.includes('$.results {'), 'selection unwraps the results array');
});

test('test_R6_batch_maxSize_override', async () => {
  const schema = await run([PRODUCT, 'get:/products>**'], { 'get:/products': { maxSize: 50 } }, 1);
  assert.ok(schema!.includes('batch: { maxSize: 50 }'), 'file overrides maxSize');
});

test('test_R6_batch_coexists_with_single_this_resolver', async () => {
  const schema = await run([PRODUCT, 'post:/products/batch>**'], { 'post:/products/batch': {} }, 2);
  // one @key, the single $this resolver, and the batch resolver all on Product
  assert.ok((schema!.match(/@key\(fields: "id"\)/g) ?? []).length === 1, 'exactly one @key');
  assert.ok(schema!.includes('{$this.id}'), 'R1 single resolver still there');
  assert.ok(schema!.includes('$batch.id'), 'batch resolver added alongside');
});

test('test_R6_batch_petstore_findByNames', async () => {
  // the petstore, extended with GET /user/findByNames?username=a&username=b -> [User].
  // User already has R1 @key("username") from /user/{username}, so it batch-resolves by username.
  const schema = await runOasTest(
    'petstore-batch.yaml',
    ['get:/user/{username}>**', 'get:/user/findByNames>**'],
    20,
    1,
    false,
    true,
    undefined,
    false,
    true,
    { batch: { 'get:/user/findByNames': {} } },
  );
  assert.ok(schema!.includes('@key(fields: "username")'), 'User keeps its R1 @key');
  assert.ok(schema!.includes('http: { GET: "/user/findByNames"'), 'batch connector targets the batch endpoint');
  assert.ok(schema!.includes('username: $batch.username'), 'maps the query array to $batch.username');
  assert.ok(schema!.includes('batch: { maxSize: 100 }'), 'default maxSize emitted');
});

test('test_R6_16_batch_selection_keeps_key_plain', async () => {
  // #16: both entity connectors ($this and $batch) reuse Product's fields with the key `id` plain
  // and `name?` marked; the list op's own selection marks `id?` like any response field.
  const schema = await run([PRODUCT, 'get:/products>**'], { 'get:/products': {} }, 1);
  const plainKeyBlocks = (schema!.match(/"""\n      id\n      name\?/g) ?? []).length;
  assert.strictEqual(plainKeyBlocks, 2, 'the $this and the $batch selection both keep the key plain');
  assert.ok(schema!.includes('"""\n      id?\n      name?'), 'the list selection marks the same prop');
});

test('test_R6_16_composite_key_both_parts_plain', async () => {
  // #16 with a two-part key: `storeId` and `sku` both stay plain in the entity selection.
  const schema = await runOasTest(
    'r6-batch.yaml',
    ['get:/stores/{storeId}/items/{sku}>**'],
    9,
    1,
    false,
    false,
    undefined,
    false,
    true,
  );
  assert.ok(schema!.includes('@key(fields: "storeId sku")'), 'composite @key emitted');
  assert.ok(schema!.includes('name?\n      sku\n      storeId\n'), 'both key parts plain, the optional field marked');
});

// --- skips: every ambiguity warns and emits nothing, never guesses ---

async function expectSkip(paths: string[], batch: BatchConfig, why: RegExp, typesSize: number) {
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest('r6-batch.yaml', paths, 9, typesSize, false, false, undefined, false, true, { batch });
  });
  assert.ok(!schema!.includes('$batch'), 'no batch resolver emitted');
  assert.ok(warnings.some((w) => why.test(w)), `expected a "${why}" warning, got: ${warnings.join(' | ')}`);
}

test('test_R6_batch_skips_unselected_endpoint', async () => {
  // listed in --batch but not selected -> can't read it, skip with a clear message
  await expectSkip([PRODUCT], { 'get:/products': {} }, /selected paths/, 1);
});

test('test_R6_batch_skips_path_param_endpoint', async () => {
  await expectSkip([PRODUCT, 'post:/stores/{storeId}/products/batch>**'], { 'post:/stores/{storeId}/products/batch': {} }, /path params/, 2);
});

test('test_R6_batch_skips_ambiguous_inputs', async () => {
  await expectSkip([PRODUCT, 'post:/products/ambiguous>**'], { 'post:/products/ambiguous': {} }, /exactly one scalar-array input/, 2);
});

test('test_R6_batch_skips_composite_key', async () => {
  await expectSkip(
    ['get:/stores/{storeId}/items/{sku}>**', 'post:/store-items/batch>**'],
    { 'post:/store-items/batch': {} },
    /composite keys/,
    2,
  );
});

test('test_R6_batch_skips_unknown_op', async () => {
  await expectSkip([PRODUCT], { 'post:/nope': {} }, /no matching operation/, 1);
});

test('test_R6_batch_skips_when_no_r1_key', async () => {
  // infer off -> Product has no @key, so a batch resolver can't reuse one
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest('r6-batch.yaml', [PRODUCT, 'post:/products/batch>**'], 9, 2, false, false, undefined, false, false, {
      batch: { 'post:/products/batch': {} },
    });
  });
  assert.ok(!schema!.includes('$batch'), 'no batch resolver without an R1 key');
  assert.ok(warnings.some((w) => /no @key/.test(w)), `expected a "no @key" warning, got: ${warnings.join(' | ')}`);
});

// (removed test_R6_batch_below_v0_2_downgrades: the v0.2 batch gate is unreachable now that the connector
// spec is floored at v0.4 — connect < v0.4 is rejected at the entrypoint, covered by versions.test.ts.)

test('test_R6_batch_file_from_disk_applies', async () => {
  // the checked-in example file is the one the CLI would load with
  // `--batch tests/resources/oas/r6-batch.json` — reading it here keeps it working
  const config = JSON.parse(fs.readFileSync(`${oasBasePath}/r6-batch.json`, 'utf-8'));
  const schema = await run([PRODUCT, 'get:/products>**', 'post:/products/batch>**'], config, 2);
  assert.ok(schema!.includes('batch: { maxSize: 50 }'), 'file overrides maxSize');
  assert.ok(schema!.includes('ids: $batch.id'), 'body batch endpoint wired');
});
