/**
 * Corpus lint invariant: generate every op of every corpus spec and run `lintSelections` over the
 * result. The generator never writes a bad selection, so a clean sweep is the pass condition —
 * anything reported is either an emitter bug or a linter false positive.
 *
 * Generation only: no rover, no composition, no shared tmp dir, so this is safe to run alongside
 * `make coverage`. Still CPU-heavy — it walks the whole corpus.
 *
 *   node --import tsx/esm ./tools/lint-corpus.mts [--spec <file>] [--verbs get|mutations|all] [--v05]
 *
 * `--v05` generates connect v0.5 with reusable `@mapping`; only meaningful on a branch whose
 * generator supports it.
 */
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { OasGen } from '../src/index.js';
import { lintSelections, SchemaReader } from '../src/oas/lint/index.js';
import { SelectedFields } from '../src/oas/lint/selectedFields.js';
import type { LintDiagnostic, SelectedField } from '../src/oas/lint/index.js';

const argv = process.argv.slice(2);
const getArg = (name: string, fallback?: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const base = './tests/resources/oas';
const onlySpec = getArg('--spec');
const verbs = getArg('--verbs', 'get')!;
const v05 = argv.includes('--v05');
// Anything but a full default sweep writes its own file, so a scoped run can never overwrite the
// full report: `--spec petstore.yaml` writes LINT-CORPUS-petstore.md.
const outFile = reportName();

function reportName(): string {
  const specPart = onlySpec ? `-${onlySpec.replace(/\.(ya?ml|json)$/i, '')}` : '';
  const verbsPart = verbs === 'get' ? '' : `-${verbs}`;
  return `LINT-CORPUS${specPart}${verbsPart}${v05 ? '-v05' : ''}.md`;
}

const MUTATION_PREFIXES = ['post:', 'put:', 'patch:', 'del:'];
const wanted = (key: string): boolean =>
  verbs === 'get' ? key.startsWith('get:') : verbs === 'mutations' ? MUTATION_PREFIXES.some((p) => key.startsWith(p)) : true;

// the generator traces unconditionally through console.log; silence it or the sweep writes 400 MB
const trace = console.log;
console.log = () => {};
const say = (line: string): void => void process.stderr.write(line + '\n');

function genOptions(skipValidation: boolean) {
  return {
    skipValidation,
    showParentInSelections: false,
    connectorSpecVersion: v05 ? 'v0.5' : 'v0.4',
    federationVersion: 'v2.14',
    reusableMappings: v05,
    mapper: undefined,
    skipOptionalArgs: false,
  };
}

interface Finding {
  spec: string;
  op: string;
  diagnostic: LintDiagnostic;
  excerpt: string;
}

/**
 * Per spec, how much the linter actually looked at. Without this a clean sweep is ambiguous: a
 * linter that reads nothing reports nothing, and the two look identical from the outside.
 */
interface SpecTally {
  spec: string;
  ops: number;
  selections: number;
  fields: number;
  blindOps: number;
  emptyOps: number;
  errors: number;
  warnings: number;
}

// only fields the reader actually read: an unreadable one is a field it gave up on, and counting
// it would let a selection the reader cannot handle at all still look like it was checked
function countFields(fields: SelectedField[]): number {
  return SelectedFields.readable(fields).reduce(
    (total, field) => total + 1 + countFields(field.nested ?? []),
    0,
  );
}

const specs = (onlySpec ? [onlySpec] : fs.readdirSync(base).filter((f) => /\.(ya?ml|json)$/i.test(f))).sort();

let opCount = 0;
let dirtyOps = 0;
const byCode = new Map<string, number>();
const findings: Finding[] = [];
const tallies: SpecTally[] = [];

for (const spec of specs) {
  let loaded: { gen: OasGen; skipValidation: boolean } | null = null;
  for (const skipValidation of [false, true]) {
    try {
      const gen = await OasGen.fromFile(path.join(base, spec), genOptions(skipValidation) as never);
      await gen.visit();
      loaded = { gen, skipValidation };
      break;
    } catch {
      /* a spec that needs skipValidation throws on the strict pass */
    }
  }
  if (!loaded) {
    say(`LOAD-FAIL ${spec}`);
    continue;
  }

  const ops = Array.from(loaded.gen.paths.keys()).filter(wanted);
  const tally: SpecTally = { spec, ops: 0, selections: 0, fields: 0, blindOps: 0, emptyOps: 0, errors: 0, warnings: 0 };
  for (const op of ops) {
    let sdl: string;
    let perOp: OasGen;
    try {
      perOp = new OasGen(loaded.gen.parser, genOptions(loaded.skipValidation) as never);
      await perOp.visit();
      sdl = perOp.generateSchema([`${op}>**`]);
    } catch {
      continue; // generation failures are the coverage harness's business, not the linter's
    }
    opCount += 1;
    tally.ops += 1;

    // what the linter had in front of it, so "no diagnostics" can be told apart from "saw nothing"
    const parsed = SchemaReader.read(sdl);
    const fields = parsed.selections.reduce((total, selection) => total + countFields(selection.fields), 0);
    tally.selections += parsed.selections.length;
    tally.fields += fields;
    if (parsed.selections.length === 0) {
      // nothing was generated for this op at all (the coverage harness calls this GEN-EMPTY, e.g.
      // petstore `get:/store/inventory`, whose response is a free-form map) — not the linter's doing
      tally.emptyOps += 1;
    } else if (fields === 0) {
      tally.blindOps += 1;
    }

    const found = lintSelections(sdl, perOp);
    if (found.length === 0) {
      continue;
    }
    dirtyOps += 1;
    for (const diagnostic of found) {
      if (diagnostic.severity === 'error') tally.errors += 1;
      else tally.warnings += 1;
      byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
      if (findings.length < 40) {
        findings.push({
          spec,
          op,
          diagnostic,
          excerpt: sdl.slice(Math.max(0, diagnostic.from - 50), diagnostic.to + 25).replace(/\s+/g, ' '),
        });
      }
    }
  }
  tallies.push(tally);
  say(`${spec}: ${tally.ops} ops, ${tally.fields} fields read (running total ${opCount}, ${dirtyOps} with diagnostics)`);
}

console.log = trace;

const totalFields = _.sumBy(tallies, 'fields');
const blindOps = _.sumBy(tallies, 'blindOps');
const emptyOps = _.sumBy(tallies, 'emptyOps');

say(`\n=== ${opCount} ops linted, ${totalFields} fields read, ${dirtyOps} ops with diagnostics (connect ${v05 ? 'v0.5 + @mapping' : 'v0.4'})`);
for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
  say(`  ${code}: ${count}`);
}
if (emptyOps > 0) {
  say(`  ${emptyOps} ops generated no connector at all (GEN-EMPTY) — nothing for the linter to read`);
}
if (blindOps > 0) {
  say(`  ${blindOps} ops HAVE a selection the reader could not read a single field from`);
}
for (const finding of findings) {
  say(`\n${finding.spec} ${finding.op}\n  [${finding.diagnostic.severity}] ${finding.diagnostic.code} ${finding.diagnostic.message}\n  ...${finding.excerpt}...`);
}

