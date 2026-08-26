import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// --- R1: entity-resolver inference (inferEntityResolvers, type-level @connect) ---

test('test_R1_entity_flag_on_positive_emits_key_and_type_resolver', async () => {
  // GET /widgets/{id} -> Widget { id } qualifies: path param `id` matches a selected
  // scalar field. Expect @key(fields: "id") plus a type-level @connect using $this.id;
  // the Query field stays a plain connector (no legacy entity: true).
  const paths = [
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-resolver.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "id")'), 'expected @key on Widget');
  assert.ok(schema!.includes('http: { GET: "/widgets/{$this.id}" }'), 'expected type-level $this resolver');
  assert.ok(!schema!.includes('entity: true'), 'must not emit the legacy Query-field entity: true');
});

test('test_R1_entity_flag_off_is_byte_identical', async () => {
  // Same selection, flag OFF: no @key, no $this resolver (literal conversion).
  const paths = [
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-resolver.yaml', paths, 2, 1);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('@key('), 'flag off must not emit @key');
  assert.ok(!schema!.includes('$this'), 'flag off must not emit a $this resolver');
});

test('test_R1_entity_flag_on_negative_key_not_selected', async () => {
  // Flag ON but the key field `id` is NOT selected -> $this would dangle, so the op does
  // not qualify: no @key, no type-level resolver. Still composes.
  const paths = [
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:sku',
  ];

  const schema = await runOasTest('entity-resolver.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('@key('), 'no @key when key field is unselected');
  assert.ok(!schema!.includes('$this'), 'no $this resolver when key field is unselected');
});

test('test_R1_entity_op_scoping_only_qualifying_op_resolves', async () => {
  // A qualifying GET-by-id and a non-qualifying list GET both return Widget. Only the
  // by-id op contributes a type-level resolver; the list (array) op does not.
  const paths = [
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-resolver.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "id")'), 'expected single @key on Widget');
  const resolverCount = schema!.split('{$this.').length - 1;
  assert.strictEqual(resolverCount, 1, `exactly one $this resolver expected, got ${resolverCount}`);
  assert.ok(!schema!.includes('entity: true'), 'must not emit entity: true');
});

test('test_R1_16_entity_selection_keeps_key_plain', async () => {
  // #16: the same Widget props emit `id` plain inside the entity's own @connect (a key that may
  // be absent is not a key) and `id?` in the Query selections; the optional `name?` marks both.
  const paths = [
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets/{id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:id',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-resolver.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema!.includes('"""\n      id\n      name?'), 'key plain, optional sibling marked, in the entity selection');
  assert.ok(schema!.includes('"""\n      id?\n      name?'), 'the same prop takes ? in the Query selections');
});

test('test_R1_16_aliased_optional_key_plain_only_in_entity_selection', async () => {
  // #16 spots a key by Prop identity, not by name — the aliased `widgetId: widget_id` stays plain
  // in the entity selection and takes `?` in the list selection. #65 sanitises @key/$this to the
  // written field name, so this now composes.
  const paths = [
    'get:/widgets/{widget_id}>res:r>obj:type:#/c/s/Widget>prop:scalar:widget_id',
    'get:/widgets/{widget_id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:widget_id',
    'get:/widgets>res:r>array:#/c/s/Widget>obj:type:#/c/s/Widget>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-aliased-key.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('@key(fields: "widgetId")'), 'key field sanitised');
  assert.ok(schema!.includes('http: { GET: "/widgets/{$this.widgetId}" }'), 'resolver URL uses the sanitised $this field');
  assert.ok(schema!.includes('name?\n      widgetId: widget_id\n'), 'aliased key plain in the entity selection');
  assert.ok(schema!.includes('name?\n      widgetId: widget_id?'), 'aliased key marked in the list selection');
});

test('test_R1_entity_multi_key_two_resolvers_sorted', async () => {
  // Two qualifying ops resolve to the same type with different path-param keys. Expect
  // both @key directives (sorted) and one type-level $this resolver per key.
  const paths = [
    'get:/gadgets/{id}>res:r>obj:type:#/c/s/Gadget>prop:scalar:id',
    'get:/gadgets/{id}>res:r>obj:type:#/c/s/Gadget>prop:scalar:sku',
    'get:/gadgets/by-sku/{sku}>res:r>obj:type:#/c/s/Gadget>prop:scalar:id',
    'get:/gadgets/by-sku/{sku}>res:r>obj:type:#/c/s/Gadget>prop:scalar:sku',
  ];

  const schema = await runOasTest('entity-multi-key.yaml', paths, 2, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(
    schema!.includes('type Gadget @key(fields: "id") @key(fields: "sku")'),
    'expected both @key directives in sorted order',
  );
  assert.ok(schema!.includes('http: { GET: "/gadgets/{$this.id}" }'), 'expected id resolver');
  assert.ok(schema!.includes('http: { GET: "/gadgets/by-sku/{$this.sku}" }'), 'expected sku resolver');
  const resolverCount = schema!.split('{$this.').length - 1;
  assert.strictEqual(resolverCount, 2, `expected two $this resolvers, got ${resolverCount}`);
});

test('test_168_twin_key_uses_numbered_field', async () => {
  // Take's key (take_id) loses the #69 twin race to its own take_Id sibling and numbers to
  // takeId2 -- @key and $this must follow that rename, with no #161 link in play. see docs/FIXED.md #168
  const paths = [
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:take_Id',
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:take_id',
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:name',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, 14, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('takeId2: String!'), 'expected the key twin to take a numbered name on Take');
  assert.ok(schema!.includes('@key(fields: "takeId2")'), 'expected the @key to follow the key prop\'s own rename');
  assert.ok(schema!.includes('http: { GET: "/takes/{$this.takeId2}" }'), 'expected the $this resolver to follow the rename');
});
