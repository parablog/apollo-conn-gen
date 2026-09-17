import _ from 'lodash';
import { ResponseObject, SchemaObject } from 'oas/types';
import { ErrorsMapping, OasContext } from '../oasContext.js';
import { OasGen } from '../oasGen.js';
import { Op } from '../nodes/internal.js';
import { Media } from '../utils/media.js';
import { quotedOrBlockString, quotedString } from '../utils/gql.js';
import { findOverride } from '../utils/overrides.js';
import { Writer } from './writer.js';

// The `errors:` block of a connector: an operation's own mapping from the overrides file when it
// names one, otherwise (R4, opt-in) `message` inferred from the documented error body plus `$status`.
//   e.g. (ashby) post:/customFields.fetch with { "errors": { "message": "$.errorInfo.message" } }
export class ErrorsWriter {
  // corpus-measured priority for the error-body message field: `message` (755 error schemas),
  // `error` (362), `detail` (7)
  private static readonly MESSAGE_FIELDS = ['message', 'error', 'detail'];

  constructor(private gen: OasGen) {}

  // Writes the errors block: the operation's own mapping when its override entry names one, else
  // the inferred R4 block for operations that document HTTP error responses.
  //   e.g. (ashby) post:/customFields.fetch with { "errors": { "message": "$.errorInfo.message" } }
  public write(context: OasContext, writer: Writer, op: Op, indent: number): void {
    const mapping = findOverride(op.id, context.generateOptions.overrides)?.errors;
    if (mapping?.message || mapping?.extensions) {
      this.writeMapping(writer, mapping, indent);
      return;
    }

    if (!context.generateOptions?.emitConnectorErrors || !this.hasDocumentedErrors(op)) {
      return;
    }

    // `message: "$.message"` — the path form yields the field's VALUE; a bare `message`
    // selection would build the object `{message: …}`, which errors.message rejects. R4
    const message = this.errorMessageField(context, op);

    // fully expanded: `errors {` and `}` at the @connect arg level, message/extensions/body/closing
    // one level deeper (8 spaces) so the body and the closing `"""` line up.
    const labelSpacing = ' '.repeat(indent + 6);
    const innerSpacing = ' '.repeat(indent + 8);
    writer.write(labelSpacing).write('errors: {\n');
    if (message) {
      writer.write(innerSpacing).write(`message: "$.${message}"\n`);
    }
    writer
      .write(innerSpacing)
      .write('extensions: """\n')
      .write(innerSpacing)
      .write('statusCode: $status\n')
      .write(innerSpacing)
      .write('"""\n')
      .write(labelSpacing)
      .write('}\n');
  }

  // Writes the file's own errors mapping for one operation, one line at the @connect arg level.
  //   e.g. (ashby) { message: "$.errorInfo.message" } -> errors: { message: "$.errorInfo.message" }
  private writeMapping(writer: Writer, mapping: ErrorsMapping, indent: number): void {
    const labelSpacing = ' '.repeat(indent + 6);
    writer.write(labelSpacing).write('errors: {');
    if (mapping.message) {
      writer.write(` message: ${quotedString(mapping.message)}`);
    }
    if (mapping.extensions) {
      writer.write(` extensions: ${quotedOrBlockString(mapping.extensions)}`);
    }
    writer.write(' }\n');
  }

  // True when the operation documents an HTTP error response. Accepts both concrete numeric statuses
  // (4xx/5xx) and the OAS range keys `4XX`/`5XX` (case-insensitive). The `default` key is excluded —
  // it also covers 2xx/3xx, so it is not specifically an error indicator.
  private hasDocumentedErrors(op: Op): boolean {
    return op.operation.getResponseStatusCodes().some((code: string) => /^[45](\d\d|XX)$/i.test(code));
  }

  // the field must be a string on EVERY documented JSON error shape — a field missing on some
  // status would yield a null message there. Non-JSON / shapeless error responses don't veto.
  private errorMessageField(context: OasContext, op: Op): string | undefined {
    const responses = op.operation.schema.responses ?? {};
    const errorShapes: Array<Record<string, unknown>> = [];

    for (const [code, response] of Object.entries(responses)) {
      if (!/^[45](\d\d|XX)$/i.test(code)) {
        continue;
      }
      const resolved = this.deref(context, response) as ResponseObject | null;
      const mediaKey = Media.findJsonMediaType(Object.keys(resolved?.content ?? {}));
      const schema = mediaKey
        ? (this.deref(context, resolved!.content![mediaKey].schema) as SchemaObject | null)
        : null;
      if (schema?.properties) {
        errorShapes.push(schema.properties);
      }
    }

    if (errorShapes.length === 0) {
      return undefined;
    }
    return ErrorsWriter.MESSAGE_FIELDS.find((field) =>
      errorShapes.every((props) => (this.deref(context, props[field]) as SchemaObject | null)?.type === 'string'),
    );
  }

  // read-only $ref hop — resolvePointer, NOT lookupRef: this sniff must not bump refCount
  private deref(context: OasContext, node: unknown): unknown {
    return _.has(node, '$ref') ? context.resolvePointer(_.get(node, '$ref') as string) : node;
  }
}
