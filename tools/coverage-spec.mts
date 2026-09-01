// Corpus coverage harness. For each vendor spec, iterate every selected op (GET by default,
// --verbs mutations/all) and try to generate + rover-compose it, at the current shipping versions
// (connect v0.4 / fed 2.14). Classifies each outcome and writes a report (per-spec pass-rates + a
// global failure histogram = prioritized gap list) — COVERAGE.md for the GET sweep,
// COVERAGE-<verbs>.md otherwise, so different sweeps don't clobber each other.
//
// Correctness: the generator is stateful (OasContext.reset only clears generatedSet; the
// abstract-types path mutates shared nodes). So we use a FRESH OasGen per op — mirroring the corpus
// tests (runners.ts) which build a fresh gen per assertion. We parse each spec once and reuse the
// parsed `parser` across fresh `new OasGen(parser, opts)` instances to avoid re-bundling big specs
// (GitHub is 8.4MB); each instance still gets its own context + freshly-visited node tree.
//
// Usage:
//   node --import tsx/esm ./tools/coverage-spec.mts [--spec <file>] [--limit N]
//        [--concurrency N] [--workers N] [--verbs get|mutations|all]
import { OasGen } from '../src/index.js';
import { SelectionPath } from '../src/oas/utils/selectionPath.js';
import { wholeVerdict } from './coverage-verdict.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec as _exec, execSync } from 'child_process';
import { promisify } from 'util';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

// The generator traces via console.log/warn; mute it (progress goes to stderr, report to file).
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const exec = promisify(_exec);
const base = './tests/resources/oas';

// Vendor corpus plus tracked real fixtures that are broad enough to measure beyond one smoke test.
const ALL_SPECS = [
  'docusign.json',
  'googlebooks.yaml',
  'slack.yaml',
  'digitalocean.yaml',
  'box.yaml',
  'openai.yaml',
  'asana.yaml',
  'sendgrid.yaml',
  'github.yaml',
  '1password-connect.json',
  '1password-events.json',
  'ably-control.json',
  'amadeus-flight-offers.json',
  'docker-engine.json',
  'nasa-apod.json',
  'nytimes-article-search.json',
  'nytimes-books.json',
  'openfigi.json',
  'plaid.json',
  'spotify.json',
  'square.json',
  'stripe.json',
  'trello.json',
  'visualcrossing-weather.json',
  // QuickBooks Online v3. Intuit publishes no OpenAPI, so this is a third-party spec authored by
  // WSO2, not by Intuit — it may diverge from the live API; we keep it for its shape, not its truth.
  // ballerina-platform/openapi-connectors, openapi/quickbooks.online/openapi.yaml @ 61a7188, Apache-2.0.
  'quickbooks-online.yaml',
  'adobe-commerce-swagger.json',
  'launch_Library_2-docs-v2.3.0.json',
  'common-room-core.json',
  'mindbody.json',
  'js-mva-consumer-info_v1.yaml',
  'js-mva-homepage-product-selector_v3.yaml',
  'most-popular-product.yaml',
  'omni.yaml',
  'confluence.json',
  // Mercedes-Benz Car Configurator Service: union/shared-$ref heavy. 100% default;
  // abstract pass fails with CONNECTORS_UNRESOLVED_FIELD across 26/43 ops (under investigation).
  'openapi.car_configurator_service_(ccs)_int-10.210.0.yaml',
  'incidentio.json',
  'sanity-projects.json',
  'gong.json',
  // P1 tier of the Apollo x Xolvio connector catalog (added 2026-08-26; provenance in TEST_CORPUS.md).
  'profound.yaml',
  'motion.json',
  // Pre-bundled mirror (ballerina-platform/openapi-connectors) — the live official spec is a path
  // index of external HTTP $refs whose sub-schema URLs are Akamai-blocked.
  'mailchimp.json',
  'fullstory-events.json',
  'fullstory-users.json',
];

