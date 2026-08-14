import { BatchConfig, JsonGen, DirectivesConfig, OasGen, OverridesConfig } from '../index.js';
import { JsonContext, JsonType } from '../json/index.js';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync, spawnSync } from 'child_process';
import { Mapper } from '../oas/mapper/types.js';
import _ from 'lodash';

export const oasBasePath = './tests/resources/oas';
const jsonBasePath = './tests/resources/json';

// runOasTest test
export async function runOasTest(
  file: string,
  paths: string[],
  pathsSize: number,
  typesSize: number,
  shouldFail: boolean = false,
  skipValidation: boolean = false,
  mapper?: Mapper,
  skipOptionalArgs: boolean = false,
  inferEntityResolvers: boolean = false,
  // R2: optional version/compose overrides. Defaults to the shipping versions (connect v0.4 / fed
  // 2.14, real unions); pass connectorSpecVersion/federationVersion/composeFederationVersion to vary.
  opts: {
    baseURL?: string;
    overrides?: OverridesConfig;
    batch?: BatchConfig;
    connectorSpecVersion?: string;
    federationVersion?: string;
    composeFederationVersion?: string;
    emitConnectorErrors?: boolean;
    skipAuth?: boolean;
    authValuePrefix?: string;
    directives?: DirectivesConfig;
    skipOptionalMarkers?: boolean;
    // the local composer is one fixed build and ignores `federation_version`, so a test that pins an
    // older composition has to go through stock rover to mean anything. see docs/issues.md #16
    forceRover?: boolean;
  } = {},
): Promise<string | undefined> {
  const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
    skipValidation,
    baseURL: opts.baseURL,
    overrides: opts.overrides,
    batch: opts.batch,
    directives: opts.directives,
    showParentInSelections: false,
    mapper,
    skipOptionalArgs,
    skipOptionalMarkers: opts.skipOptionalMarkers,
    inferEntityResolvers,
    emitConnectorErrors: opts.emitConnectorErrors,
    skipAuth: opts.skipAuth,
    authValuePrefix: opts.authValuePrefix,
    connectorSpecVersion: opts.connectorSpecVersion,
    federationVersion: opts.federationVersion,
  });
  await gen.visit();

  assert.ok(gen.paths !== undefined);
  assert.ok(gen.paths.size === pathsSize, `${gen.paths.size} is not equal to ${pathsSize}`);

  const types = gen.getTypes(paths);
  assert.ok(
    types.size === typesSize,
    `${types.size} is not equal to ${typesSize}:  ${Array.from(types.keys()).join(',\n')}`,
  );

  const schema = gen.generateSchema(paths);
  assert.ok(schema !== undefined);

  // A fresh dir per call — tests run concurrently and many share the same fixture file, so a
  // shared path here would let one test's write clobber another's mid-compose.
  const oasTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-test-'));

  const schemaFile = path.join(oasTestDir, file.replace(/yaml|json|yml/, 'graphql'));
  fs.writeFileSync(schemaFile, schema, { encoding: 'utf-8', flag: 'w' });

  // need to write another graphql file but this only with a sample query otherwise composition
  // will fail for mutations
  const sampleFile = path.join(oasTestDir, 'simple-query.graphql');
  fs.writeFileSync(sampleFile, 'type Query { hello: String }', { encoding: 'utf-8', flag: 'w' });

  const [result, output] = compose(schemaFile, sampleFile, opts.composeFederationVersion, opts.forceRover);
  if (shouldFail) {
    assert.ok(!result);
    assert.ok(output !== undefined);
    return output;
  } else {
    assert.ok(output === undefined, 'should have been undefined, but it is: ' + output);
    assert.ok(result);
    console.error(schema);
    // Return the generated schema so callers can make substring assertions (e.g. on
    // @key / entity: true emitted by the inferEntityResolvers path).
    return schema;
  }
}

interface IJsonTestOptions {
  shouldFail: boolean;
  outputContains?: string;
  connectorSpecVersion?: string;
  federationVersion?: string;
  composeFederationVersion?: string;
}

