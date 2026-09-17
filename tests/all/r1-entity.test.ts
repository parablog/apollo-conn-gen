import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import { runConnectorTest } from '../../src/tests/connectors.js';
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

  const schema = await runOasTest('entity-link.yaml', paths, 24, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('takeId2: String!'), 'expected the key twin to take a numbered name on Take');
  assert.ok(schema!.includes('@key(fields: "takeId2")'), 'expected the @key to follow the key prop\'s own rename');
  assert.ok(schema!.includes('http: { GET: "/takes/{$this.takeId2}" }'), 'expected the $this resolver to follow the rename');
});

test('test_R1_petId_aliases_to_id_sole_path_param_only', async () => {
  // A sole path param named `<TypeName>Id` aliases to the type's own `id`: `/pet/{petId}` ->
  // `Pet.id` (camelCase), `/store/order/{order_id}` -> `Order.id` (separator-insensitive). A
  // literal match still wins (`/user/{username}` -> `User.username`, not aliased to `id`), and
  // two path params never alias even when one of them matches the rule by name (`accountId` on
  // `/customer/{customerId}/account/{accountId}`) — `Account` gets no `@key` at all.
  const paths = [
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:id',
    'get:/pet/{petId}>res:r>obj:type:#/c/s/Pet>prop:scalar:name',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:id',
    'get:/user/{username}>res:r>obj:type:#/c/s/User>prop:scalar:username',
    'get:/customer/{customerId}/account>res:r>obj:type:#/c/s/Account>prop:scalar:id',
    'get:/store/order/{order_id}>res:r>obj:type:#/c/s/Order>prop:scalar:id',
    'get:/customer/{customerId}/account/{accountId}>res:r>obj:type:#/c/s/Account>prop:scalar:id',
  ];

  const schema = await runOasTest('entity-param-alias.yaml', paths, 6, 4, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Pet @key(fields: "id")'), 'expected petId aliased to id on Pet');
  assert.ok(schema!.includes('http: { GET: "/pet/{$this.id}" }'), 'expected the $this URL to use id, not petId');
  assert.ok(schema!.includes('type Order @key(fields: "id")'), 'expected order_id aliased to id on Order');
  assert.ok(schema!.includes('http: { GET: "/store/order/{$this.id}" }'), 'expected the $this URL to use id, not order_id');
  assert.ok(schema!.includes('type User @key(fields: "username")'), 'expected literal match to still win on User');
  assert.ok(schema!.includes('http: { GET: "/user/{$this.username}" }'), 'expected the $this URL to keep username');
  assert.ok(!/type Account[^{]*@key/.test(schema!), 'expected no @key on Account from either candidate op');
  assert.ok(!schema!.includes('{$this.petId}'), 'must not reference the raw petId param');
  assert.ok(!schema!.includes('{$this.customerId}'), 'must not reference the raw customerId param');
  assert.ok(!schema!.includes('{$this.accountId}'), 'must not reference the raw accountId param');
});

test('test_R1_composite_path_key_literal_match_qualifies', async () => {
  // Both /warehouse/{regionId}/{binId} path params literally name a selected field on
  // StockLocation -- the positive counterpart to the negative two-param case above.
  const paths = [
    'get:/warehouse/{regionId}/{binId}>res:r>obj:type:#/c/s/StockLocation>prop:scalar:regionId',
    'get:/warehouse/{regionId}/{binId}>res:r>obj:type:#/c/s/StockLocation>prop:scalar:binId',
    'get:/warehouse/{regionId}/{binId}>res:r>obj:type:#/c/s/StockLocation>prop:scalar:quantity',
  ];

  const schema = await runOasTest('entity-param-alias.yaml', paths, 6, 1, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type StockLocation @key(fields: "regionId binId")'), 'expected a composite @key');
  assert.ok(
    schema!.includes('http: { GET: "/warehouse/{$this.regionId}/{$this.binId}" }'),
    'expected both path params to resolve as $this',
  );
});

// --- R1 POST: type-level entity resolvers keyed through a request body, #224 ---

const RPC_POST_PATHS = [
  'post:/widget.list>**',
  'post:/widget.info>**',
  'post:/gadget.info>**',
  'post:/gizmo.info>**',
  'post:/token.info>**',
  'post:/file.info>**',
  'post:/pair.info>**',
  'post:/widget.infoWithRegion>**',
  'post:/widget.infoForm>**',
  'post:/widget.infoVendorJson>**',
  'post:/widget.delete>**',
];

// Every read op is marked explicitly; widget.delete carries no override on purpose, so it
// stays a mutation for its own negative case (Concern 2: shape alone cannot tell a write apart).
const RPC_POST_READS = Object.fromEntries(
  [
    'post:/widget.list',
    'post:/widget.info',
    'post:/gadget.info',
    'post:/gizmo.info',
    'post:/token.info',
    'post:/file.info',
    'post:/pair.info',
    'post:/widget.infoWithRegion',
    'post:/widget.infoForm',
    'post:/widget.infoVendorJson',
  ].map((id) => [id, { root: 'query' as const }]),
);

test('test_R1_post_entity_resolver_same_name_key_wrapped_in_envelope', async () => {
  // widget.info: body { id } -> union [WidgetInfoSuccessResponse { results: Widget }, Error] ->
  // same-name key, the selection wraps under the envelope's own results field.
  const schema = await runOasTest('entity-rpc-post-key.yaml', RPC_POST_PATHS, 11, 29, {
    inferEntityResolvers: true,
    overrides: RPC_POST_READS,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "id")'), 'expected @key on Widget');
  assert.ok(
    schema!.includes('POST: "/widget.info"\n        body: "$({ id: $this.id })"'),
    'expected the POST body key on Widget',
  );
  assert.ok(schema!.includes('$.results {'), 'expected the selection wrapped under the envelope field');
  assert.ok(!schema!.includes('entity: true'), 'must not emit the legacy Query-field entity: true');

  const widgetBlock = schema!.match(/type Widget @key\(fields: "id"\)\n([\s\S]*?)\n\{\n/);
  assert.ok(widgetBlock, 'expected to find the Widget type header');
  const connectCount = (widgetBlock![1].match(/@connect\(/g) ?? []).length;
  assert.strictEqual(connectCount, 1, `expected exactly one entity resolver on Widget, got ${connectCount}`);

  assert.ok(
    schema!.includes('moreDataAvailable?\n      nextCursor?\n      results? {'),
    "widget.list's own Query-field selection stays flat, unwrapped by the envelope rule",
  );
});

test('test_R1_post_entity_resolver_divergent_name_key_and_extra_optional_prop', async () => {
  // gadget.info: body key gadgetId aliases to Gadget's own id (a divergent name, the common
  // Ashby case). gizmo.info: body { id, includeArchived? } -- the extra optional property
  // does not block candidacy.
  const schema = await runOasTest('entity-rpc-post-key.yaml', RPC_POST_PATHS, 11, 29, {
    inferEntityResolvers: true,
    overrides: RPC_POST_READS,
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Gadget @key(fields: "id")'), 'expected @key on Gadget');
  assert.ok(
    schema!.includes('POST: "/gadget.info"\n        body: "$({ gadgetId: $this.id })"'),
    'expected the aliased body key on Gadget',
  );
  assert.ok(schema!.includes('type Gizmo @key(fields: "id")'), 'expected @key on Gizmo');
  assert.ok(
    schema!.includes('POST: "/gizmo.info"\n        body: "$({ id: $this.id })"'),
    'expected the POST body key on Gizmo, unaffected by the extra optional property',
  );
});

test('test_R1_post_entity_resolver_excluded_ops', async () => {
  // token.info has no body; file.info's fileHandle resolves against neither File's own field
  // nor a type-name alias; pair.info's required "other" body property has nowhere to go;
  // infoWithRegion/infoForm/infoVendorJson fail the read-only-JSON-body gate; widget.delete
  // matches the shape but carries no root: query override, so it stays a mutation.
  const schema = await runOasTest('entity-rpc-post-key.yaml', RPC_POST_PATHS, 11, 29, {
    inferEntityResolvers: true,
    overrides: RPC_POST_READS,
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('type Token @key('), 'token.info has no body -- no candidate key');
  assert.ok(!schema!.includes('type File @key('), 'fileHandle resolves against neither File.id nor a type-name alias');
  assert.ok(!schema!.includes('type Pair @key('), 'the required, non-key body property "other" blocks candidacy');
  assert.ok(schema!.includes('createWidgetInfoWithRegion('), 'widget.infoWithRegion stays a plain read');
  assert.ok(schema!.includes('createWidgetInfoForm('), 'widget.infoForm stays a plain read');
  assert.ok(schema!.includes('createWidgetInfoVendorJson('), 'widget.infoVendorJson stays a plain read');
  assert.ok(schema!.includes('createWidgetDelete('), 'widget.delete stays a plain mutation field');
  assert.ok(!schema!.includes('entity: true'), 'must not emit the legacy Query-field entity: true');
});

test('test_R1_post_entity_resolver_flag_off_is_byte_identical', async () => {
  // Same fixture and overrides, flag OFF: no @key, no $this resolver anywhere.
  const schema = await runOasTest('entity-rpc-post-key.yaml', RPC_POST_PATHS, 11, 29, {
    overrides: RPC_POST_READS,
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('@key('), 'flag off must not emit @key');
  assert.ok(!schema!.includes('$this'), 'flag off must not emit a $this resolver');
});

test('test_225_pattern_read_gets_the_entity_resolver', async () => {
  // same fixture, but the read comes from a "$match" pattern instead of RPC_POST_READS naming
  // widget.info directly -- proves a pattern-derived root: query still reaches the #224 path.
  const schema = await runOasTest('entity-rpc-post-key.yaml', ['post:/widget.info>**'], 11, 5, {
    inferEntityResolvers: true,
    overrides: { $match: [{ pattern: '\\.info$', root: 'query' }] },
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "id")'), 'expected @key on Widget');
  assert.ok(
    schema!.includes('POST: "/widget.info"\n        body: "$({ id: $this.id })"'),
    'expected the POST body key on Widget',
  );
  assert.ok(schema!.includes('$.results {'), 'expected the selection wrapped under the envelope field');
});

// A type-level connector, addressed as "TypeName[0]", answers test-connectors like a root
// field does -- confirmed against Widget's GET resolver before writing this case.
test('entity-rpc-post-key runtime: widget-info', async (t) => {
  const result = await runConnectorTest(
    'entity-rpc-post-key.yaml',
    ['post:/widget.info>**'],
    'tests/resources/connectors/entity-rpc-post-key/widget-info.connector.yaml',
    { inferEntityResolvers: true, overrides: { 'post:/widget.info': { root: 'query' } } },
  );
  if (result.skipped) {
    t.skip(result.output);
    return;
  }
  assert.ok(result.success, result.output);
});