// One pass at the current shipping versions (connect v0.4 / fed v2.14, per DEFAULT_VERSIONS): real
// unions/interfaces — the only behaviour now that the consolidate downgrade was removed.
const PASSES = {
  // fed 2.15.1: first published supergraph plugin with the #14 `->entries` crediting fix
  abstract: { connectorSpecVersion: 'v0.4', federationVersion: 'v2.14', fed: '2.15.1' },
};

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name: string, def?: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const onlySpec = getArg('--spec');
const limit = parseInt(getArg('--limit', '0')!, 10);
const concurrency = parseInt(getArg('--concurrency', '16')!, 10);
// One worker thread sweeps one whole spec at a time; generation is CPU-bound JS, so this is what
// lets a long spec (confluence, 51s) overlap the rest instead of serialising the sweep.
const workers = parseInt(getArg('--workers', String(Math.min(8, Math.max(1, os.cpus().length - 2))))!, 10);
const verbsSel = getArg('--verbs', 'get'); // get | mutations | all
// each --verbs sweep gets its own report file so a later run doesn't clobber an earlier one.
const opsLabel = verbsSel === 'get' ? 'GET' : verbsSel === 'mutations' ? 'mutation' : 'all';
// COV_OUT redirects the report (tests point it at a temp dir so a suite run never clobbers the real file)
const outFile = process.env.COV_OUT ?? (verbsSel === 'get' ? 'COVERAGE.md' : `COVERAGE-${verbsSel}.md`);
// --specs a.yaml,b.json sweeps just that subset, e.g. probing a fix across the two specs it touches
const someSpecs = getArg('--specs');
// ALL_SPECS is a catalog of filenames, not a guarantee the files exist — the vendor corpus is
// gitignored (real specs carry example secrets), so nobody but whoever built up their own local
// tests/resources/oas/ has all of it. Run against whichever cataloged specs are actually present
// rather than crashing (or worse, silently reporting an absent file as a LOAD-FAIL alongside real
// generator bugs) on a fresh checkout. An explicit --spec/--specs request is unfiltered: naming a
// file that doesn't exist there is a mistake worth erroring on, not something to skip quietly.
const specs = onlySpec
  ? [onlySpec]
  : someSpecs
    ? someSpecs.split(',')
    : ALL_SPECS.filter((f) => fs.existsSync(path.join(base, f)));
// Only meaningful for the default (whole-catalog) run — an explicit --spec/--specs isn't filtered
// above, so there's nothing "missing" to report for it.
const missingSpecs = onlySpec || someSpecs ? [] : ALL_SPECS.filter((f) => !specs.includes(f));
if (missingSpecs.length || (!onlySpec && !someSpecs)) {
  process.stderr.write(`${specs.length}/${ALL_SPECS.length} cataloged specs present locally\n`);
  if (missingSpecs.length) process.stderr.write(`  missing (not run, not scored): ${missingSpecs.join(', ')}\n`);
}
// --whole off skips the all-ops column's generate+compose (default on)
const wholeSel = getArg('--whole', 'on') !== 'off';
const passKeys = ['abstract'] as (keyof typeof PASSES)[];

// Whole (spec, pass) combinations that infinite-loop the generator — skipped so the sweep can
// complete, reported as "not measurable" with the reason. Currently empty: the Confluence abstract
// hang was fixed by docs/FIXED.md #10 (selection indexing + cycle cuts).
const SKIP_PASSES = new Map<string, string>([]);
const skipReason = (file: string, pass: keyof typeof PASSES) => SKIP_PASSES.get(`${file}::${pass}`);

const TRACE = !!process.env.COV_TRACE;
// A normal compose takes a few seconds. Past this, rover is not going to finish: confluence's
// `put:/wiki/rest/api/content/{id}/child/attachment/{attachmentId}` (87 input types) grows by about
// 2 GB every 5s until the machine is out of memory. Score it as a failure instead of losing the
// whole sweep — the ceiling this leaves is roughly 12 GB for one op.
// COV_COMPOSE_TIMEOUT=<ms> lowers it, to check the kill works without letting the op grow first.
// `Number` so a typo (`=30s`) falls back to the default instead of becoming NaN, which fires the
// deadline at once and scores every op in the sweep as a timeout.
const COMPOSE_TIMEOUT_MS = Number(process.env.COV_COMPOSE_TIMEOUT) || 30_000;
// the all-ops compose is one legitimately big schema (stripe: 263 ops) — its own, longer deadline
const WHOLE_TIMEOUT_MS = Number(process.env.COV_WHOLE_TIMEOUT) || 120_000;
// Above this SDL size we compose one at a time — eight rovers on a 300K schema each is what ate 60 GB.
const BIG_SCHEMA_BYTES = 200_000;
// Above this spec-FILE size the whole sweep runs one at a time — several docusign-class sweeps at
// once (each may need most of the 16 GB worker heap) ran the machine itself out of memory.
const HEAVY_SPEC_BYTES = Number(process.env.COV_HEAVY_SPEC_BYTES) || 1_000_000;
// A fresh dir per run (same reason as runners.ts): the GET and mutations sweeps name their files
// by index, so a shared dir would swap schemas between them when the two passes run concurrently.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-coverage-'));
fs.writeFileSync(path.join(tmp, 'sample.graphql'), 'type Query { hello: String }');

