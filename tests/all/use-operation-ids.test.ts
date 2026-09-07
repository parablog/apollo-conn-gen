import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { OasGen } from '../../src/index.js';
import { Naming } from '../../src/oas/utils/naming.js';
import { captureErrors } from './_setup.js';
import './_setup.js';

// --use-operation-ids: name Query/Mutation fields (and any synthesized response/input type) from
// the OAS operationId when present, falling back to the derived verb+path name otherwise.

const PETSTORE_PATHS = [
  'post:/pet>**',
  'put:/pet>**',
  'get:/pet/findByStatus>**',
  'get:/pet/findByTags>**',
  'get:/pet/{petId}>**',
  'post:/pet/{petId}>**',
  'del:/pet/{petId}>**',
  'post:/pet/{petId}/uploadImage>**',
  'get:/store/inventory>**',
  'post:/store/order>**',
  'get:/store/order/{orderId}>**',
  'del:/store/order/{orderId}>**',
  'post:/user>**',
  'post:/user/createWithList>**',
  'get:/user/login>**',
  'get:/user/logout>**',
  'get:/user/{username}>**',
  'put:/user/{username}>**',
  'del:/user/{username}>**',
];

test('test_use_operation_ids_petstore_flag_on_names_fields_from_operationId', async () => {
  const schema = await runOasTest('petstore.yaml', PETSTORE_PATHS, 19, 20, { useOperationIds: true });
  assert.ok(schema !== undefined);

  // Mutation, POST /pet/{petId} operationId updatePetWithForm -- the PUT proof in the plan is
  // covered separately below; these are the rest of the verbs.
  for (const field of ['updatePetWithForm', 'addPet', 'uploadFile', 'updateUser', 'deletePet']) {
    assert.ok(schema!.includes(`${field}(`) || schema!.includes(`${field}:`), `expected Mutation field ${field}`);
  }
  // Query
  for (const field of ['getPetById', 'findPetsByStatus']) {
    assert.ok(schema!.includes(`${field}(`), `expected Query field ${field}`);
  }
  // POST /user, operationId createUser -- coincides with the derived name, proves nothing moved
  // that shouldn't.
  assert.ok(schema!.includes('createUser('), 'createUser unchanged');

  // the response wrapper for POST /pet/{petId} is named from the operationId, not the derived
  // createPetByPetId
  assert.ok(schema!.includes('type UpdatePetWithFormResponse {'), 'response type named from the operationId');
  assert.ok(!schema!.includes('CreatePetByPetIdResponse'), 'derived response type name must not appear');
});

test('test_use_operation_ids_ref_body_type_is_unaffected', async () => {
  // PUT /user/{username}: derived name and operationId (updateUser) disagree, so this is also the
  // PUT proof from the plan. Its $ref request body (UserInput) is a component schema and must stay
  // the same type on and off -- only the synthesized response wrapper, which has no $ref, moves.
  const on = await runOasTest('petstore.yaml', ['put:/user/{username}>**'], 19, 2, { useOperationIds: true });
  const off = await runOasTest('petstore.yaml', ['put:/user/{username}>**'], 19, 2);
  assert.ok(on !== undefined && off !== undefined);

  const userInputBlock = (schema: string) => schema.match(/input UserInput \{[\s\S]*?\n\}/)?.[0];
  assert.ok(userInputBlock(on!), 'UserInput present with the flag on');
  assert.strictEqual(userInputBlock(on!), userInputBlock(off!), 'UserInput is byte-identical on and off');

  assert.ok(on!.includes('updateUser(username: String!, input: UserInput!): UpdateUserResponse'));
  assert.ok(off!.includes('updateUserByUsername(username: String!, input: UserInput!): UpdateUserByUsernameResponse'));
});

test('test_use_operation_ids_sanitises_dots_and_dashes_and_falls_back', async () => {
  const paths = [
    'get:/widgets/{widgetId}>**',
    'patch:/widgets/{widgetId}>**',
    'post:/widgets>**',
    'get:/gadgets>**',
    'get:/gizmos>**',
    'get:/doohickeys>**',
  ];
  const schema = await runOasTest('operation-ids.yaml', paths, 6, 5, { useOperationIds: true });
  assert.ok(schema !== undefined);

  // dots and dashes in the raw operationId
  assert.ok(schema!.includes('widgetFetchOne('), 'widget.fetch-one -> widgetFetchOne');
  assert.ok(schema!.includes('type WidgetFetchOneResponse {'));
  assert.ok(schema!.includes('widgetPatchOne('), 'widget.patch-one -> widgetPatchOne');
  assert.ok(schema!.includes('input WidgetPatchOneInput {'), 'the PATCH input type is named from the operationId');

  // no operationId on POST /widgets -- falls back to the derived name
  assert.ok(schema!.includes('createWidgets('));

  // three distinct raw operationIds (listThings, list-things, list.things) all sanitise to
  // listThings -- renamedTo (collision numbering, #116) must still tell them apart. Computed via
  // Naming.numberedName rather than hardcoded, since which op lands second/third depends on path
  // sort order, not spec order.
  const second = Naming.numberedName('listThings', (n) => n === 'listThings');
  const third = Naming.numberedName('listThings', (n) => [`listThings`, second].includes(n));
  for (const name of ['listThings', second, third]) {
    assert.ok(schema!.includes(`${name}:`), `expected a distinct field named ${name}`);
  }
});

