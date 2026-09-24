import { test } from 'node:test';
import assert from 'node:assert';
import { runOasTest } from '../../src/tests/runners.js';
import { runConnectorTest } from '../../src/tests/connectors.js';
import { captureErrors } from './_setup.js';
import './_setup.js';

// --- #161: entity-link inference (inferEntityLinks) -- the reference half of R1: a key-only
// field on any other selected type that carries the by-id op's own path-param name. ---

const PATHS_SIZE = 24; // total ops declared in entity-link.yaml, regardless of selection

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
  // Take's key loses the twin race to its own take_Id sibling and numbers to takeId2 -- the @key
  // and the stub must follow the key prop's own rename, not the sibling's clean name. see docs/FIXED.md #168
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
  assert.ok(schema!.includes('@key(fields: "takeId2")'), 'expected the @key to follow the key prop\'s own rename');
  assert.ok(schema!.includes('{$this.takeId2}'), 'expected the $this resolver to follow the key prop\'s own rename');
  assert.ok(schema!.includes('take: Take!'), 'expected a required take link on Mix');
  assert.ok(
    /take:\s*\{\s*takeId2:\s*take_id\s*\}/.test(schema!),
    'the stub key must match the renamed @key, value stays the raw source key',
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

test('test_191_input_type_host_never_links', async () => {
  // Album's own schema reused as a POST body -- AlbumInput must never gain an album link even
  // though it mirrors Album's own key.
  const paths = ['post:/albums>**', 'get:/albums/{album_id}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(!/album:\s*Album/.test(schema!), 'no link field expected inside an input type');
  assert.ok(schema!.includes('input AlbumInput'), 'sanity: AlbumInput must actually exist in this schema');
});

test('test_190_alias_keyed_target_still_links', async () => {
  // Thing is keyed by alias (its own key property is "id", the path param is "thingId") --
  // Shelf's thingId field must still resolve the link the same way a literal-named key would.
  const paths = ['get:/things/{thingId}>**', 'get:/shelves/{shelfId}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(schema!.includes('thing: Thing!'), 'expected a required thing link on Shelf');
  assert.ok(
    /thing:\s*\{\s*id:\s*thingId\s*\}/.test(schema!),
    'expected a key-only selection stub mapping id to thingId',
  );
});

test('test_191_bare_id_field_does_not_link', async () => {
  // Item is keyed on a literal "id" -- Crate's own "id" field names itself, not a foreign key to
  // Item, however literally the names line up.
  const paths = ['get:/items/{id}>**', 'get:/crates/{crate_id}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('item: Item'), 'no link field expected -- a bare id is not a foreign key');
  assert.ok(!/item:\s*\{/.test(schema!), 'no key-only selection stub expected');
});

test('test_191_non_id_keyed_target_never_a_candidate', async () => {
  // Member is keyed on username, not id -- it must never become a link candidate, however
  // alias-shaped Post's memberId field looks.
  const paths = ['get:/members/{username}>**', 'get:/posts/{post_id}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  assert.ok(!schema!.includes('member: Member'), 'no link field expected -- Member is not id-keyed');
  assert.ok(!/member:\s*\{/.test(schema!), 'no key-only selection stub expected');
});

test('test_191_petstore_user_input_never_links', async () => {
  // The original #191 repro: User is keyed on username, not id -- UserInput mirrors User's own
  // username field, but must never gain a `user: User` field (an object type inside an input
  // type fails composition outright).
  const paths = ['post:/user>**', 'get:/user/{username}>**'];

  const schema = await runOasTest('petstore.yaml', paths, 19, 2, { inferEntityResolvers: true, skipValidation: true });
  assert.ok(schema !== undefined);
  assert.ok(!/user:\s*User/.test(schema!), 'no link field expected inside an input type');
  assert.ok(schema!.includes('input UserInput'), 'sanity: UserInput must actually exist in this schema');
});

// #196: Card stays unkeyed (its own path param, card_ref, matches neither "id" nor "CardId") and
// is returned by more than one op -- each op builds its own copy of Card, so the link stub has to
// reach every copy, not just whichever op the collector visits first.

test('test_196_get_then_patch_both_write_the_stub', async () => {
  const paths = ['get:/cards/{card_ref}>**', 'patch:/cards/{card_ref}>**', 'get:/things/{thingId}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 3, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  const stubCount = (schema!.match(/thing: \{\s*\n\s*id: thingId/g) ?? []).length;
  assert.strictEqual(stubCount, 2, `expected both the GET and the PATCH connector to carry the stub, got ${stubCount}`);
});

test('test_196_patch_then_get_both_write_the_stub', async () => {
  // same pair, PATCH listed first -- #196 was selection-order-dependent, so this is the case that
  // caught it: the PATCH used to become the copy inferEntityLinks attaches the link to, leaving
  // the GET's own copy silently unlinked.
  const paths = ['patch:/cards/{card_ref}>**', 'get:/cards/{card_ref}>**', 'get:/things/{thingId}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 3, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  const stubCount = (schema!.match(/thing: \{\s*\n\s*id: thingId/g) ?? []).length;
  assert.strictEqual(stubCount, 2, `expected both the PATCH and the GET connector to carry the stub, got ${stubCount}`);
});

test('test_196_two_gets_both_write_the_stub', async () => {
  // two unrelated GETs returning the same Card schema, no PATCH involved -- #196 is not
  // mutation-specific, any second op sharing a response type hits it.
  const paths = ['get:/cards/{card_ref}>**', 'get:/decks/{deck_ref}/card>**', 'get:/things/{thingId}>**'];

  const schema = await runOasTest('entity-link.yaml', paths, PATHS_SIZE, 2, { inferEntityResolvers: true });
  assert.ok(schema !== undefined);
  const stubCount = (schema!.match(/thing: \{\s*\n\s*id: thingId/g) ?? []).length;
  assert.strictEqual(stubCount, 2, `expected both GETs' connectors to carry the stub, got ${stubCount}`);
});

// --- #249: links named in the overrides file ("$links"), for records whose names do not say
// where an id points: a key spelled `Id`, and fields named after the relationship (OwnerId -> User). ---

const LINKS_FIXTURE = 'entity-link-overrides.yaml';
const LINKS_PATHS_SIZE = 7; // total ops declared in entity-link-overrides.yaml
const ACCOUNT = 'get:/sobjects/Account/{Id}>**';
const USER = 'get:/sobjects/User/{Id}>**';
const GROUP = 'get:/sobjects/Group/{Id}>**';
const QUEUE = 'get:/sobjects/Queue/{Id}>**';
const TASK = 'get:/sobjects/Task/{Id}>**';
const MEMBER = 'get:/members/{id}>**';
const ACCOUNT_FIELD = 'get:/sobjects/Account/{Id}>res:r>obj:type:#/c/s/Account>prop:scalar:';
const OWNER_TO_USER = { 'Account.OwnerId': { target: 'User', name: 'Owner' } };
const TWO_WAY = { ...OWNER_TO_USER, 'User.AccountId': { target: 'Account', name: 'Account' } };

test('test_249_fixture_infers_task_member_without_links', async () => {
  // Checks the fixture's plain-inference case first, so the tests that suppress it mean something.
  const schema = await runOasTest(LINKS_FIXTURE, [TASK, MEMBER], LINKS_PATHS_SIZE, 2, {
    inferEntityResolvers: true,
    forceRover: true,
  });
  assert.ok(schema!.includes('member: Member'), 'plain inference links Task.MemberId to Member');
});

test('test_249_named_link_writes_owner_stub', async () => {
  // Checks Account.OwnerId -> User writes `owner: User` and the key-only stub in every selection
  // that writes Account: the GraphQL key name `id`, the REST source field `OwnerId`.
  const schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, USER], LINKS_PATHS_SIZE, 2, {
    inferEntityResolvers: true,
    overrides: { $links: OWNER_TO_USER },
    forceRover: true,
  });
  assert.ok(schema!.includes('  owner: User\n'), 'Account gains owner: User');
  const stubs = (schema!.match(/owner: \{\s*\n\s*id: OwnerId/g) ?? []).length;
  assert.strictEqual(stubs, 2, `expected the stub in Account's connector and the Query field, got ${stubs}`);
});

test('test_249_named_link_without_name_uses_target', async () => {
  // Checks an entry with no name writes the link under the target's name, `user`.
  const schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, USER], LINKS_PATHS_SIZE, 2, {
    inferEntityResolvers: true,
    overrides: { $links: { 'Account.OwnerId': { target: 'User' } } },
    forceRover: true,
  });
  assert.ok(schema!.includes('  user: User\n'), 'Account gains user: User');
  assert.ok(/user: \{\s*\n\s*id: OwnerId/.test(schema!), 'the stub reads OwnerId');
});

test('test_249_two_way_pair_links_both_and_composes', async () => {
  // Checks Account.owner and User.account both link when neither type holds the other by value:
  // each stub sits in its own type's connector, and the composer accepts the pair.
  const paths = [`${ACCOUNT_FIELD}Id`, `${ACCOUNT_FIELD}Name`, `${ACCOUNT_FIELD}OwnerId`, USER];
  const schema = await runOasTest(LINKS_FIXTURE, paths, LINKS_PATHS_SIZE, 2, {
    inferEntityResolvers: true,
    overrides: { $links: TWO_WAY },
    forceRover: true,
  });
  assert.ok(schema!.includes('  owner: User\n'), 'Account gains owner: User');
  assert.ok(schema!.includes('  account: Account\n'), 'User gains account: Account');
});

test('test_249_nested_back_link_left_as_id', async () => {
  // Checks User.account is skipped when Account holds User by value (Account.Users): the stub
  // would put Account inside Account's own selection. Account.owner is still written.
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, USER], LINKS_PATHS_SIZE, 2, {
      inferEntityResolvers: true,
      overrides: { $links: TWO_WAY },
      forceRover: true,
    });
  });
  assert.ok(schema!.includes('  owner: User\n'), 'Account.owner is still written');
  assert.ok(!schema!.includes('account: Account'), 'User.account is left out');
  assert.ok(schema!.includes('  accountId: ID\n'), 'User.AccountId stays an id');
  assert.ok(
    warnings.some((w) =>
      w.includes('Account.users nests User, so User.account would put Account inside its own selection; left as id'),
    ),
    `expected the nesting warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_249_self_link_left_as_id', async () => {
  // Checks Account.ParentId -> Account warns and stays an id: the composer rejects a type
  // inside its own selection.
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT], LINKS_PATHS_SIZE, 2, {
      inferEntityResolvers: true,
      overrides: { $links: { 'Account.ParentId': { target: 'Account', name: 'Parent' } } },
      forceRover: true,
    });
  });
  assert.ok(!schema!.includes('parent: Account'), 'no self-link written');
  assert.ok(
    warnings.some((w) => w.includes('self-link left as id: the composer rejects a type inside its own selection')),
    `expected the self-link warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_249_target_needing_another_param_left_as_id', async () => {
  // Checks Account.QueueId -> Queue warns: Queue's by-id op also needs a required `mode`, so
  // Queue cannot be fetched from its key alone.
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, QUEUE], LINKS_PATHS_SIZE, 3, {
      inferEntityResolvers: true,
      overrides: { $links: { 'Account.QueueId': { target: 'Queue', name: 'Queue' } } },
      forceRover: true,
    });
  });
  assert.ok(!schema!.includes('queue: Queue'), 'no link to Queue');
  assert.ok(
    warnings.some((w) => w.includes('no by-id operation for Queue that takes only its key')),
    `expected the by-id warning, got: ${warnings.join(' | ')}`,
  );
});

test('test_249_target_list_writes_note_not_link', async () => {
  // Checks Task.MemberId -> ["Group", "Member"] writes no link, not even the member: Member that
  // plain inference would, and notes the targets on the field.
  const schema = await runOasTest(LINKS_FIXTURE, [TASK, MEMBER, GROUP], LINKS_PATHS_SIZE, 3, {
    inferEntityResolvers: true,
    overrides: { $links: { 'Task.MemberId': { target: ['Group', 'Member'] } } },
    forceRover: true,
  });
  assert.ok(!schema!.includes('member: Member'), 'the entry owns MemberId over inference');
  assert.ok(schema!.includes('"Links to Group or Member."\n  memberId: ID'), 'the note sits on the id field');
});

test('test_249_single_target_overrides_inference', async () => {
  // Checks Task.MemberId -> Group writes group: Group and not also the inferred member: Member.
  const schema = await runOasTest(LINKS_FIXTURE, [TASK, MEMBER, GROUP], LINKS_PATHS_SIZE, 3, {
    inferEntityResolvers: true,
    overrides: { $links: { 'Task.MemberId': { target: 'Group' } } },
    forceRover: true,
  });
  assert.ok(schema!.includes('  group: Group\n'), 'Task gains group: Group');
  assert.ok(!schema!.includes('member: Member'), 'no inferred member link');
});

test('test_249_missing_target_host_field_or_free_name_warn', async () => {
  // Checks each entry that cannot be placed warns and writes nothing: a target with no by-id op,
  // a field the host does not have, and a name the host already writes (`name`).
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, USER], LINKS_PATHS_SIZE, 2, {
      inferEntityResolvers: true,
      overrides: {
        $links: {
          'Account.OwnerId': { target: 'Contact' },
          'Account.Missing': { target: 'User' },
          'User.AccountId': { target: 'Account', name: 'Name' },
        },
      },
      forceRover: true,
    });
  });
  assert.ok(!schema!.includes('contact: Contact'), 'no link to Contact');
  assert.ok(!schema!.includes('user: User'), 'no link from Account.Missing');
  assert.ok(!schema!.includes('account: Account'), 'no link from User.AccountId');
  for (const expected of [
    'no by-id operation for Contact that takes only its key',
    'Account has no selected field Missing',
    'User already has a field name',
  ]) {
    assert.ok(
      warnings.some((w) => w.includes(expected)),
      `expected "${expected}", got: ${warnings.join(' | ')}`,
    );
  }
});

