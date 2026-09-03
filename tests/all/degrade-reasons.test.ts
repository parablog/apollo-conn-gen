import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #188: "NEEDS ATTENTION: ... defaulted to JSON" notes are addressed to the schema author, but
// they ride field descriptions into the SDL every consumer (human or agent) reads, diluting the
// description they sit next to. skipDegradeReasons drops the generated note; the author's own
// text (dash-normalised) always survives, even when it happens to contain the literal words
// "NEEDS ATTENTION:" itself. Off by default: the SDL stays byte-identical without the flag.

// The fixture has fields that default to JSON in every emission shape: docstring-form (with and
// without an author description), an argument-form note, and two fields whose own author text
// already contains "NEEDS ATTENTION:" and an em-dash, to prove the flag never touches author text.
const PATHS = ['get:/things', 'get:/things/{thing_id}'];

const run = (opts: { skipDegradeReasons?: boolean } = {}) =>
  runOasTest('degrade-reasons.yaml', PATHS, 2, 1, { skipValidation: true, ...opts });

const DEFAULT_SCHEMA = `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.4"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "http://localhost:9000" })


scalar JSON

type Thing {
  "NEEDS ATTENTION: this field's shape didn't match any known pattern and defaulted to JSON -- worth checking the source OAS schema."
  bareBlob: JSON
  """
  An opaque blob.

NEEDS ATTENTION: this field's shape didn't match any known pattern and defaulted to JSON -- worth checking the source OAS schema.
  """
  blob: JSON
  """
  Uses an em--dash in its own text.

NEEDS ATTENTION: this field's shape didn't match any known pattern and defaulted to JSON -- worth checking the source OAS schema.
  """
  emDash: JSON
  """
  Author note: NEEDS ATTENTION: check this value by hand.

NEEDS ATTENTION: this field's shape didn't match any known pattern and defaulted to JSON -- worth checking the source OAS schema.
  """
  literalNote: JSON
  thingId: Int
}

type Query {
  """
  List things (/things)
  """
  things("NEEDS ATTENTION: this object declares no properties of its own -- sent as raw JSON instead." filter: JSON): [Thing]
    @connect(
      source: "api"
      http: {
        GET: "/things"
        queryParams: """
          $args {
            "filter": filter
          }
        """
      }
      selection: """
      bareBlob: bare_blob?
      blob?
      emDash: em_dash?
      literalNote: literal_note?
      thingId: thing_id?
      """
    )
  """
  Get a thing (/things/{thing_id})
  """
  thingsByThingId(thingId: Int!): Thing
    @connect(
      source: "api"
      http: { GET: "/things/{$args.thingId}"}
      selection: """
      bareBlob: bare_blob?
      blob?
      emDash: em_dash?
      literalNote: literal_note?
      thingId: thing_id?
      """
    )
}

`;

const SKIPPED_SCHEMA = `extend schema
  @link(url: "https://specs.apollo.dev/federation/v2.14", import: ["@key"])
  @link(
    url: "https://specs.apollo.dev/connect/v0.4"
    import: ["@connect", "@source"]
  )
  @source(name: "api", http: { baseURL: "http://localhost:9000" })


scalar JSON

type Thing {
  bareBlob: JSON
  "An opaque blob."
  blob: JSON
  "Uses an em--dash in its own text."
  emDash: JSON
  "Author note: NEEDS ATTENTION: check this value by hand."
  literalNote: JSON
  thingId: Int
}

type Query {
  """
  List things (/things)
  """
  things(filter: JSON): [Thing]
    @connect(
      source: "api"
      http: {
        GET: "/things"
        queryParams: """
          $args {
            "filter": filter
          }
        """
      }
      selection: """
      bareBlob: bare_blob?
      blob?
      emDash: em_dash?
      literalNote: literal_note?
      thingId: thing_id?
      """
    )
  """
  Get a thing (/things/{thing_id})
  """
  thingsByThingId(thingId: Int!): Thing
    @connect(
      source: "api"
      http: { GET: "/things/{$args.thingId}"}
      selection: """
      bareBlob: bare_blob?
      blob?
      emDash: em_dash?
      literalNote: literal_note?
      thingId: thing_id?
      """
    )
}

`;

test('test_188_notes_stay_by_default', async () => {
  const schema = await run();
  assert.strictEqual(schema, DEFAULT_SCHEMA, 'default output is byte-identical to before the flag existed');
});

test('test_188_skip_degrade_reasons_drops_every_generated_note', async () => {
  const schema = await run({ skipDegradeReasons: true });
  assert.strictEqual(schema, SKIPPED_SCHEMA, 'no generated note anywhere, author text (incl. its own "NEEDS ATTENTION:") survives');
});
