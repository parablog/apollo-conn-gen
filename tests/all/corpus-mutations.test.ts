import { test } from 'node:test';
import { runOasTest } from '../../src/tests/runners.js';
import './_setup.js';

// --- Corpus mutations: one representative mutation per vendor spec (smoke, like corpus.test.ts) ---
// The fast guard for the mutation arc (#27-#31): each selection generates and composes in ~1s,
// catching regressions without the full mutation sweep (tools/coverage-spec.mts --verbs mutations).
// Ops were picked from passing sweep verdicts, preferring params+body shapes (the #27/#28/#30
// surface); googlebooks also covers the #31 empty-response synthetic. Sizes are the spec's total
// path count + the selection's type count.

test('test_corpus_mut_googlebooks', async () => {
  // updateBook: 11 query params + a body (#27); deleteBook: `Empty` response -> synthetic (#31)
  await runOasTest(
    'googlebooks.yaml',
    ['post:/books/v1/cloudloading/updateBook>**', 'post:/books/v1/cloudloading/deleteBook>**'],
    51,
    3,
  );
});

test('test_corpus_mut_slack', async () => {
  // 2 types since #83: slack posts a form, so the body is mapped and its input type is written
  await runOasTest('slack.yaml', ['post:/admin.apps.approve>**'], 174, 2);
});

test('test_corpus_mut_digitalocean', async () => {
  // account/keys: snake_case body payload name (#30); body aliases + defaults (#28/#29)
  // 3 types since #85: it answers `201` with the created key, where it used to answer `default`
  await runOasTest('digitalocean.yaml', ['post:/v2/account/keys>**'], 290, 3);
});

test('test_corpus_mut_box', async () => {
  await runOasTest('box.yaml', ['post:/collaboration_whitelist_entries>**'], 258, 7);
});

test('test_corpus_mut_box_nested_list', async () => {
  // zip_downloads answers `202` with a list of lists of objects (#85 reaches it, #59 writes it):
  // the field names `[[NameConflictsItem]]` and its selection opens one block. Composing is the
  // check — the reference used to name the inner list, which nothing defines.
  await runOasTest('box.yaml', ['post:/zip_downloads>**'], 258, 5);
});

test('test_corpus_mut_openai', async () => {
  await runOasTest('openai.yaml', ['post:/audio/transcriptions>**'], 28, 1);
});

test('test_corpus_mut_asana', async () => {
  await runOasTest('asana.yaml', ['post:/attachments>**'], 167, 4);
});

test('test_corpus_mut_sendgrid', async () => {
  await runOasTest('sendgrid.yaml', ['post:/alerts>**'], 334, 3);
});

test('test_corpus_mut_github', async () => {
  // 3 types since #85: this op documents only `201`, so it answers the real conversion type now
  // instead of the synthetic `success: Boolean`. It was the canary for that bug.
  await runOasTest('github.yaml', ['post:/app-manifests/{code}/conversions>**'], 845, 3);
});

test('test_corpus_mut_omni', async () => {
  // 5 types since #85: `201` carries the created group, which brings its own members and meta
  await runOasTest('omni.yaml', ['post:/scim/v2/groups>**'], 146, 5, false, true);
});

test('test_corpus_mut_confluence', async () => {
  await runOasTest('confluence.json', ['put:/wiki/rest/api/audit/retention>**'], 130, 3);
});
