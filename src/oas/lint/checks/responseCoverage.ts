import type { ResponseObject, SchemaObject } from 'oas/types';
import type { OasGen } from '../../oasGen.js';
import type { OasContext } from '../../oasContext.js';
import type { LintDiagnostic, NamedSpan, ParsedSchema, SelectedField, Selection } from '../types.js';
import { Get, ReferenceObject } from '../../nodes/internal.js';
import { Media } from '../../utils/media.js';
import { SelectedFields } from '../selectedFields.js';
import _ from 'lodash';

/**
 * Compares a spec's own response schema against the connector selection generated for it, so a
 * spec that describes real fields but ends up with an empty selection is caught.
 *
 * The bug this exists for (#175, docusign): a response declared a real object —
 *   200: { serviceInformation: { buildVersion, linkedSites, ... } }
 * — but every field of it was lost during generation, so the connector selected nothing from the
 * response at all and the generator quietly fell back to its "nothing to select" shape:
 *   type ServiceInformationResponse { success: Boolean }
 *   serviceInformation: ServiceInformationResponse @connect(... selection: "success: $(true)")
 * That shape is legitimate exactly when the spec truly has no response schema. This check reads
 * the spec's own response document (not the generated GraphQL type — that would just agree with
 * itself) and complains when the spec offered fields the selection never asked for.
 *
 * Not one of the CHECKS in index.ts: it needs the raw SDL text to read the cycle-cut comments
 * (`# label: circular reference omitted (...)`), and it is only meaningful when the selection was
 * written to take everything under an operation, which is true of the corpus sweep in
 * tools/lint-corpus.mts but not of a hand-written selection in the schema editor.
 * see docs/FIXED.md #176
 */
export class ResponseCoverageCheck {
  public static run(sdl: string, schema: ParsedSchema, gen: OasGen): LintDiagnostic[] {
    const found: LintDiagnostic[] = [];
    for (const selection of schema.selections) {
      if (selection.directive !== 'connect' || !selection.operationKey) {
        continue;
      }
      const operation = gen.paths.get(selection.operationKey);
      if (!(operation instanceof Get)) {
        continue;
      }
      const fields = SelectedFields.readable(selection.fields);
      // A bare `$` with no alias, no `->method` and no block passes the whole response through as
      // one value (a plain scalar, an enum list, or a whole-response JSON degrade — res.ts, and
      // the "unknown scalar type" fallback in factory.ts). There is no field to compare against a
      // spec key there, by design, not by loss. `$(true)` looks the same until you notice it has
      // an alias (`success: $(true)`) and this doesn't — that alias is what marks it as the #175
      // stub instead of a legitimate passthrough.
      if (ResponseCoverageCheck.isBarePassthrough(fields)) {
        continue;
      }
      const top: NamedSpan = { name: '', from: selection.from, to: selection.from };
      ResponseCoverageCheck.walk(
        gen,
        sdl,
        ResponseCoverageCheck.declared(gen, operation),
        fields,
        [selection.from, selection.to + 1],
        selection,
        true,
        top,
        found,
      );
    }
    return found;
  }

  private static isBarePassthrough(fields: SelectedField[]): boolean {
    if (fields.length !== 1) {
      return false;
    }
    const [field] = fields;
    return (
      field.outputName === undefined &&
      field.readsFrom.startsAt === 'dollar' &&
      field.readsFrom.pathParts.length === 0 &&
      field.methods.length === 0 &&
      field.nested === undefined
    );
  }

