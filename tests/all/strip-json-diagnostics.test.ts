import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// #172: "NEEDS ATTENTION: ... defaulted to JSON" notes are addressed to the schema author, but
// they ride field descriptions into the SDL every consumer (human or agent) reads, diluting the
// description they sit next to. --strip-json-diagnostics removes the inline copies; the author
// still gets each one as a build-time warning at its point of origin. Off by default: the SDL
// stays byte-identical without the flag.

// The fixture has fields that default to JSON in each emission shape: docstring-form (with and
// without an author description) and an argument-form note (quoted note before the arg name).
const PATHS = ['get:/things', 'get:/things/{thing_id}'];

const run = (opts: { stripJsonDiagnostics?: boolean } = {}) =>
  runOasTest('strip-json-diagnostics.yaml', PATHS, 2, 1, { skipValidation: true, ...opts });

test('test_172_notes_stay_by_default', async () => {
  const schema = await run();
  assert.ok(schema!.includes('NEEDS ATTENTION:'), 'inline notes remain without the flag');
});

test('test_172_flag_strips_every_note_form', async () => {
  const schema = await run({ stripJsonDiagnostics: true });
  assert.ok(!schema!.includes('NEEDS ATTENTION'), 'no note text survives anywhere in the SDL');
  // the fields the notes annotated must survive the strip intact
  assert.ok(schema!.includes('blob: JSON'), 'field with docstring-form note kept');
  assert.ok(/filter: JSON/.test(schema!), 'argument with inline-form note kept');
  // a real description that shared a docstring with a note keeps its own text
  assert.ok(schema!.includes('An opaque blob.'), 'author-written description text survives');
});
