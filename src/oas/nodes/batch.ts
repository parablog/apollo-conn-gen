import { Arr, IType, Obj, Op, PropArray, Res, T } from './internal.js';
import { OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Params } from '../utils/params.js';
import { warn } from '../log/trace.js';

// default batch size cap — OAS gives no signal for it, so emit one and let the user edit it.
const DEFAULT_MAX_SIZE = 100;

/** the entity a batch op returns, plus the wrapper key when the response array is wrapped. */
interface BatchTarget {
  obj: Obj;
  wrapperKey?: string;
}

/** the derived $batch request mapping — exactly one of queryParams / body. */
interface BatchRequest {
  queryParams?: string;
  body?: string;
}

/**
 * R6: turn the `--batch` file (op id -> { maxSize? }) into batch `@connect` resolvers.
 *
 * A batch resolver is the R1 resolver with `$batch` in place of `$this`: same `@key`, same
 * selection, but the keys come from the batch endpoint's array input. Everything is read off the
 * op's node graph (result/params/body) — so the batch endpoint must be in the selection, just like
 * R1's by-id endpoint — plus the entity's R1 key; only `maxSize` is a knob. Runs after
 * `inferEntityResolvers`; anything it can't infer cleanly is skipped with a warning, never guessed.
 */
export function applyBatchResolvers(context: OasContext, gen: OasGen, types: Map<string, IType>): void {
  const batch = context.generateOptions.batch;
  if (!batch) {
    return;
  }

  for (const [opId, entry] of Object.entries(batch)) {
    const skip = (why: string) => warn(context, '[batch]', `${opId}: ${why} — skipped`);

    const op = gen.paths.get(opId);
    if (!op || !T.isOp(op)) {
      skip('no matching operation');
      continue;
    }
    // like R1, we read the op's node graph — so it must be in the selection (already expanded)
    if (!op.resultType) {
      skip('add the batch endpoint to the selected paths');
      continue;
    }

    // the entity = the response array's item, e.g. `[Product]` or `{ results: [Product] }`
    const item = responseItem(op);
    if (!item) {
      skip('response is not an array of objects');
      continue;
    }
    // the canonical entity is the same instance R1 keyed (same id, collected from the by-id endpoint)
    const entity = types.get(item.obj.id);
    if (!(entity instanceof Obj)) {
      skip(`${item.obj.name} is not in the selection — select its by-id endpoint too`);
      continue;
    }
    // reuse the entity's single $this resolver — that's the one carrying the @key, never invented
    const keyResolver = entity.entityResolvers.find((resolver) => !resolver.batch);
    if (!keyResolver) {
      skip(`${entity.name} has no @key — run with --infer-entity-resolvers`);
      continue;
    }
    if (keyResolver.keyFields.includes(' ')) {
      skip('composite keys not supported yet');
      continue;
    }
    // a path param (e.g. /stores/{id}/batch) has no $batch value to fill it
    if (op.params.some((p) => p.parameter.in?.toLowerCase() === 'path')) {
      skip('endpoint has path params');
      continue;
    }
    const request = batchRequest(op, keyResolver.keyFields);
    if (!request) {
      skip('expected exactly one scalar-array input for the keys');
      continue;
    }

    entity.entityResolvers.push({
      keyFields: keyResolver.keyFields,
      path: op.operation.path,
      verb: op.verb,
      source: keyResolver.source,
      batch: { ...request, wrapperKey: item.wrapperKey, maxSize: entry?.maxSize ?? DEFAULT_MAX_SIZE },
    });
  }
}

// the response array's item object: `[Product]` -> Product; `{ results: [Product] }` -> Product + "results".
// reads the same result-type node graph as inferEntityResolvers / promoteInterfaces.
function responseItem(op: IType & Op): BatchTarget | null {
  let node: IType | undefined = op.resultType;
  if (node instanceof Res) {
    node = node.response;
  }
  if (node instanceof Arr) {
    return node.itemsType instanceof Obj ? { obj: node.itemsType } : null;
  }
  if (node instanceof Obj) {
    const arrays = Array.from(node.props.values()).filter((p) => p instanceof PropArray);
    if (arrays.length === 1 && arrays[0].items instanceof Obj) {
      return { obj: arrays[0].items, wrapperKey: arrays[0].name };
    }
  }
  return null;
}

// where the endpoint takes the keys -> the $batch request mapping. exactly one scalar-array input:
//   ?id=1&id=2        -> queryParams: "id: $batch.id"   (+ ->joinNotNull(",") when comma-packed)
//   { "ids": [1, 2] } -> body: "ids: $batch.id"
function batchRequest(op: IType & Op, key: string): BatchRequest | null {
  const queries = op.params.filter((p) => p.parameter.in?.toLowerCase() === 'query' && T.isScalarArray(p.resultType));

  // a named body array of scalars: `{ ids: [...] }`
  const payload = op.body?.payload;
  const bodyArrays =
    payload instanceof Obj
      ? Array.from(payload.props.values()).filter((p): p is PropArray => p instanceof PropArray && T.isLeaf(p))
      : [];

  if (queries.length + bodyArrays.length !== 1) {
    return null; // 0 = none found, >1 = ambiguous
  }
  if (queries.length === 1) {
    return { queryParams: `${queries[0].name}: $batch.${key}${Params.arrayJoin(queries[0].parameter)}` };
  }
  return { body: `${bodyArrays[0].name}: $batch.${key}` };
}
