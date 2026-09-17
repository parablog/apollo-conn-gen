import { IType, Obj, Op, Prop, Res, Union } from '../nodes/internal.js';
import { OasContext, OverridesConfig } from '../oasContext.js';
import { findOverride } from './overrides.js';

// The field an op's root field returns instead of the whole response, from the overrides file:
// the op's own entry first, then the "$source" default. `payload: null` on an op keeps the response.
//   e.g. { "$source": { "payload": "results" }, "post:/job.info": { "payload": null } }
export function payloadField(opId: string, overrides: OverridesConfig | undefined): string | undefined {
  const entry = findOverride(opId, overrides);
  return entry && 'payload' in entry ? (entry.payload ?? undefined) : overrides?.$source?.payload;
}

// The property named by payloadField, on the response object or on one member of a merged oneOf.
// Undefined when no field is configured or the response has no such property.
//   e.g. Ashby: oneOf [{ success: true, results: Job }, { success: false, errors: [...] }] -> results
export function findPayload(context: OasContext, op: IType & Op): Prop | undefined {
  const field = payloadField(op.id, context.generateOptions.overrides);
  const response = op.resultType instanceof Res ? op.resultType.response : undefined;
  if (!field || !response) {
    return undefined;
  }

  const holders = response instanceof Union && response.isFlat() ? response.children : [response];
  const found = holders
    .filter((holder): holder is Obj => holder instanceof Obj)
    .map((holder) => holder.props.get(field))
    .filter((prop): prop is Prop => prop !== undefined);
  return found.length === 1 ? found[0] : undefined;
}
