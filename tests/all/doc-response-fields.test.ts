import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #160: --doc-response-fields adds the top-level field names of an operation's response to its
// description, as a "Returns:" line, so a reader can see what a request actually hands back
// without making the request first. Two response shapes are covered here: a single object
// ("Returns: ...") and a list of objects ("Returns a list of items with: ...").

const PATHS_SIZE = 3;

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
