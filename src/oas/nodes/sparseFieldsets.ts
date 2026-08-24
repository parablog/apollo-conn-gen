import { Arr, IType, Obj, Op, PropArray, Res, Scalar, T } from './internal.js';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { warn } from '../log/trace.js';

// #151: some REST APIs only send back a few fields unless a query parameter (often `fields`)
// widens the request. GET /products/{id} -> { id }, but ?fields=id,name,price -> { id, name, price }.
// A caller who selects `name` in GraphQL but never sends `fields` gets a `null` that looks empty.
export function applySparseFieldsets(context: OasContext, gen: OasGen, selection: string[]): void {
  const paramName = context.generateOptions.sparseFieldsetsParam;
  if (!paramName) {
    return;
  }

  for (const op of gen.paths.values()) {
    // fields= is a read-time convention, so a write op is skipped even with a same-named param.
    if (!T.isOp(op) || !T.isQueryType(op, context)) {
      continue;
    }

    const param = op.params.find((p) => p.parameter.in?.toLowerCase() === 'query' && p.name === paramName);
    if (!param) {
      continue;
    }

    const skip = (why: string) => warn(context, '[sparse-fieldsets]', `${op.id}: ${why} — skipped`);

    // an OAS-authored default (e.g. fields: { default: "id,name" }) is a deliberate choice, kept as-is
    if (param.defaultValue !== null && param.defaultValue !== undefined) {
      continue;
    }

    // an array param (fields: { type: array }) reads as GraphQL [String], which has no
    // comma-string default syntax -> writing one would emit invalid SDL ([String] = "a,b,c")
    if (!(param.resultType instanceof Scalar) || param.resultType.name !== 'String') {
      skip(`"${paramName}" is not a plain string parameter`);
      continue;
    }

    const obj = unwrapResponseObj(op);
    if (!obj) {
      skip('response is not an object or a list of objects');
      continue;
    }

    // Prop.name is the raw OAS wire name, e.g. "id" -- what the REST API's own fields= expects
    const fields = obj
      .selectedProps(selection)
      .map((prop) => prop.name)
      .sort();
    if (fields.length === 0) {
      skip('selection maps no fields');
      continue;
    }

    param.defaultValue = fields.join(',');
  }
}

// Unwraps an op's response down to the object whose field names become the default value.
// GET /products/{id} -> Product itself; GET /products -> [Product] or { results: [Product] } both
// use Product (the array's item), since one selection is written and reused per item.
function unwrapResponseObj(op: IType & Op): Obj | null {
  let node: IType | undefined = op.resultType;
  if (node instanceof Res) {
    node = node.response;
  }
  if (node instanceof Arr) {
    return node.itemsType instanceof Obj ? node.itemsType : null;
  }
  if (node instanceof Obj) {
    const arrays = Array.from(node.props.values()).filter((p) => p instanceof PropArray);
    if (arrays.length === 1 && arrays[0].items instanceof Obj) {
      return arrays[0].items;
    }
    return node;
  }
  return null;
}
