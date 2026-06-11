import fs from 'fs';
import { DEFAULT_VERSIONS } from '../versions.js';
import { JsonGen } from '../json/index.js';

import { Command } from 'commander';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- for options
async function main(fileOrFolder: string, opts: any): Promise<void> {
  console.log = () => {};

  if (!fs.existsSync(fileOrFolder)) {
    console.error(`File or folder not found: ${fileOrFolder}`);
    return;
  }

  if (opts.reusableMappings) {
    throw new Error('reusable @mapping (--reusable-mappings) is not supported for JSON generation yet');
  }

  const jsonOptions = {
    federationVersion: opts.federationVersion,
    connectorSpecVersion: opts.connectorSpecVersion,
    rootType: opts.rootType,
    baseURL: opts.baseUrl,
    relativePath: opts.relativePath,
    queryField: opts.queryField,
    verbose: opts.verbose,
  };

  // generator
  let gen: JsonGen;

  // if it is a file
  if (fs.lstatSync(fileOrFolder).isFile()) {
    // read contents
    const contents = fs.readFileSync(fileOrFolder, 'utf-8');
    gen = JsonGen.fromReader(contents, jsonOptions);
  } else {
    // iterate through the files found in the target folder and load all the contents
    gen = JsonGen.new(jsonOptions);
    fs.readdirSync(fileOrFolder).forEach((file) => {
      const contents = fs.readFileSync(fileOrFolder + '/' + file, 'utf-8');
      gen.walkJson(contents);
    });
  }

  let generated;
  if (opts.schemaTypes) {
    generated = gen.writeTypes();
  } else if (opts.selectionSet) {
    generated = gen.writeSelection();
  } else {
    generated = gen.generateSchema();
  }

  if (opts.outputFile !== 'stdout') {
    fs.writeFileSync(opts.outputFile, generated);
  } else {
    console.info(generated);
  }
}

const program = new Command();
program
  .version('0.0.1')
  .argument('<file|folder>', 'A single JSON file or a folder with a collection of JSON files')
  .option('-s --schema-types', 'Output the GraphQL schema types', false)
  .option('-e --selection-set', 'Output the Apollo Connector selection set', false)
  .option('-o --output-file <file>', 'Where to write the output', 'stdout')
  .option('--federation-version <version>', 'Federation version to use', DEFAULT_VERSIONS.federationVersion)
  .option('--connector-spec-version <version>', 'Connector spec version to use', DEFAULT_VERSIONS.connectorSpecVersion)
  .option('--reusable-mappings', 'Not supported for JSON generation (OAS only)', false)
  .option('--root-type <name>', 'Root type name, use [Name] for list (default: Root)')
  .option('--base-url <url>', 'Base URL for the @source directive (default: http://localhost:4010)')
  .option('--relative-path <path>', 'Relative path for the @connect directive (default: /test)')
  .option('--query-field <name>', 'Query field name (default: derived from root type)')
  .option('-v --verbose', 'Log all messages from generator', false)
  .parse(process.argv);

const source = program.args[0];
main(source, program.opts()).then(() => console.log('done'));
