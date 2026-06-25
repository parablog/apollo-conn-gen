import { test } from 'node:test';
import assert from 'node:assert';
import { OasGen } from '../../src/index.js';
import { oasBasePath, runOasTest } from '../../src/tests/runners.js';
import { captureWarnings } from './_setup.js';

// --- R2: real unions with discriminator -> __typename (connect v0.4) ----------

test('test_R2_union_discriminator_emits_typename_match_and_composes', async () => {
  // simple-oneOf-example: a oneOf [Book, Movie] with discriminator { propertyName: type,
  // mapping: { book: Book, movie: Movie } }. With real unions + connect v0.4, the
  // connector must emit a real `union` and a `...->match` selection that sets a string-literal
  // __typename per member. Composes only at fed 2.14.
  const schema = await runOasTest('simple-oneOf-example.yaml', ['get:/item>**'], 1, 3, false, false, undefined, false, false, {
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    composeFederationVersion: '2.14.1',
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

test('test_R2_union_partial_selection_omits_unselected_member', async () => {
  // A real union emits every *referenced* member type. A partial selection that picks fields from only
  // SOME members must NOT emit the unselected ones as fieldless `type X {}` (INVALID_GRAPHQL: expected
  // Field Definition). Here only Book's fields are selected — Movie must not appear at all, and the union
  // lists only Book. Union.dependencies() must mirror generate()/->match (selectedMembers). see #36
  const paths = [
    'get:/item>res:r>union:itemResponse>obj:type:#/c/s/Book>prop:scalar:id',
    'get:/item>res:r>union:itemResponse>obj:type:#/c/s/Book>prop:scalar:type',
    'get:/item>res:r>union:itemResponse>obj:type:#/c/s/Book>prop:scalar:title',
    'get:/item>res:r>union:itemResponse>obj:type:#/c/s/Book>prop:scalar:author',
  ];
  const schema = await runOasTest('simple-oneOf-example.yaml', paths, 1, 2, false, false, undefined, false, false, {
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    composeFederationVersion: '2.14.1',
  });
  assert.ok(schema !== undefined);
  assert.ok(/union ItemResponse = Book\b/.test(schema!), 'union lists only the selected member');
  assert.ok(!/\bMovie\b/.test(schema!), 'unselected member Movie must not appear (no fieldless type, no union member)');
});

// --- R2 (Scenario B): oneOf members sharing an allOf base -> GraphQL interface (connect v0.4) ---

test('test_R2_interface_oneof_promotes_and_composes', async () => {
  // oneOf [Book, Movie], both allOf [Product, {…}] + a discriminator. With real unions +
  // connect v0.4, the shared base Product is promoted to an interface, members implement it, the
  // field returns Product, and the connector selection uses the abstract-type ->match. Composes at
  // fed 2.13.
  const schema = await runOasTest('r2-interface-oneof.yaml', ['get:/item>**'], 1, 4, false, false, undefined, false, false, {
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    composeFederationVersion: '2.14.1',
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
      showParentInSelections: false,
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
    });
    await gen.visit();
    schema = gen.generateSchema(['get:/item>**', 'get:/product>**']);
  });
  assert.ok(schema !== undefined);
  assert.ok(!/interface Product/.test(schema!), 'base used concretely must NOT be promoted');
  assert.ok(/union ItemResponse = Book \| Movie/.test(schema!), 'the un-promoted union lists its members (#34)');
  assert.ok(
    warnings.some((w) => /not promoting .*Product.* concrete/.test(w)),
    `expected a rule-3 skip warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_R2_union_without_discriminator_degrades_to_merged_object', async () => {
  // No tag field means `->match` has nothing to dispatch on, so a real union cannot be selected.
  // The abstract pass degrades to the same merged-object form the default pass emits — SDL and
  // selection agree, and composition passes. see docs/issues.md #25
  // typesSize 2: response + union — the merged members are no longer collected at all (#26)
  const schema = await runOasTest('oneof-no-discriminator.yaml', ['get:/search>**'], 1, 2, false, false, undefined, false, false, {
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    composeFederationVersion: '2.14.1',
  });
  assert.ok(schema !== undefined);
  assert.ok(!/\bunion \w+ =/.test(schema!), 'no real union line without a discriminator');
  assert.ok(/union degraded to a merged object/.test(schema!), 'the degrade is announced');
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
    showParentInSelections: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
  });
  await gen.visit();
  const first = gen.generateSchema(['get:/item>**']);
  const second = gen.generateSchema(['get:/item>**']);
  assert.strictEqual(second, first, 'second generation must be byte-identical');
});

test('test_R2_union_discriminator_no_mapping_uses_bare_refname', async () => {
  // C1: a discriminator with `propertyName` but NO `mapping` must fall back to the bare schema
  // name from the $ref (e.g. "Book"), per OAS 3.x. The pre-fix code lowercased the name
  // (`typeName.toLowerCase()`), producing `["book", $ { … }]` — a branch that never matches a
  // spec-compliant payload tagged `type: "Book"`. With real unions + connect v0.4,
  // the emitted `->match` must key on the bare name. Composes at fed 2.14.
  const schema = await runOasTest(
    'r2-discriminator-no-mapping.yaml',
    ['get:/item>**'],
    1,
    3,
    false,
    false,
    undefined,
    false,
    false,
    {
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.1',
    },
  );
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('union ItemResponse = Book | Movie'), 'expected a real union type');
  assert.ok(
    schema!.includes('["Book", $ {'),
    'no-mapping discriminator must key on the bare ref name "Book" (OAS 3.x implicit value)',
  );
  assert.ok(
    schema!.includes('["Movie", $ {'),
    'no-mapping discriminator must key on the bare ref name "Movie"',
  );
  // Negative: the pre-fix lowercase form must NOT appear.
  assert.ok(!/\["book"/.test(schema!), 'the buggy lowercase form ["book"] must not appear');
  assert.ok(!/\["movie"/.test(schema!), 'the buggy lowercase form ["movie"] must not appear');
});

test('test_R2_input_union_consolidated_kind_is_intentional (C6 investigation)', async () => {
  // C6: the review claimed a Body-rooted Union emitting `input ResultUnion { … }` was invalid SDL,
  // but the investigation proved otherwise. When `oneOf` is a *request body*, the merged object
  // IS an input — referenced as `input InputInput!` from the Mutation field — so `kind='input'`
  // (inherited from Body) is correct, not a bug. Hard-coding `'type '` here would break this case.
  // This test locks the correct behavior: the merged object is emitted with the `input` keyword,
  // the Mutation references it as `input InputInput!`, and the SDL composes cleanly at fed 2.12.
  const schema = await runOasTest(
    'r2-input-union-consolidated.yaml',
    ['post:/create>**'],
    1,
    2,
    false,
    false,
    undefined,
    false,
    false,
    {
      connectorSpecVersion: 'v0.4',
      federationVersion: 'v2.14',
      composeFederationVersion: '2.14.1',
    },
  );
  assert.ok(schema !== undefined);
  // A discriminated input `oneOf` must STILL degrade to the input object — never a union / ->match
  // (GraphQL has no input unions, any version). This is the guard for the position-first predicate. #36
  assert.ok(!/\bunion \w+ =/.test(schema!), 'no real union for an input-position oneOf');
  assert.ok(!/->match\(/.test(schema!), 'no ->match for an input-position oneOf');
  // The merged object is emitted with the `input` keyword (not `type`), since it lives in input
  // position. `nameSuffix()` adds `Input` so the name is `InputInput` — distinct from any output
  // sibling reached by the same schema.
  assert.ok(
    /input InputInput \{ #### replacement for Union Input/.test(schema!),
    'merged input-position union must use the `input` keyword and the Input-suffixed name',
  );
  // The Mutation references it as an input type — a valid GraphQL input-field reference.
  assert.ok(
    schema!.includes('createCreate(input: InputInput!)'),
    'the Mutation must reference the merged input type by its Input-suffixed name',
  );
  // runOasTest already asserted composition passed (it returns the schema only on compose success),
  // so the SDL is provably valid — the C6 "invalid SDL" claim is closed.
});

test('test_R2_union_form_derived_from_connect_version', async () => {
  // connect v0.4 emits real unions; connect < v0.4 is now rejected at the floor (the pre-v0.4
  // consolidate downgrade was removed). see ROADMAP R2
  const real = await OasGen.fromFile(`${oasBasePath}/simple-oneOf-example.yaml`, {
    skipValidation: false,
    showParentInSelections: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
  });
  await real.visit();
  assert.ok(/union ItemResponse = Book \| Movie/.test(real.generateSchema(['get:/item>**'])), 'v0.4 emits real unions');

  await assert.rejects(
    OasGen.fromFile(`${oasBasePath}/simple-oneOf-example.yaml`, {
      skipValidation: false,
      showParentInSelections: false,
      connectorSpecVersion: 'v0.3',
      federationVersion: 'v2.14',
    }),
    /Unsupported connector spec version .*v0\.3/,
    'connect < v0.4 is rejected at the floor',
  );
});
