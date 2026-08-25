import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #159: --skip-arg-defaults writes a parameter's default, minimum, maximum, and allowed values
// as a "Params:" note on the operation, keeping the default out of the argument itself.
//   e.g. page_limit: { type: integer, default: 5, minimum: 1, maximum: 20 } ->
//   `pageLimit: Int` plus the description line "Params: pageLimit (default 5, min 1, max 20)"

const PATHS_SIZE = 2;

const LIST_ITEMS_PATH = 'get:/items>**';
const GET_ITEM_PATH = 'get:/items/{item_id}>**';

const run = (paths: string[], typesSize: number, opts: { skipArgDefaults?: boolean; keepFieldNames?: boolean } = {}) =>
  runOasTest('skip-arg-defaults.yaml', paths, PATHS_SIZE, typesSize, { skipValidation: true, ...opts });

test('test_159_disabled_by_default', async () => {
  // flag off: the default is written into the argument, exactly as before the flag existed
  const schema = await run([LIST_ITEMS_PATH], 1);
  assert.ok(schema!.includes('limit: Int = 20'), 'default still written into the argument');
  // "queryParams:" (the connector's own field, unrelated to this flag) also contains the text
  // "Params:", so the check below looks for the whole note instead of that one word
  assert.ok(!schema!.includes('Params: limit'), 'no note is added without the flag');
});

test('test_159_strips_defaults_and_adds_a_note', async () => {
  // flag on: arguments come out bare and the description gains the one-line note. sort shows
  // both its allowed values; region declares ten, so the note shows eight plus "(+2 more)"
  const schema = await run([LIST_ITEMS_PATH], 1, { skipArgDefaults: true });
  assert.ok(
    schema!.includes('items(limit: Int, pageSize: Int, sort: String, q: String, region: String, verbose: Boolean)'),
    'every argument kept, just without its default',
  );
  assert.ok(
    schema!.includes(
      'Params: limit (default 20, min 1, max 100), pageSize (default 10), ' +
        'sort (default asc, one of asc|desc), q (default ""), ' +
        'region (one of na|sa|eu|af|me|sas|eas|sea (+2 more))',
    ),
    'defaults, minimums, maximums, and allowed values written as a note instead',
  );
  assert.ok(
    !schema!.includes('verbose ('),
    'a parameter with no default, minimum, maximum, or allowed values stays out of the note',
  );
});

test('test_159_no_note_when_nothing_is_constrained', async () => {
  // get:/items/{item_id}'s only parameter is a bare `item_id: { type: string }`, so the
  // operation keeps its plain description with the flag on
  const schema = await run([GET_ITEM_PATH], 1, { skipArgDefaults: true });
  assert.ok(!schema!.includes('Params:'), 'an operation with only unconstrained parameters keeps its plain description');
});

test('test_159_note_uses_kept_spelling_with_158', async () => {
  // combined with --keep-field-names, the note names each parameter the same way the argument
  // itself is spelled: page_size, not pageSize
  const schema = await run([LIST_ITEMS_PATH], 1, { skipArgDefaults: true, keepFieldNames: true });
  assert.ok(schema!.includes('page_size (default 10)'), 'note uses the kept spelling');
  assert.ok(!schema!.includes('pageSize'), 'the camelCased spelling never appears once kept');
});

test('test_159_cli_flag_reaches_generator', () => {
  // spawnSync, not runOasTest: pins the Commander option declaration and the opts map in
  // src/cli/oas.ts, which runOasTest bypasses by calling OasGen directly
  const cli = spawnSync(
    'node',
    [
      '--import',
      'tsx/esm',
      'src/cli/oas.ts',
      'tests/resources/oas/skip-arg-defaults.yaml',
      '-i',
      '-n',
      '--skip-arg-defaults',
    ],
    { encoding: 'utf-8' },
  );
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.ok(!cli.stdout.includes('limit: Int = 20'), 'default no longer emitted through the CLI');
  assert.ok(
    cli.stdout.includes(
      'Params: limit (default 20, min 1, max 100), pageSize (default 10), ' +
        'sort (default asc, one of asc|desc), q (default ""), ' +
        'region (one of na|sa|eu|af|me|sas|eas|sea (+2 more))',
    ),
    'the flag reached the generator through the CLI',
  );
});
