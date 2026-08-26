import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// --- #161: entity-link inference (inferEntityLinks) -- the reference half of R1: a key-only
// field on any other selected type that carries the by-id op's own path-param name. ---

const PATHS_SIZE = 14; // total GET ops declared in entity-link.yaml, regardless of selection

test('test_161_happy_path_song_links_to_album', async () => {
  // Song.album_id (required) matches Album's own by-id key -> Song gains a key-only
  // `album: Album!` field, selecting just Album's own key.
  const paths = [
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:song_id',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:album_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('album: Album!'), 'expected a required album link field on Song');
  assert.ok(
    /album:\s*\{\s*albumId:\s*album_id\s*\}/.test(schema!),
    'expected a key-only selection stub mapping albumId to album_id',
  );
});

test('test_161_terminal_segment_rejected', async () => {
  // /albums/{album_id}/details has one path param, but the path doesn't end in it -- must not
  // become a link source, even though Album is otherwise R1-qualified via this very op.
  const paths = [
    'get:/albums/{album_id}/details>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}/details>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:song_id',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:album_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('album: Album'), 'no link field expected when the path does not end in the param');
  assert.ok(!/album:\s*\{/.test(schema!), 'no key-only selection stub expected');
});

test('test_161_field_name_collision_skips_existing_prop', async () => {
  // Concert already declares its own scalar "album" field -- the link must be skipped rather
  // than clobbering it, even though Concert also carries a matching album_id.
  const paths = [
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/concerts/{concert_id}>res:r>obj:type:#/c/s/Concert>prop:scalar:concert_id',
    'get:/concerts/{concert_id}>res:r>obj:type:#/c/s/Concert>prop:scalar:name',
    'get:/concerts/{concert_id}>res:r>obj:type:#/c/s/Concert>prop:scalar:album_id',
    'get:/concerts/{concert_id}>res:r>obj:type:#/c/s/Concert>prop:scalar:album',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('album: String'), 'expected the pre-existing album field to survive untouched');
  assert.ok(!schema!.includes('album: Album'), 'no link field expected -- the name is already taken');
  assert.ok(!/album:\s*\{/.test(schema!), 'no key-only selection stub expected');
});

test('test_161_extra_required_param_not_a_link_source', async () => {
  // getWidget takes a second required param (mode) besides its path param -- it still qualifies
  // Widget for R1 itself (R1 ignores non-path params), but must not seed a link.
  const paths = [
    'get:/widgets/{widget_id}>res:r>obj:type:#/c/s/Widget>prop:scalar:widget_id',
    'get:/widgets/{widget_id}>res:r>obj:type:#/c/s/Widget>prop:scalar:name',
    'get:/gadgets/{gadget_id}>res:r>obj:type:#/c/s/Gadget>prop:scalar:gadget_id',
    'get:/gadgets/{gadget_id}>res:r>obj:type:#/c/s/Gadget>prop:scalar:name',
    'get:/gadgets/{gadget_id}>res:r>obj:type:#/c/s/Gadget>prop:scalar:widget_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('type Widget @key(fields: "widgetId")'), 'R1 itself should still resolve Widget');
  assert.ok(!schema!.includes('widget: Widget'), 'no link field expected -- the op has an extra required param');
  assert.ok(!/widget:\s*\{/.test(schema!), 'no key-only selection stub expected');
});

test('test_161_mutual_circular_only_first_by_sort_order', async () => {
  // Disc carries cut_id and Cut carries disc_id -- both directions qualify, but adding both
  // would close a cycle the composer rejects (CIRCULAR_REFERENCE). Candidates sort by op id
  // ('get:/cuts/{cut_id}' < 'get:/discs/{disc_id}'), so Cut's candidate is placed first: Disc
  // gains a `cut` link, and Cut's own reciprocal `disc` link is then blocked by reachability.
  const paths = [
    'get:/discs/{disc_id}>res:r>obj:type:#/c/s/Disc>prop:scalar:disc_id',
    'get:/discs/{disc_id}>res:r>obj:type:#/c/s/Disc>prop:scalar:name',
    'get:/discs/{disc_id}>res:r>obj:type:#/c/s/Disc>prop:scalar:cut_id',
    'get:/cuts/{cut_id}>res:r>obj:type:#/c/s/Cut>prop:scalar:cut_id',
    'get:/cuts/{cut_id}>res:r>obj:type:#/c/s/Cut>prop:scalar:name',
    'get:/cuts/{cut_id}>res:r>obj:type:#/c/s/Cut>prop:scalar:disc_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('cut: Cut!'), 'expected Disc to gain the first-sorted cut link');
  assert.ok(
    /cut:\s*\{\s*cutId:\s*cut_id\s*\}/.test(schema!),
    'expected a key-only selection stub mapping cutId to cut_id',
  );
  assert.ok(!schema!.includes('disc: Disc'), 'the reciprocal disc link must be blocked by the reachability guard');
  assert.ok(!/disc:\s*\{/.test(schema!), 'no reciprocal selection stub expected');
});

test('test_161_two_hosts_independent_links', async () => {
  // Both Song and Playlist carry album_id -- each gets its own independent album link (distinct
  // ids), and the schema still composes with both present.
  const paths = [
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:song_id',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:album_id',
    'get:/playlists/{playlist_id}>res:r>obj:type:#/c/s/Playlist>prop:scalar:playlist_id',
    'get:/playlists/{playlist_id}>res:r>obj:type:#/c/s/Playlist>prop:scalar:name',
    'get:/playlists/{playlist_id}>res:r>obj:type:#/c/s/Playlist>prop:scalar:album_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 3, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  const linkFieldCount = (schema!.match(/album:\s*Album!/g) || []).length;
  assert.strictEqual(linkFieldCount, 2, `expected an independent album link on both Song and Playlist, got ${linkFieldCount}`);
});

test('test_161_target_twin_rename_stub_matches_key', async () => {
  // Take's key twins with its own take_Id sibling and numbers to takeId2, but the @key stays on
  // the raw name's clean form -- the stub's key must match the @key, so it ignores the rename too.
  const paths = [
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:take_Id',
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:take_id',
    'get:/takes/{take_id}>res:r>obj:type:#/c/s/Take>prop:scalar:name',
    'get:/mixes/{mix_id}>res:r>obj:type:#/c/s/Mix>prop:scalar:mix_id',
    'get:/mixes/{mix_id}>res:r>obj:type:#/c/s/Mix>prop:scalar:name',
    'get:/mixes/{mix_id}>res:r>obj:type:#/c/s/Mix>prop:scalar:take_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('takeId2: String!'), 'expected the key twin to take a numbered name on Take');
  assert.ok(schema!.includes('@key(fields: "takeId")'), "expected the @key on the raw name's clean form");
  assert.ok(schema!.includes('take: Take!'), 'expected a required take link on Mix');
  assert.ok(
    /take:\s*\{\s*takeId:\s*take_id\s*\}/.test(schema!),
    'the stub key must match the @key, not the renamed twin',
  );
});

test('test_161_host_twin_rename_value_stays_raw', async () => {
  // Loop's own beat_Id sibling forces its beat_id to number to beatId2 -- the stub still writes
  // Beat's @key name and still reads the raw beat_id key, so the host-side rename changes nothing.
  const paths = [
    'get:/beats/{beat_id}>res:r>obj:type:#/c/s/Beat>prop:scalar:beat_id',
    'get:/beats/{beat_id}>res:r>obj:type:#/c/s/Beat>prop:scalar:name',
    'get:/loops/{loop_id}>res:r>obj:type:#/c/s/Loop>prop:scalar:loop_id',
    'get:/loops/{loop_id}>res:r>obj:type:#/c/s/Loop>prop:scalar:name',
    'get:/loops/{loop_id}>res:r>obj:type:#/c/s/Loop>prop:scalar:beat_Id',
    'get:/loops/{loop_id}>res:r>obj:type:#/c/s/Loop>prop:scalar:beat_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('beatId2: String!'), 'expected the carried key to take a numbered name on Loop');
  assert.ok(schema!.includes('beat: Beat!'), 'expected a required beat link on Loop');
  assert.ok(
    /beat:\s*\{\s*beatId:\s*beat_id\s*\}/.test(schema!),
    'the stub must keep the @key name and the raw source key',
  );
});

test('test_161_nullability_optional_source_field', async () => {
  // Track.album_id is NOT required -> the link mirrors that: `album: Album`, no `!`.
  const paths = [
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/tracks/{track_id}>res:r>obj:type:#/c/s/Track>prop:scalar:track_id',
    'get:/tracks/{track_id}>res:r>obj:type:#/c/s/Track>prop:scalar:name',
    'get:/tracks/{track_id}>res:r>obj:type:#/c/s/Track>prop:scalar:album_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('album: Album\n'), 'expected an optional (non-bang) album link on Track');
  assert.ok(!schema!.includes('album: Album!'), 'the link must not be marked required');
});

test('test_161_flag_off_byte_identical', async () => {
  // Same selection as the happy path, flag OFF: no @key, no $this, and no link field either --
  // entity links are coupled to --infer-entity-resolvers, not a separate flag.
  const paths = [
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:album_id',
    'get:/albums/{album_id}>res:r>obj:type:#/c/s/Album>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:song_id',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:name',
    'get:/songs/{song_id}>res:r>obj:type:#/c/s/Song>prop:scalar:album_id',
  ];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2);
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('@key('), 'flag off must not emit @key');
  assert.ok(!schema!.includes('$this'), 'flag off must not emit a $this resolver');
  assert.ok(!schema!.includes('album: Album'), 'flag off must not emit a link field either');
  assert.ok(!/album:\s*\{/.test(schema!), 'flag off must not emit a link selection stub');
});
