import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest, oasBasePath } from '../../src/tests/runners.js';
import { OasGen } from '../../src/index.js';
import { Obj, Prop, T } from '../../src/oas/nodes/internal.js';
import './_setup.js';

// #162: under --keep-field-names (#158), a field whose own spelling is already safe (foo_bar)
// still collided with a camelCase sibling and got renumbered, even though keeping its own name
// would have avoided the collision. see docs/FIXED.md #162
//   e.g. (keep-twin-fields.yaml) foo_bar + fooBar, flag on -> both keep their own name, no clash

const PATHS_SIZE = 3;

const run = (paths: string[], typesSize: number, opts: { keepFieldNames?: boolean } = {}) =>
  runOasTest('keep-twin-fields.yaml', paths, PATHS_SIZE, typesSize, opts);

// Widget's own Prop array, fully visited so each Prop carries its real name (id order: foo_bar,
// fooBar, prefs-background, prefs/background, prefsBackground2). numberTwinFields mutates
// renamedTo in place, so tests that call it directly ask for a fresh array of their own.
//   e.g. widgetProps() twice -> two independent Prop arrays, neither sees the other's renamedTo
async function widgetProps(): Promise<Prop[]> {
  const gen = await OasGen.fromFile(`${oasBasePath}/keep-twin-fields.yaml`, { showParentInSelections: false } as never);
  await gen.visit();
  const op = gen.paths.get('get:/widgets')!;
  const [res] = gen.expand(op);
  const [widget] = gen.expand(res) as [Obj];
  gen.expand(widget);
  return Array.from(widget.props.values());
}

test('test_162_disabled_by_default_still_numbers', async () => {
  // flag off: numberTwinFields keeps its keep=false branch, verbatim -- every twin still numbers,
  // whichever spelling processes first. see docs/FIXED.md #162
  //   e.g. (widgets) foo_bar + fooBar, flag off -> fooBar, fooBar2
  const schema = await run(['get:/widgets>**', 'get:/merged>**', 'get:/choice>**'], 3);
  assert.ok(schema!.includes('fooBar: String') && schema!.includes('fooBar2: String'), 'widgets: still numbers');
  assert.ok(schema!.includes('fooBar2: fooBar?'), 'widgets: numbered twin aliases the base');
  assert.ok(schema!.includes('tagName: String') && schema!.includes('tagName2: String'), 'merged: still numbers');
  assert.ok(schema!.includes('tagName2: tagName?'), 'merged: numbered twin aliases the base');
  assert.ok(schema!.includes('modeX: String') && schema!.includes('modeX2: String'), 'choice: still numbers');
  assert.ok(schema!.includes('modeX2: modeX?'), 'choice: numbered twin aliases the base');
});

test('test_162_keepable_twins_stop_colliding', async () => {
  // flag on: foo_bar and fooBar are each already a safe identifier, so both keep their own
  // spelling and there is no collision left to number around. see docs/FIXED.md #162
  //   e.g. (widgets) foo_bar + fooBar, flag on -> foo_bar, fooBar (no fooBar2)
  const schema = await run(['get:/widgets>**'], 1, { keepFieldNames: true });
  assert.ok(schema!.includes('foo_bar: String'), 'foo_bar bare');
  assert.ok(schema!.includes('fooBar: String'), 'fooBar bare');
  assert.ok(!schema!.includes('fooBar2'), 'no numbered twin is written at all');
});

test('test_162_kept_spelling_wins_the_base_name', async () => {
  // flag on: prefsBackground2 is itself a valid identifier, so it claims its own spelling
  // unconditionally; the two unkeepable spellings number around it instead of taking it.
  // see docs/FIXED.md #162
  //   e.g. (widgets) prefsBackground2 stays bare; prefs-background and prefs/background number
  //   to prefsBackground and prefsBackground3
  const schema = await run(['get:/widgets>**'], 1, { keepFieldNames: true });
  assert.ok(schema!.includes('prefsBackground2: String'), 'the literal kept spelling stays bare');
  assert.ok(schema!.includes('prefsBackground: $."prefs-background"?'), 'the base twin keeps its own key');
  assert.ok(schema!.includes('prefsBackground3: $."prefs/background"?'), 'the second twin numbers past the kept name');
  assert.ok(!schema!.includes('prefsBackground22'), 'no double-numbered fallback is left over');
});

