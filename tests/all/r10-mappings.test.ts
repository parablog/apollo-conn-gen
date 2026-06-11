import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';

// --- R10 (slice 1): --reusable-mappings -> connect v0.5 @mapping, leaf auto-map form ---

const V05 = {
  connectorSpecVersion: 'v0.5',
  federationVersion: 'v2.13',
  composeFederationVersion: '2.13.0',
  reusableMappings: true,
};

test('test_R10_leaf_type_gets_automap_mapping', async () => {
  // User is all scalars -> its selection body is exactly its field names -> auto-map form
  // (bare @mapping, no selection argument), and the @connect selection is just its spread.
  const schema = await runOasTest('petstore.yaml', ['get:/user/{username}>**'], 19, 1, false, true, undefined, false, false, V05);
  assert.ok(schema !== undefined);
  assert.ok(/type User @mapping \{/.test(schema!), 'leaf type should carry the auto-map @mapping');
  assert.ok(!/@mapping\(/.test(schema!), 'an all-scalar schema needs no explicit @mapping(selection:)');
  assert.ok(schema!.includes('...User'), 'the @connect selection should be the root spread');
});

test('test_R10_mapping_added_to_connect_import', async () => {
  const schema = await runOasTest('petstore.yaml', ['get:/user/{username}>**'], 19, 1, false, true, undefined, false, false, V05);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('url: "https://specs.apollo.dev/connect/v0.5"'), 'expected the v0.5 connect @link');
  assert.ok(schema!.includes('import: ["@connect", "@source", "@mapping"]'), '@mapping must join the connect import');
  assert.ok(
    schema!.includes('import: ["@key"]'),
    'federation import stays ["@key"] — no @shareable by design',
  );
});

test('test_R10_nested_type_gets_explicit_mapping_with_spreads', async () => {
  // Pet nests Category/Tag: the leaves auto-map; Pet gets the explicit @mapping(selection:)
  // whose body is one level deep with child bodies collapsed to `field { ...Child }` spreads.
  const schema = await runOasTest('petstore.yaml', ['get:/pet/findByStatus>**'], 19, 3, false, true, undefined, false, false, V05);
  assert.ok(schema !== undefined);
  assert.ok(/type Category @mapping \{/.test(schema!), 'Category is a leaf -> auto-map');
  assert.ok(/type Tag @mapping \{/.test(schema!), 'Tag is a leaf -> auto-map');
  assert.ok(/type Pet @mapping\(selection: """/.test(schema!), 'Pet has nested fields -> explicit @mapping');
  assert.ok(schema!.includes('category { ...Category }'), 'nested object field collapses to its spread');
  assert.ok(schema!.includes('tags { ...Tag }'), 'array-of-object field collapses to its spread');
  assert.ok(schema!.includes('...Pet'), 'the @connect selection should be the root spread');
});

test('test_R10_entity_resolver_spreads_with_mapping', async () => {
  // R1 + R10: the entity type keeps @key -> @mapping -> @connect order and its entity
  // selection is its own spread, not the inlined field body.
  const schema = await runOasTest('petstore.yaml', ['get:/user/{username}>**'], 19, 1, false, true, undefined, false, true, V05);
  assert.ok(schema !== undefined);
  assert.ok(/type User @key\(fields: "username"\) @mapping/.test(schema!), 'order: @key then @mapping');
  const connectIdx = schema!.indexOf('@connect', schema!.indexOf('type User'));
  const mappingIdx = schema!.indexOf('@mapping', schema!.indexOf('type User'));
  assert.ok(mappingIdx >= 0 && connectIdx > mappingIdx, '@mapping precedes the entity @connect');
  assert.ok(/\.\.\.User/.test(schema!), 'entity selection should spread the type');
});

test('test_R10_flag_off_emits_no_mapping', async () => {
  // Same op, flag off: no @mapping anywhere, import list unchanged.
  const schema = await runOasTest('petstore.yaml', ['get:/user/{username}>**'], 19, 1, false, true, undefined, false, false, {
    connectorSpecVersion: 'v0.5',
    federationVersion: 'v2.13',
    composeFederationVersion: '2.13.0',
  });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('@mapping'), 'no @mapping without --reusable-mappings');
  assert.ok(schema!.includes('import: ["@connect", "@source"]'), 'import list unchanged without the flag');
});

// Extract the explicit @mapping body for a type, or undefined when it has none/auto-map.
function mappingBodyOf(schema: string, typeName: string): string | undefined {
  const m = new RegExp(`type ${typeName} @mapping\\(selection: """([\\s\\S]*?)"""\\)`).exec(schema);
  return m?.[1];
}

test('test_R10_two_type_cycle_stays_acyclic', async () => {
  // A -> B -> A: generation must terminate and the emitted @mapping graph must be acyclic —
  // exactly one direction spreads, the cycle-closing reference renders as the existing
  // commented circular cut (construction-time, see #10) or as a fully-inlined subtree.
  const schema = await runOasTest('r10-recursive.yaml', ['get:/a>**', 'get:/b>**'], 5, 2, false, false, undefined, false, false, V05);
  assert.ok(schema !== undefined);

  const aBody = mappingBodyOf(schema!, 'A');
  const bBody = mappingBodyOf(schema!, 'B');
  assert.ok(aBody !== undefined && bBody !== undefined, 'both cycle members carry explicit mappings');

  const aSpreadsB = aBody!.includes('...B');
  const bSpreadsA = bBody!.includes('...A');
  assert.ok(aSpreadsB !== bSpreadsA, 'exactly one direction may spread — both would loop the router expander');
});

test('test_R10_three_type_cycle_stays_acyclic', async () => {
  // X -> Y -> Z -> X: same invariant on a longer cycle — the spread chain must be broken once.
  const schema = await runOasTest('r10-recursive.yaml', ['get:/x>**', 'get:/y>**', 'get:/z>**'], 5, 3, false, false, undefined, false, false, V05);
  assert.ok(schema !== undefined);

  const bodies = ['X', 'Y', 'Z'].map((n) => mappingBodyOf(schema!, n) ?? '');
  const spreadEdges = [bodies[0].includes('...Y'), bodies[1].includes('...Z'), bodies[2].includes('...X')];
  const broken = spreadEdges.filter((edge) => !edge).length;
  assert.ok(broken >= 1, 'the 3-cycle must be broken at least once');
  assert.ok(spreadEdges.filter(Boolean).length >= 1, 'non-closing edges still spread');
});

test('test_R10_requires_connect_v05', async () => {
  // Explicit gate: the flag with a lower connect target must throw, not auto-bump.
  await assert.rejects(
    OasGen.fromFile(`${oasBasePath}/petstore.yaml`, {
      skipValidation: true,
      consolidateUnions: true,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.13',
      reusableMappings: true,
    }),
    /requires connect v0\.5/,
    'reusable mappings below v0.5 must be rejected',
  );
});
