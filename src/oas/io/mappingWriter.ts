import _ from 'lodash';
import { OasContext } from '../oasContext.js';
import { Writer } from './writer.js';
import { Composed, IType, Obj, Prop, T } from '../nodes/internal.js';
import { Naming } from '../utils/naming.js';

// R10: writes the two halves of a reusable @mapping — the directive on the type line, and the
// call a selection line makes into it. Free functions, like the R1/R6 passes.
// e.g. (petstore) `type Category @mapping {` and `category: category->Category`

// the column @mapping bodies start at, matching the connect v0.5 reference shape
const BODY_COLUMN = 2;

// Writes ` @mapping` (bare) or ` @mapping(selection: """…""")` after the type name.
// e.g. (petstore) all-scalar `Tag` stays bare; `Pet` carries `category: category->Category`
export function writeMappingDirective(type: Obj | Composed, context: OasContext, writer: Writer, selection: string[]): void {
  if (!context.generateOptions.reusableMappings || type.kind === 'input') {
    return;
  }
  if (type instanceof Obj && type.emitAsInterface) {
    return;
  }

  const body = writer.capture(() => {
    const saved = context.indent;
    // select indents by context.indent + stack.length, and this type is on the stack — offset
    // so the body lines land at BODY_COLUMN
    context.indent = BODY_COLUMN - context.stack.length;
    type.select(context, writer, selection);
    context.indent = saved;
  });

  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return;
  }

  const selected = type.selectedProps(selection);
  const fields = selected.map((prop) => Naming.sanitiseField(prop.name));
  // The bare form works at runtime, but compose-time expansion loses nested fields and rejects
  // the result — a type with any object/interface/union field takes the explicit form.
  // see R10_STATUS.md "Why autoMap gained a guard"
  const autoMap = bodyMatchesFieldNames(lines, fields) && !selected.some((prop) => T.isObjectTypedProp(prop));

  if (autoMap) {
    writer.write(' @mapping');
  } else {
    // close at the body's column so the directive reads as one aligned block, like @connect
    writer.write(' @mapping(selection: """\n').write(body).write('  """)');
  }
}

// Writes the field's call into its child's @mapping and answers true; false means the caller
// writes the field inline as usual. A call that would close a loop also renders inline.
// e.g. (petstore) `category: category->Category`
export function writeMappingCall(
  prop: Prop,
  child: IType | undefined,
  sanitised: string,
  context: OasContext,
  writer: Writer,
  selection: string[],
  writeInline: () => void,
): boolean {
  if (!context.generateOptions.reusableMappings || context.inlineFallbackDepth !== 0) {
    return false;
  }
  const callName = T.mappingCallName(child, selection);
  if (!callName) {
    return false;
  }
  if (T.isInlinedBackEdge(prop, callName, context, selection)) {
    context.inlineFallbackDepth++;
    try {
      writeInline();
    } finally {
      context.inlineFallbackDepth--;
    }
  } else {
    writer.write(callSuffix(sanitised, callName)).write('\n');
  }
  return true;
}

// A plain field repeats its own name; a field that already carries an alias just gets the arrow.
// e.g. (response-allof-snake-path) `billingHistory: billing_history->BillingHistoryItem`
function callSuffix(sanitised: string, callName: string): string {
  return isAliased(sanitised) ? `->${callName}` : `: ${sanitised}->${callName}`;
}

function isAliased(sanitised: string): boolean {
  return sanitised.includes(': ');
}

// the body is nothing but the SDL field names, in order — the shape bare @mapping stands for
function bodyMatchesFieldNames(lines: string[], fields: string[]): boolean {
  return lines.length === fields.length && lines.every((line, i) => line === fields[i]);
}
