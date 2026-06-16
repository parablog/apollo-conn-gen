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

// --- R0: spec version gating (rover-free unit tests) -----------------------

test('test_063_versions_defaults_locked', () => {
  // Lock the paired bump so a future edit cannot desync connect/federation.
  assert.deepStrictEqual(DEFAULT_VERSIONS, { federationVersion: 'v2.14', connectorSpecVersion: 'v0.4' });
});

test('test_064_versions_parse', () => {
  assert.deepStrictEqual(parseVersion('v0.4'), { major: 0, minor: 4 });
  assert.deepStrictEqual(parseVersion('v2.12'), { major: 2, minor: 12 });
  // optional patch (federation ships patches, e.g. v2.14.1) — included only when present
  assert.deepStrictEqual(parseVersion('v2.14.1'), { major: 2, minor: 14, patch: 1 });
  // the dot is escaped, so a non-dot separator and a 4th part are both rejected
  for (const bad of ['2.11', 'v2', 'vx.y', 'v0.4-preview', 'v2.14x1', 'v2.14.1.0']) {
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
  // patch tie-breaks; a missing patch counts as 0 (v2.14 == v2.14.0 < v2.14.1)
  assert.strictEqual(compareVersions('v2.14.1', 'v2.14'), 1);
  assert.strictEqual(compareVersions('v2.14', 'v2.14.0'), 0);
  assert.strictEqual(meetsMinimum('v2.14', 'v2.14.1'), false);
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
