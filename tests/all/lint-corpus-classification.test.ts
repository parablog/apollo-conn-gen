import { test } from 'node:test';
import assert from 'node:assert';
import type { LintDiagnostic } from '../../src/oas/lint/index.js';
import { fieldOf, classify, tally, decideExit, type ClassifiableFinding, type Gap } from '../../tools/lintCorpusGaps.mjs';
import './_setup.js';

// No OasGen, no generation -- this exercises the exit-1 path directly, in milliseconds, since
// every scoped and full sweep otherwise runs the same way and is expected to exit 0.

test('test_field_of_extracts_the_backticked_key_from_response_field_not_read', () => {
  const fieldNotRead: LintDiagnostic = {
    code: 'RESPONSE_FIELD_NOT_READ',
    severity: 'warning',
    message: '`uris` is returned by `get:/thing` but its selection never reads it.',
    from: 0,
    to: 0,
  };
  assert.equal(fieldOf(fieldNotRead), 'uris');

  const notRead: LintDiagnostic = {
    code: 'RESPONSE_NOT_READ',
    severity: 'error',
    message: '`get:/thing` returns `id` but its selection reads none of them.',
    from: 0,
    to: 0,
  };
  assert.equal(fieldOf(notRead), undefined);
});

test('test_classify_unmatched_finding_is_new', () => {
  const gaps: Gap[] = [{ spec: 'known.yaml', field: 'uris', ref: 'docs/TASKS.md #216' }];
  const finding: ClassifiableFinding = { spec: 'known.yaml', op: 'get:/thing', code: 'RESPONSE_FIELD_NOT_READ', field: 'other' };
  assert.equal(classify(finding, gaps), undefined);
});

test('test_classify_empty_field_matches_by_presence_not_truthiness', () => {
  const gaps: Gap[] = [{ spec: 'sendgrid.yaml', field: '', ref: 'docs/TASKS.md #217' }];
  const empty: ClassifiableFinding = { spec: 'sendgrid.yaml', op: 'get:/status', code: 'RESPONSE_FIELD_NOT_READ', field: '' };
  assert.equal(classify(empty, gaps)?.ref, 'docs/TASKS.md #217');

  const wholeResponse: ClassifiableFinding = { spec: 'sendgrid.yaml', op: 'get:/status', code: 'RESPONSE_NOT_READ', field: undefined };
  assert.equal(classify(wholeResponse, gaps), undefined, 'an op-only finding must not match a field-only entry');
});

test('test_tally_mixed_known_and_new_still_fails', () => {
  const gaps: Gap[] = [{ spec: 'spec.yaml', field: 'known', ref: 'docs/TASKS.md #1' }];
  const known: ClassifiableFinding = { spec: 'spec.yaml', op: 'get:/a', code: 'RESPONSE_FIELD_NOT_READ', field: 'known' };
  const fresh: ClassifiableFinding = { spec: 'spec.yaml', op: 'get:/b', code: 'RESPONSE_FIELD_NOT_READ', field: 'new' };
  const totals = tally([known, fresh], gaps);
  assert.deepEqual(totals, { known: 1, new: 1 });
  assert.equal(decideExit(totals.new, 0), 1);
});

test('test_tally_all_known_passes', () => {
  const gaps: Gap[] = [
    { spec: 'spec.yaml', field: 'a', ref: 'docs/TASKS.md #1' },
    { spec: 'spec.yaml', field: 'b', ref: 'docs/TASKS.md #2' },
  ];
  const findings: ClassifiableFinding[] = [
    { spec: 'spec.yaml', op: 'get:/a', code: 'RESPONSE_FIELD_NOT_READ', field: 'a' },
    { spec: 'spec.yaml', op: 'get:/b', code: 'RESPONSE_FIELD_NOT_READ', field: 'b' },
  ];
  const totals = tally(findings, gaps);
  assert.deepEqual(totals, { known: 2, new: 0 });
  assert.equal(decideExit(totals.new, 0), 0);
});

test('test_tally_scans_past_the_display_cap', () => {
  const gaps: Gap[] = [{ spec: 'spec.yaml', field: 'known', ref: 'docs/TASKS.md #1' }];
  const findings: ClassifiableFinding[] = Array.from({ length: 41 }, (_, i) => ({
    spec: 'spec.yaml',
    op: `get:/op${i}`,
    code: 'RESPONSE_FIELD_NOT_READ',
    field: i < 40 ? 'known' : 'unfiled',
  }));
  const totals = tally(findings, gaps);
  assert.deepEqual(totals, { known: 40, new: 1 });
  assert.equal(decideExit(totals.new, 0), 1);
});

test('test_decide_exit_blind_op_fails_with_zero_findings', () => {
  assert.equal(decideExit(0, 1), 1);
});
