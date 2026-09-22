import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureErrors } from './_setup.js';
import { Factory, IType, PropArray, PropComp, Union } from '../../src/oas/nodes/internal.js';
import { Schemas } from '../../src/oas/utils/schemas.js';
import { SchemaObject } from 'oas/types';

// --- FIXED #208: one field per kind, for a nested oneOf mixing object and non-object members ---

test('test_208_nested_oneof_mixed_value_type_and_selection', async () => {
  // Ashby OverlayCustomField.value: oneOf [boolean, { currencyCode, value }, string(date)]. No
  // number member, so no `[@, ...]` fallback branch.
  const schema = await runOasTest('nested-oneof-branch-loss.yaml', ['get:/overlay.list>**'], 2, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type ValueUnion {\n  text: String\n  boolean: Boolean\n  object: ValueUnionObject\n  raw: JSON\n}'),
    'mixed value keeps text/boolean/object/raw, no number field',
  );
  assert.ok(
    schema!.includes('type ValueUnionObject {\n  currencyCode: String\n  value: Float\n}'),
    'merged object keeps both Currency fields, nullable',
  );
  assert.ok(schema!.includes('value: value?->echo({ raw: @ }) {'), 'selection head reads the whole value');
  assert.ok(schema!.includes('["\\"", { text: raw }]'), 'string branch');
  assert.ok(schema!.includes('["t", { boolean: raw }]'), 'boolean-true branch');
  assert.ok(schema!.includes('["f", { boolean: raw }]'), 'boolean-false branch');
  assert.ok(schema!.includes('["{", { object: raw {'), 'object branch');
  assert.ok(schema!.includes('[@, {}]'), 'null catch-all — no number member in this fixture');
});

