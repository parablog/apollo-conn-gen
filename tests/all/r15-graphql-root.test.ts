import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureWarnings } from './_setup.js';

// docs/FIXED.md #150: normally a GraphQL field is written under "type Query" when its HTTP method is GET, and
// under "type Mutation" for anything else. Setting `root` on an operation's entry in the
// overrides file moves it to the named side instead, regardless of its HTTP method. The HTTP
// request itself (the @connect block's verb, path, body) is unaffected — only where the field
// is written changes.
// Fixture ops: get:/items/{id} (baseline, no override), post:/items/search (reads data via a
// search body, forced to query), get:/legacy/purge (deletes something via GET, forced to
// mutation), head:/items/{id} (unsupported method, generates no field either way).

const ALL_PATHS = ['get:/items/{id}>**', 'post:/items/search>**', 'get:/legacy/purge>**'];

// The text of one root type block (e.g. everything between "type Query {" and its closing "}"),
// so a test can check which fields landed on which side without a field elsewhere in the schema
// (like the same name inside "type Mutation") accidentally matching too.
function rootBlock(schema: string, rootName: 'Query' | 'Mutation'): string {
  return new RegExp(`type ${rootName} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? '';
}

test('test_150_root_override_moves_a_post_under_query', async () => {
  const schema = await runOasTest('r15-graphql-root.yaml', ALL_PATHS, 3, 3, {
    skipValidation: true,
    overrides: { 'post:/items/search': { root: 'query' } },
  });
  assert.ok(rootBlock(schema!, 'Query').includes('createItemsSearch'), 'searchItems is written under Query');
  assert.ok(!rootBlock(schema!, 'Mutation').includes('createItemsSearch'), 'searchItems is not also under Mutation');
  // the HTTP request itself is untouched: still a POST, still to the same path
  assert.ok(schema!.includes('POST: "/items/search"'), 'the @connect verb stays POST');
});

test('test_150_root_override_moves_a_get_under_mutation', async () => {
  const schema = await runOasTest('r15-graphql-root.yaml', ALL_PATHS, 3, 3, {
    skipValidation: true,
    overrides: { 'get:/legacy/purge': { root: 'mutation' } },
    directives: { 'Mutation.*': ['@tag(name: "require-approval")'] },
  });
  assert.ok(rootBlock(schema!, 'Mutation').includes('legacyPurge'), 'legacyPurge is written under Mutation');
  assert.ok(!rootBlock(schema!, 'Query').includes('legacyPurge'), 'legacyPurge is not also under Query');
  // the HTTP request itself is untouched: still a GET
  assert.ok(schema!.includes('GET: "/legacy/purge"'), 'the @connect verb stays GET');
  // a `Mutation.*` selector, applied after generation, reaches a field moved there by root
  assert.ok(
    schema!.includes('legacyPurge: PurgeResult @tag(name: "require-approval")'),
    'the Mutation.* directive selector applies to the moved field',
  );
});

test('test_150_baseline_and_unsupported_method_are_unaffected', async () => {
  const schema = await runOasTest('r15-graphql-root.yaml', ALL_PATHS, 3, 3, {
    skipValidation: true,
    overrides: { 'post:/items/search': { root: 'query' } },
  });
  // the plain GET with no override keeps behaving exactly as it always has
  assert.ok(rootBlock(schema!, 'Query').includes('itemsById'), 'the untouched GET stays under Query');
  // HEAD is not GET/POST/PUT/PATCH/DELETE, so it never generates a field under either root —
  // proving root/query classification didn't quietly widen past GET
  assert.ok(!schema!.includes('headItem'), 'the unsupported HEAD method emits no field');
});

test('test_150_unknown_op_id_root_warns_not_throws', async () => {
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('r15-graphql-root.yaml', ALL_PATHS, 3, 3, {
      skipValidation: true,
      overrides: { 'get:/nope': { root: 'query' } },
    });
  });
  assert.ok(schema !== undefined, 'generation still succeeds');
  assert.ok(
    warnings.some((w) => /no operation matches "get:\/nope"/.test(w)),
    `expected an "override ignored" warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_150_invalid_root_value_throws', async () => {
  const gen = await OasGen.fromFile(`${oasBasePath}/r15-graphql-root.yaml`, {
    skipValidation: true,
    showParentInSelections: false,
    overrides: { 'post:/items/search': { root: 'Mutation' as 'mutation' } },
  });
  await gen.visit();
  assert.throws(
    () => gen.generateSchema(['post:/items/search>**']),
    /"post:\/items\/search"\.root must be "query" or "mutation"/,
  );
});

