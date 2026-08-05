import type { SchemaObject } from 'oas/types';
import type { OasGen } from '../../oasGen.js';
import type { LintDiagnostic, ParsedSchema, SelectedField, Selection } from '../types.js';
import { ResponseShape } from '../responseShape.js';
import { SelectedFields } from '../selectedFields.js';

/**
 * A selection has to ask for something the API actually returns. Nothing else in the toolchain can
 * tell: composition and the router both accept `photoUrlz`, and the field simply comes back null.
 *
 * A missing key is only an error when the spec bans extra properties; otherwise it is a warning,
 * because JSON Schema still allows it. Free-form responses are left alone entirely, so this can miss
 * a wrong path but will not complain about a right one.
 */
export class PathInResponseCheck {
  public static run(schema: ParsedSchema, gen?: OasGen): LintDiagnostic[] {
    if (!gen) {
      return []; // no spec loaded, so there is nothing to compare against
    }
    const found: LintDiagnostic[] = [];
    for (const selection of schema.selections) {
      if (selection.directive !== 'connect' || !selection.operationKey) {
        continue;
      }
      const response = ResponseShape.forOperation(gen, selection.operationKey);
      if (response) {
        PathInResponseCheck.checkFields(selection.fields, response, selection, found);
      }
    }
    return found;
  }

  private static checkFields(
    fields: SelectedField[],
    response: SchemaObject | undefined,
    selection: Selection,
    found: LintDiagnostic[],
  ): void {
    for (const field of SelectedFields.readable(fields)) {
      // `$` and `@` are the object itself; only a named path can be missing from it
      const reached = field.readsFrom.pathParts.length > 0
        ? PathInResponseCheck.followPath(field, response, selection, found)
        : response;

      if (field.nested) {
        PathInResponseCheck.checkFields(field.nested, reached, selection, found);
      }
    }
  }

  /** Walk `category.name` a step at a time, stopping at the first step the response cannot supply. */
  private static followPath(
    field: SelectedField,
    response: SchemaObject | undefined,
    selection: Selection,
    found: LintDiagnostic[],
  ): SchemaObject | undefined {
    let current = response;
    for (const part of field.readsFrom.pathParts) {
      const lookup = ResponseShape.look(current, part.name);
      if (lookup === 'cannotTell') {
        return undefined; // free-form from here down, so nothing below can be judged either
      }
      if (lookup === 'forbidden' || lookup === 'notDocumented') {
        found.push(PathInResponseCheck.report(part.name, part.from, part.to, selection, lookup === 'forbidden'));
        return undefined;
      }
      current = ResponseShape.propertySchema(current, part.name);
    }
    return current;
  }

  private static report(
    name: string,
    from: number,
    to: number,
    selection: Selection,
    isForbidden: boolean,
  ): LintDiagnostic {
    return {
      code: 'PATH_NOT_IN_RESPONSE',
      severity: isForbidden ? 'error' : 'warning',
      message: isForbidden
        ? `\`${name}\` is not returned by \`${selection.operationKey}\`, and that response does not allow extra properties.`
        : `\`${name}\` is not one of the properties \`${selection.operationKey}\` documents.`,
      from,
      to,
    };
  }
}
