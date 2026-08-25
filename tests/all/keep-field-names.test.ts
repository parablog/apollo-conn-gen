import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #158: --keep-field-names writes a spec field/param spelling verbatim (no camelCasing, no
// selection alias) when it already reads safely both as a GraphQL name and as a bare
// JSONSelection key. Everything else, and every output with the flag off, stays unchanged.

const PATHS_SIZE = 3;

// GET /items — owner_id/created_at/item_id are safe to keep; content-type/__meta/null_sort are
// not; parent_item is a self-reference that gets cut and commented out (docs/FIXED.md #10).
const ITEMS_LIST_PATHS = [
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:__meta',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:content-type',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:created_at',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:item_id',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:null_sort',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:scalar:owner_id',
  'get:/items>res:r>array:#/c/s/Item>obj:type:#/c/s/Item>prop:circular-ref:#parent_item',
];

// GET /items/{item_id} — same fields, one item at a time; item_id's path param exactly matches
// its field name, so it qualifies as an entity resolver key when inferEntityResolvers is on.
const ITEM_BY_ID_PATHS = [
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:__meta',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:content-type',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:created_at',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:item_id',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:null_sort',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:scalar:owner_id',
  'get:/items/{item_id}>res:r>obj:type:#/c/s/Item>prop:circular-ref:#parent_item',
];

// GET /labels/{labelName} — the path token is camelCase, but the declared parameter is
// label_name; a keepable spelling on its own, but keeping it here would desync the SDL
// argument from the {$args…} path template (docs/FIXED.md #158).
const LABEL_PATHS = ['get:/labels/{labelName}>res:r>obj:type:#/c/s/Label>prop:scalar:label_name'];

// skipValidation: the /labels/{labelName} op declares its parameter as `label_name`, which the
// strict OAS validator rejects as not matching the `{labelName}` path token — the same shape as
// the existing path-param-mismatch.yaml fixture (docs/FIXED.md #81).
const run = (
  paths: string[],
  typesSize: number,
  opts: { keepFieldNames?: boolean; inferEntityResolvers?: boolean } = {},
) => runOasTest('keep-field-names.yaml', paths, PATHS_SIZE, typesSize, { skipValidation: true, ...opts });

test('test_158_disabled_by_default', async () => {
  // no --keep-field-names: every field/arg still camelCases and aliases, same as before #158
  const schema = await run(ITEMS_LIST_PATHS, 1);
  assert.ok(schema!.includes('ownerId: String'), 'field camelCased in the SDL');
  assert.ok(schema!.includes('ownerId: owner_id'), 'selection aliases back to the wire key');
  assert.ok(schema!.includes('items(pageSize: Int)'), 'query arg camelCased');
});

test('test_158_keeps_valid_spellings', async () => {
  // --keep-field-names on: a spelling that is already safe as both a GraphQL name and a bare
  // selection key is written verbatim, with no alias
  const schema = await run(ITEMS_LIST_PATHS, 1, { keepFieldNames: true });
  assert.ok(schema!.includes('owner_id: String'), 'field kept verbatim in the SDL');
  assert.ok(!schema!.includes('ownerId'), 'the camelCased spelling never appears');
  assert.ok(schema!.includes('items(page_size: Int)'), 'query arg kept verbatim');
  assert.ok(schema!.includes('"page_size": page_size'), 'queryParams value kept verbatim too');
});

test('test_158_unkeepable_names_rename_as_today', async () => {
  // a spelling that is NOT safe both ways still camelCases and aliases exactly like the flag
  // off — pins the narrower guard against a looser one that would keep null_sort bare and break
  // it, since it would then read as the literal `null` (docs/FIXED.md #82)
  const schema = await run(ITEMS_LIST_PATHS, 1, { keepFieldNames: true });
  assert.ok(schema!.includes('contentType: $."content-type"'), 'not a plain identifier, still aliased');
  assert.ok(schema!.includes('meta: __meta'), 'GraphQL-reserved "__" prefix, still aliased');
  assert.ok(schema!.includes('nullSort: $."null_sort"'), 'reads as the literal null, still aliased');
});

test('test_158_entity_and_path_outputs', async () => {
  // the flag reaches every other writer that spells a field: the entity key, the type-level
  // resolver's $this template, the Query field's $args template, and the circular-reference
  // comment
  const schema = await run(ITEM_BY_ID_PATHS, 1, { keepFieldNames: true, inferEntityResolvers: true });
  assert.ok(schema!.includes('@key(fields: "item_id")'), 'entity key kept verbatim');
  assert.ok(schema!.includes('http: { GET: "/items/{$this.item_id}" }'), 'entity resolver $this kept verbatim');
  assert.ok(schema!.includes('http: { GET: "/items/{$args.item_id}"}'), 'query field $args kept verbatim');
  assert.ok(
    schema!.includes('# parent_item: Item - circular reference omitted'),
    'circular field comment kept verbatim',
  );
});

test('test_158_path_param_spelling_mismatch', async () => {
  // the SDL argument and the {$args…} path template must agree on one spelling — renaming the
  // param to its path token (as the flag-off #81 fix already does) is what keeps them in sync
  const schema = await run(LABEL_PATHS, 1, { keepFieldNames: true });
  assert.ok(
    schema!.includes('labelsByLabelName(labelName: String!): Label'),
    'SDL argument uses the path token spelling',
  );
  assert.ok(schema!.includes('http: { GET: "/labels/{$args.labelName}"}'), 'path template uses the same spelling');
});

test('test_158_cli_flag_reaches_generator', () => {
  // spawnSync, not runOasTest: pins the Commander option declaration and the opts map in
  // src/cli/oas.ts, which runOasTest bypasses by calling OasGen directly
  const cli = spawnSync(
    'node',
    [
      '--import',
      'tsx/esm',
      'src/cli/oas.ts',
      'tests/resources/oas/keep-field-names.yaml',
      '-i',
      '-n',
      '--keep-field-names',
    ],
    { encoding: 'utf-8' },
  );
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.ok(cli.stdout.includes('owner_id: String'), 'the flag reached the generator through the CLI');
  assert.ok(!cli.stdout.includes('ownerId'), 'the camelCased spelling never appears');
});
