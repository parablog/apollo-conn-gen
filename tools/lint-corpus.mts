/**
 * Corpus lint invariant: generate every op of every corpus spec and run `lintSelections` over the
 * result. The generator never writes a bad selection, so a clean sweep is the pass condition —
 * anything reported is either an emitter bug or a linter false positive.
 *
 * Also runs `ResponseCoverageCheck` (#176) on the same generated selections: every field the
 * spec's own response schema declares must be read or accounted for, so a spec that offers real
 * data and gets an empty `success: Boolean` stub back is caught here, corpus-wide.
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
import { SelectionPath } from '../src/oas/utils/selectionPath.js';
import { lintSelections, SchemaReader } from '../src/oas/lint/index.js';
import { SelectedFields } from '../src/oas/lint/selectedFields.js';
import { ResponseCoverageCheck } from '../src/oas/lint/checks/responseCoverage.js';
import type { LintDiagnostic, SelectedField } from '../src/oas/lint/index.js';
import { toClassifiable, classify, tally as tallyGaps, decideExit, type Gap } from './lintCorpusGaps.mjs';

// Filed gaps the sweep tolerates: a finding is known when its spec matches and, code-aware, either
// the field (RESPONSE_FIELD_NOT_READ) or the op (RESPONSE_NOT_READ) also matches -- per spec+field,
// not per op, since the same shape recurs across many ops (confluence: 18 GET ops for `uris`).
const KNOWN_GAPS: Gap[] = [
  // docs/TASKS.md #215: a oneOf mixing a plain scalar with a shapeless object (`{}` or
  // `additionalProperties: true`, no properties) matches no existing helper and folds away.
  { spec: 'github.yaml', field: 'payload', ref: 'docs/TASKS.md #215' },
  { spec: 'confluence.json', field: 'args', ref: 'docs/TASKS.md #215' },
  { spec: 'confluence.json', field: '_expandable', ref: 'docs/TASKS.md #215' },
  { spec: 'motion.json', field: 'value', ref: 'docs/TASKS.md #215' },
  { spec: 'motion.json', field: 'data', ref: 'docs/TASKS.md #215' },
  { spec: 'oneof-plain-and-shapeless-object.yaml', field: 'payload', ref: 'docs/TASKS.md #215' },
  { spec: 'oneof-plain-and-shapeless-object.yaml', field: 'args', ref: 'docs/TASKS.md #215' },
  { spec: 'oneof-plain-and-shapeless-object.yaml', field: 'value', ref: 'docs/TASKS.md #215' },
  { spec: 'oneof-plain-and-shapeless-object.yaml', field: 'data', ref: 'docs/TASKS.md #215' },

  // docs/TASKS.md #216: a container object whose every property individually folds away by its
  // own oneOf (array mixed with a plain scalar or object) disappears whole -- no field, no JSON.
  { spec: 'confluence.json', field: 'uris', ref: 'docs/TASKS.md #216' },
  { spec: 'docker-engine.json', field: 'Cmd', ref: 'docs/TASKS.md #216' },
  { spec: 'docker-engine.json', field: 'Entrypoint', ref: 'docs/TASKS.md #216' },
  { spec: 'slack.yaml', field: 'fields', ref: 'docs/TASKS.md #216' },
  { spec: 'container-whose-fields-all-vanish-drops.yaml', field: 'uris', ref: 'docs/TASKS.md #216' },

  // docs/TASKS.md #217: a checker false positive, not a data loss -- a property literally named
  // "" sanitises to `_` and reads fine; the coverage check's own falsy-key guard misses it.
  { spec: 'sendgrid.yaml', field: '', ref: 'docs/TASKS.md #217' },
  { spec: 'empty-string-property-name.yaml', field: '', ref: 'docs/TASKS.md #217' },

  // docs/TASKS.md #218: an allOf of two plain scalar members (a $ref plus an inline nullable
  // string) vanishes.
  { spec: 'digitalocean.yaml', field: 'region_slug', ref: 'docs/TASKS.md #218' },
  { spec: 'allof-two-plain-members.yaml', field: 'region_slug', ref: 'docs/TASKS.md #218' },

  // docs/TASKS.md #214: a single-member allOf wrapping a scalar-only oneOf vanishes the same way.
  { spec: 'ashby.json', field: 'value', ref: 'docs/TASKS.md #214' },
  { spec: 'allof-wrapping-scalar-oneof.yaml', field: 'value', ref: 'docs/TASKS.md #214' },

  // docs/TASKS.md #184: two contradictory nullable-oneOf shapes vanish with no trace.
  { spec: 'required-nullable-oneof.yaml', field: 'doubleNull', ref: 'docs/TASKS.md #184' },
  { spec: 'required-nullable-oneof.yaml', field: 'constrained', ref: 'docs/TASKS.md #184' },

  // docs/TASKS.md #183: a false RESPONSE_NOT_READ when the spec's own responses was empty.
  { spec: 'malformed-response-schema-crashes.yaml', op: 'get:/markers', ref: 'docs/TASKS.md #183' },

  // the #176 stub-response positive control -- a deliberate test fixture, not a gap.
  { spec: 'unread-media-type.yaml', op: 'get:/reports', ref: 'test_176_a_stubbed_response_is_an_error' },
];

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

// the generator traces through console.log and warns through console.error; silence both or the
// sweep floods the console. e.g. (FHIR-baseR4) thousands of shapeless-body warns across its mutations
const trace = console.log;
console.log = () => {};
console.warn = () => {};
console.error = () => {};
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
  ref?: string;
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
  known: number;
  new: number;
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
  const tally: SpecTally = {
    spec,
    ops: 0,
    selections: 0,
    fields: 0,
    blindOps: 0,
    emptyOps: 0,
    errors: 0,
    warnings: 0,
    known: 0,
    new: 0,
  };
  for (const op of ops) {
    let sdl: string;
    let perOp: OasGen;
    try {
      perOp = new OasGen(loaded.gen.parser, genOptions(loaded.skipValidation) as never);
      await perOp.visit();
      sdl = perOp.generateSchema([SelectionPath.everythingUnder(op)]);
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

    // v0.5's `$->Type` hand-off reads nothing by key at all -- that is its own check to write,
    // not this one's, so the response-coverage check only runs on the v0.4 sweep.
    const found = [...lintSelections(sdl, perOp), ...(v05 ? [] : ResponseCoverageCheck.run(sdl, parsed, perOp))];
    if (found.length === 0) {
      continue;
    }
    dirtyOps += 1;
    // the sole known-vs-new decision: every diagnostic this op produced, tallied against KNOWN_GAPS
    // -- not the capped `findings` list below, which only decides what gets printed as an example.
    const classifiable = found.map((diagnostic) => toClassifiable(spec, op, diagnostic));
    const opTally = tallyGaps(classifiable, KNOWN_GAPS);
    tally.known += opTally.known;
    tally.new += opTally.new;
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
          ref: classify(toClassifiable(spec, op, diagnostic), KNOWN_GAPS)?.ref,
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
const knownCount = _.sumBy(tallies, 'known');
const newCount = _.sumBy(tallies, 'new');

say(`\n=== ${opCount} ops linted, ${totalFields} fields read, ${dirtyOps} ops with diagnostics (connect ${v05 ? 'v0.5 + @mapping' : 'v0.4'})`);
say(`  ${knownCount} known, ${newCount} new`);
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
  say(
    `\n${finding.spec} ${finding.op}\n  [${finding.diagnostic.severity}] ${finding.diagnostic.code} ${finding.diagnostic.message}${finding.ref ? ` (known: ${finding.ref})` : ''}\n  ...${finding.excerpt}...`,
  );
}

fs.writeFileSync(outFile, report());
say(`\nwrote ${outFile}`);

// A sweep is only good news if the linter had something to read. An op whose selection exists but
// yielded no fields is a failure in its own right — the reader came back empty on real generated
// output. An op that generated no connector at all is not: there was nothing to read. A finding
// past a filed gap does not fail the run; a finding classify cannot match does.
process.exitCode = decideExit(newCount, blindOps);

function report(): string {
  const lines = [
    '# Corpus lint — connector selections per spec',
    '',
    `Generated by \`tools/lint-corpus.mts${v05 ? ' --v05' : ''}${verbs === 'get' ? '' : ` --verbs ${verbs}`}\`.`,
    'Every op is generated and its selections are checked. The generator should never write a',
    'selection its own linter rejects, so any row with a finding is a bug in one of the two.',
    'RESPONSE_NOT_READ and RESPONSE_FIELD_NOT_READ additionally compare the selection against the',
    'spec\'s own response schema, so a spec that offers fields the selection never reads is caught',
    'here too, not just a selection that reads a field the spec never offered.',
    '',
    '**fields** is how many selected fields the reader actually read. It is the guard against a',
    'quiet pass: a linter that reads nothing reports nothing, and without this column the two look',
    'the same. **blind** counts ops whose selection exists but yielded no fields — those fail the',
    'run regardless of known/new, since a blind op has no diagnostic of its own to classify.',
    '**empty** counts ops that generated no connector at all, which is not the linter\'s doing.',
    '**known** findings match a filed gap and pass; **new** findings do not, and fail the run.',
    '',
    `- connect ${v05 ? 'v0.5 with reusable `@mapping`' : 'v0.4'}, verbs: ${verbs}`,
    `- ${opCount} ops, ${totalFields} fields read, ${dirtyOps} ops with findings, ${blindOps} blind, ${emptyOps} empty, ${knownCount} known, ${newCount} new`,
    '',
    '| Spec | ops | selections | fields | blind | empty | errors | warnings | known | new |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const tally of _.sortBy(tallies, (entry) => -(entry.new + entry.blindOps))) {
    lines.push(
      `| ${tally.spec} | ${tally.ops} | ${tally.selections} | ${tally.fields} | ${tally.blindOps} | ${tally.emptyOps} | ${tally.errors} | ${tally.warnings} | ${tally.known} | ${tally.new} |`,
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
        `- **${finding.spec}** \`${finding.op}\` — [${finding.diagnostic.severity}] ${finding.diagnostic.code}: ${finding.diagnostic.message}${finding.ref ? ` (known: ${finding.ref})` : ''}`,
        `  \`\`\`\n  ...${finding.excerpt}...\n  \`\`\``,
      );
    }
  }

  return lines.join('\n') + '\n';
}
