import { test } from 'node:test';
import assert from 'node:assert';
import { runConnectorTest } from '../../src/tests/connectors.js';
import './_setup.js';

// Harness proof: an existing, already-correct shape (no JSON fallback involved) run end to end
// against test-connectors, to prove runConnectorTest's mechanics before it carries real fallback
// fixtures. Skips when the test-connectors binary is absent; see connectors.ts for the policy.

test('petstore GET /pet/{petId} runs against test-connectors', async (t) => {
  const result = await runConnectorTest(
    'petstore.yaml',
    ['get:/pet/{petId}>**'],
    'tests/resources/connectors/petstore/get-pet.connector.yaml',
  );
  if (result.skipped) {
    t.skip(result.output);
    return;
  }
  assert.ok(result.success, result.output);
});

// Runs one case file for a fixture through the freshly generated, stock-composed SDL.
async function runFixtureCase(t: import('node:test').TestContext, fixture: string, paths: string[], dir: string, name: string) {
  const result = await runConnectorTest(fixture, paths, `tests/resources/connectors/${dir}/${name}.connector.yaml`);
  if (result.skipped) {
    t.skip(result.output);
    return;
  }
  assert.ok(result.success, result.output);
}

// Ashby OverlayCustomField.value shape: a nested oneOf mixing object and non-object members.
const NESTED_PATHS = ['get:/overlay.list>**'];
const NESTED_CASES = ['boolean', 'currency-object', 'date-string', 'null'];
for (const name of NESTED_CASES) {
  test(`nested-oneof-branch-loss: ${name}`, (t) =>
    runFixtureCase(t, 'nested-oneof-branch-loss.yaml', NESTED_PATHS, 'nested-oneof-branch-loss', name));
}

// Ashby CustomField.value shape: oneOf of scalars, a list, and two differently-shaped objects.
const MIXED_PATHS = ['get:/customField.list>**'];
const MIXED_CASES = ['boolean', 'number', 'string', 'array', 'object-currency', 'object-location', 'null'];
for (const name of MIXED_CASES) {
  test(`oneof-mixed-scalars-objects: ${name}`, (t) =>
    runFixtureCase(t, 'oneof-mixed-scalars-objects.yaml', MIXED_PATHS, 'oneof-mixed-scalars-objects', name));
}

// Same shape, anyOf-spelled and all nine members as Ashby actually writes it (#220).
for (const name of MIXED_CASES) {
  test(`anyof-mixed-scalars-objects: ${name}`, (t) =>
    runFixtureCase(t, 'anyof-mixed-scalars-objects.yaml', MIXED_PATHS, 'anyof-mixed-scalars-objects', name));
}

// PropComp.select() selection head: a field whose OAS name needs sanitising (`custom-value` ->
// `customValue`) proven at runtime — the aliased fetch must still pull from the original JSON key.
const HEAD_VARIANTS_PATHS = ['get:/thing.get>**'];
test('propcomp-select-head-variants: renamed-field', (t) =>
  runFixtureCase(t, 'propcomp-select-head-variants.yaml', HEAD_VARIANTS_PATHS, 'propcomp-select-head-variants', 'renamed-field'));

// FIXED #208 (widened): mixed-value fields at the list-item and map-value positions — PropArray's
// `->map(@selectionSuffix)` head and Map.selectEntries' `value: value<selectionSuffix>` head, each
// runtime-proven.
const MIXED_VALUE_CASES = ['boolean', 'currency-object', 'date-string', 'null', 'object-missing-field'];

const LIST_ITEMS_PATHS = ['get:/values.list>**'];
for (const name of MIXED_VALUE_CASES) {
  test(`mixed-value-list-items: ${name}`, (t) =>
    runFixtureCase(t, 'mixed-value-list-items.yaml', LIST_ITEMS_PATHS, 'mixed-value-list-items', name));
}

// anyOf list items get the same mixed-value type as their oneOf twin above.
for (const name of MIXED_VALUE_CASES) {
  test(`mixed-value-list-items-anyof: ${name}`, (t) =>
    runFixtureCase(t, 'mixed-value-list-items-anyof.yaml', LIST_ITEMS_PATHS, 'mixed-value-list-items-anyof', name));
}

const MAP_VALUES_PATHS = ['get:/byKey.get>**'];
for (const name of MIXED_VALUE_CASES) {
  test(`mixed-value-map-values: ${name}`, (t) =>
    runFixtureCase(t, 'mixed-value-map-values.yaml', MAP_VALUES_PATHS, 'mixed-value-map-values', name));
}

