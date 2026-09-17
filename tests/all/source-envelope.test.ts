import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OasGen } from '../../src/index.js';
import { OverridesConfig } from '../../src/oas/oasContext.js';
import { runOasTest, oasBasePath } from '../../src/tests/runners.js';
import { runConnectorTest } from '../../src/tests/connectors.js';
import './_setup.js';
import { captureErrors } from './_setup.js';

// --- source error mapping and the payload field from the overrides file (see docs/FIXED.md #226) ---

const UNION_ALL = [
  'post:/widget.info>**',
  'post:/widget.list>**',
  'post:/widget.count>**',
  'post:/widget.tags>**',
  'post:/widget.noPayload>**',
];
const FLAG_ALL = ['get:/channel.info>**', 'get:/channel.list>**'];

// every op under Query, so the connector tests can address them as Query.<name>
const UNION_ROOTS: OverridesConfig = {
  'post:/widget.info': { root: 'query' },
  'post:/widget.list': { root: 'query' },
  'post:/widget.count': { root: 'query' },
  'post:/widget.tags': { root: 'query' },
  'post:/widget.noPayload': { root: 'query' },
};

const ASHBY_SOURCE: OverridesConfig = {
  ...UNION_ROOTS,
  $source: {
    isSuccess: '$.success',
    errors: {
      message: "$($.errors?->first?.message ?? 'Ashby request failed')",
      extensions: 'httpStatus: $status',
    },
    payload: 'results',
  },
};

const SLACK_SOURCE: OverridesConfig = {
  $source: { isSuccess: '$.ok', errors: { message: '$.error' } },
};

test('source-envelope union: no config leaves the old @source and every wrapper type in place', async () => {
  const schema = await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 10, { useOperationIds: true, overrides: UNION_ROOTS });
  assert.ok(schema!.includes('@source(name: "api", http: { baseURL: "https://api.example.com" })\n'));
  assert.ok(schema!.includes('widgetInfo(input: WidgetInfoInput!): WidgetInfoResponse'));
  assert.ok(schema!.includes('type WidgetInfoResponse'));
});

test('source-envelope flag: no config leaves the old @source and the flat response type in place', async () => {
  const schema = await runOasTest('source-envelope-flag.yaml', FLAG_ALL, 2, 4, { useOperationIds: true });
  assert.ok(schema!.includes('@source(name: "api", http: { baseURL: "https://api.example.com" })\n'));
  assert.ok(schema!.includes('channelInfo(id: ID!): ChannelInfoResponse'));
});

test('source-envelope union: configured payload unwraps every op by its own shape', async () => {
  const schema = await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 6, {
    useOperationIds: true,
    overrides: ASHBY_SOURCE,
  });

  assert.ok(
    schema!.includes(
      '@source(name: "api", http: { baseURL: "https://api.example.com" }\n' +
        '    isSuccess: "$.success"\n' +
        '    errors: { message: "$($.errors?->first?.message ?? \'Ashby request failed\')" extensions: "httpStatus: $status" })',
    ),
    'isSuccess/errors written onto @source verbatim',
  );

  // an object: the root field returns Widget and the selection opens on $.results
  assert.ok(schema!.includes('widgetInfo(input: WidgetInfoInput!): Widget'));
  assert.ok(schema!.includes('$.results {\n       id?\n       title?\n      }'));

  // a list of objects: [Widget]; the paging fields next to results are dropped on purpose
  assert.ok(schema!.includes('widgetList(input: WidgetListInput!): [Widget]'));
  assert.ok(!schema!.includes('moreDataAvailable'));
  assert.ok(!schema!.includes('nextCursor'));

  // a plain value: Int, and $.results alone
  assert.ok(schema!.includes('widgetCount: Int'));

  // a list of plain values: [String], and $.results alone, no empty block
  assert.ok(schema!.includes('widgetTags: [String]'));

  // no results property on the success branch: left as is, with a warning
  assert.ok(schema!.includes('widgetNoPayload(input: WidgetNoPayloadInput!): WidgetNoPayloadResponse'));
  assert.ok(schema!.includes('type WidgetNoPayloadResponse'));

  // the response types nothing returns any more are gone
  assert.ok(!schema!.includes('type WidgetInfoResponse'));
  assert.ok(!schema!.includes('type WidgetListResponse'));
  assert.ok(!schema!.includes('type WidgetCountResponse'));
  assert.ok(!schema!.includes('type WidgetTagsResponse'));
});

