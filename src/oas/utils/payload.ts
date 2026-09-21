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

// The response fields the overrides file already reads through isSuccess and errors, taken from every
// `$.name` in those settings. They are never written on a type that returns one data field instead of
// the whole response.
//   e.g. (ashby-overrides.json) "isSuccess": "$.success", "errors": { "message": "$($.errors?->first?.message ?? '…')" } -> success, errors
export function envelopeFields(opId: string, overrides: OverridesConfig | undefined): Set<string> {
  const source = overrides?.$source;
  const opErrors = findOverride(opId, overrides)?.errors;
  const expressions = [
    source?.isSuccess,
    source?.errors?.message,
    source?.errors?.extensions,
    opErrors?.message,
    opErrors?.extensions,
  ];

  const names = new Set<string>();
  for (const expression of expressions) {
    if (!expression) {
      continue;
    }
    for (const match of expression.matchAll(/\$\.(\w+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

// The response objects the returned field can sit on: the response itself, or each member when it is
// a merged oneOf. Visits them first, since an object has no properties until it is visited.
//   e.g. (ashby) oneOf [{ success: true, results: Job }, { success: false, errors: [...] }] -> both members
export function responseObjects(context: OasContext, op: IType & Op): Obj[] {
  const result = op.resultType instanceof Res ? op.resultType : undefined;
  result?.visit(context);
  const response = result?.response;
  response?.visit(context);
  const holders = response instanceof Union && response.isFlat() ? response.children : [response];
  return holders.filter((holder): holder is Obj => holder instanceof Obj);
}

// The property the overrides name, on the response object or on one member of a merged oneOf.
// Undefined when no field is configured or the response has no such property.
//   e.g. Ashby: oneOf [{ success: true, results: Job }, { success: false, errors: [...] }] -> results
export function findConfiguredPayload(context: OasContext, op: IType & Op): Prop | undefined {
  const field = payloadField(op.id, context.generateOptions.overrides);
  if (!field) {
    return undefined;
  }

  const found = responseObjects(context, op)
    .map((holder) => holder.props.get(field))
    .filter((prop): prop is Prop => prop !== undefined);
  return found.length === 1 ? found[0] : undefined;
}

// The field the op returns instead of the whole response, or undefined when the response has other data
// fields beside it that would be lost. Fields isSuccess and errors already read do not count as data.
//   e.g. (ashby) job.info { success, results } -> results; application.list { success, results, nextCursor } -> undefined
export function findPayload(context: OasContext, op: IType & Op): Prop | undefined {
  const prop = findConfiguredPayload(context, op);
  if (!prop) {
    return undefined;
  }
  const envelope = envelopeFields(op.id, context.generateOptions.overrides);
  const holder = responseObjects(context, op).find((candidate) => candidate.props.get(prop.name) === prop);
  const keepsResponse = Array.from(holder?.props.keys() ?? []).some(
    (name) => name !== prop.name && !envelope.has(name),
  );
  return keepsResponse ? undefined : prop;
}

// What isEnvelopeNode checks against, built once per op by envelopeContext.
export type EnvelopeContext = { names: Set<string>; objects: Obj[]; hasPayload: boolean };

// The three things needed to tell an op's success/errors fields apart from its data fields, read once
// per op: which field names the overrides file's isSuccess and errors settings mention, which response
// objects carry them, and whether the overrides file names a field to return in place of the response.
//   e.g. (ashby-overrides.json) "$source": { "isSuccess": "$.success", "payload": "results" } -> success
export function envelopeContext(context: OasContext, op: IType & Op): EnvelopeContext {
  return {
    names: envelopeFields(op.id, context.generateOptions.overrides),
    objects: responseObjects(context, op),
    hasPayload: findConfiguredPayload(context, op) !== undefined,
  };
}

// True for a field the overrides file already handles through isSuccess or errors, and for anything
// inside it (ErrorDetail.message); these stay out of the written type and its selection. Answers
// false for every field when the overrides file names no field to return.
//   e.g. (ashby) ApplicationListSuccessResponse: { success, results, nextCursor } -> success: true, nextCursor: false
export function isEnvelopeNode(node: IType, op: IType & Op, envelope: EnvelopeContext): boolean {
  if (!envelope.hasPayload) {
    return false;
  }

  let current: IType | undefined = node;
  while (current && current !== (op as IType)) {
    if (
      current instanceof Prop &&
      envelope.names.has(current.name) &&
      envelope.objects.includes(current.parent as Obj)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}
