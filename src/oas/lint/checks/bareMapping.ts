import type { LintDiagnostic, ParsedSchema, SchemaType } from '../types.js';

/**
 * A bare `@mapping` asks the router to work the mapping out from the field list. That works when a
 * query runs, but composition expands it first and only picks up the scalar fields, so an
 * object-typed field expands to nothing and the whole schema is rejected:
 *
 *   type Pet @mapping { id: ID  name: String  category: Category }
 *                                             ^ expands empty -> "Category has no fields"
 *
 * Spelling the selection out passes both. This is why the generator writes the long form for any
 * type holding an object — see `T.writeMappingDirective`, which makes the same call from the node
 * graph rather than from the SDL.
 */
export class BareMappingCheck {
  public static run(schema: ParsedSchema): LintDiagnostic[] {
    const found: LintDiagnostic[] = [];
    for (const type of schema.types.values()) {
      const objectFields = BareMappingCheck.objectFieldsOf(type, schema);
      if (type.hasMapping && !type.hasSelection && type.mappingSpan && objectFields.length > 0) {
        found.push(BareMappingCheck.report(type, objectFields));
      }
    }
    return found;
  }

  // A field holds an object when its type is one of the document's own types — anything else is a
  // scalar or an enum, which the bare form handles fine. `[Tag]` counts: only the name is compared.
  private static objectFieldsOf(type: SchemaType, schema: ParsedSchema): string[] {
    return type.fields.filter((field) => schema.types.has(field.typeName)).map((field) => field.name);
  }

  private static report(type: SchemaType, objectFields: string[]): LintDiagnostic {
    const span = type.mappingSpan!;
    return {
      code: 'BARE_MAPPING_OBJECT_FIELDS',
      severity: 'warning',
      message:
        `\`${type.name}\` holds ${objectFields.length === 1 ? 'an object field' : 'object fields'} ` +
        `(${objectFields.join(', ')}), which a bare \`@mapping\` cannot expand at composition time. ` +
        `Write the selection out: \`@mapping(selection: """…""")\`.`,
      from: span.from,
      to: span.to,
    };
  }
}