// FIXED #208 (follow-up): the object branch nests a list of objects (Confluence labels.results:
// [Label]) and follows the real selection instead of a hand-rolled loop over every member field.
const OBJECT_BRANCH_NESTED_LIST_PATHS = ['get:/content.descendant>**'];
const OBJECT_BRANCH_NESTED_LIST_CASES = ['two-labels', 'empty-list', 'plain-string'];
for (const name of OBJECT_BRANCH_NESTED_LIST_CASES) {
  test(`mixed-value-object-branch-nested-list: ${name}`, (t) =>
    runFixtureCase(
      t,
      'mixed-value-object-branch-nested-list.yaml',
      OBJECT_BRANCH_NESTED_LIST_PATHS,
      'mixed-value-object-branch-nested-list',
      name,
    ));
}

// FIXED #208 (follow-up): a real object payload must not land in the number field when no
// object-member prop was selected — the "{" match branch must still claim it.
const OBJECT_MEMBER_UNSELECTED_PATHS = [
  'get:/customField.list>res:r>obj:type:customFieldListResponse>prop:comp:value',
];
const OBJECT_MEMBER_UNSELECTED_CASES = ['object-no-number-fallback', 'number-still-routes-with-no-object-field'];
for (const name of OBJECT_MEMBER_UNSELECTED_CASES) {
  test(`oneof-mixed-scalars-objects (object member unselected): ${name}`, (t) =>
    runFixtureCase(t, 'oneof-mixed-scalars-objects.yaml', OBJECT_MEMBER_UNSELECTED_PATHS, 'oneof-mixed-scalars-objects', name));
}

// FIXED #208: two object members disagree on `data`'s shape (scalar vs. list) — Union.dedupeByName
// degrades it to JSON instead of silently keeping one branch's shape, proven with both bodies.
const INCOMPATIBLE_FIELDS_PATHS = ['get:/entry.get>**'];
const INCOMPATIBLE_FIELDS_CASES = ['data-string', 'data-array'];
for (const name of INCOMPATIBLE_FIELDS_CASES) {
  test(`mixed-value-object-branch-incompatible-fields: ${name}`, (t) =>
    runFixtureCase(
      t,
      'mixed-value-object-branch-incompatible-fields.yaml',
      INCOMPATIBLE_FIELDS_PATHS,
      'mixed-value-object-branch-incompatible-fields',
      name,
    ));
}

// Two objects disagree on a list field's item shape (same old "array" kind) — the flat merge's
// own dedupeByName call, proven with both branches' bodies.
const LIST_SHAPE_CLASH_PATHS = ['get:/party.get>**'];
const LIST_SHAPE_CLASH_CASES = ['list-of-strings', 'list-of-objects'];
for (const name of LIST_SHAPE_CLASH_CASES) {
  test(`flat-merge-list-of-strings-vs-list-of-objects: ${name}`, (t) =>
    runFixtureCase(
      t,
      'flat-merge-list-of-strings-vs-list-of-objects.yaml',
      LIST_SHAPE_CLASH_PATHS,
      'flat-merge-list-of-strings-vs-list-of-objects',
      name,
    ));
}

// Two objects disagree on an enum field's values (same old "enum" kind) — the mixed value's own
// dedupeByName call, proven with both branches' bodies.
const ENUM_VALUE_CLASH_PATHS = ['get:/entry.get>**'];
const ENUM_VALUE_CLASH_CASES = ['record-a', 'record-b'];
for (const name of ENUM_VALUE_CLASH_CASES) {
  test(`mixed-value-object-branch-incompatible-enums: ${name}`, (t) =>
    runFixtureCase(
      t,
      'mixed-value-object-branch-incompatible-enums.yaml',
      ENUM_VALUE_CLASH_PATHS,
      'mixed-value-object-branch-incompatible-enums',
      name,
    ));
}

// An integer enum is classified as a number, not text.
test('mixed-value-integer-enum-number: integer-enum-value', (t) =>
  runFixtureCase(
    t,
    'mixed-value-integer-enum-number.yaml',
    ['get:/entry.get>**'],
    'mixed-value-integer-enum-number',
    'integer-enum-value',
  ));

// A string with no text member fills only raw, not the number field.
test('mixed-value-number-object-no-text: string-with-no-text-member', (t) =>
  runFixtureCase(
    t,
    'mixed-value-number-object-no-text.yaml',
    ['get:/entry.get>**'],
    'mixed-value-number-object-no-text',
    'string-with-no-text-member',
  ));

// A field read through ->jsonStringify (a wide integer) does not merge with a plain string field
// — both bodies come back unchanged, in both member orders.
const STRINGIFIED_NUMBER_PATHS = ['get:/entry.get>**'];
const STRINGIFIED_NUMBER_CASES = ['plain-string', 'wide-integer'];
for (const name of STRINGIFIED_NUMBER_CASES) {
  test(`merge-stringified-number-vs-string: ${name}`, (t) =>
    runFixtureCase(
      t,
      'merge-stringified-number-vs-string.yaml',
      STRINGIFIED_NUMBER_PATHS,
      'merge-stringified-number-vs-string',
      name,
    ));
}