export async function runJsonTest(
  fileOrFolder: string,
  options: IJsonTestOptions = { shouldFail: false, outputContains: undefined },
): Promise<string | undefined> {
  const fileOrFolderPath: string = `${jsonBasePath}/${fileOrFolder}`;

  assert.ok(fs.existsSync(fileOrFolderPath));

  let walker: JsonGen;

  const stats = fs.statSync(fileOrFolderPath);
  if (stats.isDirectory()) {
    walker = JsonGen.new({
      connectorSpecVersion: options.connectorSpecVersion,
      federationVersion: options.federationVersion,
    });

    const sources = fs.readdirSync(fileOrFolderPath).filter((name: string) => name.toLowerCase().endsWith('.json'));

    for (const source of sources) {
      const fullPath = path.join(fileOrFolderPath, source);
      const json = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(json !== undefined);

      walker.walkJson(json);
    }
  } else {
    const json = fs.readFileSync(fileOrFolderPath, 'utf-8');
    assert.ok(json !== undefined);

    walker = JsonGen.fromReader(json, {
      connectorSpecVersion: options.connectorSpecVersion,
      federationVersion: options.federationVersion,
    });
  }

  const context: JsonContext = walker.getContext();

  const types: JsonType[] = context.getTypes();
  assert.ok(types.length > 0);

  const schema = walker.generateSchema();
  assert.ok(schema !== undefined);

  // A fresh dir per call — see the matching comment in runOasTest. fileOrFolder can carry
  // subdirectories (e.g. "stats/fixtures/championship"), so the schema file's parent may not
  // be walkerDir itself.
  const walkerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-test-'));
  const schemaFile = path.join(walkerDir, fileOrFolder.replace(/\.yaml|\.json|\.yml/, '') + '.graphql');
  fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
  fs.writeFileSync(schemaFile, schema, { encoding: 'utf-8', flag: 'w' });

  const [result, output] = compose(schemaFile, undefined, options.composeFederationVersion);

  if (options.shouldFail) {
    assert.ok(result === false);
    assert.ok(output !== undefined);
    return output;
  } else {
    assert.ok(output === undefined);
    assert.ok(result === true);
  }

  // writer.clear();
}

/// rover checks
function isRoverAvailable(command: string): [boolean, string?] {
  const cmd = os.platform() === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [command], { encoding: 'utf8' });

  return [result.status === 0, result.stdout.toString().trim()];
}

// connect v0.4 `->entries` (maps) don't compose on stock rover yet — the #14 fix is unreleased (v0.5
// `@mapping` likewise). When the local patched build is present (gitignored), compose through it.
// `OAS_TEST_COMPOSER` overrides the resolved path. Ported from the feat/r10-reusable-mappings branch.
function localComposer(): string | undefined {
  const override = process.env.OAS_TEST_COMPOSER;
  if (override) {
    return override;
  }
  const cli = path.join(process.cwd(), 'tools', 'local', 'apollo-federation-cli');
  return fs.existsSync(cli) ? cli : undefined;
}

function compose(
  schemaPath: string,
  samplePath?: string,
  federationVersion: string = '2.15.1',
  forceRover: boolean = false,
): [boolean, string?] {
  console.info('schemaPath', schemaPath);

  const rover: [boolean, (string | undefined)?] = isRoverAvailable('rover');
  if (!rover[0]) {
    throw new Error('Rover is not available');
  }

  // A fresh dir per call — see the matching comment in runOasTest; concurrent tests must not
  // share this config file or each other's rover invocation.
  const composeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-test-compose-'));
  const supergraphFile = path.join(composeDir, 'supergraph.yaml');
  let content: string = `
federation_version: =${federationVersion}
subgraphs:
  test_spec:
    routing_url: http://localhost # this value is ignored
    schema:
      file: ${schemaPath} # path to the schema file`;

  if (samplePath) {
    content += `
  sample_spec:
    routing_url: http://localhost # this value is ignored
    schema:
      file: ${samplePath} # path to the sample file\`;
  `;
  }

  fs.writeFileSync(supergraphFile, content, { encoding: 'utf-8', flag: 'w' });

  // Prefer the local patched composer (has the unreleased #14 ->entries fix) when present; else rover.
  // `forceRover` skips it: it is one fixed build, so only rover honours `federation_version` above.
  const local = forceRover ? undefined : localComposer();
  const cmd = local
    ? `${local} compose --config ${supergraphFile}`
    : `${rover[1]} supergraph compose --config ${supergraphFile} --elv2-license accept`;

  // Write the rover command to a bash script for easy re-execution
  const scriptFile = path.join(composeDir, 'run-rover.sh');

  // Generate script with environment variables and dev command
  const devCmd = `APOLLO_KEY=\${APOLLO_KEY} APOLLO_GRAPH_REF=\${APOLLO_GRAPH_REF} ${rover[1]} dev --supergraph-config ${supergraphFile}`;
  const scriptContent = `#!/bin/bash

# Generated rover compose command (original)
# ${cmd}

# Alternative rover dev command with environment variables
# Check if required environment variables are set
if [ -z "\${APOLLO_KEY}" ]; then
    echo "Error: APOLLO_KEY environment variable is not set"
    echo "Please set it with: export APOLLO_KEY=your_apollo_key"
    exit 1
fi

if [ -z "\${APOLLO_GRAPH_REF}" ]; then
    echo "Error: APOLLO_GRAPH_REF environment variable is not set"
    echo "Please set it with: export APOLLO_GRAPH_REF=your_graph_ref"
    exit 1
fi

echo "Running rover dev with Apollo Studio integration..."
${devCmd}
`;
  fs.writeFileSync(scriptFile, scriptContent, { encoding: 'utf-8', flag: 'w' });

  let output;
  try {
    output = execSync(cmd, { stdio: 'pipe' });
    return [true, undefined];
  } catch (error) {
    return [false, _.get(error, 'message')];
  }
}
