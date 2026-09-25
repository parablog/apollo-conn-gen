import { OasGen, OverridesConfig } from '../index.js';
import { compose, oasBasePath } from './runners.js';
import { warn } from '../oas/log/trace.js';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';

export interface ConnectorTestOptions {
  skipValidation?: boolean;
  // Composes on stock rover by default; pass false to also check the patched local composer.
  forceRover?: boolean;
  inferEntityResolvers?: boolean;
  keepArgEnums?: boolean;
  overrides?: OverridesConfig;
}

export interface ConnectorTestResult {
  skipped: boolean;
  success: boolean;
  output: string;
}

// e.g. OAS_TEST_CONNECTORS_BINARY unset -> os.homedir()/.rover/bin/supergraph-v2.15.1 (not `~`: spawnSync skips the shell that would expand it).
function connectorsBinary(): string {
  return process.env.OAS_TEST_CONNECTORS_BINARY || path.join(os.homedir(), '.rover', 'bin', 'supergraph-v2.15.1');
}

// Generates a fixture's SDL, composes it, runs suiteFile against it with test-connectors; skips when the binary is missing unless OAS_REQUIRE_RUNTIME_TESTS=1.
export async function runConnectorTest(
  fixture: string,
  paths: string[],
  suiteFile: string,
  opts: ConnectorTestOptions = {},
): Promise<ConnectorTestResult> {
  const binary = connectorsBinary();
  if (!fs.existsSync(binary)) {
    const message = `test-connectors binary not found at ${binary} -- set OAS_TEST_CONNECTORS_BINARY or install it via rover.`;
    if (process.env.OAS_REQUIRE_RUNTIME_TESTS === '1') {
      assert.fail(message);
    }
    warn(null, '[connectors]', `${message} Skipping runtime mapping check.`);
    return { skipped: true, success: false, output: message };
  }

  const gen = await OasGen.fromFile(`${oasBasePath}/${fixture}`, {
    skipValidation: opts.skipValidation,
    showParentInSelections: false,
    inferEntityResolvers: opts.inferEntityResolvers,
    keepArgEnums: opts.keepArgEnums,
    overrides: opts.overrides,
  });
  await gen.visit();
  const schema = gen.generateSchema(paths);
  assert.ok(schema, `no schema generated for ${fixture} ${paths.join(', ')}`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-connector-test-'));
  const schemaFile = path.join(dir, fixture.replace(/\.(yaml|yml|json)$/, '') + '.graphql');
  fs.writeFileSync(schemaFile, schema!, { encoding: 'utf-8', flag: 'w' });

  // A companion Query subgraph, same reason as runOasTest: a mutation-only generated schema has
  // no Query root, and composition needs one somewhere in the supergraph.
  const sampleFile = path.join(dir, 'sample-query.graphql');
  fs.writeFileSync(sampleFile, 'type Query { hello: String }', { encoding: 'utf-8', flag: 'w' });

  const [composed, composeError] = compose(schemaFile, sampleFile, undefined, opts.forceRover ?? true);
  assert.ok(composed, `compose failed for ${fixture} ${paths.join(', ')}: ${composeError}`);

  const result = spawnSync(binary, ['test-connectors', '-f', suiteFile, '--schema', schemaFile, '--no-fail-fast'], {
    encoding: 'utf-8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  return { skipped: false, success: result.status === 0, output };
}
