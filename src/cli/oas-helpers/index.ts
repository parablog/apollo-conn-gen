/// internal functions
import fs from 'fs';
import { IType, Type } from '../../oas/nodes/index.js';
import { Composed } from '../../oas/nodes/index.js';
import { Union } from '../../oas/nodes/index.js';
import { Ref } from '../../oas/nodes/index.js';
import { typesPrompt } from '../../oas/prompts/prompt.js';
import { OasGen } from '../../oas/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateFromSelection(opts: any, gen: OasGen) {
  const selections = JSON.parse(fs.readFileSync(opts.loadSelections, { encoding: 'utf-8' }));
  if (!Array.isArray(selections)) {
    console.error('Invalid selections file');
    return;
  }

  console.info('--------------- Apollo Connector schema -----------------');
  console.info(gen.generateSchema(selections));
  return;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function promptForSelection(gen: OasGen, opts: any, types: IType[]) {
  function expandType(type?: IType) {
    if (!type) {
      return types;
    }

    let result: IType[];

    if (type instanceof Composed || type instanceof Union) {
      // make sure we gather all the props
      (type as Composed | Union).consolidate([]);

      result = Array.from(type.props.values());
    } else {
      // top level paths
      result = gen.expand(type);

      if (result.length === 1) {
        // we are checking for a ref so we can go straight to where its pointing
        const child = result[0];

        if (!(child as Type).visited) {
          child.visit(gen.context!);
        }

        if (child instanceof Ref) {
          result = [child.refType!];
        }
      }
    }

    return result;
  }

  return typesPrompt({
    context: gen.context!,
    expandFn: expandType,
    message: 'Navigate spec and select the fields to use in the connector',
    pageSize: parseInt(opts.pageSize, 10),
    types: types,
  });
}
