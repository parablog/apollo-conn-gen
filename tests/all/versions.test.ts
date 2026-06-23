import { test } from 'node:test';
import assert from 'node:assert';
import { JsonGen, OasGen } from '../../src/index.js';
import {
  DEFAULT_VERSIONS,
  parseVersion,
  compareVersions,
  meetsMinimum,
  assertSupportedConnectVersion,
  requireConnectVersion,
} from '../../src/versions.js';
import './_setup.js';
import { captureErrors } from './_setup.js';
import { oasBasePath } from '../../src/tests/runners.js';

// --- R0: spec version gating (rover-free unit tests) -----------------------

test('test_063_versions_defaults_locked', () => {
  // Lock the paired bump so a future edit cannot desync connect/federation.
  assert.deepStrictEqual(DEFAULT_VERSIONS, { federationVersion: 'v2.14', connectorSpecVersion: 'v0.4' });
});

test('test_064_versions_parse', () => {
  assert.deepStrictEqual(parseVersion('v0.4'), { major: 0, minor: 4 });
  assert.deepStrictEqual(parseVersion('v2.12'), { major: 2, minor: 12 });
  for (const bad of ['2.11', 'v2', 'vx.y', 'v0.4-preview']) {
    assert.throws(() => parseVersion(bad), /Invalid version/);
  }
});

test('test_065_versions_compare_and_minimum', () => {
  assert.strictEqual(compareVersions('v0.3', 'v0.3'), 0);
  assert.strictEqual(compareVersions('v0.2', 'v0.4'), -1);
  assert.strictEqual(compareVersions('v0.4', 'v0.2'), 1);
  assert.strictEqual(meetsMinimum('v0.4', 'v0.2'), true);
  assert.strictEqual(meetsMinimum('v0.2', 'v0.4'), false);
  assert.strictEqual(meetsMinimum('v0.3', 'v0.3'), true);
  // cross-major ordering on (major, minor)
  assert.strictEqual(meetsMinimum('v2.11', 'v0.4'), true);
});

test('test_066_versions_assert_supported', () => {
  assert.doesNotThrow(() => assertSupportedConnectVersion('v0.3'));
  assert.doesNotThrow(() => assertSupportedConnectVersion('v0.4'));
  assert.throws(() => assertSupportedConnectVersion('v9.9'), /Unsupported connector spec version/);
  // a -preview suffix is not a valid identifier; message steers to v0.4
  assert.throws(() => assertSupportedConnectVersion('v0.4-preview'), /v0\.4/);
});

test('test_067_versions_require_gate', () => {
  assert.doesNotThrow(() => requireConnectVersion('unions', 'v0.4', 'v0.4'));
  assert.doesNotThrow(() => requireConnectVersion('errors', 'v0.3', 'v0.2'));
  assert.throws(() => requireConnectVersion('unions', 'v0.3', 'v0.4'), /requires connect v0\.4/);
});

test('test_068_entrypoints_reject_bad_version', async () => {
  // JsonGen constructor validates synchronously.
  assert.throws(
    () => JsonGen.new({ connectorSpecVersion: 'v0.4-preview' }),
    /Unsupported connector spec version/,
  );
  // OasGen.fromData validates before touching the data.
  await assert.rejects(
    OasGen.fromData(new ArrayBuffer(0), {
      skipValidation: true,
      consolidateUnions: true,
      showParentInSelections: false,
      connectorSpecVersion: 'v9.9',
    }),
    /Unsupported connector spec version/,
  );
});

test('test_069_body_skipped_below_connect_v02_with_warning (C2)', async () => {
  // C2: `@connect(http.body)` is a connect v0.2+ feature — the same gate errors (R4) and batch
  // (R6) use. Targeting v0.1 with a POST that has a request body must (1) emit no `body:` block
  // and (2) log a single downgrade notice via the project logger (warn → console.error). Uses
  // direct OasGen (no compose), since v0.1 itself wouldn't compose on a released supergraph.
  let schema: string | undefined;
  const errors = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/body-aliases-defaults.yaml`, {
      skipValidation: true,
      consolidateUnions: true,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.1',
      federationVersion: 'v2.11',
    });
    await gen.visit();
    schema = gen.generateSchema(['post:/things>**']);
  });
  assert.ok(schema !== undefined);
  assert.ok(!/\bbody:/.test(schema!), 'a v0.1 target must not emit a `body:` block');
  assert.ok(
    errors.some((e) => /@connect\(http\.body\) requires connect v0\.2/.test(e)),
    `expected the body downgrade warning, got: ${errors.join(' | ')}`,
  );
});
