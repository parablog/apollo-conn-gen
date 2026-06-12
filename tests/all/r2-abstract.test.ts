import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureWarnings } from './_setup.js';

// --- R2: real unions with discriminator -> __typename (connect v0.4) ----------

test('test_R2_union_discriminator_emits_typename_match_and_composes', async () => {
  // simple-oneOf-example: a oneOf [Book, Movie] with discriminator { propertyName: type,
  // mapping: { book: Book, movie: Movie } }. With consolidateUnions OFF + connect v0.4, the
  // connector must emit a real `union` and a `...->match` selection that sets a string-literal
  // __typename per member. Composes only at fed 2.13.
  const schema = await runOasTest('simple-oneOf-example.yaml', ['get:/item>**'], 1, 3, false, false, undefined, false, false, {
    consolidateUnions: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.13',
    composeFederationVersion: '2.13.0',
  });
  assert.ok(schema !== undefined);
  // real union, not the consolidate downgrade
  assert.ok(schema!.includes('union ItemResponse = Book | Movie'), 'expected a real union type');
  assert.ok(!schema!.includes('NOT SUPPORTED YET'), 'must not emit the consolidate placeholder');
  // discriminator-driven match with string-literal __typename per member
  assert.ok(schema!.includes('... type->match('), 'expected a spread ->match on the discriminator');
  assert.ok(schema!.includes('["book", $ {'), 'expected a branch keyed by the mapping value "book"');
  assert.ok(schema!.includes('__typename: $("Book")'), 'expected string-literal __typename for Book');
  assert.ok(schema!.includes('__typename: $("Movie")'), 'expected string-literal __typename for Movie');
});

test('test_R2_union_consolidate_downgrade_unchanged', async () => {
  // Default path (consolidateUnions ON): the same fixture must still emit the consolidate
  // downgrade (a replacement object + the NOT-SUPPORTED marker), composing at fed 2.12 —
  // i.e. the new abstract-type path does not perturb the default behaviour.
  const schema = await runOasTest('simple-oneOf-example.yaml', ['get:/item>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('NOT SUPPORTED YET'), 'default path still emits the consolidate downgrade');
  assert.ok(!schema!.includes('->match('), 'default path must not emit the v0.4 match form');
});

// --- R2 (Scenario B): oneOf members sharing an allOf base -> GraphQL interface (connect v0.4) ---

test('test_R2_interface_oneof_promotes_and_composes', async () => {
  // oneOf [Book, Movie], both allOf [Product, {…}] + a discriminator. With consolidateUnions OFF +
  // connect v0.4, the shared base Product is promoted to an interface, members implement it, the
  // field returns Product, and the connector selection uses the abstract-type ->match. Composes at
  // fed 2.13.
  const schema = await runOasTest('r2-interface-oneof.yaml', ['get:/item>**'], 1, 4, false, false, undefined, false, false, {
    consolidateUnions: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.13',
    composeFederationVersion: '2.13.0',
  });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('interface Product'), 'shared base promoted to an interface');
  assert.ok(schema!.includes('type Book implements Product'), 'Book implements the interface');
  assert.ok(schema!.includes('type Movie implements Product'), 'Movie implements the interface');
  assert.ok(/item: Product\b/.test(schema!), 'field returns the interface, not the union');
  assert.ok(!/\bunion \w+ =/.test(schema!), 'no union type is emitted');
  assert.ok(schema!.includes('... type->match('), 'abstract-type ->match selection');
  assert.ok(schema!.includes('__typename: $("Book")'), 'string-literal __typename per member');
});

test('test_R2_interface_skips_when_base_used_concretely', async () => {
  // Rule 3: when the shared base is ALSO returned concretely by another selected op
  // (GET /product -> $ref Product), promotion must be skipped (else that op would return an
  // interface with no __typename). Asserts the skip DECISION + loud warning. (Not composed: the
  // non-promoted real-union fallback is pre-existing-broken for allOf-composed members — see the
  // ROADMAP follow-up; promotion is precisely what fixes the allOf case.)
  let schema: string | undefined;
  const warnings = await captureWarnings(async () => {
    const gen = await OasGen.fromFile(`${oasBasePath}/r2-interface-shared-base.yaml`, {
      skipValidation: false,
      consolidateUnions: false,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.13',
    });
    await gen.visit();
    schema = gen.generateSchema(['get:/item>**', 'get:/product>**']);
  });
  assert.ok(schema !== undefined);
  assert.ok(!/interface Product/.test(schema!), 'base used concretely must NOT be promoted');
  assert.ok(
    warnings.some((w) => /not promoting .*Product.* concrete/.test(w)),
    `expected a rule-3 skip warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_R2_interface_default_consolidate_unchanged', async () => {
  // Default path (consolidateUnions ON) on the same fixture: consolidate downgrade, no interface,
  // no ->match. Confirms interface promotion does not perturb the default. Composes at fed 2.12.
  const schema = await runOasTest('r2-interface-oneof.yaml', ['get:/item>**'], 1, 1);
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('NOT SUPPORTED YET'), 'default path emits the consolidate downgrade');
  assert.ok(!schema!.includes('interface '), 'default path must not emit an interface');
  assert.ok(!schema!.includes('->match('), 'default path must not emit the v0.4 match form');
});

test('test_R2_union_without_discriminator_degrades_to_merged_object', async () => {
  // No tag field means `->match` has nothing to dispatch on, so a real union cannot be selected.
  // The abstract pass degrades to the same merged-object form the default pass emits — SDL and
  // selection agree, and composition passes. see docs/issues.md #25
  // typesSize 2: response + union — the merged members are no longer collected at all (#26)
  const schema = await runOasTest('oneof-no-discriminator.yaml', ['get:/search>**'], 1, 2, false, false, undefined, false, false, {
    consolidateUnions: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.13',
    composeFederationVersion: '2.13.0',
  });
  assert.ok(schema !== undefined);
  assert.ok(!/\bunion \w+ =/.test(schema!), 'no real union line without a discriminator');
  assert.ok(/no discriminator — union degraded/.test(schema!), 'the degrade is announced');
  assert.ok(/type ResultUnion \{/.test(schema!), 'merged object replaces the union');
  assert.ok(/minutes: Int/.test(schema!) && /pages: Int/.test(schema!), 'fields from both members merged');
  assert.ok(!/->match\(/.test(schema!), 'no ->match without a discriminator');
});

test('test_R2_collect_twice_is_byte_identical', async () => {
  // Composed.dependencies consolidates while the reachability walk reads (#26) — the same call
  // select() makes later. Generating twice from one instance must give the same output, or the
  // walk mutated something it shouldn't have.
  const gen = await OasGen.fromFile(`${oasBasePath}/r2-interface-oneof.yaml`, {
    skipValidation: false,
    consolidateUnions: false,
    showParentInSelections: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.13',
  });
  await gen.visit();
  const first = gen.generateSchema(['get:/item>**']);
  const second = gen.generateSchema(['get:/item>**']);
  assert.strictEqual(second, first, 'second generation must be byte-identical');
});
