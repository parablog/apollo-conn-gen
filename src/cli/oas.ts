import fs from 'fs';
import { Command, OptionValues } from 'commander';
import { DEFAULT_VERSIONS } from '../versions.js';
import { generateFromSelection, promptForSelection } from './oas-helpers/index.js';
import { OasGen } from '../oas/oasGen.js';
import { BatchConfig, DirectivesConfig, OverridesConfig } from '../oas/oasContext.js';
import { RulesLoader, OpNameMapper, MapRules, Mapper } from '../oas/mapper/index.js';

const originalConsole = Object.assign(
  {
    log: console.log,
  },
  console,
);

// Every loader below stops the run on an unreadable file — carrying on would generate without it.
function loadRules(opts: OptionValues): Mapper | undefined {
  let mapper;
  if (opts.transformRules) {
    try {
      const rules = RulesLoader.fromFile(opts.transformRules);
      mapper = OpNameMapper.fromRules(rules);
    } catch (error) {
      console.error(`Error loading transform rules: ${error}`);
      process.exit(1);
    }
  }

  return mapper;
}

function loadOverrides(opts: OptionValues): OverridesConfig | undefined {
  if (!opts.overrides) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(opts.overrides, 'utf-8'));
  } catch (error) {
    console.error(`Error loading overrides: ${error}`);
    process.exit(1);
  }
}

function loadBatch(opts: OptionValues): BatchConfig | undefined {
  if (!opts.batch) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(opts.batch, 'utf-8'));
  } catch (error) {
    console.error(`Error loading batch file: ${error}`);
    process.exit(1);
  }
}

function loadDirectives(opts: OptionValues): DirectivesConfig | undefined {
  if (!opts.directives) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(opts.directives, 'utf-8'));
  } catch (error) {
    console.error(`Error loading directives: ${error}`);
    process.exit(1);
  }
}

async function main(sourceFile: string, opts: OptionValues): Promise<void> {
  console.log = () => {};

  const mapper = loadRules(opts);
  const overrides = loadOverrides(opts);
  const batch = loadBatch(opts);
  const directives = loadDirectives(opts);

  const gen = await OasGen.fromFile(sourceFile, {
    ...opts,
    baseURL: opts.baseUrl,
    overrides,
    batch,
    directives,
    showParentInSelections: false,
    federationVersion: opts.federationVersion,
    connectorSpecVersion: opts.connectorSpecVersion,
    mapper: mapper,
    skipOptionalArgs: opts.skipOptionalArgs,
    inferEntityResolvers: opts.inferEntityResolvers,
    skipAuth: opts.skipAuth,
  });

  await gen.visit();

  let pathSet = Array.from(gen.paths.values());
  if (opts.loadSelections) {
    generateFromSelection(opts, gen);
    return;
  }

  if (opts.grep !== '*') {
    // no `g` flag: a global regex keeps lastIndex across .test() calls, silently skipping
    // the path right after every match (petstore: post:/pet/{petId} vanished from --grep "{\w+}$")
    const regex = new RegExp(opts.grep, 'i');
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

  if (opts.verbose) console = originalConsole;

  console.info(gen.generateSchema(paths));

  if (opts.printSelections) {
    console.info('# --------------- Selections -----------------');
    console.info(gen.selections);
    console.info('# --------------- Paths -----------------');
    console.info('paths =', JSON.stringify(paths, null, 2));
  }
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
  .option('-v --verbose', 'Log all messages from generator')
  .option('-m --print-selections', 'Print selections from generator')
  .option('-t --transform-rules <file>', 'Load transform rules from a JSON file to apply multiple name transformations')
  .option('--federation-version <version>', 'Federation version to use', DEFAULT_VERSIONS.federationVersion)
  .option('--connector-spec-version <version>', 'Connector spec version to use', DEFAULT_VERSIONS.connectorSpecVersion)
  .option('--base-url <url>', 'Override the @source base URL (default: servers[0] from the spec)')
  .option('--overrides <file>', 'Load per-operation path/queryParams overrides from a JSON file')
  .option('--batch <file>', 'Load batch endpoints (op id -> { maxSize? }) from a JSON file')
  .option('--directives <file>', 'Load directives (Type or Type.field -> ["@…"]) from a JSON file')
  .option('--skip-optional-args', 'Skip optional arguments in queries', false)
  .option('--infer-entity-resolvers', 'Infer entity resolvers and emit @key / entity: true', false)
  .option('--skip-auth', 'Omit all auth (no headers on @source, no auth on @connect)', false)
  .parse(process.argv);

const source = program.args[0];
main(source, program.opts()).then(() => console.log('done'));