  // Walk one level of the spec's response against the selection fields read at that level, then
  // recurse into every field that opened a `{ ... }` block.
  //   e.g. (petstore) get:/pet/{petId} declares { id, name, category: { id, name }, ... } — the
  //   top-level walk checks id/name/category/..., then a second walk checks category's own id/name
  private static walk(
    gen: OasGen,
    sdl: string,
    spec: SchemaObject | undefined,
    fields: SelectedField[],
    span: [number, number],
    selection: Selection,
    isTop: boolean,
    anchor: NamedSpan,
    found: LintDiagnostic[],
  ): void {
    const props = ResponseCoverageCheck.properties(gen, spec);
    if (props.size === 0) {
      // Nothing declared at this level (no content, `properties: {}`, a map's `additionalProperties`,
      // or a `oneOf`/`anyOf`/`allOf` this check does not walk) — a selection that reads nothing here
      // is not a loss, it is the only honest answer. This is exactly what makes `success: $(true)`
      // legitimate for a spec that truly declared no response body.
      return;
    }

    const read = new Map<string, SelectedField>();
    for (const field of fields) {
      const key = ResponseCoverageCheck.readKey(field);
      if (key) {
        read.set(key, field);
      }
    }

    const ownText = ResponseCoverageCheck.blank(sdl, span, fields);
    // A field the generator cut to break a reference cycle leaves a comment behind instead of a
    // field, e.g. (recursive-cycle.yaml) `Node.parent` pointing back to `Node` itself:
    //   # parent: circular reference omitted (re-visit schema and remove the reference)
    // That key is accounted for, not lost, so it is excused rather than reported.
    const excused = new Set<string>();
    for (const match of ownText.matchAll(/# ([A-Za-z_][A-Za-z0-9_]*): circular reference omitted \(/g)) {
      excused.add(match[1]);
    }
    // Two other comments mean the generator gave up on this whole level, not just one field of it
    // (a type with every field cut, or a raw `$ref` cycle) — nothing at this level can be judged.
    if (
      /# [A-Za-z_][A-Za-z0-9_]*: circular reference omitted(?!\s\()/.test(ownText) ||
      ownText.includes("# Circular reference to '")
    ) {
      return;
    }

    const readDeclared = [...props.keys()].filter((key) => read.has(key));
    const missing = [...props.keys()].filter((key) => !read.has(key) && !excused.has(key));

    if (isTop && readDeclared.length === 0 && missing.length > 0) {
      found.push(ResponseCoverageCheck.reportNotRead(missing, selection));
    } else {
      for (const key of missing) {
        found.push(ResponseCoverageCheck.reportFieldNotRead(key, selection, anchor));
      }
    }

    for (const field of fields) {
      const key = ResponseCoverageCheck.readKey(field);
      if (key && field.nested && props.has(key)) {
        const childAnchor = field.outputName ?? { name: key, from: field.from, to: field.from };
        ResponseCoverageCheck.walk(
          gen,
          sdl,
          props.get(key),
          SelectedFields.readable(field.nested),
          [field.from, field.to + 1],
          selection,
          false,
          childAnchor,
          found,
        );
      }
    }
  }

  // The response key this field reads, e.g. `category` for `category { id name }`, `amount_off`
  // for `amountOff: amount_off`. A field with no path (`$(true)`, `$args`, `$->entries`) reads
  // nothing by key and answers undefined.
  private static readKey(field: SelectedField): string | undefined {
    return field.readsFrom.pathParts[0]?.name;
  }

  // The span's own text with every field's `[from, to)` blanked out, so what remains is only the
  // comments sitting between sibling fields at this level — nothing from inside a nested block.
  private static blank(sdl: string, span: [number, number], fields: SelectedField[]): string {
    const chars = sdl.slice(span[0], span[1]).split('');
    for (const field of fields) {
      const start = Math.max(0, field.from - span[0]);
      const end = Math.min(chars.length, field.to - span[0]);
      for (let i = start; i < end; i++) {
        chars[i] = ' ';
      }
    }
    return chars.join('');
  }

  // The response schema the operation's own success-response code actually resolves to, read from
  // the raw spec document (not from the generated type — that would only ever agree with itself).
  //   e.g. (docusign) 200 -> serviceInformation: { buildVersion, linkedSites, ... }
  private static declared(gen: OasGen, op: Get): SchemaObject | undefined {
    const context = gen.getContext();
    const responses = (op.operation.schema.responses ?? {}) as Record<string, ResponseObject | ReferenceObject>;
    const code = op.findSuccessResponseCode(context, responses);
    if (!code) {
      return undefined;
    }
    const raw = responses[code];
    const response = raw && '$ref' in raw ? context.lookupResponse(raw.$ref) : raw;
    if (!response || '$ref' in response) {
      return undefined;
    }
    const content = response.content ?? {};
    // Follow the same media-type choice the generator makes (a JSON type, else `*/*`, see
    // Media.findJsonMediaType) rather than inventing a separate policy: this check must never
    // blame the selection for a representation the generator never read in the first place.
    //   e.g. (unread-media-type.yaml) `content: { application/xml: { schema: Report } }` — the
    //   generator finds no JSON key here and stubs the response; this check follows it there too
    const withSchema = Object.keys(content).filter((key) => content[key]?.schema);
    const key = Media.findJsonMediaType(withSchema) ?? withSchema[0];
    return key ? ResponseCoverageCheck.deref(context, content[key].schema) : undefined;
  }

  // This level's own declared keys, unwrapping a list (`[Pet]` reads as one `Pet`) first. A
  // `oneOf`/`anyOf`/`allOf` schema answers no keys — each branch can declare a different shape, so
  // "the declared keys" is not one list yet. see docs/FIXED.md #176's out-of-scope note
  private static properties(gen: OasGen, schema: SchemaObject | undefined): Map<string, SchemaObject> {
    const context = gen.getContext();
    let current = ResponseCoverageCheck.deref(context, schema);
    while (current?.type === 'array' && _.isObject(current.items)) {
      current = ResponseCoverageCheck.deref(context, current.items as SchemaObject);
    }
    if (!current || current.oneOf || current.anyOf || current.allOf) {
      // ponytail: composed schemas unjudged; a per-key schema list is the upgrade
      return new Map();
    }
    return new Map(Object.entries(current.properties ?? {}) as [string, SchemaObject][]);
  }

  // Follows a `$ref` to the schema it points at, e.g. `{ $ref: '#/components/schemas/Report' }` ->
  // `Report`'s own `{ type: object, properties: { id, name } }`. Never bumps refCount: like the
  // sniff in get.ts's visitResponseContent, this may look at a schema generation never visits.
  private static deref(
    context: OasContext,
    schema: SchemaObject | ReferenceObject | undefined,
  ): SchemaObject | undefined {
    let current: SchemaObject | ReferenceObject | undefined = schema;
    while (current && '$ref' in current) {
      current = context.resolvePointer((current as ReferenceObject).$ref) as SchemaObject | ReferenceObject | undefined;
    }
    return current as SchemaObject | undefined;
  }

  private static reportNotRead(missing: string[], selection: Selection): LintDiagnostic {
    return {
      code: 'RESPONSE_NOT_READ',
      severity: 'error',
      message: `\`${selection.operationKey}\` returns ${ResponseCoverageCheck.listKeys(missing)} but its selection reads none of them.`,
      from: selection.from,
      to: selection.from,
    };
  }

  private static reportFieldNotRead(key: string, selection: Selection, anchor: NamedSpan): LintDiagnostic {
    return {
      code: 'RESPONSE_FIELD_NOT_READ',
      severity: 'warning',
      message: `\`${key}\` is returned by \`${selection.operationKey}\` but its selection never reads it.`,
      from: anchor.from,
      to: anchor.to,
    };
  }

  private static listKeys(keys: string[]): string {
    const shown = keys
      .slice(0, 8)
      .map((key) => `\`${key}\``)
      .join(', ');
    const extra = keys.length > 8 ? ` (+${keys.length - 8} more)` : '';
    return shown + extra;
  }
}