test('source-envelope union: a no-match payload warns once with the op and the field name', async () => {
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/source-envelope-union.yaml`, {
      showParentInSelections: false,
      useOperationIds: true,
      overrides: ASHBY_SOURCE,
    });
    await gen.visit();
    gen.generateSchema(UNION_ALL);
  });

  const relevant = messages.filter((m) => m.includes('widget.noPayload') && m.includes('has no "results"'));
  assert.strictEqual(relevant.length, 1, 'one generation warns exactly once, however many sites resolve the payload');
});

test('source-envelope union: two scalar-list widget.count/widget.tags selections both write $.results alone', async () => {
  const schema = await runOasTest('source-envelope-union.yaml', ['post:/widget.count>**', 'post:/widget.tags>**'], 5, 1, {
    useOperationIds: true,
    overrides: ASHBY_SOURCE,
  });
  const opening = /selection: """\n\s*\$\.results\n\s*"""/g;
  assert.strictEqual((schema!.match(opening) ?? []).length, 2, 'both scalar/scalar-list payloads write the bare value, no block');
});

test('source-envelope union: a per-op payload:null keeps that op wrapped under the default', async () => {
  const overrides: OverridesConfig = {
    ...ASHBY_SOURCE,
    'post:/widget.info': { root: 'query', payload: null },
  };
  const schema = await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 7, { useOperationIds: true, overrides });

  assert.ok(schema!.includes('widgetInfo(input: WidgetInfoInput!): WidgetInfoResponse'), 'payload:null keeps its wrapper');
  assert.ok(schema!.includes('type WidgetInfoResponse'));
  assert.ok(schema!.includes('widgetList(input: WidgetListInput!): [Widget]'), 'every other op still returns its own field');
});

test('source-envelope flag: configured isSuccess/errors leaves both root fields unchanged', async () => {
  const schema = await runOasTest('source-envelope-flag.yaml', FLAG_ALL, 2, 4, { useOperationIds: true, overrides: SLACK_SOURCE });

  assert.ok(
    schema!.includes(
      '@source(name: "api", http: { baseURL: "https://api.example.com" }\n' + '    isSuccess: "$.ok"\n' + '    errors: { message: "$.error" })',
    ),
  );
  assert.ok(schema!.includes('channelInfo(id: ID!): ChannelInfoResponse'));
  assert.ok(schema!.includes('channelList: ChannelListResponse'));
});

test('source-envelope union: a selection path saved before the config resolves to the same nodes with it', async () => {
  const before = await OasGen.fromFile(`${oasBasePath}/source-envelope-union.yaml`, {
    showParentInSelections: false,
    useOperationIds: true,
  });
  await before.visit();
  const saved = before.expanded(['post:/widget.info>**']);
  assert.ok(saved.length > 0);

  const after = await OasGen.fromFile(`${oasBasePath}/source-envelope-union.yaml`, {
    showParentInSelections: false,
    useOperationIds: true,
    overrides: ASHBY_SOURCE,
  });
  await after.visit();
  const schema = after.generateSchema(saved);
  assert.ok(schema.includes('widgetInfo(input: WidgetInfoInput!): Widget'), 'the saved node ids still resolve, now returning the payload field directly');
});

test('source-envelope union: configured schema composes on stock rover 2.15.1', async () => {
  await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 6, { useOperationIds: true, overrides: ASHBY_SOURCE, forceRover: true });
});

test('source-envelope flag: configured schema composes on stock rover 2.15.1', async () => {
  await runOasTest('source-envelope-flag.yaml', FLAG_ALL, 2, 4, { useOperationIds: true, overrides: SLACK_SOURCE, forceRover: true });
});

// --- runtime: a success body returns each kind of payload ---
// widget.info and widget.list take an object argument, which the connector-test binary cannot pass,
// so they run through the router below; widget.count and widget.tags take none and use a fixture.

test('source-envelope union runtime: widget-info (object payload)', async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);
  const response = await runBodyThroughRouter(
    'source-envelope-union.yaml',
    UNION_ALL,
    ASHBY_SOURCE,
    '{"success": true, "results": {"id": "w1", "title": "Foo"}}',
    'query { widgetInfo(input: {id: "w1"}) { id title } }',
  );
  assert.deepStrictEqual(response.data, { widgetInfo: { id: 'w1', title: 'Foo' } });
});

test('source-envelope union runtime: widget-list (list-of-objects payload)', async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);
  const response = await runBodyThroughRouter(
    'source-envelope-union.yaml',
    UNION_ALL,
    ASHBY_SOURCE,
    '{"success": true, "results": [{"id": "w1", "title": "Foo"}], "moreDataAvailable": true, "nextCursor": "c2"}',
    'query { widgetList(input: {cursor: "c1"}) { id title } }',
  );
  assert.deepStrictEqual(response.data, { widgetList: [{ id: 'w1', title: 'Foo' }] });
});

test('source-envelope union runtime: widget-count (scalar payload)', async (t) => {
  const result = await runConnectorTest(
    'source-envelope-union.yaml',
    UNION_ALL,
    'tests/resources/connectors/source-envelope-union/widget-count.connector.yaml',
    { overrides: ASHBY_SOURCE },
  );
  if (result.skipped) return t.skip(result.output);
  assert.ok(result.success, result.output);
});

test('source-envelope union runtime: widget-tags (scalar-list payload)', async (t) => {
  const result = await runConnectorTest(
    'source-envelope-union.yaml',
    UNION_ALL,
    'tests/resources/connectors/source-envelope-union/widget-tags.connector.yaml',
    { overrides: ASHBY_SOURCE },
  );
  if (result.skipped) return t.skip(result.output);
  assert.ok(result.success, result.output);
});

test('source-envelope flag runtime: channel-list (unchanged wrapper)', async (t) => {
  const result = await runConnectorTest(
    'source-envelope-flag.yaml',
    FLAG_ALL,
    'tests/resources/connectors/source-envelope-flag/channel-list.connector.yaml',
    { overrides: SLACK_SOURCE },
  );
  if (result.skipped) return t.skip(result.output);
  assert.ok(result.success, result.output);
});

// --- runtime: a failing body becomes a GraphQL error ---
// through the real router: the connector-test binary ignores errors.extensions. see docs/FIXED.md #226

function routerBinary(): string {
  return process.env.OAS_TEST_ROUTER_BINARY || path.join(os.homedir(), '.rover', 'bin', 'router-v2.15.1');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error('no port assigned'))));
    });
  });
}

// answers every request with the same body/status, whatever the connector actually asked for
function startMockServer(body: string, status = 200): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

// composes the schema with rover and returns the supergraph file; runners.ts only reports pass/fail
function composeSupergraph(schemaFile: string, sampleFile: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-envelope-compose-'));
  const configFile = path.join(dir, 'supergraph.yaml');
  const outFile = path.join(dir, 'supergraph.graphql');
  fs.writeFileSync(
    configFile,
    `federation_version: =2.15.1\nsubgraphs:\n  test_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${schemaFile}\n  sample_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${sampleFile}\n`,
  );
  const composed = execSync(`rover supergraph compose --config ${configFile} --elv2-license accept`, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(outFile, composed);
  return outFile;
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`router never listened on port ${port}`);
}

// starts the router on the supergraph, sends one query, stops it, and returns the JSON response
async function queryThroughRouter(supergraphFile: string, query: string): Promise<{ data: unknown; errors?: unknown[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-envelope-router-'));
  const routerConfigFile = path.join(dir, 'router.yaml');
  const routerPort = await freePort();
  fs.writeFileSync(
    routerConfigFile,
    `supergraph:\n  listen: 127.0.0.1:${routerPort}\nhealth_check:\n  enabled: false\nhomepage:\n  enabled: false\ninclude_subgraph_errors:\n  all: true\nconnectors:\n  preview_connect_v0_4: true\n`,
  );

  const router = spawn(routerBinary(), ['-s', supergraphFile, '-c', routerConfigFile, '--log', 'error'], {
    env: { ...process.env, APOLLO_TELEMETRY_DISABLED: '1' },
  });
  try {
    await waitForPort(routerPort);
    const response = await fetch(`http://127.0.0.1:${routerPort}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'apollo-require-preflight': 'true' },
      body: JSON.stringify({ query }),
    });
    return await response.json();
  } finally {
    router.kill();
  }
}

