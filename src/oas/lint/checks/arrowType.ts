import type { LintDiagnostic, MethodCall, ParsedSchema, SchemaField, SchemaType, SelectedField, Selection } from '../types.js';
import { SelectedFields } from '../selectedFields.js';
import _ from 'lodash';

/**
 * An arrow to a type has to produce what the field says it holds. `category: category->Colour` on a
 * `category: Category` field composes and runs; the field just comes back empty, because Colour's
 * mapping asks for keys the category does not have.
 *
 *   type Pet @mapping(selection: """
 *     category: category->Category    <- right: the field is a Category
 *     status: status->Category        <- wrong: status is a String
 *   """) { category: Category  status: String }
 *
 * A list is the same as a single value here: the router applies the mapping to every element, so
 * `tags: tags->Tag` on a `tags: [Tag]` field is correct and is what the generator writes.
 */
export class ArrowTypeCheck {
  public static run(schema: ParsedSchema): LintDiagnostic[] {
    const found: LintDiagnostic[] = [];
    for (const selection of schema.selections) {
      ArrowTypeCheck.checkFields(selection.fields, ArrowTypeCheck.selectedType(selection, schema), schema, found);
    }
    return found;
  }

  // The type whose fields a selection lists: for a `@mapping` the type it sits on, and for a
  // `@connect` the type its field returns — `pets: [Pet] @connect(...)` selects Pet's fields.
  private static selectedType(selection: Selection, schema: ParsedSchema): SchemaType | undefined {
    const name = selection.directive === 'mapping' ? selection.ownerType : selection.ownerFieldType?.typeName;
    return name ? schema.types.get(name) : undefined;
  }

  private static checkFields(
    fields: SelectedField[],
    owner: SchemaType | undefined,
    schema: ParsedSchema,
    found: LintDiagnostic[],
  ): void {
    for (const field of SelectedFields.readable(fields)) {
      const declared = ArrowTypeCheck.declaredField(field, owner);
      const target = ArrowTypeCheck.typeArrow(field, schema);
      if (declared && target && declared.typeName !== target.name) {
        found.push(ArrowTypeCheck.report(declared, target, schema));
      }
      if (field.nested) {
        ArrowTypeCheck.checkFields(field.nested, schema.types.get(declared?.typeName ?? ''), schema, found);
      }
    }
  }

  // The SDL field this selection line fills in. A line with no name of its own (`...@->Other`) fills
  // in no single field, and a name the type does not declare is someone else's complaint.
  private static declaredField(field: SelectedField, owner: SchemaType | undefined): SchemaField | undefined {
    const name = field.outputName?.name;
    return name ? owner?.fields.find((candidate) => candidate.name === name) : undefined;
  }

  /**
   * The last `->Name` that names a type in the document — that is the one deciding the field's
   * shape. `photoUrls->first->Photo` ends at Photo. `tags->map(@->Tag)` has none of its own: what is
   * inside the brackets applies to each element, so the field keeps whatever `map` gives back.
   */
  private static typeArrow(field: SelectedField, schema: ParsedSchema): MethodCall | undefined {
    return _.findLast(field.methods, (method) => schema.types.has(method.name));
  }

  private static report(declared: SchemaField, target: MethodCall, schema: ParsedSchema): LintDiagnostic {
    const holdsObject = schema.types.has(declared.typeName);
    return {
      code: 'ARROW_TYPE_MISMATCH',
      severity: 'error',
      message: holdsObject
        ? `\`->${target.name}\` gives back a \`${target.name}\`, but \`${declared.name}\` holds a \`${declared.typeName}\`.`
        : `\`->${target.name}\` gives back a \`${target.name}\`, but \`${declared.name}\` holds a \`${declared.typeName}\`, which is not an object.`,
      from: target.from,
      to: target.to,
      // only worth offering when the field's own type can be mapped to; `->String` is not a thing
      fix: schema.types.get(declared.typeName)?.hasMapping
        ? {
            title: `Change to \`->${declared.typeName}\``,
            from: target.from,
            to: target.to,
            insert: declared.typeName,
          }
        : undefined,
    };
  }
}