test('test_150_every_selected_op_forced_to_mutation', async () => {
  // forcing every selected op onto Mutation (including the last GET) is not an error — the
  // acceptance criteria's own example of correct behavior, same as a spec that is naturally
  // all-mutation
  const schema = await runOasTest('r15-graphql-root.yaml', ALL_PATHS, 3, 3, {
    skipValidation: true,
    overrides: {
      'get:/items/{id}': { root: 'mutation' },
      'post:/items/search': { root: 'mutation' },
      'get:/legacy/purge': { root: 'mutation' },
    },
  });
  assert.ok(!schema!.includes('type Query {'), 'no Query root is written at all');
  const mutationBlock = rootBlock(schema!, 'Mutation');
  for (const field of ['itemsById', 'createItemsSearch', 'legacyPurge']) {
    assert.ok(mutationBlock.includes(field), `${field} is under Mutation`);
  }
});

// docs/FIXED.md #225: a "$match" entry in the overrides file applies to every operation whose key matches its pattern;
// an exact entry for the same operation wins field by field. Fixture ops are described in overrides-match.yaml.

const MATCH_PATHS = [
  'get:/widgets/{id}>**',
  'post:/widgets.list>**',
  'post:/widgets.create>**',
  'post:/widgets.purgeAll>**',
  'get:/widgets.export>**',
];

test('test_225_match_entry_moves_matching_operations', async () => {
  const schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, {
    skipValidation: true,
    overrides: {
      $match: [{ pattern: '^post:/widgets\\.(list|purgeAll)$', root: 'query' }],
      'post:/widgets.purgeAll': { root: 'mutation' },
    },
  });
  const queryBlock = rootBlock(schema!, 'Query');
  const mutationBlock = rootBlock(schema!, 'Mutation');
  assert.ok(queryBlock.includes('createWidgetsList'), 'the pattern moves widgets.list to Query');
  assert.ok(
    mutationBlock.includes('createWidgetsCreate'),
    'widgets.create is untouched by the pattern, stays Mutation',
  );
  assert.ok(
    mutationBlock.includes('createWidgetsPurgeAll'),
    'the exact entry wins over the pattern for widgets.purgeAll',
  );
  assert.ok(queryBlock.includes('widgetsById'), 'the plain GET is unaffected');
});

test('test_225_match_entry_sends_a_get_to_mutation', async () => {
  const schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, {
    skipValidation: true,
    overrides: { $match: [{ pattern: '^get:/widgets\\.export$', root: 'mutation' }] },
  });
  assert.ok(rootBlock(schema!, 'Mutation').includes('widgetsExport'), 'a GET can be moved to Mutation by a pattern');
  assert.ok(!rootBlock(schema!, 'Query').includes('widgetsExport'), 'widgetsExport is not also under Query');
});

test('test_225_exact_entry_merges_field_by_field', async () => {
  const schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, {
    skipValidation: true,
    overrides: {
      $match: [{ pattern: '^post:/widgets\\.list$', root: 'query' }],
      'post:/widgets.list': { path: '/v2/widgets.list' },
    },
  });
  assert.ok(rootBlock(schema!, 'Query').includes('createWidgetsList'), 'the pattern root still applies');
  assert.ok(
    schema!.includes('POST: "/v2/widgets.list"'),
    'the exact entry changes only the path, on top of the pattern',
  );
});

test('test_225_no_match_entries_leaves_the_default', async () => {
  const schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, { skipValidation: true, overrides: {} });
  assert.ok(
    rootBlock(schema!, 'Mutation').includes('createWidgetsList'),
    'with no overrides, widgets.list stays Mutation',
  );
});

test('test_225_first_match_wins_between_overlapping_patterns', async () => {
  const schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, {
    skipValidation: true,
    overrides: {
      $match: [
        { pattern: '^post:/widgets\\.(list|purgeAll)$', root: 'query' },
        { pattern: '^post:/widgets\\.list$', root: 'mutation' },
      ],
    },
  });
  assert.ok(rootBlock(schema!, 'Query').includes('createWidgetsList'), 'the first pattern to match wins, not the last');
});

test('test_225_bad_pattern_stops_the_run', async () => {
  await assert.rejects(
    OasGen.fromFile(`${oasBasePath}/overrides-match.yaml`, {
      skipValidation: true,
      showParentInSelections: false,
      overrides: { $match: [{ pattern: '(unterminated', root: 'query' }] },
    }),
    /"\$match" pattern "\(unterminated" does not compile/,
  );
});

test('test_225_unmatched_pattern_warns', async () => {
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    schema = await runOasTest('overrides-match.yaml', MATCH_PATHS, 5, 5, {
      skipValidation: true,
      overrides: { $match: [{ pattern: '^post:/nope$', root: 'query' }] },
    });
  });
  assert.ok(schema !== undefined, 'generation still succeeds');
  assert.ok(
    warnings.some((w) => /no operation matches pattern "\^post:\/nope\$"/.test(w)),
    `expected an "override ignored" warning, got: ${warnings.join(' | ')}`,
  );
});
