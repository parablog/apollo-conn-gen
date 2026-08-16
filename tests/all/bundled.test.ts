import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as esbuild from 'esbuild';
import { oasBasePath } from '../../src/tests/runners.js';
import './_setup.js';

// Every other test reads the source files as they are, so none of them sees what the browser build
// does to the code. see docs/FIXED.md #53
test('test_bundled_build_keeps_enum_params_as_scalar_arguments', async () => {
  // packed here rather than read from dist/ so a fresh checkout works. Only our own code is
  // renamed (packing the libraries too breaks them), and the file has to sit inside the repo or
  // it can't find them.
  const outfile = path.join(process.cwd(), 'node_modules', '.cache', 'apollo-conn-gen', 'bundled.mjs');
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  esbuild.buildSync({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    minifyIdentifiers: true,
    packages: 'external',
    outfile,
  });

  const { OasGen } = await import(pathToFileURL(outfile).href);
  const gen = await OasGen.fromFile(`${oasBasePath}/petstore.yaml`, {
    showParentInSelections: false,
    connectorSpecVersion: 'v0.4',
    federationVersion: 'v2.14',
    skipValidation: true,
  });
  await gen.visit();

  const paths = ['get:/pet/findByStatus>**'];
  gen.getTypes(paths);
  const schema: string = gen.generateSchema(paths);

  // petstore's `status` query param is `type: string` with an enum — an argument takes the scalar
  assert.ok(/petFindByStatus\(status: String/.test(schema), 'enum param must be a scalar argument');
  assert.ok(!/enum Enum \{/.test(schema), 'the enum definition must not be inlined into the arg list');
});
