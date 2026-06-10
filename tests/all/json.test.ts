import { test } from 'node:test';
import assert from 'node:assert';
import { JsonGen } from '../../src/index.js';
import { JsonContext, JsonType } from '../../src/json/index.js';
import { runJsonTest } from '../../src/tests/runners.js';
import './_setup.js';

test('should construct Walker from JSON string and store types in context', () => {
  const json = `{
      "name": "Test User",
      "age": 25,
      "address": {
        "street": "Main St",
        "city": "Anytown"
      }
    }`;

  const walker = JsonGen.fromReader(json);
  const context: JsonContext = walker.getContext();
  const types: JsonType[] = context.getTypes();

  // ConnectorWriter.write(walker, writer);
  // writer.clear();
  const schema = walker.generateSchema();

  assert.ok(types.length > 0);
});

test('JsonGen: default rootType produces Root type', () => {
  const json = '{"name": "Test", "age": 25}';
  const schema = JsonGen.fromReader(json).generateSchema();
  assert.ok(schema.includes('type Root {'));
  assert.ok(schema.includes('root: Root'));
});

test('JsonGen: custom rootType produces correct type and query field', () => {
  const json = '{"name": "Test", "address": {"street": "Main St"}}';
  const schema = JsonGen.fromReader(json, { rootType: 'User' }).generateSchema();
  assert.ok(schema.includes('type User {'));
  assert.ok(schema.includes('type UserAddress {'));
  assert.ok(schema.includes('user: User'));
  assert.ok(!schema.includes('type Root {'));
  assert.ok(!schema.includes('root: Root'));
});

test('JsonGen: rootType is case-insensitive (User === user)', () => {
  const json = '{"name": "Test", "address": {"street": "Main St"}}';
  const lower = JsonGen.fromReader(json, { rootType: 'user' }).generateSchema();
  const upper = JsonGen.fromReader(json, { rootType: 'User' }).generateSchema();
  assert.strictEqual(lower, upper);
});

test('JsonGen: custom baseURL, relativePath, and list rootType', () => {
  const json = '{"id": 1, "name": "Test"}';
  const schema = JsonGen.fromReader(json, {
    rootType: '[User]',
    baseURL: 'https://api.example.com',
    relativePath: '/users',
  }).generateSchema();
  assert.ok(schema.includes('baseURL: "https://api.example.com"'));
  assert.ok(schema.includes('user: [User]'));
  assert.ok(schema.includes('GET: "/users"'));
  assert.ok(schema.includes('type User {'));
});

test('JsonGen: queryField overrides the derived field name', () => {
  const json = '{"id": 1, "name": "Test"}';
  const schema = JsonGen.fromReader(json, {
    rootType: '[User]',
    queryField: 'allUsers',
  }).generateSchema();
  assert.ok(schema.includes('allUsers: [User]'));
  assert.ok(!schema.includes('user: [User]'));
});

test('JsonGen: defaults for baseURL and relativePath', () => {
  const json = '{"id": 1}';
  const schema = JsonGen.fromReader(json).generateSchema();
  assert.ok(schema.includes('baseURL: "http://localhost:4010"'));
  assert.ok(schema.includes('root: Root'));
  assert.ok(schema.includes('GET: "/test"'));
  assert.ok(!schema.includes('[Root]'));
});

test('should construct Walker from JSON file and store types in context', async () => {
  await runJsonTest('test/merge/a.json');
});

test('should read and output a single file', async () => {
  await runJsonTest('preferences/user/50.json');
});

test('should read all the json files and combine the output into one', async () => {
  await runJsonTest('live-scores/all');
});

test('stats/fixtures/championship', async () => {
  await runJsonTest('stats/fixtures/championship');
});

test('stats/leagues', async () => {
  await runJsonTest('stats/leagues');
});

test('stats/line-ups', async () => {
  await runJsonTest('stats/line-ups');
});

test('stats/results/scottish-premiership', async () => {
  await runJsonTest('stats/results/scottish-premiership');
});

test('stats/tables/championship', async () => {
  await runJsonTest('stats/tables/championship');
});

test('stats/tables/not-found.json', async () => {
  await runJsonTest('stats/tables/not-found.json');
});

test('fronts', async () => {
  await runJsonTest('fronts');
});

test('articles/search.json', async () => {
  await runJsonTest('articles/search.json');
});

test('articles/clockwatch', async () => {
  // known-bad: empty {} value emits a dangling type reference — see docs/issues.md #21
  const output = await runJsonTest('articles/clockwatch', { shouldFail: true });
  assert.ok(output !== undefined);
  assert.ok(output!.includes('MainAttributes'));
});

test('test/merge', async () => {
  await runJsonTest('test/merge');
});

test('articles/blog', async () => {
  await runJsonTest('articles/blog', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('articles/article', async () => {
  await runJsonTest('articles/article', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('articles/article/2023_dec_01_premier-league-10-things-to-look-out-for-this-weekend', async () => {
  await runJsonTest('articles/article/2023_dec_01_premier-league-10-things-to-look-out-for-this-weekend.json', {
    shouldFail: true,
    outputContains: 'SELECTED_FIELD_NOT_FOUND',
  });
});

test('live-scores/all/2023-12-23_15_00.json', async () => {
  await runJsonTest('live-scores/all/2023-12-23_15_00.json');
});

test('test/all/2023-12-23_15_00.json', async () => {
  await runJsonTest('test/names_with_colon.json');
});

test('test/null_fields.json', async () => {
  await runJsonTest('test/null_fields.json');
});
