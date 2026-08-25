import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #160: --doc-response-fields adds the top-level field names of an operation's response to its
// description, as a "Returns:" line, so a reader can see what a request actually hands back
// without making the request first. Two response shapes are covered here: a single object
// ("Returns: ...") and a list of objects ("Returns a list of items with: ...").

const PATHS_SIZE = 7;

const LIST_ITEMS_PATHS = [
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:created_at',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:id',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:name',
];

const GET_ITEM_PATHS = [
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:created_at',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:id',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:name',
];

const WIDE_FIELDS = Array.from({ length: 16 }, (_, i) => `field${String(i + 1).padStart(2, '0')}`);
const WIDE_PATHS = WIDE_FIELDS.map((f) => `get:/wide>res:r>obj:type:#/c/s/WideThing>prop:scalar:${f}`);

// each mutation op paired with the description heading its "Returns:" line sits under
const MUTATION_OPS = [
  ['post:/items', 'Create an item (/items)'],
  ['put:/items/{item_id}', 'Update an item (/items/{item_id})'],
  ['patch:/items/{item_id}', 'Patch an item (/items/{item_id})'],
  ['del:/items/{item_id}', 'Delete an item (/items/{item_id})'],
] as const;

const MUTATION_PATHS = MUTATION_OPS.flatMap(([op]) =>
  ['created_at', 'id', 'name'].map((f) => `${op}>res:r>obj:type:#/c/s/Item>prop:scalar:${f}`),
);

const run = (paths: string[], opts: { docResponseFields?: boolean; keepFieldNames?: boolean } = {}) =>
  runOasTest('doc-response-fields.yaml', paths, PATHS_SIZE, 1, { skipValidation: true, ...opts });

test('test_160_disabled_by_default', async () => {
  // flag off: no "Returns:" line at all, regardless of response shape
  const schema = await run(LIST_ITEMS_PATHS);
  assert.ok(!schema!.includes('Returns'), 'no Returns: note without the flag');
});

test('test_160_object_response', async () => {
  // a single-object response gets a bare "Returns:" line (no "a list of items with")
  const schema = await run(GET_ITEM_PATHS, { docResponseFields: true });
  assert.ok(
    schema!.includes('"""\n  Get an item by id (/items/{item_id})\n\n  Returns: createdAt, id, name\n  """'),
    'a single-object response gets a bare "Returns:" line',
  );
});

test('test_160_array_response', async () => {
  // an array-of-objects response gets the "Returns a list of items with:" wording
  const schema = await run(LIST_ITEMS_PATHS, { docResponseFields: true });
  assert.ok(
    schema!.includes('"""\n  List items (/items)\n\n  Returns a list of items with: createdAt, id, name\n  """'),
    'an array-of-objects response gets the "Returns a list of items with:" wording',
  );
});

test('test_160_caps_at_14_fields', async () => {
  // 16 fields: first 14 shown, then "(+2 more)"
  const schema = await run(WIDE_PATHS, { docResponseFields: true });
  assert.ok(
    schema!.includes(
      'Returns: field01, field02, field03, field04, field05, field06, field07, field08, field09, field10, ' +
        'field11, field12, field13, field14 (+2 more)',
    ),
    'the field list caps at 14 names, then "(+N more)"',
  );
});

test('test_160_uses_kept_spelling_with_158', async () => {
  // combined with --keep-field-names, the note names each field the same way the generated
  // type spells it: created_at, not createdAt
  const schema = await run(GET_ITEM_PATHS, { docResponseFields: true, keepFieldNames: true });
  assert.ok(schema!.includes('Returns: created_at, id, name'), 'note uses the kept spelling');
  assert.ok(!schema!.includes('createdAt'), 'the camelCased spelling never appears once kept');
});

test('test_160_mutation_verbs', async () => {
  // put, patch and delete run Post's generate (put.ts/patch.ts/delete.ts extend post.ts), so every
  // mutation verb writes the same "Returns:" line a query gets. see docs/FIXED.md #160
  //   e.g. (doc-response-fields.yaml) put:/items/{item_id} answers one Item
  //   -> "Update an item (/items/{item_id})" gains "Returns: createdAt, id, name"
  const schema = await run(MUTATION_PATHS, { docResponseFields: true });
  for (const [op, heading] of MUTATION_OPS) {
    assert.ok(
      schema!.includes(`"""\n  ${heading}\n\n  Returns: createdAt, id, name\n  """`),
      `${op} gets a "Returns:" line`,
    );
  }
});

test('test_160_cli_flag_reaches_generator', () => {
  // spawnSync, not runOasTest: pins the Commander option declaration and the opts map in
  // src/cli/oas.ts, which runOasTest bypasses by calling OasGen directly
  const cli = spawnSync(
    'node',
    ['--import', 'tsx/esm', 'src/cli/oas.ts', 'tests/resources/oas/doc-response-fields.yaml', '-i', '-n', '--doc-response-fields'],
    { encoding: 'utf-8' },
  );
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.ok(
    cli.stdout.includes('Returns a list of items with: createdAt, id, name'),
    'the flag reached the generator through the CLI',
  );
});