// generates the fixture against a stub API answering the given body, and runs one query through the router
async function runBodyThroughRouter(file: string, paths: string[], overrides: OverridesConfig, apiResponseBody: string, query: string) {
  const mock = await startMockServer(apiResponseBody);
  try {
    const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
      showParentInSelections: false,
      useOperationIds: true,
      overrides,
      baseURL: `http://127.0.0.1:${mock.port}`,
    });
    await gen.visit();
    const schema = gen.generateSchema(paths);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-envelope-schema-'));
    const schemaFile = path.join(dir, 'schema.graphql');
    fs.writeFileSync(schemaFile, schema);
    const sampleFile = path.join(dir, 'sample.graphql');
    fs.writeFileSync(sampleFile, 'type Query { hello: String }\n');

    const supergraphFile = composeSupergraph(schemaFile, sampleFile);
    return await queryThroughRouter(supergraphFile, query);
  } finally {
    mock.close();
  }
}

function routerAvailable(): boolean {
  return fs.existsSync(routerBinary());
}

test('source-envelope union runtime: a failing body becomes a mapped GraphQL error', async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);

  const response = await runBodyThroughRouter(
    'source-envelope-union.yaml',
    UNION_ALL,
    ASHBY_SOURCE,
    '{"success": false, "errors": [{"message": "widget not found"}]}',
    'query { widgetCount }',
  );

  assert.ok(response.errors && response.errors.length > 0, 'a failed body must answer with a GraphQL error, not data');
  const error = response.errors![0] as { message: string; extensions?: Record<string, unknown> };
  assert.strictEqual(error.message, 'widget not found', "the configured errors.message mapping picks the API's own message");
  assert.strictEqual(error.extensions?.httpStatus, 200, 'the configured errors.extensions mapping carries its own key through');
});

