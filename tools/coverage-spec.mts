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
//        [--concurrency N] [--verbs get|mutations|all]
import { OasGen } from '../src/index.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec as _exec, execSync } from 'child_process';
import { promisify } from 'util';

// The generator traces via console.log/warn; mute it (progress goes to stderr, report to file).
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const exec = promisify(_exec);
const base = './tests/resources/oas';

// Vendor corpus plus tracked real fixtures that are broad enough to measure beyond one smoke test.
const ALL_SPECS = [
  'googlebooks.yaml',
  'slack.yaml',
  'digitalocean.yaml',
  'box.yaml',
  'openai.yaml',
  'asana.yaml',
  'sendgrid.yaml',
  'github.yaml',
  'adobe-commerce-swagger.json',
  'launch_Library_2-docs-v2.3.0.json',
  'common-room-core.json',
  'mindbody.json',
  'TMF632-Party_Management-v5.0.0.oas.yaml',
  'TMF637-ProductInventory-v5.0.0.oas.yaml',
  'TMF666-Account_Management-v5.0.0.oas.yaml',
  'TMF680-4.0.0-WithExtensions.swagger.yaml',
  'TMF717_Customer360-v5.0.0.oas.yaml',
  'js-mva-consumer-info_v1.yaml',
  'js-mva-homepage-product-selector_v3.yaml',
  'most-popular-product.yaml',
  'omni.yaml',
  'confluence.json',
  // Mercedes-Benz Car Configurator Service: union/shared-$ref heavy. 100% default;
  // abstract pass fails with CONNECTORS_UNRESOLVED_FIELD across 26/43 ops (under investigation).
  'openapi.car_configurator_service_(ccs)_int-10.210.0.yaml',
];

// One pass at the current shipping versions (connect v0.4 / fed v2.14, per DEFAULT_VERSIONS): real
// unions/interfaces — the only behaviour now that the consolidate downgrade was removed.
const PASSES = {
  abstract: { connectorSpecVersion: 'v0.4', federationVersion: 'v2.14', fed: '2.14.1' },
};

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name: string, def?: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const onlySpec = getArg('--spec');
const limit = parseInt(getArg('--limit', '0')!, 10);
const concurrency = parseInt(getArg('--concurrency', '8')!, 10);
const verbsSel = getArg('--verbs', 'get'); // get | mutations | all
// each --verbs sweep gets its own report file so a later run doesn't clobber an earlier one.
const opsLabel = verbsSel === 'get' ? 'GET' : verbsSel === 'mutations' ? 'mutation' : 'all';
const outFile = verbsSel === 'get' ? 'COVERAGE.md' : `COVERAGE-${verbsSel}.md`;
const specs = onlySpec ? [onlySpec] : ALL_SPECS;
const passKeys = ['abstract'] as (keyof typeof PASSES)[];

// Whole (spec, pass) combinations that infinite-loop the generator — skipped so the sweep can
// complete, reported as "not measurable" with the reason. Currently empty: the Confluence abstract
// hang was fixed by docs/issues.md #10 (selection indexing + cycle cuts).
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
// Above this SDL size we compose one at a time — eight rovers on a 300K schema each is what ate 60 GB.
const BIG_SCHEMA_BYTES = 200_000;
const tmp = path.join(os.tmpdir(), 'oas-coverage');
fs.mkdirSync(tmp, { recursive: true });
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

