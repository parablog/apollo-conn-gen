import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import { Namespace } from '../../src/oas/lint/namespace.js';
import './_setup.js';

// --- the flag, end to end through the CLI ----------------------------------

const CLI = ['--import', 'tsx/esm', 'src/cli/oas.ts', 'tests/resources/oas/apikey-header-prefix.yaml', '-n'];

test('test_service_prefix_renames_types_and_root_fields', () => {
  // Connectors generated on their own compose into one supergraph, so every name they bring has to
  // be theirs. All caps on purpose: only the first character is uppercased, so the tail is kept.
  const run = spawnSync('node', [...CLI, '--service-prefix', 'ACME'], { encoding: 'utf-8' });
  assert.strictEqual(run.status, 0, run.stderr);

  assert.ok(run.stdout.includes('scalar ACME_JSON'), 'a scalar takes the type prefix');
  assert.ok(run.stdout.includes('type ACME_WidgetsResponse {'), 'so does an object definition');
  assert.ok(run.stdout.includes('acme_widgets: ACME_WidgetsResponse'), 'the root field and its type move together');
  assert.ok(run.stdout.includes('type Query {'), 'the root type itself keeps its name');
  assert.ok(run.stdout.includes('@source(name: "api"'), 'a directive argument is a string, not a type reference');
});

test('test_service_prefix_rejects_a_value_that_is_not_a_graphql_name', () => {
  // a service directory id carries hyphens, which a GraphQL name cannot; the prefix here is `ACME`
  const run = spawnSync('node', [...CLI, '--service-prefix', 'acme-sanity'], { encoding: 'utf-8' });
  assert.notStrictEqual(run.status, 0, 'a prefix that is not a GraphQL name stops the run');
  assert.strictEqual(run.stdout.trim(), '', 'and nothing is written');
  assert.ok(/Invalid --service-prefix/.test(run.stderr), 'with the offending value named');
});

// --- the transform on its own ----------------------------------------------

test('test_service_prefix_renames_interfaces_unions_and_members', () => {
  const sdl = `
type Query {
  pets: [Pet!]!
}
interface Animal {
  id: String
}
type Dog implements Animal {
  id: String
}
type Cat implements Animal {
  id: String
}
union Pet = Dog | Cat
`;
  const out = Namespace.apply(sdl, 'ACME');

  assert.ok(out.includes('interface ACME_Animal {'), 'the interface definition');
  assert.ok(out.includes('type ACME_Dog implements ACME_Animal {'), 'and where a type implements it');
  assert.ok(out.includes('union ACME_Pet = ACME_Dog | ACME_Cat'), 'the union and both members');
  assert.ok(out.includes('acme_pets: [ACME_Pet!]!'), 'wrappers are kept, only the name inside changes');
  assert.ok(out.includes('type Query {'), 'Query is not renamed');
});

test('test_service_prefix_renames_argument_types', () => {
  const sdl = `
type Query {
  widget(where: Filter): Widget
}
input Filter {
  id: String
}
type Widget {
  id: String
}
`;
  const out = Namespace.apply(sdl, 'stripe');

  assert.ok(out.includes('stripe_widget(where: Stripe_Filter): Stripe_Widget'), 'argument and return type');
  assert.ok(out.includes('input Stripe_Filter {'), 'the input definition');
  assert.ok(!/\bid: Stripe_String\b/.test(out), 'a built-in scalar the document does not define is left alone');
});

test('test_service_prefix_requires_a_graphql_name', () => {
  // the library path guards itself too — the CLI check is for the message, not the safety
  assert.throws(() => Namespace.apply('type Query { a: String }', 'not-a-name'));
});
