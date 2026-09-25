import { spawnSync } from 'child_process';
import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #170: --note-partial-pages notes on every paginated operation that a full page is not necessarily
// the last page. Without the note, a page-sized response reads as the complete result set and a
// reader silently accepts truncated data. An operation counts as paginated when any parameter's
// name carries a "page" token (page_index, pageLimit, per_page, ...) or is exactly "cursor" or
// "offset" — the signature can show the parameters, but not what a full page means.

const NOTE = 'Returns one page of results; a full page is not necessarily the last page.';
const PATHS = ['get:/items', 'get:/events', 'get:/pages', 'get:/items/{item_id}'];

const run = (opts: { notePartialPages?: boolean; noteResponseFields?: boolean } = {}) =>
  runOasTest('doc-pagination.yaml', PATHS, 4, 1, { skipValidation: true, keepFieldNames: true, ...opts });

test('test_170_disabled_by_default', async () => {
  const schema = await run();
  assert.ok(!schema!.includes(NOTE), 'no pagination note without the flag');
});

test('test_170_page_params_gain_the_note', async () => {
  const schema = await run({ notePartialPages: true });
  // get:/items paginates via page_index/page_limit
  const items = schema!.slice(schema!.indexOf('List items'), schema!.indexOf('listItems'));
  assert.ok(items.includes(NOTE), 'page_index/page_limit op carries the note');
  // get:/events paginates via cursor
  const events = schema!.slice(schema!.indexOf('List events'), schema!.indexOf('listEvents'));
  assert.ok(events.includes(NOTE), 'cursor op carries the note');
});

test('test_170_non_paginated_ops_stay_silent', async () => {
  const schema = await run({ notePartialPages: true });
  // get:/pages has no pagination parameters — "pages" in the name alone must not trigger
  const pages = schema!.slice(schema!.indexOf('List pages of the document'), schema!.indexOf('listPages'));
  assert.ok(!pages.includes(NOTE), 'an op merely named "pages" does not get the note');
  const byId = schema!.slice(schema!.indexOf('Get an item'), schema!.indexOf('getItem'));
  assert.ok(!byId.includes(NOTE), 'a by-id op does not get the note');
});

test('test_170_rides_the_returns_paragraph', async () => {
  // with --note-response-fields on, the note completes the "Returns a list of items with:"
  // paragraph instead of opening its own
  const schema = await run({ notePartialPages: true, noteResponseFields: true });
  assert.ok(
    schema!.includes(`item_id, name\n  ${NOTE}`),
    'note sits on the line after the Returns line, same paragraph',
  );
});

test('test_170_old_switch_name_still_works', () => {
  // Checks the old --doc-pagination still turns the note on, through the CLI, and names the new switch
  const cli = spawnSync(
    'node',
    ['--import', 'tsx/esm', 'src/cli/oas.ts', 'tests/resources/oas/doc-pagination.yaml', '-i', '-n', '--doc-pagination'],
    { encoding: 'utf-8' },
  );
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.ok(cli.stdout.includes(NOTE), 'sets notePartialPages');
  assert.ok(cli.stderr.includes('--doc-pagination is now --note-partial-pages'), 'warns with the new name');
});
