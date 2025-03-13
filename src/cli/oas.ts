import { Command } from 'commander';
import { generateFromSelection, promptForSelection } from './oas-helpers/index.js';
import { OasGen } from '../oas/index.js';

const originalConsole = {
  log: console.log,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- for options
async function main(sourceFile: string, opts: any): Promise<void> {
  console.log = () => {};

  const gen = await OasGen.fromFile(sourceFile, opts);
  await gen.visit();

  let pathSet = Array.from(gen.paths.values());
  if (opts.loadSelections) {
    generateFromSelection(opts, gen);
    return;
  }

  if (opts.grep !== '*') {
    const regex = new RegExp(opts.grep, 'ig');
    pathSet = pathSet.filter((p) => regex.test(p.path()));
  }

  if (opts.listPaths) {
    pathSet.forEach((path) => console.info(path.path()));
    return;
  }

  let paths: string[];
  if (opts.skipSelection) {
    paths = pathSet.map((p) => p.path() + '>**');
  } else {
    paths = await promptForSelection(gen, opts, pathSet);
  }

  console.info('selected :=', JSON.stringify(paths, null, 2));
  console.info('--------------- Apollo Connector schema -----------------');
  console.info(gen.generateSchema(paths));
}

const program = new Command();
program
  .version('0.0.1')
  .argument('<source>', 'source spec (yaml or json)')
  .option('-i --skip-validation', 'Skip validation step', false)
  .option('-n --skip-selection', 'Generate all [filtered] paths without prompting for a selection', false)
  .option('-l --list-paths', 'Only list the paths that can be generated', false)
  .option('-g --grep <regex>', 'Filter the list of paths with the passed expression', '*')
  .option('-p --page-size <num>', 'Number of rows to display in selection mode', '10')
  .option('-s --load-selections <file>', 'Load a JSON file with field selections (other options are ignored)')
  .parse(process.argv);

const source = program.args[0];
main(source, program.opts()).then(() => console.log('done'));