fs.writeFileSync(outFile, report());
say(`\nwrote ${outFile}`);

// A sweep is only good news if the linter had something to read. An op whose selection exists but
// yielded no fields is a failure in its own right — the reader came back empty on real generated
// output. An op that generated no connector at all is not: there was nothing to read.
process.exitCode = dirtyOps === 0 && blindOps === 0 ? 0 : 1;

function report(): string {
  const lines = [
    '# Corpus lint — connector selections per spec',
    '',
    `Generated by \`tools/lint-corpus.mts${v05 ? ' --v05' : ''}${verbs === 'get' ? '' : ` --verbs ${verbs}`}\`.`,
    'Every op is generated and its selections are checked. The generator should never write a',
    'selection its own linter rejects, so any row with a finding is a bug in one of the two.',
    '',
    '**fields** is how many selected fields the reader actually read. It is the guard against a',
    'quiet pass: a linter that reads nothing reports nothing, and without this column the two look',
    'the same. **blind** counts ops whose selection exists but yielded no fields — those fail the',
    'run. **empty** counts ops that generated no connector at all, which is not the linter\'s doing.',
    '',
    `- connect ${v05 ? 'v0.5 with reusable `@mapping`' : 'v0.4'}, verbs: ${verbs}`,
    `- ${opCount} ops, ${totalFields} fields read, ${dirtyOps} ops with findings, ${blindOps} blind, ${emptyOps} empty`,
    '',
    '| Spec | ops | selections | fields | blind | empty | errors | warnings |',
    '|---|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const tally of _.sortBy(tallies, (entry) => -(entry.errors + entry.warnings + entry.blindOps))) {
    lines.push(
      `| ${tally.spec} | ${tally.ops} | ${tally.selections} | ${tally.fields} | ${tally.blindOps} | ${tally.emptyOps} | ${tally.errors} | ${tally.warnings} |`,
    );
  }

  if (byCode.size > 0) {
    lines.push('', '## Findings by code', '', '| count | code |', '|--:|---|');
    for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${count} | ${code} |`);
    }
    lines.push('', '## Examples', '');
    for (const finding of findings) {
      lines.push(
        `- **${finding.spec}** \`${finding.op}\` — [${finding.diagnostic.severity}] ${finding.diagnostic.code}: ${finding.diagnostic.message}`,
        `  \`\`\`\n  ...${finding.excerpt}...\n  \`\`\``,
      );
    }
  }

  return lines.join('\n') + '\n';
}
