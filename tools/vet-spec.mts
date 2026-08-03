// Temporary corpus-vetting harness (not committed). Finds the RICHEST selection (max typesSize)
// that both generates and composes (rover, fed 2.12, consolidateUnions default).
// Usage: node --import tsx/esm ./vet.mts <specFileInResourcesOas>
import { OasGen } from '../src/index.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const file = process.argv[2];
const base = './tests/resources/oas';

function compose(schema: string): boolean {
  const dir = path.join(os.tmpdir(), 'oas-vet');
  fs.mkdirSync(dir, { recursive: true });
  const schemaFile = path.join(dir, 'schema.graphql');
  const sampleFile = path.join(dir, 'sample.graphql');
  const sg = path.join(dir, 'supergraph.yaml');
  fs.writeFileSync(schemaFile, schema);
  fs.writeFileSync(sampleFile, 'type Query { hello: String }');
  fs.writeFileSync(
    sg,
    `federation_version: =2.12.0\nsubgraphs:\n  test_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${schemaFile}\n  sample_spec:\n    routing_url: http://localhost\n    schema:\n      file: ${sampleFile}\n`,
  );
  try {
    execSync(`rover supergraph compose --config ${sg} --elv2-license accept`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function load(skipValidation: boolean) {
  const gen = await OasGen.fromFile(`${base}/${file}`, {
    skipValidation,
    consolidateUnions: true,
    showParentInSelections: false,
  });
  await gen.visit();
  return gen;
}

(async () => {
  let gen;
  let skip = false;
  try {
    gen = await load(false);
  } catch {
    try {
      gen = await load(true);
      skip = true;
    } catch (e) {
      console.log(`RESULT ${file} :: LOAD-FAIL :: ${(e as Error).message.slice(0, 140)}`);
      return;
    }
  }
  const getIds = Array.from(gen.paths.keys()).filter((k) => k.startsWith('get:'));
  // Phase 1: cheap generate pass — collect (id, typesSize) for selections that generate cleanly.
  const cands: { id: string; size: number; clean: boolean }[] = [];
  for (const id of getIds.slice(0, 120)) {
    const sel = [`${id}>**`];
    try {
      const types = gen.getTypes(sel);
      if (types.size === 0) continue;
      const schema = gen.generateSchema(sel);
      if (!schema) continue;
      cands.push({ id, size: types.size, clean: !schema.includes('NOT SUPPORTED YET') });
    } catch {
      /* skip */
    }
  }
  // Prefer clean (no union-downgrade marker), then larger typesSize.
  cands.sort((a, b) => Number(b.clean) - Number(a.clean) || b.size - a.size);
  // Phase 2: compose the top candidates until one composes.
  for (const c of cands.slice(0, 30)) {
    const schema = gen.generateSchema([`${c.id}>**`]);
    if (compose(schema)) {
      console.log(
        `RESULT ${file} :: OK :: skipValidation=${skip} sel='${c.id}>**' pathsSize=${gen.paths.size} typesSize=${c.size} clean=${c.clean}`,
      );
      return;
    }
  }
  console.log(`RESULT ${file} :: NO-WORKING-SELECTION (gen-ok candidates: ${cands.length}/${getIds.length})`);
})();