test('source-envelope flag runtime: a failing body becomes a mapped GraphQL error', async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);

  const response = await runBodyThroughRouter(
    'source-envelope-flag.yaml',
    FLAG_ALL,
    SLACK_SOURCE,
    '{"ok": false, "error": "channel_not_found"}',
    'query { channelList { ok error } }',
  );

  assert.ok(response.errors && response.errors.length > 0, 'a failed body must answer with a GraphQL error, not data');
  const error = response.errors![0] as { message: string };
  assert.strictEqual(error.message, 'channel_not_found');
});

// --- an operation's own errors mapping, written on its @connect instead of the "$source" one (see docs/FIXED.md #228) ---

const OVERRIDES_ERRORS_ALL = ['post:/widget.info>**', 'post:/customFields.fetch>**'];

const ERRORS_SOURCE: OverridesConfig['$source'] = {
  isSuccess: '$.success',
  errors: {
    message: "$($.errors?->first?.message ?? 'Ashby request failed')",
    extensions: 'httpStatus: $status',
  },
};

test("source-envelope: an operation's own errors is written on that op's @connect only", async () => {
  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    'post:/customFields.fetch': { errors: { message: '$.errorInfo.message', extensions: 'code: $.errorInfo.code' } },
  };
  const schema = await runOasTest('overrides-errors.yaml', OVERRIDES_ERRORS_ALL, 2, 8, { useOperationIds: true, overrides });

  assert.ok(
    schema!.includes('errors: { message: "$.errorInfo.message" extensions: "code: $.errorInfo.code" }'),
    "customFieldsFetch carries the file's own errors mapping",
  );
  const errorsBlocks = schema!.match(/errors: \{/g) ?? [];
  assert.strictEqual(errorsBlocks.length, 2, 'one on @source, one on customFieldsFetch, none on widgetInfo');
  assert.ok(
    schema!.includes('errors: { message: "$($.errors?->first?.message ?? \'Ashby request failed\')" extensions: "httpStatus: $status" })'),
    '@source still carries the $source mapping',
  );
});

test("source-envelope: an operation's own errors also works through a $match pattern", async () => {
  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    $match: [{ pattern: '\\.fetch$', errors: { message: '$.errorInfo.message' } }],
  };
  const schema = await runOasTest('overrides-errors.yaml', OVERRIDES_ERRORS_ALL, 2, 8, { useOperationIds: true, overrides });

  assert.ok(schema!.includes('errors: { message: "$.errorInfo.message" }'), "the pattern's own errors mapping reaches customFieldsFetch");
});

test("source-envelope: an operation's own errors wins over the inferred R4 block", async () => {
  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    'post:/customFields.fetch': { errors: { message: '$.errorInfo.message', extensions: 'code: $.errorInfo.code' } },
  };
  const schema = await runOasTest('overrides-errors.yaml', OVERRIDES_ERRORS_ALL, 2, 8, {
    useOperationIds: true,
    overrides,
    emitConnectorErrors: true,
  });

  // one on @source, one on customFieldsFetch's own mapping; none inferred, none on widgetInfo
  const errorsBlocks = schema!.match(/errors: \{/g) ?? [];
  assert.strictEqual(errorsBlocks.length, 2, "customFieldsFetch carries exactly one errors argument, the file's own, and widgetInfo none");
  assert.ok(schema!.includes('errors: { message: "$.errorInfo.message" extensions: "code: $.errorInfo.code" }'));
});

test("source-envelope: an operation's own errors composes on stock rover 2.15.1", async () => {
  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    'post:/customFields.fetch': { errors: { message: '$.errorInfo.message', extensions: 'code: $.errorInfo.code' } },
  };
  await runOasTest('overrides-errors.yaml', OVERRIDES_ERRORS_ALL, 2, 8, { useOperationIds: true, overrides, forceRover: true });
});

