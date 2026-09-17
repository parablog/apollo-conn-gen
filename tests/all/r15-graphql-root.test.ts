import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
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

// docs/FIXED.md #225: an API where every operation is POST (Ashby is the motivating case) gives no
// way to tell a read from a write by HTTP method alone. `--reads <pattern>` is a regex tested
// against a POST operation's OAS operation id or its path; a match moves that one operation into
// "type Query" the same way an explicit `root: 'query'` override does (docs/FIXED.md #150), without
// an overrides entry for every read. An override still wins when it names the same operation.
// Fixture ops: get:/widgets/{id} (baseline GET, untouched), post:/widgets.list (its path ends in
// ".list", matches), post:/widgets.create (matches nothing, stays a write), post:/widgets.purgeAll
// (its path also matches, but an override pins it to Mutation on purpose), post:/widgets/export
// (its path does not match, but its operation id "widgetsFetch" does).

const READS_PATTERN_PATHS = [
  'get:/widgets/{id}>**',
  'post:/widgets.list>**',
  'post:/widgets.create>**',
  'post:/widgets.purgeAll>**',
  'post:/widgets/export>**',
];
const READS_PATTERN = '\\.list$|purge|fetch';

test('test_225_reads_pattern_moves_matching_posts_to_query', async () => {
  const schema = await runOasTest('reads-pattern.yaml', READS_PATTERN_PATHS, 5, 4, {
    skipValidation: true,
    readsPattern: READS_PATTERN,
    overrides: { 'post:/widgets.purgeAll': { root: 'mutation' } },
  });
  const queryBlock = rootBlock(schema!, 'Query');
  const mutationBlock = rootBlock(schema!, 'Mutation');

  assert.ok(queryBlock.includes('widgetsById'), 'the untouched GET stays under Query');
  assert.ok(queryBlock.includes('createWidgetsList'), 'a POST whose path matches the pattern moves to Query');
  assert.ok(
    queryBlock.includes('createWidgetsExport'),
    'a POST whose operation id matches the pattern moves to Query, even though its path does not',
  );

  assert.ok(mutationBlock.includes('createWidgetsCreate'), 'a POST matching neither id nor path stays under Mutation');
  assert.ok(
    mutationBlock.includes('createWidgetsPurgeAll'),
    'a POST whose path matches the pattern, but is named in the overrides file, stays under Mutation',
  );
  assert.ok(!queryBlock.includes('createWidgetsPurgeAll'), 'the overrides file wins over a pattern match');
});

test('test_225_reads_pattern_omitted_keeps_the_default_unchanged', async () => {
  const schema = await runOasTest('reads-pattern.yaml', READS_PATTERN_PATHS, 5, 4, {
    skipValidation: true,
  });
  assert.ok(
    rootBlock(schema!, 'Mutation').includes('createWidgetsList'),
    'with no --reads pattern given, a POST that would otherwise match stays under Mutation exactly as it does today',
  );
});

// docs/FIXED.md #224 already turns a read POST (one marked `root: 'query'`, by override) into a
// type-level entity resolver keyed through its request body, not just a root field. Since a
// --reads pattern match sets the same "this POST is a read" flag as that override, the same
// entity-resolver wiring should fire for a pattern match too, with no separate code path to keep
// in sync — this reuses the entity-rpc-post-key.yaml fixture, asking only about post:/widget.info,
// to confirm the two features actually compose the way the issue describes.
test('test_225_reads_pattern_extends_224_post_entity_resolvers', async () => {
  const schema = await runOasTest('entity-rpc-post-key.yaml', ['post:/widget.info>**'], 11, 5, {
    inferEntityResolvers: true,
    readsPattern: '\\.info$',
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "id")'), 'expected @key on Widget, same as the override form');
  assert.ok(
    schema!.includes('POST: "/widget.info"\n        body: "$({ id: $this.id })"'),
    'expected the POST body key on Widget, same as the override form',
  );
});

test('test_225_cli_flag_reaches_generator', () => {
  // spawnSync, not runOasTest: pins the Commander option declaration and the opts.reads ->
  // readsPattern mapping in src/cli/oas.ts, which runOasTest bypasses by calling OasGen directly
  const cli = spawnSync(
    'node',
    [
      '--import',
      'tsx/esm',
      'src/cli/oas.ts',
      'tests/resources/oas/reads-pattern.yaml',
      '-i',
      '-n',
      '--reads',
      '\\.list$',
    ],
    { encoding: 'utf-8' },
  );
  assert.strictEqual(cli.status, 0, cli.stderr);
  // post:/widgets.list matches the pattern -> createWidgetsList moves to Query
  assert.ok(rootBlock(cli.stdout, 'Query').includes('createWidgetsList'), 'the matched POST reaches Query through the CLI');
  assert.ok(!rootBlock(cli.stdout, 'Mutation').includes('createWidgetsList'), 'and is not also left under Mutation');
  // post:/widgets.create does not match -> createWidgetsCreate stays exactly where it is today
  assert.ok(rootBlock(cli.stdout, 'Mutation').includes('createWidgetsCreate'), 'an unmatched POST is unaffected by the flag');
  assert.ok(!rootBlock(cli.stdout, 'Query').includes('createWidgetsCreate'), 'and never moves to Query');
});
