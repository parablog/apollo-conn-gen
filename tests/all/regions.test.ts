import { test } from 'node:test';
import assert from 'node:assert';
import { Regions } from '../../src/oas/utils/regions.js';
import './_setup.js';

// --- #140: hand-written CUSTOM regions survive regeneration -----------------
//
// The problem this solves: someone generates a schema, then hand-edits it to fix or add
// something the OpenAPI spec can't produce on its own (say, a field the real API returns but
// its own spec omits). Next time the schema is regenerated from the spec, that hand edit is
// gone with no warning. A CUSTOM region is how the hand-written part survives: it's wrapped in
// `# === CUSTOM <name> ===` / `# === END CUSTOM <name> ===` comment markers, `extract` reads it
// out of the old file, and `splice` puts it back into the freshly generated file.

const OLD_SCHEMA = `# === CUSTOM extra-types ===
type Acme_HandAuthoredThing {
  id: ID
}
# === END CUSTOM extra-types ===

type Query {
  # === CUSTOM extra-query-fields ===
  acme_handAuthoredField: Acme_HandAuthoredThing
  # === END CUSTOM extra-query-fields ===
}
`;

const FRESH_SKELETON = `type Acme_Widget {
  id: ID
}

type Query {
  acme_getWidget: Acme_Widget
}
`;

test('test_140_splice_puts_hand_authored_type_and_field_back_into_a_fresh_schema', () => {
  const regions = Regions.extract(OLD_SCHEMA);
  const spliced = Regions.splice(FRESH_SKELETON, regions);

  // the hand-authored type lands before `type Query {`, not after
  const typeIndex = spliced.indexOf('type Acme_HandAuthoredThing {\n  id: ID\n}');
  const queryIndex = spliced.indexOf('type Query {');
  assert.ok(typeIndex >= 0, 'hand-authored type is present');
  assert.ok(typeIndex < queryIndex, 'hand-authored type comes before type Query');

  // the hand-authored field is inside Query, alongside the field that was already there
  const queryBody = spliced.slice(queryIndex, spliced.indexOf('\n}', queryIndex));
  assert.ok(queryBody.includes('acme_handAuthoredField: Acme_HandAuthoredThing'), 'hand-authored field is inside Query');
  assert.ok(queryBody.includes('acme_getWidget: Acme_Widget'), 'the field already in the fresh schema is untouched');

  // both blocks are still wrapped in their markers, so the next regeneration can recover them too
  assert.ok(spliced.includes('# === CUSTOM extra-types ==='), 'extra-types start marker re-emitted');
  assert.ok(spliced.includes('# === END CUSTOM extra-types ==='), 'extra-types end marker re-emitted');
  assert.ok(spliced.includes('# === CUSTOM extra-query-fields ==='), 'extra-query-fields start marker re-emitted');
  assert.ok(spliced.includes('# === END CUSTOM extra-query-fields ==='), 'extra-query-fields end marker re-emitted');

  // round trip: extracting the spliced output gives back the same two bodies extracted from
  // the old schema, so a second regeneration would not lose the hand-authored content
  const reExtracted = Regions.extract(spliced);
  assert.strictEqual(reExtracted['extra-types'], regions['extra-types']);
  assert.strictEqual(reExtracted['extra-query-fields'], regions['extra-query-fields']);
});

test('test_140_splice_accepts_a_body_already_at_column_zero_without_extract', () => {
  // extract() hands splice() a body with no leading spaces, even when the marker it came from
  // was indented. A caller that skips extract() and builds a region body by hand must supply
  // that same shape, so this calls splice() directly with a body that never went through
  // extract() at all, to prove splice()'s own indenting is correct on its own.
  const regions = { 'extra-query-fields': 'acme_directField: Acme_Widget' };
  const spliced = Regions.splice(FRESH_SKELETON, regions);

  const queryIndex = spliced.indexOf('type Query {');
  const queryBody = spliced.slice(queryIndex, spliced.indexOf('\n}', queryIndex));
  assert.ok(queryBody.includes('  acme_directField: Acme_Widget'), 'column-zero body gets exactly one indent level, not zero or two');
});

test('test_140_splice_hard_fails_on_a_known_but_unsupported_region', () => {
  // extra-links is one of the five known region names, but no committed schema has a real
  // non-empty example of it yet, so splice has no insertion point implemented for it. It must
  // refuse the input by name instead of silently dropping the hand-written links.
  const regions = { 'extra-links': '@link(url: "https://example.com/foo")' };
  assert.throws(() => Regions.splice(FRESH_SKELETON, regions), /extra-links/);
});

test('test_140_unknown_region_name_hard_fails', () => {
  // A typo'd or made-up region name (not one of the five known ones) must fail loudly rather
  // than being silently ignored, in extract and in splice alike.
  const withUnknownRegion = `# === CUSTOM extra-nonsense ===
some hand-written content
# === END CUSTOM extra-nonsense ===
`;
  assert.throws(() => Regions.extract(withUnknownRegion), /extra-nonsense/);
  assert.throws(() => Regions.splice(FRESH_SKELETON, { 'extra-nonsense': 'some hand-written content' }), /extra-nonsense/);
});
