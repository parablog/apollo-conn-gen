import type { LintDiagnostic, LintFix, ParsedSchema, SelectedField } from '../types.js';
import { ArrowMethods } from '../arrowMethods.js';
import { SelectedFields } from '../selectedFields.js';
import _ from 'lodash';

/**
 * Every `->name` has to be either a builtin method or a type that carries `@mapping`. A misspelling
 * (`photoUrls->fist`) and a type that forgot its `@mapping` both land here, and the router's own
 * message for either does not say which name it disliked.
 */
export class ArrowTargetCheck {
  public static run(schema: ParsedSchema): LintDiagnostic[] {
    const mapped = new Set([...schema.types.values()].filter((type) => type.hasMapping).map((type) => type.name));

    const found: LintDiagnostic[] = [];
    for (const selection of schema.selections) {
      ArrowTargetCheck.checkFields(selection.fields, mapped, schema, found);
    }
    return found;
  }

  private static checkFields(
    fields: SelectedField[],
    mapped: Set<string>,
    schema: ParsedSchema,
    found: LintDiagnostic[],
  ): void {
    for (const field of SelectedFields.readable(fields)) {
      for (const method of field.methods) {
        if (!ArrowMethods.has(method.name) && !mapped.has(method.name)) {
          found.push(ArrowTargetCheck.report(method.name, method.from, method.to, schema));
        }
      }
      if (field.nested) {
        ArrowTargetCheck.checkFields(field.nested, mapped, schema, found);
      }
    }
  }

  private static report(name: string, from: number, to: number, schema: ParsedSchema): LintDiagnostic {
    const isKnownType = schema.types.has(name);
    return {
      code: isKnownType ? 'TARGET_HAS_NO_MAPPING' : 'UNKNOWN_ARROW_TARGET',
      severity: 'error',
      message: isKnownType
        ? `\`->${name}\` points at the type \`${name}\`, which has no \`@mapping\`. Add \`@mapping\` to \`${name}\`.`
        : `\`->${name}\` is not a method the router knows, and no type in this document is called \`${name}\`.`,
      from,
      to,
      fix: isKnownType ? undefined : ArrowTargetCheck.spellingFix(name, from, to),
    };
  }

  // `->trimStrt` is nearly always `->trimStart`, so offer the closest method when one is close enough
  private static spellingFix(name: string, from: number, to: number): LintFix | undefined {
    const closest = _.minBy(ArrowMethods.all(), (method) => ArrowTargetCheck.editDistance(name, method));
    if (!closest || ArrowTargetCheck.editDistance(name, closest) > 2) {
      return undefined;
    }
    return { title: `Change to \`->${closest}\``, from, to, insert: closest };
  }

  // how many single-character edits turn one name into the other
  private static editDistance(left: string, right: string): number {
    const costs = _.range(right.length + 1);
    for (let row = 1; row <= left.length; row++) {
      let diagonal = costs[0];
      costs[0] = row;
      for (let column = 1; column <= right.length; column++) {
        const above = costs[column];
        costs[column] =
          left[row - 1] === right[column - 1] ? diagonal : 1 + Math.min(diagonal, above, costs[column - 1]);
        diagonal = above;
      }
    }
    return costs[right.length];
  }
}
