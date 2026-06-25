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
  assert.doesNotThrow(() => assertSupportedConnectVersion('v0.4'));
  assert.throws(() => assertSupportedConnectVersion('v0.3'), /Unsupported connector spec version.*v0\.3/);
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
      showParentInSelections: false,
      connectorSpecVersion: 'v9.9',
    }),
    /Unsupported connector spec version/,
  );
});

test('test_069_floor_rejects_below_v0_4_and_fed_below_2_13', async () => {
  // The connector spec is floored at v0.4 (the pre-v0.4 consolidate/feature downgrades were removed);
  // v0.4 also requires federation >= v2.13. Both fail fast at the entrypoint (validateVersionOptions).
  await assert.rejects(
    OasGen.fromData(new ArrayBuffer(0), {
      skipValidation: true,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.3',
    }),
    /Unsupported connector spec version .*v0\.3/,
    'connect < v0.4 is rejected',
  );
  await assert.rejects(
    OasGen.fromData(new ArrayBuffer(0), {
      skipValidation: true,
      showParentInSelections: false,
      federationVersion: 'v2.9',
    }),
    /requires federation >= v2\.13/,
    'fed < v2.13 with connect v0.4 is rejected (order-aware, not lexicographic)',
  );
});