test('test_use_operation_ids_flag_off_is_the_derived_name_only', async () => {
  const paths = ['get:/widgets/{widgetId}>**', 'patch:/widgets/{widgetId}>**', 'post:/widgets>**'];
  const schema = await runOasTest('operation-ids.yaml', paths, 6, 5);
  assert.ok(schema !== undefined);

  assert.ok(schema!.includes('widgetsByWidgetId('), 'derived name used, not the operationId');
  assert.ok(schema!.includes('patchWidgetsByWidgetId('));
  assert.ok(!schema!.includes('widgetFetchOne'), 'operationId-derived name must not leak in when the flag is off');
  assert.ok(!schema!.includes('widgetPatchOne'));
});

test('test_use_operation_ids_duplicate_operationIds_are_still_numbered', async () => {
  const schema = await runOasTest(
    'operation-ids-duplicate.yaml',
    ['get:/things>**', 'get:/stuff>**'],
    2,
    0,
    { useOperationIds: true, skipValidation: true },
  );
  assert.ok(schema !== undefined);

  const second = Naming.numberedName('listThings', (n) => n === 'listThings');
  assert.ok(schema!.includes('listThings:'));
  assert.ok(schema!.includes(`${second}:`));
});

test('test_use_operation_ids_saved_selection_recovers_the_same_leaf_get_response', async () => {
  // A selection saved with the flag off names the inline GET response wrapper by its derived id.
  // Reloading it under a flag-on generator can no longer find that id -- SelectionPath.resolveSegment
  // (#72/#135) recovers through T.innerChild, since the response wrapper is the response's only
  // child. Recover-to-the-same-node, or throw -- never a silently different node.
  const saved = ['get:/widgets/{widgetId}>res:r>obj:type:widgetsByWidgetIdResponse>prop:scalar:id'];

  const fresh = await OasGen.fromFile(`${oasBasePath}/operation-ids.yaml`, {
    showParentInSelections: false,
    useOperationIds: true,
  });
  await fresh.visit();
  const freshSchema = fresh.generateSchema(['get:/widgets/{widgetId}>**']);

  const reloaded = await OasGen.fromFile(`${oasBasePath}/operation-ids.yaml`, {
    showParentInSelections: false,
    useOperationIds: true,
  });
  await reloaded.visit();
  const warnings = await captureErrors(async () => {
    const reloadedSchema = reloaded.generateSchema(saved);
    assert.ok(reloadedSchema.includes('type WidgetFetchOneResponse {\n  id: ID\n}'), 'recovered to the renamed type');
    assert.ok(freshSchema.includes('type WidgetFetchOneResponse {'), 'same type a fresh flag-on selection produces');
  });
  assert.ok(
    warnings.some((w) => w.includes('obj:type:widgetFetchOneResponse')),
    'a recovery warning is logged, not a silent switch',
  );
});

test('test_use_operation_ids_saved_selection_recovers_the_same_leaf_patch_input', async () => {
  const saved = [
    'patch:/widgets/{widgetId}>res:r>obj:type:patchWidgetsByWidgetIdResponse>prop:scalar:id',
    'patch:/widgets/{widgetId}>body:b>obj:input:PatchWidgetsByWidgetId>prop:scalar:note',
  ];

  const reloaded = await OasGen.fromFile(`${oasBasePath}/operation-ids.yaml`, {
    showParentInSelections: false,
    useOperationIds: true,
  });
  await reloaded.visit();
  const warnings = await captureErrors(async () => {
    const schema = reloaded.generateSchema(saved);
    assert.ok(schema.includes('input WidgetPatchOneInput {\n  note: String\n}'), 'input recovered to the renamed type');
    assert.ok(schema.includes('type WidgetPatchOneResponse {'), 'response wrapper recovered too');
  });
  assert.ok(
    warnings.some((w) => w.includes('obj:input:WidgetPatchOne')),
    'a recovery warning is logged for the input type',
  );
});

// --- the flag, end to end through the CLI -----------------------------------

test('test_use_operation_ids_cli_flag_end_to_end', () => {
  const CLI = ['--import', 'tsx/esm', 'src/cli/oas.ts', 'tests/resources/oas/operation-ids.yaml', '-n'];
  const run = spawnSync('node', [...CLI, '--use-operation-ids'], { encoding: 'utf-8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('widgetFetchOne'), 'the CLI flag reaches OasGen');

  const off = spawnSync('node', [...CLI], { encoding: 'utf-8' });
  assert.strictEqual(off.status, 0, off.stderr);
  assert.ok(!off.stdout.includes('widgetFetchOne'), 'without the flag the derived name is used');
});
