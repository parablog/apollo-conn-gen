import fs from 'fs';
import { JsonGen } from '../json/index.js';

// // mute console.log
// console.log = () => {};

// function walkSourceFile(source: string): void {
//   const fileContent = fs.readFileSync(source, 'utf-8');

//   const walker = JsonGen.fromReader(fileContent);
//   console.info(walker.generateSchema());
// }

// async function main() {
//   walkSourceFile(
//     '/Users/fernando/Development/Apollo/connectors/projects/JsonToConnector/src/test/resources/preferences/user/50.json',
//   );
// }

// main().then(() => console.log('done'));

import { Command } from 'commander';

// const originalConsole = {
//   log: console.log,
// };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- for options
async function main(fileOrFolder: string, opts: any): Promise<void> {
  console.log = () => {};

  if (!fs.existsSync(fileOrFolder)) {
    console.error(`File or folder not found: ${fileOrFolder}`);
    return;
  }

  // generator
  let gen: JsonGen;

  // if it is a file
  if (fs.lstatSync(fileOrFolder).isFile()) {
    // read contents
    const contents = fs.readFileSync(fileOrFolder, 'utf-8');
    gen = JsonGen.fromReader(contents);
  } else {
    // iterate through the files found in the target folder and load all the contents
    gen = JsonGen.new();
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
  .parse(process.argv);

const source = program.args[0];
main(source, program.opts()).then(() => console.log('done'));