// Two enums under one field name merge into one enum holding both value sets — both values come
// back as themselves, not JSON.
const MERGE_ENUM_PATHS = ['get:/entry.get>**'];
const MERGE_ENUM_CASES = ['value-a', 'value-b'];
for (const name of MERGE_ENUM_CASES) {
  test(`merge-enum-value-sets: ${name}`, (t) =>
    runFixtureCase(t, 'merge-enum-value-sets.yaml', MERGE_ENUM_PATHS, 'merge-enum-value-sets', name));
}

// Regression: a property literally named `enum` used to collapse two unrelated merges into one
// node and lose one side's values — both schemas' own values must survive.
const MERGE_ENUM_NAMED_PATHS = ['get:/a.get>**', 'get:/b.get>**'];
test('merge-enum-value-sets-field-named-enum: schema-a', (t) =>
  runFixtureCase(
    t,
    'merge-enum-value-sets-field-named-enum.yaml',
    MERGE_ENUM_NAMED_PATHS,
    'merge-enum-value-sets-field-named-enum',
    'schema-a',
  ));
test('merge-enum-value-sets-field-named-enum: schema-b', (t) =>
  runFixtureCase(
    t,
    'merge-enum-value-sets-field-named-enum.yaml',
    MERGE_ENUM_NAMED_PATHS,
    'merge-enum-value-sets-field-named-enum',
    'schema-b',
  ));

// Two same-named objects fold under declaresEveryKeptField: a compatible pair keeps its typed
// shape end to end, an incompatible one keeps working as JSON.
const COMPATIBLE_CASES = ['basic', 'rich'];
for (const name of COMPATIBLE_CASES) {
  test(`merge-object-refs: compatible.${name}`, (t) =>
    runFixtureCase(t, 'merge-object-refs.yaml', ['get:/compatible>**'], 'merge-object-refs', `compatible.${name}`));
}

const NESTED_CLASH_CASES = ['a', 'b'];
for (const name of NESTED_CLASH_CASES) {
  test(`merge-object-refs: nested-clash.${name}`, (t) =>
    runFixtureCase(
      t,
      'merge-object-refs.yaml',
      ['get:/nested-clash>**'],
      'merge-object-refs',
      `nested-clash.${name}`,
    ));
}

// A required mismatch on the colliding field itself, not inside it: member B's body omits detail
// entirely, the exact body a required DetailBasic! would fail on at execution.
test('merge-object-refs: outer-required-mismatch.no-detail', (t) =>
  runFixtureCase(
    t,
    'merge-object-refs.yaml',
    ['get:/outer-required-mismatch>**'],
    'merge-object-refs',
    'outer-required-mismatch.no-detail',
  ));

// A real $ref shared by both members reads through end to end, no execution error either way.
const SAME_TYPE_CASES = ['a', 'b'];
for (const name of SAME_TYPE_CASES) {
  test(`merge-object-refs: same-type.${name}`, (t) =>
    runFixtureCase(t, 'merge-object-refs.yaml', ['get:/same-type>**'], 'merge-object-refs', `same-type.${name}`));
}

// The outer requiredness check on a shared $ref: member B's body omits detail entirely.
test('merge-object-refs: same-type-required-mismatch.no-detail', (t) =>
  runFixtureCase(
    t,
    'merge-object-refs.yaml',
    ['get:/same-type-required-mismatch>**'],
    'merge-object-refs',
    'same-type-required-mismatch.no-detail',
  ));

// Two components generating the same display name: a body shaped like the optional one, the exact
// body a written-name-only shortcut would incorrectly type as code: String! and crash on.
test('merge-object-refs: colliding-name-required-mismatch.detail-underscore-a', (t) =>
  runFixtureCase(
    t,
    'merge-object-refs.yaml',
    ['get:/colliding-name-required-mismatch>**'],
    'merge-object-refs',
    'colliding-name-required-mismatch.detail-underscore-a',
  ));

// Two inline detail oneOfs sharing one id across a request/response name-sharing pair: a body
// shaped like the second member, the exact body a bare-id shortcut would crash on.
test('merge-object-refs: get-mixed-detail.member-b', (t) =>
  runFixtureCase(
    t,
    'merge-object-refs.yaml',
    ['post:/create-detail>**', 'get:/get-mixed-detail>**'],
    'merge-object-refs',
    'get-mixed-detail.member-b',
  ));
