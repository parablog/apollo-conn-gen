import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { lintSelections } from '../../src/oas/lint/index.js';
import { SchemaReader } from '../../src/oas/lint/schemaReader.js';
import { ResponseCoverageCheck } from '../../src/oas/lint/checks/responseCoverage.js';
import { SelectionPath } from '../../src/oas/utils/selectionPath.js';
import { oasBasePath } from '../../src/tests/runners.js';
import { fieldOf } from '../../tools/lintCorpusGaps.mjs';
import './_setup.js';

// Each test below pins one finding the corpus sweep reports today and docs/TASKS.md files; when
// the underlying gap is fixed the test fails, and the fix flips it to assert no findings and
// closes the entry.

async function findingsFor(file: string, op: string, options: Record<string, unknown> = {}) {
  const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
    skipValidation: true,
    showParentInSelections: false,
    ...options,
  } as never);
  await gen.visit();
  const sdl = gen.generateSchema([SelectionPath.everythingUnder(op)]);
  const parsed = SchemaReader.read(sdl);
  const found = [...lintSelections(sdl, gen), ...ResponseCoverageCheck.run(sdl, parsed, gen)];
  return { sdl, parsed, findings: found.map((d) => ({ code: d.code, field: fieldOf(d) })) };
}

test('test_gap_215_plain_or_shapeless_object_vanishes', async () => {
  const widgets = await findingsFor('oneof-plain-and-shapeless-object.yaml', 'get:/widgets');
  assert.ok(widgets.parsed.selections.length > 0, 'the op must produce a connector to prove anything');
  assert.deepEqual(
    [...widgets.findings].sort((a, b) => a.field!.localeCompare(b.field!)),
    [
      { code: 'RESPONSE_FIELD_NOT_READ', field: 'args' },
      { code: 'RESPONSE_FIELD_NOT_READ', field: 'payload' },
      { code: 'RESPONSE_FIELD_NOT_READ', field: 'value' },
    ],
  );
  assert.ok(!widgets.sdl.includes('payload') && !widgets.sdl.includes('args') && !widgets.sdl.includes('value'));

  const entries = await findingsFor('oneof-plain-and-shapeless-object.yaml', 'get:/entries');
  assert.ok(entries.parsed.selections.length > 0);
  assert.deepEqual(entries.findings, [{ code: 'RESPONSE_FIELD_NOT_READ', field: 'data' }]);
  assert.ok(!entries.sdl.includes('data'), 'the item type had only that one property, so the whole list drops too');
});

// #221 fixed the no-object-member case (docker-engine/confluence's `oneOf [array, string]`):
// uris/all/css/js now read as the mixed-value wrapper, not dropped. See docs/TASKS.md #216 --
// narrowed to slack's `oneOf [object, array]`, which has a real object member and is out of scope.
test('test_gap_216_container_whose_fields_all_vanish_drops', async () => {
  const { sdl, parsed, findings } = await findingsFor('container-whose-fields-all-vanish-drops.yaml', 'get:/folders');
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(findings, []);
  assert.ok(sdl.includes('uris: Uris'), 'the container survives once its own fields do');
  for (const name of ['All', 'Css', 'Js']) {
    assert.ok(
      sdl.includes(`type ${name}Union {\n  text: String\n  list: [String]\n  raw: JSON\n}`),
      `${name} gets the mixed-value wrapper, not a silent drop`,
    );
  }
});

test('test_gap_217_empty_string_property_name_is_a_checker_false_positive', async () => {
  const { sdl, parsed, findings } = await findingsFor('empty-string-property-name.yaml', 'get:/status');
  assert.ok(parsed.selections.length > 0);
  assert.ok(sdl.includes('_: String'), 'a property named "" sanitises to `_` and is written');
  assert.ok(sdl.includes('_: $.""?'), 'and its selection does read the empty key');
  assert.deepEqual(findings, [{ code: 'RESPONSE_FIELD_NOT_READ', field: '' }], 'not a drop -- the checker still reports it, wrongly');
});

test('test_gap_218_allof_two_plain_members_vanishes', async () => {
  const { sdl, parsed, findings } = await findingsFor('allof-two-plain-members.yaml', 'get:/actions');
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(findings, [{ code: 'RESPONSE_FIELD_NOT_READ', field: 'region_slug' }]);
  assert.ok(!sdl.includes('region_slug') && !sdl.includes('regionSlug'));
});

test('test_gap_214_allof_wrapping_scalar_oneof_vanishes', async () => {
  const { sdl, parsed, findings } = await findingsFor('allof-wrapping-scalar-oneof.yaml', 'get:/assessments');
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(findings, [{ code: 'RESPONSE_FIELD_NOT_READ', field: 'value' }]);
  assert.ok(!sdl.includes('value'));
});

test('test_gap_238_allof_wrapping_recursive_ref_vanishes', async () => {
  const { sdl, parsed, findings } = await findingsFor('allof-wrapping-recursive-ref.yaml', 'get:/event');
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(findings, [{ code: 'RESPONSE_FIELD_NOT_READ', field: 'templateEvent' }]);
  assert.ok(!sdl.includes('templateEvent'));
});

test('test_gap_184_contradictory_nullable_oneof_vanishes', async () => {
  const { parsed, findings } = await findingsFor('required-nullable-oneof.yaml', 'get:/thing', { skipValidation: true });
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(
    [...findings].sort((a, b) => a.field!.localeCompare(b.field!)),
    [
      { code: 'RESPONSE_FIELD_NOT_READ', field: 'constrained' },
      { code: 'RESPONSE_FIELD_NOT_READ', field: 'doubleNull' },
    ],
  );
});

test('test_gap_183_false_response_not_read_on_empty_responses', async () => {
  const { parsed, findings } = await findingsFor('malformed-response-schema-crashes.yaml', 'get:/markers');
  assert.ok(parsed.selections.length > 0);
  assert.deepEqual(findings, [{ code: 'RESPONSE_NOT_READ', field: undefined }]);
});