test('test_162_allof_route', async () => {
  // an inline allOf folds PartA's "tag/name" and PartB's tagName onto one type -- tagName is
  // already a valid identifier, so it wins the base name regardless of allOf member order.
  // see docs/FIXED.md #162
  //   e.g. (merged) tagName stays bare, tag/name numbers to tagName2
  const schema = await run(['get:/merged>**'], 1, { keepFieldNames: true });
  assert.strictEqual((schema!.match(/\btagName: String\b/g) || []).length, 1, 'tagName bare, once');
  assert.strictEqual((schema!.match(/\btagName2: String\b/g) || []).length, 1, 'tagName2 numbered, once');
  assert.ok(schema!.includes('tagName2: $."tag/name"?'), 'the numbered twin keeps its own key');
});

test('test_162_union_merge_route', async () => {
  // an inline oneOf with no discriminator flattens ChoiceA's "mode-x" and ChoiceB's modeX onto
  // one merged type -- modeX wins the base name, and the selection agrees. see docs/FIXED.md #162
  //   e.g. (choice) modeX stays bare, mode-x numbers to modeX2
  const schema = await run(['get:/choice>**'], 1, { keepFieldNames: true });
  assert.strictEqual((schema!.match(/\bmodeX: String\b/g) || []).length, 1, 'modeX bare, once');
  assert.strictEqual((schema!.match(/\bmodeX2: String\b/g) || []).length, 1, 'modeX2 numbered, once');
  assert.ok(schema!.includes('modeX2: $."mode-x"?'), 'the merged selection agrees');
});

test('test_162_idempotent_across_repeated_calls', async () => {
  // calling numberTwinFields again on the same Props must not renumber them further -- an already
  // pinned twin stays put. see docs/FIXED.md #162
  //   e.g. prefsBackground3 stays prefsBackground3, it never becomes prefsBackground4
  const props = await widgetProps();
  const before = T.numberTwinFields(props, true).map((p) => p.renamedTo ?? p.name);
  const after = T.numberTwinFields(props, true).map((p) => p.renamedTo ?? p.name);
  assert.deepStrictEqual(after, before, 'a second call leaves every name exactly as the first left it');
  const slash = props.find((p) => p.name === 'prefs/background')!;
  assert.strictEqual(slash.renamedTo, 'prefsBackground3', 'the numbered twin keeps its number');
});

test('test_162_partial_view_then_full_view_kept_wins', async () => {
  // a partial view (no literal prefsBackground2 in scope yet) pins the loser to prefsBackground2;
  // once the literal field comes into scope, that pin is stale and gets evicted so the literal
  // field can still win its own spelling. see docs/FIXED.md #162
  //   e.g. partial view -> prefs/background: prefsBackground2; full view -> prefsBackground2
  //   claims its own name and prefs/background renumbers to prefsBackground3
  const props = await widgetProps();
  const dash = props.find((p) => p.name === 'prefs-background')!;
  const slash = props.find((p) => p.name === 'prefs/background')!;
  const literal = props.find((p) => p.name === 'prefsBackground2')!;

  T.numberTwinFields([dash, slash], true);
  assert.strictEqual(dash.renamedTo, undefined, 'the first twin claims the base name bare');
  assert.strictEqual(slash.renamedTo, 'prefsBackground2', 'the second twin pins to the first free number');

  T.numberTwinFields(props, true);
  assert.strictEqual(dash.renamedTo, undefined, 'still the base twin');
  assert.strictEqual(literal.renamedTo, undefined, 'the literal field still claims its own spelling bare');
  assert.strictEqual(slash.renamedTo, 'prefsBackground3', 'evicted from prefsBackground2, renumbered around it');
});
