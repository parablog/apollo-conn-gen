import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { test } from 'node:test';
import assert from 'node:assert';
import { wholeVerdict } from '../../tools/coverage-verdict.mjs';
import './_setup.js';

// The all-ops coverage column (see COVERAGE.md legend): per-op composes are structurally blind to
// cross-op failures, so the tool composes every selected op as ONE schema too. These tests pin the
// tool itself — the vendor-scale pins stay the *_full_production_selection todo tests.

const runTool = (args: string[], env: Record<string, string>) =>
  spawnSync('node', ['--import', 'tsx/esm', 'tools/coverage-spec.mts', '--workers', '1', ...args], {
    encoding: 'utf-8',
    timeout: 240_000,
    env: { ...process.env, ...env },
  });

test('test_coverage_all_ops_column_all_ops_green_when_forms_agree', () => {
  // per-op-green-whole-red.yaml: both GET ops compose alone; combined they used to share one oneOf
  // component top-level (real union) AND nested (flat merge) — fixed by forcing the shared flat
  // form everywhere the two forms disagree (#121).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-tool-'));
  const res = runTool(['--spec', 'per-op-green-whole-red.yaml'], {
    COV_OUT: path.join(dir, 'out.md'),
    COV_DUMP: path.join(dir, 'dump'),
  });
  assert.strictEqual(res.status, 0, 'tool exits clean: ' + (res.stderr || '').slice(-400));
  const dump = JSON.parse(fs.readFileSync(path.join(dir, 'dump.per_op_green_whole_red_yaml.abstract.json'), 'utf-8'));
  const perOp = Object.entries(dump).filter(([k]) => k !== 'whole');
  assert.strictEqual(perOp.length, 2, 'two per-op verdicts');
  assert.ok(perOp.every(([, v]) => v === 'OK'), 'every op composes alone: ' + JSON.stringify(dump));
  assert.strictEqual(dump.whole, 'OK', 'the combined compose now agrees with the per-op verdicts');
  const report = fs.readFileSync(path.join(dir, 'out.md'), 'utf-8');
  assert.ok(report.includes('| all-ops |'), 'report has the column');
  assert.ok(/per-op-green-whole-red\.yaml \|.*\| 100\.0% \| OK/.test(report), 'row shows per-op and all-ops both green');
});

test('test_coverage_all_ops_zero_ops_is_na_not_failure', () => {
  // the sweep is per-verb; a GET-only spec has zero mutation ops — that is n/a, never a failure
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-tool-'));
  const res = runTool(['--spec', 'per-op-green-whole-red.yaml', '--verbs', 'mutations'], {
    COV_OUT: path.join(dir, 'out.md'),
    COV_DUMP: path.join(dir, 'dump'),
  });
  assert.strictEqual(res.status, 0, 'tool exits clean');
  const dump = JSON.parse(fs.readFileSync(path.join(dir, 'dump.per_op_green_whole_red_yaml.abstract.json'), 'utf-8'));
  assert.strictEqual(dump.whole, '—', 'zero ops for the verb set is n/a');
  const report = fs.readFileSync(path.join(dir, 'out.md'), 'utf-8');
  assert.ok(!/WHOLE:/.test(report), 'no failure buckets from the empty verb set');
});

test('test_174_each_pass_builds_its_tree_once', () => {
  // #174: runPass and runWholeSpec each used to call getTypes(sel) then generateSchema(sel) —
  // two full tree builds (TypesCollector.collect) per pass instead of one, doubling peak memory
  // on a heavy spec (docusign's 247-op all-ops pass held two 247-op trees at once). One op with
  // --limit 1 should cost exactly 2 builds: one per-op pass, one all-ops pass.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-tool-'));
  const collectsFile = path.join(dir, 'collects.txt');
  const res = spawnSync(
    'node',
    ['--import', 'tsx/esm', '--import', './tests/all/_countCollects.ts', 'tools/coverage-spec.mts', '--workers', '1', '--spec', 'petstore.yaml', '--limit', '1'],
    {
      encoding: 'utf-8',
      timeout: 240_000,
      env: {
        ...process.env,
        COV_OUT: path.join(dir, 'out.md'),
        COV_DUMP: path.join(dir, 'dump'),
        COV_COLLECTS: collectsFile,
      },
    },
  );
  assert.strictEqual(res.status, 0, 'tool exits clean: ' + (res.stderr || '').slice(-400));
  const collects = fs.readFileSync(collectsFile, 'utf-8');
  assert.strictEqual(collects, '2', 'one tree build per pass (per-op + all-ops), not two');
});

test('test_coverage_whole_verdict_helper', () => {
  const one = wholeVerdict('  CONNECTORS_UNRESOLVED_FIELD: [x] a\n  CONNECTORS_UNRESOLVED_FIELD: [x] b\n');
  assert.strictEqual(one.verdict, 'FAIL [CONNECTORS_UNRESOLVED_FIELD ×2]');
  // mixed codes: the multiplier is the TOP code's own count, never the total
  const mixed = wholeVerdict(
    '  INVALID_GRAPHQL: [x] a\n  CONNECTORS_UNRESOLVED_FIELD: [x] b\n  CONNECTORS_UNRESOLVED_FIELD: [x] c\n',
  );
  assert.strictEqual(mixed.verdict, 'FAIL [CONNECTORS_UNRESOLVED_FIELD ×2] +1 other codes');
  assert.deepStrictEqual(mixed.codes, ['CONNECTORS_UNRESOLVED_FIELD', 'INVALID_GRAPHQL']);
  // no federation code at all: fall back to rover's outer E-code, then OTHER
  assert.strictEqual(wholeVerdict('error[E029]: something opaque').verdict, 'FAIL [E029]');
  assert.strictEqual(wholeVerdict('completely opaque').verdict, 'FAIL [OTHER]');
});