// ---- helpers --------------------------------------------------------------
function genOptions(passKey: keyof typeof PASSES, skipValidation: boolean) {
  const p = PASSES[passKey];
  return {
    skipValidation,
    showParentInSelections: false,
    connectorSpecVersion: p.connectorSpecVersion,
    federationVersion: p.federationVersion,
    mapper: undefined,
    skipOptionalArgs: false,
  };
}

async function loadBase(file: string): Promise<{ gen: OasGen; skip: boolean } | null> {
  for (const skip of [false, true]) {
    try {
      const gen = await OasGen.fromFile(`${base}/${file}`, genOptions('abstract', skip));
      await gen.visit();
      return { gen, skip };
    } catch {
      /* try next */
    }
  }
  return null;
}

// takes the schema as a file, not a string — schemas are written to disk as soon as they are
// generated, so a big spec's sweep never holds them all in memory at once (docusign: 247).
async function compose(
  op: string,
  schemaFile: string,
  fed: string,
  idx: number | string,
  timeoutMs: number = COMPOSE_TIMEOUT_MS,
): Promise<{ ok: boolean; code?: string; out?: string }> {
  if (TRACE) process.stderr.write(`    compose ${idx} ${op}\n`);
  const sgFile = path.join(tmp, `supergraph-${idx}.yaml`);
  fs.writeFileSync(
    sgFile,
    `federation_version: =${fed}\nsubgraphs:\n  test_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${schemaFile}\n  sample_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${path.join(tmp, 'sample.graphql')}\n`,
  );
  const running = exec(`rover supergraph compose --config ${sgFile} --elv2-license accept`, {
    maxBuffer: 64 * 1024 * 1024,
  });
  // rover can still exit 0 once its child is gone, so remember that we killed it rather than
  // reading the exit status.
  let timedOut = false;
  // `rover` is only a launcher: the composing runs in a `supergraph-<version>` child of it, and that
  // is what grows (16 GB in 45s on confluence's attachment PUT). Kill that child FIRST — once rover
  // is gone the child is reparented to launchd and we can no longer find it by parent, so it keeps
  // running and keeps growing.
  const deadline = setTimeout(() => {
    timedOut = true;
    try {
      execSync(`pkill -9 -P ${running.child.pid}`);
    } catch {
      /* no children left */
    }
    running.child.kill('SIGKILL');
  }, timeoutMs);
  try {
    await running;
    return timedOut ? { ok: false, code: 'TIMEOUT' } : { ok: true };
  } catch (e: any) {
    if (timedOut) {
      return { ok: false, code: 'TIMEOUT' };
    }
    // not e.message too: child_process.exec's rejection embeds the full stderr text a second
    // time inside .message ("Command failed: <cmd>\n<stderr>") — wholeVerdict's tally counted
    // every real error twice as a result. stdout/stderr alone still carry everything real.
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    // rover wraps everything in a generic [E029]; the actionable code is the federation error
    // name in the "Caused by:" body (e.g. INVALID_URL, SATISFIABILITY_ERROR, INVALID_GRAPHQL).
    const inner = out.match(/^\s*([A-Z][A-Z0-9_]{3,}):/m);
    const outer = out.match(/\[(E[0-9]+)\]/);
    return { ok: false, code: inner ? inner[1] : outer ? outer[1] : 'OTHER', out };
  } finally {
    clearTimeout(deadline);
  }
}

