import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #171: a type-level entity resolver must authenticate exactly like the operation it was
// inferred from. Uniform-mode header auth already covers it via @source, but a per-op-mode
// header or an apiKey-in-query credential lives on each @connect — before this fix the
// inferred entity connector emitted neither, so every router-side entity fetch to a
// protected endpoint went out unauthenticated.

const PATHS = ['get:/items', 'get:/items/{item_id}'];

const run = (file: string) =>
  runOasTest(file, PATHS, 2, 1, { skipValidation: true, keepFieldNames: true, inferEntityResolvers: true });

// slice from the entity type's @key through its selection — the type-level connector only
const entityConnector = (schema: string) => {
  const start = schema.indexOf('type Item @key');
  assert.ok(start >= 0, 'entity resolver was inferred');
  return schema.slice(start, schema.indexOf('{', schema.indexOf('selection:', start)));
};

test('test_171_per_op_header_rides_the_entity_connector', async () => {
  // the by-id GET declares its own bearer security (per-op mode: nothing on @source)
  const schema = await run('entity-auth.yaml');
  assert.ok(
    !schema!.includes('@source(name: "api", http: { baseURL: "http://localhost:9000", headers'),
    'per-op mode: no auth on @source',
  );
  const connector = entityConnector(schema!);
  assert.ok(
    connector.includes('headers: [{ name: "Authorization", value: "Bearer {$config.token}" }]'),
    "entity connector carries the by-id op's bearer header",
  );
});

test('test_171_query_auth_rides_the_entity_connector', async () => {
  // global apiKey-in-query: @source has no queryParams, so the credential must sit per-@connect
  const schema = await run('entity-auth-query.yaml');
  const connector = entityConnector(schema!);
  assert.ok(connector.includes('"api_key": $config.apiKey'), 'entity connector carries the apiKey query credential');
  assert.ok(!connector.includes('headers:'), 'no header auth for a query-only scheme');
});

test('test_171_uniform_header_stays_on_source', async () => {
  // global bearer: the @source header covers every connector — the entity connector must stay
  // in its compact form, not repeat the credential
  const schema = await run('entity-auth-uniform.yaml');
  assert.ok(
    schema!.includes('headers: [{ name: "Authorization", value: "Bearer {$config.token}" }] })'),
    'uniform mode: auth header on @source',
  );
  const connector = entityConnector(schema!);
  assert.ok(
    connector.includes('http: { GET: "/items/{$this.item_id}" }'),
    'entity connector keeps the compact http form',
  );
  assert.ok(!connector.includes('headers:'), 'credential not repeated on the entity connector');
});