test('test_208_nested_oneof_mixed_value_composes_patched', async () => {
  // Same fixture through the patched local composer (skipped, not failed, when it isn't present —
  // runOasTest's compose() falls back to system rover automatically).
  const schema = await runOasTest('nested-oneof-branch-loss.yaml', ['get:/overlay.list>**'], 2, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ValueUnionObject'), 'the object type composes on the patched path too');
});

test('test_208_mixed_scalars_objects_mixed_value_full_shape', async () => {
  // Ashby CustomField.value spelled as oneOf: string, number, boolean, string list, two objects
  // with disjoint fields. Exercises every kind, the list field, and the `[@, ...]` number fallback.
  const schema = await runOasTest('oneof-mixed-scalars-objects.yaml', ['get:/customField.list>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes(
      'type ValueUnion {\n  text: String\n  number: Float\n  boolean: Boolean\n  list: [String]\n  object: ValueUnionObject\n  raw: JSON\n}',
    ),
    'the type carries every kind present in the oneOf',
  );
  assert.ok(schema!.includes('["[", { list: raw }]'), 'list branch');
  assert.ok(schema!.includes('["-", { number: raw }]'), 'number branch has an explicit arm for a leading minus');
  assert.ok(schema!.includes('["9", { number: raw }]'), 'number branch has an explicit arm for each digit');
  assert.ok(schema!.includes('[@, {}]'), 'the catch-all is empty — a number member no longer claims it');
  // the two object members' disjoint fields all merged in, each nullable (no `!`)
  for (const field of ['currencyCode: String', 'value: Float', 'city: String', 'country: String', 'region: String']) {
    assert.ok(schema!.includes(field), `merged object keeps ${field}`);
    assert.ok(!schema!.includes(field + '!'), `${field} stays nullable — only one branch populates it`);
  }
});

test('test_208_mixed_scalars_objects_composes_patched', async () => {
  const schema = await runOasTest('oneof-mixed-scalars-objects.yaml', ['get:/customField.list>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('["-", { number: raw }]'), 'the mixed-value type composes on the patched path too');
});

test('test_220_anyof_mixed_scalars_objects_mixed_value_full_shape', async () => {
  // Ashby CustomField.value, as written: anyOf of nine members (boolean, number, string, string
  // list, four objects, null) -- the same mixed-value type its oneOf twin gets (#208).
  const schema = await runOasTest('anyof-mixed-scalars-objects.yaml', ['get:/customField.list>**'], 2, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes(
      'type CustomFieldValue {\n  text: String\n  number: Float\n  boolean: Boolean\n  list: [String]\n  object: CustomFieldValueObject\n  raw: JSON\n}',
    ),
    'the type carries every kind present in the anyOf',
  );
  assert.ok(
    schema!.includes('"The value of the custom field"\n  value: CustomFieldValue'),
    'value keeps its own description, no JSON note',
  );
  // all four object members' fields merged in, each nullable (no `!`)
  for (const field of [
    'currencyCode: String',
    'value: Float',
    'type: String',
    'minValue: Float',
    'maxValue: Float',
    'interval: String',
    'country: String',
    'region: String',
    'city: String',
  ]) {
    assert.ok(schema!.includes(field), `merged object keeps ${field}`);
    assert.ok(!schema!.includes(field + '!'), `${field} stays nullable — only one branch populates it`);
  }
});

test('test_220_anyof_mixed_scalars_objects_composes_patched', async () => {
  const schema = await runOasTest('anyof-mixed-scalars-objects.yaml', ['get:/customField.list>**'], 2, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type CustomFieldValueObject'), 'the object type composes on the patched path too');
});

test('test_220_named_members_anyof_stays_json', async () => {
  // Customer.default_source: anyOf [string, $ref Card] — a named-ref anyOf member rebuilds Card's
  // shared schema on every branch, so it stays JSON instead of building a cyclic union. #223
  const schema = await runOasTest('mixed-choice-customer-card-cycle.yaml', ['get:/customers>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('defaultSource: JSON'), 'the named-ref anyOf member stays JSON');
  assert.ok(
    schema!.includes('an anyOf whose object members are named schemas is sent as raw JSON for now'),
    'the docstring carries the namedMembersAnyOf reason',
  );

  // the same schema spelled oneOf still builds a union — only anyOf takes the new guard.
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-choice-customer-card-cycle.yaml`, { showParentInSelections: false });
  const context = gen.getContext();
  for (const [name, field] of [['Customer', 'default_source'], ['Card', 'customer']]) {
    const owner = context.resolvePointer(`#/components/schemas/${name}`) as SchemaObject;
    const choice = owner.properties![field] as SchemaObject;
    choice.oneOf = choice.anyOf;
    delete choice.anyOf;
  }
  await gen.visit();
  const oneOfSchema = gen.generateSchema(['get:/customers>**']);
  assert.ok(oneOfSchema.includes('defaultSource: DefaultSourceUnion'), 'the oneOf spelling still builds a union');
  assert.ok(!oneOfSchema.includes('defaultSource: JSON'), 'only the anyOf spelling takes the new guard');
});

test('test_220_anyof_input_guard_sends_json_not_mixed_value', async () => {
  // The same anyOf reused as a request body field: mixed values are output-only, so the input
  // side degrades to JSON with the mixedInputChoice reason, same as the oneOf spelling.
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/anyof-mixed-scalars-objects.yaml`, { showParentInSelections: false });
    await gen.visit();
    const schema = gen.generateSchema(['post:/customField.set>**']);
    assert.ok(schema.includes('input CreateCustomFieldSetInput {'), 'input type is written');
    assert.ok(schema.includes('fieldValue: JSON'), 'the mixed anyOf degrades to JSON, not a Union input');
    assert.ok(
      schema.includes('rebuilding it as a typed input is not implemented yet'),
      'the docstring carries the mixedInputChoice reason',
    );
  });
  assert.ok(
    messages.some((m) => m.includes('rebuilding it as a typed input is not implemented yet')),
    'warn() ran before the JSON fallback',
  );
});

test('test_220_anyof_scalars_only_degrades_with_reason', async () => {
  // An anyOf of only plain scalars gets the same reason its oneOf twin already has, not the
  // generic unknownShape fallback that hid every anyOf shape before this change.
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/anyof-scalars-only.yaml`, { showParentInSelections: false });
    await gen.visit();
    const schema = gen.generateSchema(['get:/thing>**']);
    assert.ok(schema.includes('score: JSON'), 'the plain-only anyOf degrades to JSON');
    assert.ok(
      schema.includes('a oneOf of only plain scalar/enum values has no GraphQL union member to build'),
      'the docstring carries the scalarOnlyOneOf reason',
    );
  });
  assert.ok(
    messages.some((m) => m.includes('a oneOf of only plain scalar/enum values')),
    'warn() ran before the JSON fallback',
  );
});

test('test_212_anyof_objects_only_stays_json_oneof_twin_still_unions', async () => {
  // Keeps object-only anyOf as JSON while preserving the existing oneOf result.
  // e.g. anyOf: [$ref A { code required }, $ref B { code optional }]
  const schema = await runOasTest('anyof-objects-only-refs.yaml', ['get:/thing>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('anyValue: JSON'), 'the anyOf spelling stays JSON');
  assert.ok(
    schema!.includes('an anyOf of only objects is sent as raw JSON'),
    'the docstring carries the objectOnlyAnyOf reason',
  );
  assert.ok(schema!.includes('oneValue: OneValueUnion'), "the oneOf twin still builds a Union — this slice doesn't touch it");
  assert.ok(schema!.includes('#### union degraded to a merged object:'), "oneOf's existing #212 gap is untouched");
});

test('test_212_anyof_mixed_wide_integer_stays_json', async () => {
  // A mixed anyOf analyzeMixedValue can't build (an int64 blocks it, same as it would for oneOf)
  // stays JSON with its own reason — no Union is built, so there is no merged `code` to get wrong.
  const schema = await runOasTest('anyof-mixed-wide-integer-required-mismatch.yaml', ['get:/thing>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('anyValue: JSON'), 'the anyOf spelling stays JSON, no Union, no merged field');
  assert.ok(
    schema!.includes("a mixed anyOf here can't build a mixed-value type"),
    'the docstring carries the unbuildableMixedAnyOf reason',
  );
});

test('test_212_oneof_mixed_wide_integer_unchanged', async () => {
  // The oneOf spelling of the exact same shape merges unsafely today, unchanged by this slice —
  // the same gap test_208_wide_integer_member_keeps_todays_merge already pins for oneOf alone.
  const schema = await runOasTest('anyof-mixed-wide-integer-required-mismatch.yaml', ['get:/thing>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('oneValue: OneValueUnion'), 'the oneOf spelling still builds a Union');
  assert.ok(schema!.includes('#### union degraded to a merged object:'), "today's merge downgrade, not blocked");
  assert.ok(!schema!.includes('type OneValueUnionObject'), 'no mixed-value object type — MixedValue did not build');
});

test('test_208_input_guard_sends_json_not_mixed_value', async () => {
  // Same mixed oneOf reused as a request body: GraphQL has no input unions, and mixed values are
  // output-only, so the input side degrades to JSON with the mixedInputChoice reason.
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/nested-oneof-branch-loss.yaml`, { skipValidation: true });
    await gen.visit();
    const schema = gen.generateSchema(['post:/overlay.create>**']);
    assert.ok(schema.includes('input CreateOverlayCreateInput {'), 'input type is written');
    assert.ok(schema.includes('value: JSON'), 'the mixed choice degrades to JSON, not a Union input');
    assert.ok(
      schema.includes('rebuilding it as a typed input is not implemented yet'),
      'the docstring carries the mixedInputChoice reason',
    );
  });
  assert.ok(
    messages.some((m) => m.includes('rebuilding it as a typed input is not implemented yet')),
    'warn() ran before the JSON fallback',
  );
});

test('test_208_wide_integer_member_keeps_todays_merge', async () => {
  // A oneOf of int64 + object doesn't fit the Float `number` field — the union keeps today's
  // (lossy) merge behaviour instead, plus a warn recording the open gap.
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/oneof-wide-integer-gap.yaml`, { skipValidation: true });
    await gen.visit();
    const schema = gen.generateSchema(['get:/entry.list>**']);
    assert.ok(schema.includes('#### union degraded to a merged object:'), "today's merge downgrade, not a mixed value");
    assert.ok(!schema.includes('type ValueUnionObject'), 'no mixed-value object type — MixedValue did not build');
  });
  assert.ok(
    messages.some((m) => m.includes("wide-integer member in a mixed oneOf keeps today's merge")),
    'the open gap is recorded with a warn',
  );
});

// --- FIXED #208 (widened): mixed value fields at the list-item and map-value positions ---------

test('test_208_mixed_value_list_items_type_and_selection', async () => {
  const schema = await runOasTest('mixed-value-list-items.yaml', ['get:/values.list>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('values: [ValuesUnion]'), 'the list keeps every item as a mixed-value union');
  assert.ok(
    schema!.includes('type ValuesUnion {\n  text: String\n  boolean: Boolean\n  object: ValuesUnionObject\n  raw: JSON\n}'),
  );
  assert.ok(
    schema!.includes('values: values?->map(@->echo({ raw: @ })) {'),
    'the array writer owns ->map(@selectionSuffix), runtime-verified head',
  );
  assert.ok(schema!.includes('[@, {}]'), 'null catch-all — no number member in this fixture');
});

test('test_208_mixed_value_list_items_composes_patched', async () => {
  const schema = await runOasTest('mixed-value-list-items.yaml', ['get:/values.list>**'], 1, 3);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ValuesUnionObject'), 'the object type composes on the patched path too');
});

test('test_208_mixed_value_map_values_type_and_selection', async () => {
  const schema = await runOasTest('mixed-value-map-values.yaml', ['get:/byKey.get>**'], 1, 4, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('value: ByKeyEntryUnion'), 'the map entry value keeps every kind');
  assert.ok(
    schema!.includes('type ByKeyEntryUnion {\n  text: String\n  boolean: Boolean\n  object: ByKeyEntryUnionObject\n  raw: JSON\n}'),
  );
  assert.ok(
    schema!.includes('value: value->echo({ raw: @ }) {'),
    "Map.selectEntries' value line owns selectionSuffix, runtime-verified head",
  );
  assert.ok(schema!.includes('[@, {}]'), 'null catch-all — no number member in this fixture');
});

test('test_208_mixed_value_map_values_composes_patched', async () => {
  const schema = await runOasTest('mixed-value-map-values.yaml', ['get:/byKey.get>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ByKeyEntryUnionObject'), 'the object type composes on the patched path too');
});

test('test_208_mixed_value_list_items_nested_list_unchanged', async () => {
  // A union whose immediate parent is an Arr (list of lists) is not widened — analyzeMixedValue()
  // deliberately excludes it, and fromArrayItems's inner call never reaches PropArray either.
  const schema = await runOasTest('mixed-value-list-items-nested.yaml', ['get:/values.list>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('values: [[JSON]]'), 'a nested list of the mixed shape is unchanged');
});

test('test_208_mixed_value_list_items_wide_integer_gap_unchanged', async () => {
  // Schemas.analyzeMixedValue shares GqlUtils.gqlScalarFor with the real bailout, so a wide
  // integer never even reaches Union construction here — fromArrayItems keeps today's [JSON].
  const schema = await runOasTest('mixed-value-list-items-wide-integer-gap.yaml', ['get:/values.list>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('values: [JSON]'), 'a wide-integer member as a list item is unchanged');
});

test('test_208_mixed_value_list_items_anyof', async () => {
  // Factory.fromArrayItems reads items.oneOf ?? items.anyOf now, so an anyOf list item gets the
  // same mixed-value type as its oneOf twin (mixed-value-list-items.yaml).
  const schema = await runOasTest('mixed-value-list-items-anyof.yaml', ['get:/values.list>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('values: [ValuesUnion]'), 'the list keeps every item as a mixed-value union');
  assert.ok(
    schema!.includes('type ValuesUnion {\n  text: String\n  boolean: Boolean\n  object: ValuesUnionObject\n  raw: JSON\n}'),
  );
  assert.ok(schema!.includes('[@, {}]'), 'null catch-all — no number member in this fixture');
});

test('test_220_named_members_anyof_list_item_stays_json', async () => {
  // Stripe invoice.discounts: items.anyOf [string, $ref Discount, $ref DeletedDiscount] — the
  // same named-ref limit as fromProp's anyOf arms, now at the list-item position. #223
  const schema = await runOasTest('mixed-value-list-items-named-refs.yaml', ['get:/invoices.list>**'], 1, 5, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('namedRefs: [JSON]'), 'a named-ref anyOf list item stays JSON');
  assert.ok(
    schema!.includes('an anyOf whose object members are named schemas is sent as raw JSON for now'),
    "namedRefs' docstring carries the namedMembersAnyOf reason, not the old generic mixed-value text",
  );
  assert.ok(
    schema!.includes('inlineRefs: [InlineRefsUnion]'),
    'inline object members still build a mixed-value union — the guard fires on "named", not on "mixed" alone',
  );
});

test('test_220_named_members_oneof_list_item_unchanged', async () => {
  // The same three members spelled items.oneOf keep building a mixed-value union — the new guard
  // only applies to items.anyOf, the same split fromProp already draws.
  const schema = await runOasTest('mixed-value-list-items-named-refs.yaml', ['get:/invoices.list>**'], 1, 5, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('namedRefsOneof: [NamedRefsOneofUnion]'), 'a named-ref oneOf list item still builds a union');
  assert.ok(!schema!.includes('namedRefsOneof: [JSON]'), 'the anyOf-only guard does not fire for oneOf');
});

test('test_208_mixed_value_list_items_nested_oneof_member_unchanged', async () => {
  // The object-shaped member is itself a oneOf, so createContainerType builds it as a nested
  // Union, not an Obj/Composed — isRealObjectMember must not count it, or this would wrongly
  // build the outer Union and fall through to the #131 lossy merge at generate time.
  const schema = await runOasTest('mixed-value-list-items-nested-oneof-member.yaml', ['get:/values.list>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('values: [JSON]'), 'a nested-oneOf object member keeps the list item unchanged');
});

test('test_208_mixed_value_map_values_input_unchanged', async () => {
  // The output-only guard (kind === 'input') is the backstop for map values: Map.visitAdditionalProperties
  // builds through Factory.fromSchema directly, with nothing upstream checking kind.
  const schema = await runOasTest('mixed-value-map-values-input.yaml', ['post:/byKey.create>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('byKey: JSON'), "an input map's mixed oneOf value never gets a mixed-value type");
});

test('test_208_mixed_value_map_values_anyof_matches_oneof', async () => {
  // Map.visitAdditionalProperties never distinguished oneOf from anyOf before this change, so
  // widening analyzeMixedValue()'s parent check makes an anyOf-sourced map value eligible exactly
  // like the oneOf version — a deliberate symmetry, not a new asymmetry.
  const schema = await runOasTest('mixed-value-map-values-anyof.yaml', ['get:/byKey.get>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type ByKeyEntryUnion {\n  text: String\n  boolean: Boolean\n  object: ByKeyEntryUnionObject\n  raw: JSON\n}'),
    'anyOf at the map-value position gets a mixed-value type exactly like oneOf',
  );
});

// --- FIXED #208 (follow-up): the object branch follows the selection, clones keep their own path ---

test('test_208_object_branch_nested_list_type_and_selection', async () => {
  // Confluence content.descendant's labels: oneOf [string, { results: [Label] }] — the object
  // branch nests a list of objects, not flat scalars.
  const schema = await runOasTest('mixed-value-object-branch-nested-list.yaml', ['get:/content.descendant>**'], 1, 4, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type LabelsUnion {\n  text: String\n  object: LabelsUnionObject\n  raw: JSON\n}'),
    'mixed value keeps text/object/raw',
  );
  assert.ok(schema!.includes('type LabelsUnionObject {\n  results: [Label]\n}'), 'the object type keeps the nested list field');
  assert.ok(
    schema!.includes('type Label {\n  id: ID\n  label: String\n  name: String\n  prefix: String\n}'),
    'the list item type keeps every field, not a bare stub',
  );
  assert.ok(schema!.includes('["{", { object: raw {'), 'object branch');
  for (const field of ['id?', 'label?', 'name?', 'prefix?']) {
    assert.ok(schema!.includes(field), `object branch selects ${field}, not a bare results? { }`);
  }
});

test('test_208_object_branch_nested_list_composes_patched', async () => {
  const schema = await runOasTest('mixed-value-object-branch-nested-list.yaml', ['get:/content.descendant>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type LabelsUnionObject'), 'the object type composes on the patched path too');
});

test('test_208_object_branch_drops_a_field_left_out_of_the_selection', async () => {
  // A selection naming id/label/name but not prefix: MixedValue's clone filter only takes a member
  // prop whose path is selected, and Label's own field filtering does the rest.
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-object-branch-nested-list.yaml`, { skipValidation: true });
  await gen.visit();
  const member =
    'get:/content.descendant>res:r>obj:type:contentDescendantResponse>prop:comp:labels>union:type:labelsUnion' +
    '>obj:type:[inline:labelsUnion]>prop:array:#results>obj:type:#/c/s/Label';
  const schema = gen.generateSchema([`${member}>prop:scalar:id`, `${member}>prop:scalar:label`, `${member}>prop:scalar:name`]);
  assert.ok(schema.includes('type Label {\n  id: ID\n  label: String\n  name: String\n}'), 'Label drops prefix everywhere it is written');
  assert.ok(!schema.includes('prefix'), 'neither the type nor the object branch selection mentions prefix');
});

test('test_208_object_branch_every_object_field_left_out_keeps_the_match_branch', async () => {
  // No object-member field selected at all: no `object` field, no `<Name>Object` type — but the
  // `["{", ...]` match branch stays, so an object payload can't land in the number field instead.
  const schema = await runOasTest(
    'mixed-value-object-branch-nested-list.yaml',
    ['get:/content.descendant>res:r>obj:type:contentDescendantResponse>prop:comp:labels>union:type:labelsUnion'],
    1,
    2,
  );
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('object:'), 'no object field on the union type');
  assert.ok(!schema!.includes('LabelsUnionObject'), 'no <Name>Object type at all — it would be empty');
  assert.ok(schema!.includes('["{", {}]'), 'the "{" branch still claims the prefix, writing {}');
  assert.ok(schema!.includes('text: String'), 'the other mixed-value fields are still written');
});

test('test_208_object_branch_nested_list_pre_mixed_value_path_recovers_nested_fields', async () => {
  // A pre-mixed-value flat path over a member with something nested under it (not just a flat
  // scalar, like the three existing recovery tests): the recovery must expand into Label's own
  // fields, not stop at a bare `results? { }`.
  const preMixedValuePath =
    'get:/content.descendant>res:r>obj:type:contentDescendantResponse>prop:comp:labels>union:type:labelsUnion>prop:scalar:prefix';
  const schema = await runOasTest('mixed-value-object-branch-nested-list.yaml', [preMixedValuePath], 1, 4, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type Label {\n  id: ID\n  label: String\n  name: String\n  prefix: String\n}'),
    'every field recovers, not just the one named in the old flat path',
  );
  assert.ok(!schema!.includes('results? { }') && !schema!.includes('results? {\n         }'), 'not a bare results? { }');
  for (const field of ['id?', 'label?', 'name?', 'prefix?']) {
    assert.ok(schema!.includes(field), `object branch selection reaches ${field}`);
  }
});

// --- An object payload must not land in the number field ---

test('test_208_object_member_present_but_unselected_keeps_the_match_branch', async () => {
  // Same shape as oneof-mixed-scalars-objects (two flat object members + a number member), but the
  // selection reaches only the union's own field, naming no object-member prop.
  const schema = await runOasTest(
    'oneof-mixed-scalars-objects.yaml',
    ['get:/customField.list>res:r>obj:type:customFieldListResponse>prop:comp:value'],
    1,
    2,
  );
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('object:'), 'no object field selected');
  assert.ok(schema!.includes('["{", {}]'), 'the "{" branch still claims the prefix instead of falling through');
  assert.ok(schema!.includes('["-", { number: raw }]'), 'the number arms are unchanged for an actual number value');
});

// --- PropComp.select() selectionSuffix head: required field, and a field name needing sanitising -

test('test_208_propcomp_select_required_field_head_has_no_marker', async () => {
  // A required mixed-value field: the suffix is still written, but isOptionalInSelection() is
  // false, so the head carries no `?` — unlike the optional `value` field covered above.
  const schema = await runOasTest('propcomp-select-head-variants.yaml', ['get:/thing.get>**'], 1, 7, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('requiredValue: requiredValue->echo({ raw: @ }) {'),
    'required field: name repeated once for the explicit self-alias the suffix needs, no `?`',
  );
});

test('test_208_propcomp_select_sanitised_field_name_aliases_once', async () => {
  // `custom-value` needs sanitising to `customValue`, and the original key isn't a bare identifier
  // (hyphen), so fieldForSelect() takes the quoted path form: `customValue: $."custom-value"`.
  // writeFieldHead() must not add a second self-alias on top of it — the alias check only fires
  // when the sanitised name still equals the raw one.
  const schema = await runOasTest('propcomp-select-head-variants.yaml', ['get:/thing.get>**'], 1, 7, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('customValue: $."custom-value"?->echo({ raw: @ }) {'),
    'sanitised field: fieldForSelect\'s alias is written once, `?` still present (field is optional)',
  );
});

test('test_208_propcomp_select_skip_optional_markers_matches_required_shape', async () => {
  // skipOptionalMarkers suppresses `?` on an otherwise-optional field, same as a required field's
  // absence of `?` above — same head shape, different reason.
  const schema = await runOasTest('propcomp-select-head-variants.yaml', ['get:/thing.get>**'], 1, 7, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
    skipOptionalMarkers: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('value: value->echo({ raw: @ }) {'),
    'skipOptionalMarkers drops `?` even though `value` is optional',
  );
});

test('test_208_saved_path_to_a_pre_mixed_value_flat_field_resolves', async () => {
  // #135-style recovery: a selection saved before this union became a mixed value named a field
  // flat on it (`...>union:type:valueUnion>prop:scalar:currencyCode`). resolveSegment runs before
  // consolidate() is lazily invoked, so it can't look up the specific field — it resolves to the
  // union itself instead, and the union's unconditional dependencies() do the rest.
  const gen = await OasGen.fromFile(`${oasBasePath}/nested-oneof-branch-loss.yaml`, { skipValidation: true });
  await gen.visit();

  const preMixedValuePath =
    'get:/overlay.list>res:r>obj:type:overlayListResponse>prop:comp:value>union:type:valueUnion>prop:scalar:currencyCode';

  const messages = await captureErrors(async () => {
    const schema = gen.generateSchema([preMixedValuePath]);
    assert.ok(schema.includes('currencyCode'), 'the pre-mixed-value path still reaches the field');
    assert.ok(schema.includes('type ValueUnionObject'), 'every branch carries through, not just one field');
  });
  assert.ok(
    messages.some((m) => m.includes('is no longer a direct field of') && m.includes('the union now has one field per kind')),
    'the recovery rule logged what it did, #135 style',
  );
});

test('test_208_saved_path_to_a_flat_field_resolves_at_the_list_item_position', async () => {
  // Same recovery rule (resolveSegment only checks `parent instanceof Union`, not position) proven
  // at a list item: no `arr:` node sits between the union and its `prop:array:#values` parent.
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-list-items.yaml`, { skipValidation: true });
  await gen.visit();

  const flatPath =
    'get:/values.list>res:r>obj:type:valuesListResponse>prop:array:#values>union:type:valuesUnion>prop:scalar:currencyCode';

  const messages = await captureErrors(async () => {
    const schema = gen.generateSchema([flatPath]);
    assert.ok(schema.includes('currencyCode'), 'the flat path still reaches the field');
    assert.ok(schema.includes('type ValuesUnionObject'), 'every branch carries through, not just one field');
  });
  assert.ok(
    messages.some((m) => m.includes('is no longer a direct field of') && m.includes('the union now has one field per kind')),
    'the recovery rule logged what it did',
  );
});

test('test_208_saved_path_to_a_flat_field_resolves_at_the_map_value_position', async () => {
  // Same recovery rule proven at a map value, reached through the map's own entry type.
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-map-values.yaml`, { skipValidation: true });
  await gen.visit();

  const flatPath =
    'get:/byKey.get>res:r>obj:type:byKeyGetResponse>prop:map:byKey>map:type:ByKeyEntry>union:type:ByKeyEntryUnion>prop:scalar:currencyCode';

  const messages = await captureErrors(async () => {
    const schema = gen.generateSchema([flatPath]);
    assert.ok(schema.includes('currencyCode'), 'the flat path still reaches the field');
    assert.ok(schema.includes('type ByKeyEntryUnionObject'), 'every branch carries through, not just one field');
  });
  assert.ok(
    messages.some((m) => m.includes('is no longer a direct field of') && m.includes('the union now has one field per kind')),
    'the recovery rule logged what it did',
  );
});

// --- Schemas.analyzeMixedValue: one analysis, same answer at a field and at a list item ---------

// Builds a Union straight from a oneOf schema at the given position, fully visits it (so
// `children` populate for real), and returns what analyzeMixedValue() found. A fresh gen per call:
// reusing one context across unrelated ad-hoc unions of the same generated name trips a
// name-collision path with no real ancestor to resolve against — an artifact of this throwaway
// harness, not something the real generator ever hits.
async function analyzeMixedValueAt(schema: SchemaObject, position: 'field' | 'listItem') {
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-list-items.yaml`, { skipValidation: true });
  await gen.visit();
  const context = gen.getContext();
  const parent: IType =
    position === 'field' ? new PropComp(undefined as unknown as IType, 'value', {}) : new PropArray(undefined, 'items', {});
  const union = Factory.fromSchema(context, parent, schema) as Union;
  union.visit(context);
  return union.analyzeMixedValue(context);
}

test('test_208_holds_mixed_value_eligible_oneof_agrees_at_both_positions', async () => {
  const eligible: SchemaObject = {
    oneOf: [
      { type: 'boolean', title: 'Boolean' },
      { type: 'object', title: 'Currency', properties: { value: { type: 'number' }, currencyCode: { type: 'string' } } },
      { type: 'string', title: 'Date', format: 'date-time' },
    ],
  };
  const wideIntegerGap: SchemaObject = {
    oneOf: [
      { type: 'integer', format: 'int64' },
      { type: 'object', title: 'Currency', properties: { value: { type: 'number' }, currencyCode: { type: 'string' } } },
    ],
  };
  const nestedOneOfMember: SchemaObject = {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        oneOf: [
          { type: 'object', title: 'ById', properties: { id: { type: 'string' } } },
          { type: 'object', title: 'ByName', properties: { name: { type: 'string' } } },
        ],
      } as SchemaObject,
    ],
  };
  // a list-of-strings member alongside an object: exercises listItemType at both positions.
  const listOfStringsAndObject: SchemaObject = {
    oneOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'object', title: 'Thing', properties: { name: { type: 'string' } } },
    ],
  };

  for (const [name, schema, expected] of [
    ['mixed-value-list-items.yaml shape', eligible, true],
    ['mixed-value-list-items-wide-integer-gap.yaml shape', wideIntegerGap, false],
    ['mixed-value-list-items-nested-oneof-member.yaml shape', nestedOneOfMember, false],
    ['list of strings + object', listOfStringsAndObject, true],
  ] as [string, SchemaObject, boolean][]) {
    const atField = await analyzeMixedValueAt(schema, 'field');
    const atListItem = await analyzeMixedValueAt(schema, 'listItem');
    assert.strictEqual(atField !== undefined, expected, `${name}: at a field`);
    assert.strictEqual(atListItem !== undefined, expected, `${name}: at a list item`);
    assert.deepStrictEqual(atField, atListItem, `${name}: the same analysis both times`);
  }
});

// --- MixedValue's object type is registered like any other object (fixes the name collision) ----

test('test_208_object_branch_name_collision_gets_distinct_names_and_composes', async () => {
  // A real component already named `valueUnionObject` used to collide with the mixed value's own
  // synthetic `<Union>Object` type — two `type ValueUnionObject` definitions, rejected by rover.
  // MixedValue now builds that type through Obj.visit(), so it runs the same rename check.
  const schema = await runOasTest('mixed-value-object-branch-name-collision.yaml', ['get:/entry.get>**'], 1, 4, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ValueUnionObject {\n  note: String\n}'), 'the real component keeps its own name');
  assert.ok(
    schema!.includes('type ValueUnionValueUnionObject {\n  amount: Float\n}'),
    'the mixed value object branch is renamed instead of colliding',
  );
});

test('test_208_object_branch_name_collision_composes_patched', async () => {
  const schema = await runOasTest('mixed-value-object-branch-name-collision.yaml', ['get:/entry.get>**'], 1, 4);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ValueUnionValueUnionObject'), 'the renamed object type composes on the patched path too');
});

// --- MixedValue's object branch: two members disagreeing on one field's shape become JSON -------

test('test_208_object_branch_incompatible_field_shapes_become_json', async () => {
  // oneOf [string, { data: string }, { data: [string] }]: the two object members disagree on
  // `data`'s shape (scalar vs. list) — MixedValue.dedupeByName (shared with the flat merge)
  // degrades it to JSON instead of silently keeping the first branch's shape.
  const schema = await runOasTest('mixed-value-object-branch-incompatible-fields.yaml', ['get:/entry.get>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type ValueUnionObject {'), 'the object branch type is written');
  assert.ok(schema!.includes('data: JSON'), 'the incompatible field degrades to JSON');
  assert.ok(
    schema!.includes('different branches of a merged type declare this field differently'),
    'the docstring carries the incompatibleMergedField reason',
  );
});

test('test_208_object_branch_incompatible_scalar_types_become_json', async () => {
  // Same shape, but both members declare `data` as a plain scalar — { data: string } vs
  // { data: integer }. Same prop kind ("scalar"), different GraphQL type: only the extended
  // dedupeByName key (kind + GraphQL type) catches this; the old kind-only key would have merged
  // them as `data: String` and silently dropped the integer branch's real type.
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-object-branch-incompatible-scalar-types.yaml`, {
    skipValidation: true,
  });
  await gen.visit();
  const schema = gen.generateSchema(['get:/entry.get>**']);
  assert.ok(schema.includes('data: JSON'), 'a same-kind, different-GraphQL-type clash also degrades to JSON');
  assert.ok(
    schema.includes('different branches of a merged type declare this field differently'),
    'the docstring carries the incompatibleMergedField reason',
  );
});

test('test_208_flat_merge_incompatible_scalar_types_become_json', async () => {
  // The same extended key applies to the plain flat merge (no mixed value involved): two object
  // members with no plain-value sibling, disagreeing only on a scalar field's GraphQL type.
  const gen = await OasGen.fromFile(`${oasBasePath}/flat-merge-incompatible-scalar-types.yaml`, { skipValidation: true });
  await gen.visit();
  const schema = gen.generateSchema(['get:/party.get>**']);
  assert.ok(schema.includes('#### union degraded to a merged object:'), 'a plain flat merge, not a mixed value');
  assert.ok(schema.includes('status: JSON'), 'the merge degrades the clashing field to JSON');
  assert.ok(
    schema.includes('different branches of a merged type declare this field differently'),
    'the docstring carries the incompatibleMergedField reason',
  );
});

// --- MixedValue's object branch: clones are owned by the object type, not their member ----------

test('test_208_object_branch_clone_owned_by_object_type_keeps_member_path', async () => {
  const gen = await OasGen.fromFile(`${oasBasePath}/mixed-value-list-items.yaml`, { skipValidation: true });
  await gen.visit();
  const context = gen.getContext();

  const schema: SchemaObject = {
    oneOf: [
      { type: 'boolean', title: 'Boolean' },
      { type: 'object', title: 'Currency', properties: { value: { type: 'number' }, currencyCode: { type: 'string' } } },
      { type: 'string', title: 'Date', format: 'date-time' },
    ],
  };
  const parent = new PropComp(undefined as unknown as IType, 'value', {});
  const union = Factory.fromSchema(context, parent, schema) as Union;
  union.visit(context);

  const shape = union.analyzeMixedValue(context)!;
  const currency = union.children[shape.objectMemberIndexes[0]];
  const originalCurrencyCode = currency.props.get('currencyCode')!;
  const selection = [originalCurrencyCode.path(), currency.props.get('value')!.path()];
  union.consolidate(context, selection, false);

  const objectType = union.mixedValue!.objectType!;
  const clone = objectType.props.get('currencyCode')!;
  assert.strictEqual(clone.parent, objectType, "the clone's parent is the object type, not its Currency member");
  assert.strictEqual(
    clone.path(),
    originalCurrencyCode.path(),
    "the clone's path() is still its member field's own path (pathInSelection), not through the object type",
  );
});

// --- dedupeByName compares the written shape, not just the prop kind ----------------------------

test('test_208_dedupe_compares_list_item_shape_not_just_array_kind', async () => {
  // Both branches declare `tags` as an array (same old "array" kind), but one holds strings and
  // the other holds objects — dedupeByName's key is now getValue() ("[String]" vs "[TagsItem]"),
  // so the clash still degrades to JSON instead of silently keeping the first branch's item type.
  const schema = await runOasTest('flat-merge-list-of-strings-vs-list-of-objects.yaml', ['get:/party.get>**'], 1, 2);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('tags: JSON'), 'the list-item-shape clash degrades to JSON');
  assert.ok(
    schema!.includes('different branches of a merged type declare this field differently'),
    'the docstring carries the incompatibleMergedField reason',
  );
});

test('test_208_dedupe_compares_enum_value_sets_not_just_enum_kind', async () => {
  // Both branches declare `status` as an enum (same old "enum" kind) with different value sets —
  // dedupeByName appends the sorted values to an enum's key, so two differently-valued enums no
  // longer pass as equal. Since every branch's version is an enum, the field merges into one enum
  // holding both value sets instead of degrading to JSON.
  const schema = await runOasTest('mixed-value-object-branch-incompatible-enums.yaml', ['get:/entry.get>**'], 1, 4, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    /enum ValueUnionStatus \{\n ACTIVE,\n INACTIVE,\n OPEN,\n CLOSED\n\}/.test(schema!),
    'status merges into one enum holding both value sets, in order',
  );
});

// --- `{ field: string }` vs `{ field: [string] }` is covered elsewhere --------------------------
// (different kind, not just a different scalar type or enum values): see
// test_208_object_branch_incompatible_field_shapes_become_json. No separate fixture needed here.

// --- An unmatched value fills only raw, never the number field ----------------------------------

test('test_208_number_branch_uses_explicit_digit_arms_not_a_catch_all', async () => {
  // oneOf: [number, object, {}] has no text member. A string body's first character (a quote)
  // used to fall into the `[@, ...]` catch-all, which claimed `number` whenever one existed —
  // `->typeof` failed to compose on stock 2.15.1 (CONNECTORS_UNRESOLVED_FIELD), so the number
  // branch instead gets one arm per digit (and `-`); the catch-all itself is always empty.
  const schema = await runOasTest('mixed-value-number-object-no-text.yaml', ['get:/entry.get>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('text: String'), 'no text member in this fixture');
  assert.ok(schema!.includes('["-", { number: raw }]'), 'explicit minus arm');
  assert.ok(schema!.includes('["0", { number: raw }]'), 'explicit digit arm');
  assert.ok(schema!.includes('["9", { number: raw }]'), 'explicit digit arm');
  assert.ok(schema!.includes('[@, {}]'), 'the catch-all is always empty now');
});

// --- An enum is classified by its type before its values ----------------------------------------

test('test_208_integer_enum_classified_as_number_not_text', async () => {
  // oneOf: [integer enum [1, 2], object]: analyzeMixedValue used to classify any `enum` member as
  // text before looking at its type, so this declared `text: String` and a body of `1` filled
  // only `raw`. Type comes first now: an integer/number enum is `number`.
  const schema = await runOasTest('mixed-value-integer-enum-number.yaml', ['get:/entry.get>**'], 1, 3, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type ValueUnion {\n  number: Float\n  object: ValueUnionObject\n  raw: JSON\n}'),
    'number, not text, for an integer enum',
  );
});

// --- A field read through ->jsonStringify is not the same field as a plain string --------------

test('test_208_stringified_number_does_not_merge_with_plain_string', async () => {
  // { data: int64 } is written as String but read through ->jsonStringify; { data: string } is
  // written as String and read bare. Same written type, different read — dedupeByName's key now
  // tells them apart in both member orders, so the clash degrades to JSON either way.
  const schema = await runOasTest('merge-stringified-number-vs-string.yaml', ['get:/entry.get>**'], 1, 5, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  const reason = 'different branches of a merged type declare this field differently';
  assert.strictEqual(
    (schema!.match(new RegExp(reason, 'g')) || []).length,
    2,
    'both orderings carry the incompatibleMergedField reason',
  );
  assert.strictEqual((schema!.match(/data: JSON/g) || []).length, 2, 'both orderings degrade to JSON');
});

// --- Two enums under one field name merge into one enum with both value sets -------------------

// The merged enum's name is minted fresh (owner + field, collision-numbered like any other inline
// enum), so tests read it back from the schema instead of hard-coding it.
function enumValuesFor(schema: string, objectType: string, field: string): string[] | undefined {
  const objectMatch = schema.match(new RegExp(`type ${objectType} \\{\\n  ${field}: (\\w+)\\n\\}`));
  if (!objectMatch) return undefined;
  const enumMatch = schema.match(new RegExp(`enum ${objectMatch[1]} \\{\\n([\\s\\S]*?)\\n\\}`));
  return enumMatch?.[1].split(',\n').map((s) => s.trim());
}

test('test_208_merge_enum_value_sets_both_orders_inline_and_ref', async () => {
  // Two members give `status` an enum with a different single value each — dedupeByName used to
  // send this to JSON; now every member's version is an enum, so it merges into one enum holding
  // both values, first-seen order, in both member orders and both inline and $ref-sourced enums.
  const schema = await runOasTest('merge-enum-value-sets.yaml', ['get:/entry.get>**'], 1, 13, {
    composeFederationVersion: '2.15.1',
    forceRover: true,
  });
  assert.ok(schema !== undefined);
  assert.deepStrictEqual(enumValuesFor(schema!, 'InlineAFirstUnionObject', 'status'), ['A', 'B'], 'inline, A first');
  assert.deepStrictEqual(enumValuesFor(schema!, 'InlineBFirstUnionObject', 'status'), ['B', 'A'], 'inline, B first');
  assert.deepStrictEqual(enumValuesFor(schema!, 'RefAFirstUnionObject', 'status'), ['A', 'B'], '$ref, A first');
  assert.deepStrictEqual(enumValuesFor(schema!, 'RefBFirstUnionObject', 'status'), ['B', 'A'], '$ref, B first');
});

test('test_208_merge_enum_value_sets_composes_patched', async () => {
  const schema = await runOasTest('merge-enum-value-sets.yaml', ['get:/entry.get>**'], 1, 13);
  assert.ok(schema !== undefined);
  assert.deepStrictEqual(enumValuesFor(schema!, 'InlineAFirstUnionObject', 'status'), ['A', 'B']);
});

test('test_208_merge_enum_value_sets_field_named_enum_does_not_collide', async () => {
  // Regression: a property literally named `enum` used to share En.visit's "unnamed" sentinel, so
  // two unrelated merges under that name collapsed into one node (`enum:enum`) and one of the two
  // silently lost its values. Both must now survive collection with their own distinct values.
  const schema = await runOasTest(
    'merge-enum-value-sets-field-named-enum.yaml',
    ['get:/a.get>**', 'get:/b.get>**'],
    2,
    8,
    { composeFederationVersion: '2.15.1', forceRover: true },
  );
  assert.ok(schema !== undefined);
  const a = enumValuesFor(schema!, 'ValueUnionObject', 'enum');
  const b = enumValuesFor(schema!, 'BGetResponseValueUnionObject', 'enum');
  assert.deepStrictEqual(a, ['A', 'B'], "schema A's merge keeps its own values");
  assert.deepStrictEqual(b, ['C', 'D'], "schema B's merge keeps its own values, not schema A's");
});

test('test_208_merge_enum_value_sets_field_named_enum_composes_patched', async () => {
  const schema = await runOasTest(
    'merge-enum-value-sets-field-named-enum.yaml',
    ['get:/a.get>**', 'get:/b.get>**'],
    2,
    8,
  );
  assert.ok(schema !== undefined);
});

test('test_57_merged_union_field_is_one_enum_with_every_value', async () => {
  // File, folder, and web_link declare different type enums.
  // The merged field uses one enum containing all three values.
  const schema = await runOasTest('box.yaml', ['get:/collaborations>**'], 258, 37);
  assert.ok(schema !== undefined);
  assert.ok(/\btype: EntriesUnionType\b/.test(schema!), 'the discriminator field resolves to the merged enum');
  assert.ok(
    /enum EntriesUnionType \{\n file,\n folder,\n web_link\n\}/.test(schema!),
    'the merged enum holds every branch value',
  );
});

test('test_208_merged_enum_keeps_required_when_every_branch_requires_it', async () => {
  // Both destination shapes require `type`, so the merged enum is `type: ...!`; only one target
  // shape requires `kind`, so the merged enum stays nullable.
  //   e.g. (omni) Routine.destination: oneOf [EmailDestination, SlackDestination], both required: [type]
  const schema = await runOasTest('merged-enum-required.yaml', ['get:/routines/{id}>**', 'get:/schedules/{id}>**'], 2, 6);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('\n  type: DestinationUnionType!\n'), 'required on every branch keeps the marker');
  assert.ok(schema!.includes('\n  kind: TargetUnionKind\n'), 'optional on one branch drops it');
});

// --- Two same-named objects fold under declaresEveryKeptField, not a bare name match ------------

test('test_merge_object_refs_compatible_keeps_first_typed', async () => {
  // Basic declares summary; Rich declares summary and deep. Rich declares every field Basic has,
  // so detail keeps Basic's shape; deep is dropped, Rich itself is never written.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/compatible>**'], 11, 3);
  assert.ok(schema !== undefined);
  assert.ok(/detail: Basic\n/.test(schema!), 'kept as the first object, typed');
  assert.ok(!/Rich/.test(schema!), 'the other object is never written');
});

test('test_merge_object_refs_nested_field_shape_clash_is_json', async () => {
  // A.field is a string, B.field is a list of strings — a real shape clash one level inside the
  // merged detail object, not on detail itself.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/nested-clash>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a nested field shape clash falls back to JSON');
});

test('test_merge_object_refs_missing_field_is_json', async () => {
  // A declares code; B declares other, plus additionalProperties: true. B not declaring code is
  // what fails the merge — additionalProperties never supplies a value for a field it lacks.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/missing-field>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a field the other object never declares falls back to JSON');
});

test('test_merge_object_refs_required_mismatch_inside_is_json', async () => {
  // Both declare code: string, but A requires it and B does not — a requiredness mismatch one
  // level inside the merged detail object.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/required-mismatch>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a required mismatch inside the object falls back to JSON');
});

test('test_merge_object_refs_outer_required_mismatch_is_json', async () => {
  // detail: DetailBasic! (required) vs detail: DetailRich (optional) -- DetailBasic and DetailRich
  // agree on every field, but the colliding detail field's own requiredness still disagrees.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/outer-required-mismatch>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a required mismatch on the merged field itself falls back to JSON');
});

test('test_merge_object_refs_nested_union_member_is_json', async () => {
  // A.code is a string; B.code is a oneOf of two objects, left unconsolidated at comparison time.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/nested-union-member>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a nested union member falls back to JSON');
});

test('test_merge_object_refs_same_ref_is_established_without_walking_fields', async () => {
  // Both members declare detail: $ref Shared, an allOf wrapper with no props at merge time. The
  // same $ref on both sides is proven typed without ever needing to walk its fields.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/same-type>**'], 11, 3);
  assert.ok(schema !== undefined);
  assert.ok(/detail: Shared\n/.test(schema!), 'the shared component is kept and typed');
});

test('test_merge_object_refs_same_ref_required_mismatch_is_json', async () => {
  // Both members declare detail: $ref Shared, but one requires it and the other does not — the
  // outer requiredness check rejects the pair before the shared-ref check ever runs.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/same-type-required-mismatch>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'a required mismatch on the merged field itself falls back to JSON');
});

test('test_merge_object_refs_colliding_display_name_is_json', async () => {
  // Detail-A (required code) and Detail_A (optional code) both generate the display name DetailA,
  // but they are different components with different schemas — neither shortcut fires.
  const schema = await runOasTest('merge-object-refs.yaml', ['get:/colliding-name-required-mismatch>**'], 11, 2);
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'same display name, different components, falls back to JSON');
});

test('test_merge_object_refs_colliding_inline_union_id_is_json', async () => {
  // A POST body's inline detail oneOf claims the name detailUnion first; two later, different
  // inline detail oneOfs on the GET response then share that same id without being the same schema.
  const schema = await runOasTest(
    'merge-object-refs.yaml',
    ['post:/create-detail>**', 'get:/get-mixed-detail>**'],
    11,
    5,
  );
  assert.ok(schema !== undefined);
  assert.ok(/detail: JSON\n/.test(schema!), 'same id, different schema content, falls back to JSON');
});

// --- FIXED #230: a property that is "a list of names or a list of objects" takes the object list ---

test('test_230_list_of_names_or_objects_takes_the_objects', async () => {
  // Ashby's hiringTeamRole.list shape: results: anyOf [ [string], [$ref Role] ]. The object list
  // wins; isSuccess names "success" as the envelope field so it doesn't block the unwrap. see #232
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.list>**'], 5, 2, {
    overrides: { $source: { isSuccess: '$.success', payload: 'results' } },
  });
  assert.ok(schema !== undefined);
  assert.ok(/createRolesList\(input: CreateRolesListInput!\): \[Role\]/.test(schema!), 'the operation returns the object list');
  assert.ok(schema!.includes('$.results {') && schema!.includes('id?') && schema!.includes('title?'), 'the selection reaches into results for the objects');
  assert.ok(!schema!.includes('NEEDS ATTENTION'), 'no field falls back to JSON with a degrade note');
});

test('test_230_the_warning_names_the_dropped_list', async () => {
  // One build only: runOasTest's two-pass getTypes/generateSchema would double the warning count.
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/list-or-names.yaml`, { showParentInSelections: false });
    await gen.visit();
    gen.generateSchema(['post:/roles.list>**']);
  });
  assert.ok(
    messages.some((m) => m.includes("property 'results' can answer a list of plain values or a list of objects")),
    'warn() names the property and explains the list of plain values is dropped',
  );
});

test('test_230_without_payload_the_wrapper_field_is_the_list', async () => {
  // Same op, no payload override: the rule holds on the wrapper's own results field too.
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.list>**'], 5, 3);
  assert.ok(schema !== undefined);
  assert.ok(/results: \[Role\]\n/.test(schema!), "the wrapper's results field is the object list");
});

test('test_230_oneof_spelling_takes_the_objects', async () => {
  // The untyped oneOf arm produces the same typed array as its anyOf twin, not an unnamed union
  // with an empty selection. isSuccess names "success" so it doesn't block the unwrap. see #232
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.listOneOf>**'], 5, 2, {
    overrides: { $source: { isSuccess: '$.success', payload: 'results' } },
  });
  assert.ok(schema !== undefined);
  assert.ok(
    /createRolesListOneOf\(input: CreateRolesListOneOfInput!\): \[Role\]/.test(schema!),
    'the operation returns the object list',
  );
  assert.ok(schema!.includes('$.results {') && schema!.includes('id?') && schema!.includes('title?'), 'the selection reaches into results for the objects');
  assert.ok(!schema!.includes('NEEDS ATTENTION'), 'no field falls back to JSON with a degrade note');
});

test('test_230_oneof_spelling_warning_names_the_dropped_list', async () => {
  const messages = await captureErrors(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/list-or-names.yaml`, { showParentInSelections: false });
    await gen.visit();
    gen.generateSchema(['post:/roles.listOneOf>**']);
  });
  assert.ok(
    messages.some((m) => m.includes("property 'results' can answer a list of plain values or a list of objects")),
    'the oneOf spelling gets the identical warning text',
  );
});

test('test_230_two_object_lists_stay_json', async () => {
  // Two object-item arrays: no single winner, same unknownShape fallback as today.
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.pair>**'], 5, 1);
  assert.ok(schema !== undefined);
  assert.ok(/results: JSON/.test(schema!), 'no winner between two object lists leaves the field JSON');
  assert.ok(schema!.includes("didn't match any known pattern"), 'the docstring carries the unknownShape reason');
});

test('test_230_two_plain_lists_stay_json', async () => {
  // Two plain-item arrays: same unknownShape fallback.
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.codes>**'], 5, 1);
  assert.ok(schema !== undefined);
  assert.ok(/results: JSON/.test(schema!), 'no winner between two plain lists leaves the field JSON');
});

test('test_230_two_object_lists_stay_json_oneof', async () => {
  // The oneOf regression pin: before this change, this exact shape built an unnamed union with an
  // empty selection and did not compose. Reaching runOasTest's compose step at all is the pin.
  const schema = await runOasTest('list-or-names.yaml', ['post:/roles.pairOneOf>**'], 5, 1);
  assert.ok(schema !== undefined);
  assert.ok(/results: JSON/.test(schema!), 'no winner between two object lists leaves the field JSON, same as the anyOf twin');
});

// --- #221: a nested/flat choice of a plain scalar and a list of that scalar, no object member ---

test('test_221_nested_choice_plain_and_list_property', async () => {
  const schema = await runOasTest(
    'nested-choice-plain-and-list.yaml',
    ['get:/thing.get>**', 'post:/thing.create>**'],
    2,
    10,
  );
  assert.ok(schema !== undefined);

  // all four property spellings get the wrapper, none keeps a NEEDS ATTENTION note
  for (const name of ['Nested', 'NestedNullItems', 'Flat', 'FlatOneOf']) {
    assert.ok(
      schema!.includes(`type ${name}Union {\n  text: String\n  list: [String]\n  raw: JSON\n}`),
      `${name}Union carries text/list/raw, no object member`,
    );
  }
  const selectionBlock = schema!.match(/selection: """([\s\S]*?)"""\s*\)\s*\n}\s*\n\ntype Mutation/)?.[1] ?? '';
  for (const field of ['nested', 'nestedNullItems', 'flat', 'flatOneOf']) {
    assert.ok(selectionBlock.includes(`${field}: ${field}?->echo({ raw: @ }) {`), `${field}'s selection head`);
  }
  const responseType = schema!.match(/type ThingGetResponse \{[^}]*\}/)?.[0] ?? '';
  assert.ok(!/NEEDS ATTENTION/.test(responseType), 'no fallback note on any of the four response fields');

  // input side keeps JSON with a reason -- GraphQL has no input unions
  assert.ok(schema!.includes('flat: JSON'), 'the input field stays JSON');
  assert.ok(schema!.includes("this field's shape didn't match any known pattern"), 'the input field keeps its reason');
});

test('test_221_nested_choice_plain_and_list_position', async () => {
  // list item and map value: the shapes step 3's selection fix specifically covers -- typed AND
  // selected, not just typed in isolation (that's what the string matches on the selection block prove).
  const schema = await runOasTest(
    'nested-choice-plain-and-list.yaml',
    ['get:/thing.get>**', 'post:/thing.create>**'],
    2,
    10,
  );
  assert.ok(schema !== undefined);

  assert.ok(
    schema!.includes('type ValueListUnion {\n  text: String\n  list: [String]\n  raw: JSON\n}'),
    'list item gets the wrapper',
  );
  assert.ok(schema!.includes('valueList: valueList?->map(@->echo({ raw: @ }))'), 'list item is selected, not commented out');

  assert.ok(
    schema!.includes('type ValueByKeyEntryUnion {\n  text: String\n  list: [String]\n  raw: JSON\n}'),
    'map value gets the wrapper',
  );
  assert.ok(schema!.includes('valueByKey: valueByKey?->entries {'), 'map value is selected, not commented out');
});