async function pool<T, R>(items: T[], worker: (it: T, i: number) => Promise<R>, n: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---- per-spec, per-pass run ----------------------------------------------
type Bucket = { count: number; example: string };
type PassResult = {
  total: number;
  ok: number;
  degraded: number;
  genEmpty: number;
  genThrow: number;
  composeFail: number;
  buckets: Map<string, Bucket>;
  skipped?: string;
  // the all-ops column: every selected op of this sweep composed as ONE schema. see COVERAGE.md legend
  whole?: string;
};

// Normalize a generator exception into a root-cause class: drop the op-specific tail (` <- get:…`),
// collapse JSON pointers and per-op type details, so the histogram groups by real bug, not by op.
function genKey(e: any): string {
  let m = String(e?.message ?? e).split('\n')[0];
  m = m.split(' <- ')[0];
  m = m.replace(/#\/\S+/g, '#/…');
  m = m.replace(/property type .*/i, 'property type …');
  return m.trim().slice(0, 90);
}

function addBucket(buckets: Map<string, Bucket>, key: string, example: string) {
  const b = buckets.get(key);
  if (b) b.count++;
  else buckets.set(key, { count: 1, example });
}

// Compose slots are shared ACROSS workers (index 0 counts in-flight, index 1 is the one big-schema
// token), so when only one spec is left its worker can use the whole --concurrency budget instead
// of an even split. Waiters poll with a short sleep.
async function withSlot<T>(slots: Int32Array, index: number, capacity: number, fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const inFlight = Atomics.load(slots, index);
    if (inFlight < capacity && Atomics.compareExchange(slots, index, inFlight, inFlight + 1) === inFlight) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    return await fn();
  } finally {
    Atomics.sub(slots, index, 1);
  }
}

async function runPass(
  file: string,
  parser: any,
  ops: string[],
  passKey: keyof typeof PASSES,
  skip: boolean,
  slots: Int32Array,
): Promise<PassResult> {
  const r: PassResult = {
    total: ops.length,
    ok: 0,
    degraded: 0,
    genEmpty: 0,
    genThrow: 0,
    composeFail: 0,
    buckets: new Map(),
  };
  const verdicts: Record<string, string> = {};
  // Phase 1 (sequential, CPU): fresh gen per op -> classify generation, collect compose candidates.
  // Each schema goes straight to a file; keeping all of a big spec's schemas in memory through the
  // compose phase is what ran the sweep worker out of memory (docusign, 247 schemas).
  const candidates: { op: string; file: string; bytes: number }[] = [];
  for (const op of ops) {
    const sel = SelectionPath.everythingUnder(op); // full-subtree selection, exactly like the corpus tests / vet-spec
    if (TRACE) process.stderr.write(`    gen ${passKey} ${op}\n`);
    try {
      const g = new OasGen(parser, genOptions(passKey, skip) as any);
      await g.visit();
      const schema = g.generateSchema([sel]);
      // A schema with no `type Query {`/`type Mutation {` block has no root field at all — the
      // one case worth calling "nothing was generated". A write that answers with a bare `true`
      // (e.g. a DELETE with an empty body) still gets a real Mutation field even though it needs
      // no auxiliary `type X {}` around it, so checking for the root field (not the type count)
      // is what tells "op generated nothing" apart from "op generated, output just has no types".
      if (!/type (Query|Mutation) \{/.test(schema)) {
        r.genEmpty++;
        addBucket(r.buckets, 'GEN-EMPTY', op);
        verdicts[op] = 'GEN-EMPTY';
        continue;
      }
      const file = path.join(tmp, `schema-${passKey}-${candidates.length}.graphql`);
      fs.writeFileSync(file, schema);
      candidates.push({ op, file, bytes: Buffer.byteLength(schema) });
    } catch (e: any) {
      r.genThrow++;
      addBucket(r.buckets, `GEN-THROW: ${genKey(e)}`, op);
      verdicts[op] = 'GEN-THROW';
    }
  }
  // Phase 2 (pooled): compose candidates via rover. Big schemas run one at a time so a heavy op
  // can't be multiplied by the pool — the idx keeps counting across both so each writes its own files.
  const fed = PASSES[passKey].fed;
  const small = candidates.filter((c) => c.bytes < BIG_SCHEMA_BYTES);
  const big = candidates.filter((c) => c.bytes >= BIG_SCHEMA_BYTES);
  const composed = new Map<string, { ok: boolean; code?: string }>();
  (
    await pool(small, (c, i) => withSlot(slots, 0, concurrency, () => compose(c.op, c.file, fed, i)), concurrency)
  ).forEach((res, i) => composed.set(small[i].op, res));
  (await pool(big, (c, i) => withSlot(slots, 1, 1, () => compose(c.op, c.file, fed, small.length + i)), 1)).forEach(
    (res, i) => composed.set(big[i].op, res),
  );
  for (const { op } of candidates) {
    const res = composed.get(op)!;
    if (res.ok) {
      r.ok++;
      verdicts[op] = 'OK';
    } else {
      r.composeFail++;
      addBucket(r.buckets, `COMPOSE-FAIL [${res.code}]`, op);
      verdicts[op] = `COMPOSE-FAIL [${res.code}]`;
    }
  }
  // per-op verdict dump for before/after attribution: COV_DUMP=/path/prefix. The all-ops verdict
  // joins the same file under the "whole" key once sweepSpec has it (dumpVerdicts re-writes).
  dumpVerdicts(file, passKey, verdicts);
  return { result: r, verdicts };
}

function dumpVerdicts(file: string, passKey: string, verdicts: Record<string, string>): void {
  if (!process.env.COV_DUMP) return;
  fs.writeFileSync(
    `${process.env.COV_DUMP}.${file.replace(/[^a-z0-9]+/gi, '_')}.${passKey}.json`,
    JSON.stringify(verdicts, null, 1),
  );
}

// The all-ops run: ONE generation with every selected op, ONE compose — what production
// (gen-ts.mjs) does, and what per-op composes structurally cannot see (cross-op collisions,
// shared types selected from several positions).
async function runWholeSpec(
  parser: any,
  ops: string[],
  passKey: keyof typeof PASSES,
  skip: boolean,
  slots: Int32Array,
  buckets: Map<string, Bucket>,
): Promise<string> {
  // zero ops for this verb set is normal in a per-verb sweep, not a failure
  if (ops.length === 0) return '—';
  const sels = ops.map((op) => SelectionPath.everythingUnder(op));
  let schema: string;
  try {
    const g = new OasGen(parser, genOptions(passKey, skip) as any);
    await g.visit();
    schema = g.generateSchema(sels);
    if (!/type (Query|Mutation) \{/.test(schema)) {
      addBucket(buckets, 'WHOLE:GEN-EMPTY', 'all ops');
      return 'GEN-EMPTY';
    }
  } catch (e: any) {
    addBucket(buckets, `WHOLE:GEN-THROW: ${genKey(e)}`, 'all ops');
    return 'GEN-THROW';
  }
  // always the single-slot path: the all-ops schema is the memory-risk class (#49), whatever its size
  const wholeFile = path.join(tmp, `schema-whole-${passKey}.graphql`);
  fs.writeFileSync(wholeFile, schema);
  const res = await withSlot(slots, 1, 1, () =>
    compose(`all-ops(${ops.length})`, wholeFile, PASSES[passKey].fed, `whole-${passKey}`, WHOLE_TIMEOUT_MS),
  );
  if (res.ok) return 'OK';
  if (res.code === 'TIMEOUT') {
    addBucket(buckets, 'WHOLE:TIMEOUT', 'all ops');
    return 'FAIL [TIMEOUT]';
  }
  const { verdict, codes } = wholeVerdict(res.out ?? '');
  for (const code of codes) {
    addBucket(buckets, `WHOLE:${code}`, 'all ops');
  }
  return verdict;
}

// ---- main -----------------------------------------------------------------
type SpecReport = {
  file: string;
  skip: boolean;
  ops: number;
  passes: Partial<Record<keyof typeof PASSES, PassResult>>;
};
// what one spec's sweep hands back: its report row plus lines for the global histogram
type SpecOutcome = { rep: SpecReport; extraBuckets: { key: string; example: string }[] };

const reports: (SpecReport | undefined)[] = [];
const globalBuckets = new Map<string, Bucket>();

async function sweepSpec(file: string, slots: Int32Array): Promise<SpecOutcome> {
  // slots[2] is the heavy-sweep token: a docusign-class spec can take most of the worker heap,
  // so only one of them sweeps at a time — small specs keep full parallelism.
  if (fs.statSync(`${base}/${file}`).size >= HEAVY_SPEC_BYTES) {
    return withSlot(slots, 2, 1, () => sweepSpecNow(file, slots));
  }
  return sweepSpecNow(file, slots);
}

async function sweepSpecNow(file: string, slots: Int32Array): Promise<SpecOutcome> {
  process.stderr.write(`== ${file} ==\n`);
  const extraBuckets: SpecOutcome['extraBuckets'] = [];
  const loaded = await loadBase(file);
  if (!loaded) {
    process.stderr.write(`  ${file}: LOAD-FAIL\n`);
    return {
      rep: { file, skip: false, ops: 0, passes: {} },
      extraBuckets: [{ key: 'LOAD-FAIL (spec did not parse)', example: file }],
    };
  }
  const { gen, skip } = loaded;
  const MUTATION_PREFIXES = ['post:', 'put:', 'patch:', 'del:'];
  let ops = Array.from(gen.paths.keys()).filter((k) =>
    verbsSel === 'get'
      ? k.startsWith('get:')
      : verbsSel === 'mutations'
        ? MUTATION_PREFIXES.some((p) => k.startsWith(p))
        : true,
  );
  if (limit > 0) ops = ops.slice(0, limit);

  const rep: SpecReport = { file, skip, ops: ops.length, passes: {} };
  for (const pk of passKeys) {
    const reason = skipReason(file, pk);
    if (reason) {
      rep.passes[pk] = {
        total: ops.length,
        ok: 0,
        degraded: 0,
        genEmpty: 0,
        genThrow: 0,
        composeFail: 0,
        buckets: new Map(),
        skipped: reason,
      };
      extraBuckets.push({ key: `GEN-HANG: ${reason}`, example: `${file} ${pk} pass (whole)` });
      process.stderr.write(`  ${file} [${pk}] SKIPPED — ${reason}\n`);
      continue;
    }
    const { result: pr, verdicts } = await runPass(file, gen.parser, ops, pk, skip, slots);
    if (wholeSel) {
      pr.whole = await runWholeSpec(gen.parser, ops, pk, skip, slots, pr.buckets);
      verdicts['whole'] = pr.whole;
      dumpVerdicts(file, pk, verdicts);
    }
    rep.passes[pk] = pr;
    process.stderr.write(
      `  ${file} [${pk}] ${ops.length} ops${skip ? ' (skipValidation)' : ''}: ok=${pr.ok} degraded=${pr.degraded} genEmpty=${pr.genEmpty} genThrow=${pr.genThrow} composeFail=${pr.composeFail} (${pct(pr.ok, pr.total)})${pr.whole ? ` whole=${pr.whole}` : ''}\n`,
    );
  }
  return { rep, extraBuckets };
}

function mergeOutcome(into: Map<string, Bucket>, outcome: SpecOutcome): void {
  for (const extra of outcome.extraBuckets) {
    addBucket(into, extra.key, extra.example);
  }
  for (const pass of Object.values(outcome.rep.passes)) {
    for (const [key, bucket] of pass.buckets) {
      const g = into.get(key);
      if (g) g.count += bucket.count;
      else into.set(key, { count: bucket.count, example: `${outcome.rep.file} ${bucket.example}` });
    }
  }
}

// each worker sweeps one spec end to end and posts the outcome back (Maps survive the clone)
async function sweepSpecInWorker(file: string, slots: Int32Array): Promise<SpecOutcome> {
  // the tsx loader registers per thread, so each worker registers its own before loading this file.
  // workers start with an empty argv, so the parent's flags ride along and are pushed back on
  // before the import — otherwise every worker falls back to defaults (e.g. --verbs get)
  const bootstrap = `
    const { register } = require('tsx/esm/api');
    const { workerData } = require('worker_threads');
    process.argv.push(...workerData.argv);
    register();
    import(${JSON.stringify(import.meta.url)});
  `;
  // generating one docusign mutation can peak past 8 GB on its own — a 16 GB in-process run got
  // through all 247, so the worker gets the same room. COV_WORKER_HEAP_MB overrides it.
  const worker = new Worker(bootstrap, {
    eval: true,
    workerData: { file, slots, argv: process.argv.slice(2) },
    resourceLimits: { maxOldGenerationSizeMb: Number(process.env.COV_WORKER_HEAP_MB) || 16384 },
  });
  return new Promise<SpecOutcome>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`worker for ${file} exited with ${code}`)));
  });
}

