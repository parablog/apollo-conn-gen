import { JsonGen, OasGen } from '../index.js';
import { JsonContext, JsonType } from '../json/index.js';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execSync, spawnSync } from 'child_process';
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
): Promise<string | undefined> {
  const gen = await OasGen.fromFile(`${oasBasePath}/${file}`, {
    skipValidation,
    consolidateUnions: false,
    showParentInSelections: false,
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

  const schemaFile = path.join(os.tmpdir(), file.replace(/yaml|json|yml/, 'graphql'));
  fs.writeFileSync(schemaFile, schema, { encoding: 'utf-8', flag: 'w' });

  // need to write another graphql file but this only with a sample query otherwise composition
  // will fail for mutations
  const sampleFile = path.join(os.tmpdir(), 'simple-query.graphql');
  if (!fs.existsSync(sampleFile)) {
    fs.writeFileSync(sampleFile, 'type Query { hello: String }', { encoding: 'utf-8', flag: 'w' });
  }

  const [result, output] = compose(schemaFile, sampleFile);
  if (shouldFail) {
    assert.ok(!result);
    assert.ok(output !== undefined);
    return output as unknown as string | undefined;
  } else {
    assert.ok(output === undefined, 'should have been undefined, but it is: ' + output);
    assert.ok(result);
    console.error(schema);
  }
}

interface IJsonTestOptions {
  shouldFail: boolean;
  outputContains?: string;
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
    walker = JsonGen.new();

    const sources = fs.readdirSync(fileOrFolderPath).filter((name) => name.toLowerCase().endsWith('.json'));

    for (const source of sources) {
      const fullPath = path.join(fileOrFolderPath, source);
      const json = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(json !== undefined);

      walker.walkJson(json);
    }
  } else {
    const json = fs.readFileSync(fileOrFolderPath, 'utf-8');
    assert.ok(json !== undefined);

    walker = JsonGen.fromReader(json);
  }

  const context: JsonContext = walker.getContext();

  const types: JsonType[] = context.getTypes();
  assert.ok(types.length > 0);

  const schema = walker.generateSchema();
  assert.ok(schema !== undefined);

  const schemaFile = path.join(os.tmpdir() + '/walker', fileOrFolder.replace(/\.yaml|\.json|\.yml/, '') + '.graphql');

  // Ensure the directory exists
  // fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
  const parentFolder = path.dirname(schemaFile);
  if (!fs.existsSync(parentFolder)) {
    fs.mkdirSync(parentFolder, { recursive: true });
  }

  if (fs.existsSync(schemaFile)) {
    fs.unlinkSync(schemaFile);
  }

  fs.writeFileSync(schemaFile, schema, { encoding: 'utf-8', flag: 'w' });

  const [result, output] = compose(schemaFile);

  if (options.shouldFail) {
    assert.ok(result === false);
    assert.ok(output !== undefined);
    return output as unknown as string | undefined;
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

function compose(schemaPath: string, samplePath?: string) {
  console.info('schemaPath', schemaPath);

  const rover: [boolean, (string | undefined)?] = isRoverAvailable('rover');
  if (!rover[0]) {
    throw new Error('Rover is not available');
  }

  const supergraphFile = path.join(os.tmpdir(), 'supergraph.yaml');
  let content: string = `
federation_version: =2.10.0
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

  const cmd = `${rover[1]} supergraph compose --config ${supergraphFile} --elv2-license accept`;

  let output;
  try {
    output = execSync(cmd, { stdio: 'pipe' });
    return [true, undefined];
  } catch (error) {
    return [false, _.get(error, 'message')];
  }
}