test("source-envelope runtime: an operation's own errors mapping picks the API's own message over the $source fallback", async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);

  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    'post:/customFields.fetch': { errors: { message: '$.errorInfo.message' } },
  };
  const response = await runBodyThroughRouter(
    'overrides-errors.yaml',
    OVERRIDES_ERRORS_ALL,
    overrides,
    '{"success": false, "errors": ["invalid_input"], "errorInfo": {"code": "invalid_input", "message": "field id is required"}}',
    'mutation { customFieldsFetch(input: {id: "1"}) { success } }',
  );

  assert.ok(response.errors && response.errors.length > 0, 'a failed body must answer with a GraphQL error, not data');
  const error = response.errors![0] as { message: string; extensions?: Record<string, unknown> };
  assert.strictEqual(error.message, 'field id is required', "the operation's own mapping wins over the $source fallback text");
  assert.strictEqual(error.extensions?.httpStatus, 200, 'the $source extensions still apply when the entry sets only message');
});

test("source-envelope runtime: an operation's own errors mapping leaves every other operation on the $source mapping", async (t) => {
  if (!routerAvailable()) return t.skip(`router binary not found at ${routerBinary()}`);

  const overrides: OverridesConfig = {
    $source: ERRORS_SOURCE,
    'post:/customFields.fetch': { errors: { message: '$.errorInfo.message' } },
  };
  const response = await runBodyThroughRouter(
    'overrides-errors.yaml',
    OVERRIDES_ERRORS_ALL,
    overrides,
    '{"success": false, "errors": [{"message": "widget not found"}]}',
    'mutation { widgetInfo(input: {id: "1"}) { success } }',
  );

  assert.ok(response.errors && response.errors.length > 0, 'a failed body must answer with a GraphQL error, not data');
  const error = response.errors![0] as { message: string };
  assert.strictEqual(error.message, 'widget not found', 'widgetInfo still answers through the untouched $source mapping');
});

// --- the real Ashby spec with the config; the corpus tests keep the unconfigured baseline ---

// docs/FIXED.md #225: a "$match" pattern entry's fields (including "payload") merge under an
// exact entry for the same op the same way an exact "root" does — field by field, exact wins.

test('source-envelope union: a pattern payload is inherited, and an exact payload:null keeps the pattern root', async () => {
  const overrides: OverridesConfig = {
    $match: [{ pattern: '^post:/widget\\.(info|list)$', root: 'query', payload: 'results' }],
    'post:/widget.info': { payload: null },
  };
  const schema = await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 9, { useOperationIds: true, overrides });

  // widget.list matches the pattern only: unwraps to [Widget], proving the pattern's own
  // "payload" is read, not just its "root"
  assert.ok(schema!.includes('widgetList(input: WidgetListInput!): [Widget]'), 'the pattern payload unwraps widget.list');

  // widget.info matches the pattern (root: query) and gets an exact payload:null: stays under
  // Query (the pattern's root survives) but keeps its wrapper (the exact payload wins)
  assert.ok(
    schema!.includes('widgetInfo(input: WidgetInfoInput!): WidgetInfoResponse'),
    'the exact payload:null overrides the pattern payload but keeps the pattern root',
  );
  assert.ok(schema!.includes('type WidgetInfoResponse'), 'the wrapper type is still emitted');
});

test('source-envelope union: a pattern with no payload falls back to the $source default', async () => {
  const overrides: OverridesConfig = {
    $source: ASHBY_SOURCE.$source,
    $match: [{ pattern: '^post:/widget\\.count$', root: 'query' }],
  };
  const schema = await runOasTest('source-envelope-union.yaml', UNION_ALL, 5, 6, { useOperationIds: true, overrides });

  assert.ok(schema!.includes('widgetCount: Int'), 'widget.count still unwraps through $source.payload with no payload on the pattern itself');
});

test('source-envelope ashby: the real spec unwraps application.list under the configured payload', async () => {
  const overrides: OverridesConfig = {
    'post:/application.list': { root: 'query' },
    $source: {
      isSuccess: '$.success',
      errors: {
        message: "$($.errors?->first?.message ?? 'Ashby request failed')",
        extensions: 'httpStatus: $status',
      },
      payload: 'results',
    },
  };
  const schema = await runOasTest('ashby.json', ['post:/application.list>**'], 197, 29, { overrides });

  assert.ok(schema!.includes('isSuccess: "$.success"'));
  assert.ok(schema!.includes("errors: { message: \"$($.errors?->first?.message ?? 'Ashby request failed')\""));
  assert.ok(schema!.includes('createApplicationList(input: ApplicationListRequestInput!): [ApplicationListResult]!'));
  assert.ok(schema!.includes('$.results {'));
});