if (isMainThread) {
  const specWorkers = Math.max(1, Math.min(workers, specs.length));
  const slots = new Int32Array(new SharedArrayBuffer(12));
  await pool(
    specs,
    async (file, i) => {
      const outcome = specWorkers === 1 ? await sweepSpec(file, slots) : await sweepSpecInWorker(file, slots);
      reports[i] = outcome.rep;
      mergeOutcome(globalBuckets, outcome);
      writeReport(); // incremental: survive a later hang/crash with partial results
      return undefined;
    },
    specWorkers,
  );
} else {
  const args = workerData as { file: string; slots: Int32Array };
  parentPort!.postMessage(await sweepSpec(args.file, args.slots));
  process.exit(0);
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

// ---- markdown report ------------------------------------------------------
function passTable(pk: keyof typeof PASSES): string {
  const head = `| Spec | ${opsLabel} ops | OK | DEGRADED | GEN-empty | GEN-throw | COMPOSE-fail | pass-rate | all-ops |\n|---|--:|--:|--:|--:|--:|--:|--:|---|`;
  // incremental writes happen while workers are still sweeping — rows fill in as they finish
  const rows = reports
    .flatMap((rp) => (rp === undefined ? [] : [rp]))
    .map((rp) => {
      const p = rp.passes[pk];
      if (!p) return `| ${rp.file}${rp.skip ? ' †' : ''} | ${rp.ops} | — | — | — | — | — | LOAD-FAIL | — |`;
      if (p.skipped)
        return `| ${rp.file}${rp.skip ? ' †' : ''} | ${p.total} | — | — | — | — | — | HANG (${p.skipped}) | — |`;
      return `| ${rp.file}${rp.skip ? ' †' : ''} | ${p.total} | ${p.ok} | ${p.degraded} | ${p.genEmpty} | ${p.genThrow} | ${p.composeFail} | ${pct(p.ok, p.total)} | ${p.whole ?? '—'} |`;
    });
  return [head, ...rows].join('\n');
}

function writeReport(): void {
  const histo = [...globalBuckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, b]) => `| ${b.count} | ${k} | \`${b.example}\` |`)
    .join('\n');

  const md = `# Corpus coverage — generate-and-compose pass-rate per spec

Generated by \`tools/coverage-spec.mts --verbs ${verbsSel}\`. For each vendor spec, **every ${opsLabel} op**
is generated and rover-composed once (real unions, the shipping default). **† = loaded with
\`skipValidation\`** (patched fixture; see TEST_CORPUS.md).

- Real unions/interfaces at connect ${PASSES.abstract.connectorSpecVersion}, composed at fed ${PASSES.abstract.fed}.

Buckets: **OK** generated + composed · **DEGRADED** retired (was the consolidate downgrade — now 0) ·
**GEN-empty** no types produced · **GEN-throw** generator threw
(incl. GEN-HANG, a sync infinite loop) · **COMPOSE-fail** rover rejected the schema. pass-rate = OK / ${opsLabel} ops.

**all-ops** = every selected ${opsLabel} op of this sweep composed as ONE schema — what production
(\`gen-ts.mjs\`) does, and what per-op composes cannot see (cross-op collisions, shared types
selected from several positions). Per-verb, not full-spec: the combined read+write compose is only
measured by a \`--verbs all\` run. \`FAIL [<code> ×<n>]\` counts that code's own occurrences.
${
  missingSpecs.length
    ? `\n**Partial corpus:** ${specs.length}/${ALL_SPECS.length} cataloged specs present locally. The
vendor corpus is gitignored (real specs carry example secrets), so this reflects whatever's in
this machine's \`tests/resources/oas/\`, not a fixed shared set. Missing, not run, not scored:
${missingSpecs.map((f) => `\`${f}\``).join(', ')}.\n`
    : ''
}
\n## Coverage (real unions, connect ${PASSES.abstract.connectorSpecVersion}, fed ${PASSES.abstract.fed})\n\n${passTable('abstract')}\n
## Gap histogram (all specs, all selected passes)

Failure/degradation categories ranked by frequency — the prioritized robustness gap list. \`example\`
is one representative \`<spec> get:<path>\`.

| count | category | example |
|--:|---|---|
${histo}
`;
  fs.writeFileSync(outFile, md);
}

if (isMainThread) {
  writeReport();
  process.stderr.write(`\nWrote ${outFile}\n`);
}