async function compose(op: string, schema: string, fed: string, idx: number): Promise<{ ok: boolean; code?: string }> {
  if (TRACE) process.stderr.write(`    compose ${idx} ${op}\n`);
  const schemaFile = path.join(tmp, `schema-${idx}.graphql`);
  const sgFile = path.join(tmp, `supergraph-${idx}.yaml`);
  fs.writeFileSync(schemaFile, schema);
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
  }, COMPOSE_TIMEOUT_MS);
  try {
    await running;
    return timedOut ? { ok: false, code: 'TIMEOUT' } : { ok: true };
  } catch (e: any) {
    if (timedOut) {
      return { ok: false, code: 'TIMEOUT' };
    }
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`;
    // rover wraps everything in a generic [E029]; the actionable code is the federation error
    // name in the "Caused by:" body (e.g. INVALID_URL, SATISFIABILITY_ERROR, INVALID_GRAPHQL).
    const inner = out.match(/^\s*([A-Z][A-Z0-9_]{3,}):/m);
    const outer = out.match(/\[(E[0-9]+)\]/);
    return { ok: false, code: inner ? inner[1] : outer ? outer[1] : 'OTHER' };
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

async function runPass(
  file: string,
  parser: any,
  ops: string[],
  passKey: keyof typeof PASSES,
  skip: boolean,
): Promise<PassResult> {
  const r: PassResult = { total: ops.length, ok: 0, degraded: 0, genEmpty: 0, genThrow: 0, composeFail: 0, buckets: new Map() };
  const verdicts: Record<string, string> = {};
  // Phase 1 (sequential, CPU): fresh gen per op -> classify generation, collect compose candidates.
  const candidates: { op: string; schema: string }[] = [];
  for (const op of ops) {
    const sel = `${op}>**`; // full-subtree selection, exactly like the corpus tests / vet-spec
    if (TRACE) process.stderr.write(`    gen ${passKey} ${op}\n`);
    try {
      const g = new OasGen(parser, genOptions(passKey, skip) as any);
      await g.visit();
      const types = g.getTypes([sel]);
      const schema = g.generateSchema([sel]);
      // types.size === 0 alone isn't "empty" — a scalar-rooted op (e.g. a write returning a bare
      // `true`) legitimately needs no auxiliary `type X {}` while still emitting a real
      // Query/Mutation field. Only call it empty when the schema has no such field either.
      if (types.size === 0 && !/type (Query|Mutation) \{/.test(schema)) {
        r.genEmpty++;
        addBucket(r.buckets, 'GEN-EMPTY', op);
        verdicts[op] = 'GEN-EMPTY';
        continue;
      }
      candidates.push({ op, schema });
    } catch (e: any) {
      r.genThrow++;
      addBucket(r.buckets, `GEN-THROW: ${genKey(e)}`, op);
      verdicts[op] = 'GEN-THROW';
    }
  }
  // Phase 2 (pooled): compose candidates via rover. Big schemas run one at a time so a heavy op
  // can't be multiplied by the pool — the idx keeps counting across both so each writes its own files.
  const fed = PASSES[passKey].fed;
  const small = candidates.filter((c) => c.schema.length < BIG_SCHEMA_BYTES);
  const big = candidates.filter((c) => c.schema.length >= BIG_SCHEMA_BYTES);
  const composed = new Map<string, { ok: boolean; code?: string }>();
  (await pool(small, (c, i) => compose(c.op, c.schema, fed, i), concurrency)).forEach((res, i) =>
    composed.set(small[i].op, res),
  );
  (await pool(big, (c, i) => compose(c.op, c.schema, fed, small.length + i), 1)).forEach((res, i) =>
    composed.set(big[i].op, res),
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
  // per-op verdict dump for before/after attribution: COV_DUMP=/path/prefix
  if (process.env.COV_DUMP) {
    fs.writeFileSync(`${process.env.COV_DUMP}.${file.replace(/[^a-z0-9]+/gi, '_')}.${passKey}.json`, JSON.stringify(verdicts, null, 1));
  }
  return r;
}

// ---- main -----------------------------------------------------------------
type SpecReport = { file: string; skip: boolean; ops: number; passes: Partial<Record<keyof typeof PASSES, PassResult>> };

const reports: SpecReport[] = [];
const globalBuckets = new Map<string, Bucket>();

for (const file of specs) {
  process.stderr.write(`\n== ${file} ==\n`);
  const loaded = await loadBase(file);
  if (!loaded) {
    process.stderr.write(`  LOAD-FAIL\n`);
    reports.push({ file, skip: false, ops: 0, passes: {} });
    addBucket(globalBuckets, 'LOAD-FAIL (spec did not parse)', file);
    continue;
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
  process.stderr.write(`  ${ops.length} ${verbsSel === 'get' ? 'GET ' : verbsSel + ' '}ops${skip ? ' (skipValidation)' : ''}\n`);

  const rep: SpecReport = { file, skip, ops: ops.length, passes: {} };
  reports.push(rep);
  for (const pk of passKeys) {
    const reason = skipReason(file, pk);
    if (reason) {
      rep.passes[pk] = { total: ops.length, ok: 0, degraded: 0, genEmpty: 0, genThrow: 0, composeFail: 0, buckets: new Map(), skipped: reason };
      addBucket(globalBuckets, `GEN-HANG: ${reason}`, `${file} ${pk} pass (whole)`);
      process.stderr.write(`  [${pk}] SKIPPED — ${reason}\n`);
      writeReport();
      continue;
    }
    const pr = await runPass(file, gen.parser, ops, pk, skip);
    rep.passes[pk] = pr;
    for (const [k, b] of pr.buckets) {
      const g = globalBuckets.get(k);
      if (g) g.count += b.count;
      else globalBuckets.set(k, { count: b.count, example: `${file} ${b.example}` });
    }
    process.stderr.write(
      `  [${pk}] ok=${pr.ok} degraded=${pr.degraded} genEmpty=${pr.genEmpty} genThrow=${pr.genThrow} composeFail=${pr.composeFail} (${pct(pr.ok, pr.total)})\n`,
    );
    writeReport(); // incremental: survive a later hang/crash with partial results
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;
}

// ---- markdown report ------------------------------------------------------
function passTable(pk: keyof typeof PASSES): string {
  const head = `| Spec | GET ops | OK | DEGRADED | GEN-empty | GEN-throw | COMPOSE-fail | pass-rate |\n|---|--:|--:|--:|--:|--:|--:|--:|`;
  const rows = reports.map((rp) => {
    const p = rp.passes[pk];
    if (!p) return `| ${rp.file}${rp.skip ? ' †' : ''} | ${rp.ops} | — | — | — | — | — | LOAD-FAIL |`;
    if (p.skipped) return `| ${rp.file}${rp.skip ? ' †' : ''} | ${p.total} | — | — | — | — | — | HANG (${p.skipped}) |`;
    return `| ${rp.file}${rp.skip ? ' †' : ''} | ${p.total} | ${p.ok} | ${p.degraded} | ${p.genEmpty} | ${p.genThrow} | ${p.composeFail} | ${pct(p.ok, p.total)} |`;
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

writeReport();
process.stderr.write(`\nWrote ${outFile}\n`);
