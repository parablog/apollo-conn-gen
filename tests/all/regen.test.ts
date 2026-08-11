import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath } from '../../src/tests/runners.js';
import './_setup.js';

// #71: generating on an instance that already generated (or was browsed) must produce the same
// schema a fresh instance produces. No rover — these compare generator output strings only.

const opts = { skipValidation: true, showParentInSelections: false };
const DEPLOYMENTS = 'get:/v2/apps/{app_id}/deployments>**';

async function freshGen(file: string): Promise<OasGen> {
  const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, opts);
  await gen.visit();
  return gen;
}

test('test_71_regeneration_is_isolated', async () => {
  const gen = await freshGen('digitalocean.yaml');
  const pathsBefore = gen.paths;
  const contextBefore = gen.context;

  // the issue's repro: three /v2/apps ops first, then the op whose names used to drift
  for (const op of ['get:/v2/apps', 'get:/v2/apps/{app_id}/alerts', 'get:/v2/apps/{app_id}/components/{component_name}/logs']) {
    gen.generateSchema([`${op}>**`]);
  }
  const reused = gen.generateSchema([DEPLOYMENTS]);

  const fresh = await freshGen('digitalocean.yaml');
  const pristine = fresh.generateSchema([DEPLOYMENTS]);

  assert.strictEqual(reused, pristine, 'fourth generation must match a fresh instance byte-for-byte');
  assert.ok(pristine.includes('type ActiveDeployment'), 'the un-renamed name is the right one');
  assert.ok(!reused.includes('Inlinev2AppsDeploymentsResponseActiveDeployment'), 'the drifted rename is gone');
  assert.strictEqual(gen.paths, pathsBefore, 'the tree keeps its path nodes (the web holds them)');
  assert.strictEqual(gen.context, contextBefore, 'and it keeps its context');
});

test('test_71_shared_parser_matches_fresh_parse', async () => {
  // A rebuild reads the parser document that earlier visits rewrote in place (#55 and friends);
  // those rewrites must not change a second reader's output.
  const gen = await freshGen('digitalocean.yaml');
  gen.generateSchema([DEPLOYMENTS]);

  const shared = new OasGen(gen.parser, gen.options);
  await shared.visit();
  const rebuilt = shared.generateSchema([DEPLOYMENTS]);

  const fresh = await freshGen('digitalocean.yaml');
  assert.strictEqual(rebuilt, fresh.generateSchema([DEPLOYMENTS]), 'a shared parser generates what a fresh parse does');
});

test('test_71_parser_document_reaches_a_fixpoint', async () => {
  // the exact property the rebuild depends on: generating again rewrites nothing further
  const gen = await freshGen('digitalocean.yaml');
  gen.generateSchema([DEPLOYMENTS]);
  const afterFirst = structuredClone(gen.parser.getDefinition());
  gen.generateSchema([DEPLOYMENTS]);
  assert.deepStrictEqual(gen.parser.getDefinition(), afterFirst, 'a second generation must not rewrite the document');
});

test('test_71_failed_generation_restores_tree_state', async () => {
  const gen = await freshGen('petstore.yaml');
  const pathsBefore = gen.paths;
  const contextBefore = gen.context;

  assert.throws(() => gen.generateSchema(['get:/nope>**']), /Could not find type/);
  assert.strictEqual(gen.paths, pathsBefore, 'a throw inside the run must restore the tree path nodes');
  assert.strictEqual(gen.context, contextBefore, 'and the context');

  const after = gen.generateSchema(['get:/pet/{petId}>**']);
  const fresh = await freshGen('petstore.yaml');
  assert.strictEqual(after, fresh.generateSchema(['get:/pet/{petId}>**']), 'the next generation is unharmed');
});

test('test_71_same_selection_is_idempotent', async () => {
  const gen = await freshGen('petstore.yaml');
  const a1 = gen.generateSchema(['get:/pet/{petId}>**']);
  const b = gen.generateSchema(['get:/pet/findByStatus>**']);
  const a2 = gen.generateSchema(['get:/pet/{petId}>**']);
  assert.strictEqual(a1, a2, 'A, B, A: both A outputs identical');
  assert.strictEqual(b, gen.generateSchema(['get:/pet/findByStatus>**']), 'and B repeats too');
});