test('test_249_flag_off_warns_once', async () => {
  // Checks a "$links" entry without --infer-entity-resolvers warns once and writes nothing.
  let schema: string | undefined;
  const warnings = await captureErrors(async () => {
    schema = await runOasTest(LINKS_FIXTURE, [ACCOUNT, USER], LINKS_PATHS_SIZE, 2, {
      overrides: { $links: OWNER_TO_USER },
      forceRover: true,
    });
  });
  assert.ok(!schema!.includes('owner: User'), 'no link written');
  const flagWarnings = warnings.filter((w) => w.includes('"$links" needs --infer-entity-resolvers; no link written'));
  assert.strictEqual(flagWarnings.length, 1, `expected one warning, got: ${warnings.join(' | ')}`);
});

test('test_249_runtime_stub_hands_the_key_to_user', async (t) => {
  // Checks both halves the router joins: Account's connector turns OwnerId "005A" into the stub
  // owner { id: "005A" }, and User's connector fetches /sobjects/User/005A from that key.
  const result = await runConnectorTest(
    LINKS_FIXTURE,
    [ACCOUNT, USER],
    'tests/resources/connectors/entity-link-overrides/account-owner.connector.yaml',
    { inferEntityResolvers: true, overrides: { $links: OWNER_TO_USER } },
  );
  if (result.skipped) {
    t.skip(result.output);
    return;
  }
  assert.ok(result.success, result.output);
});
