import type { LintDiagnostic, ParsedSchema, SelectedField } from '../types.js';
import { SelectedFields } from '../selectedFields.js';

/**
 * Inside a `@mapping` body, `$` and `@` both mean the object being mapped — the parent. So
 * `category: $->Category` runs Category's mapping over the *pet*, not over the pet's category:
 *
 *   type Pet @mapping(selection: """
 *     category: category->Category    <- reads the pet's category
 *     category: $->Category           <- reads the pet itself
 *   """)
 *
 * Live on petstore, pet 335 "Trigg Hound": the first gives `{id: 1, name: "Dogs"}`, the second gives
 * `{id: 335, name: "Trigg Hound"}`. Both compose, and nothing else in the toolchain says a word.
 *
 * A warning, not an error: a mapping is allowed to read its parent on purpose. The anonymous form
 * `...@->Other` is how you do that deliberately, so it is never flagged.
 */
export class ReceiverIsParentCheck {
  public static run(schema: ParsedSchema): LintDiagnostic[] {
    const mapped = new Set([...schema.types.values()].filter((type) => type.hasMapping).map((type) => type.name));

    const found: LintDiagnostic[] = [];
    for (const selection of schema.selections) {
      if (selection.directive !== 'mapping') {
        continue;
      }
      for (const field of SelectedFields.readable(selection.fields)) {
        if (ReceiverIsParentCheck.mapsTheParent(field, mapped)) {
          found.push(ReceiverIsParentCheck.report(field));
        }
      }
    }
    return found;
  }

  private static mapsTheParent(field: SelectedField, mapped: Set<string>): boolean {
    // `($low, $high) => @->min($high)` is a definition, where `@` is the value it was applied to.
    // The reader marks its body `definitionBody`, so it never reaches here.
    if (field.place !== 'mappingSelection' || field.isMerge || !field.outputName) {
      return false;
    }
    if (field.readsFrom.startsAt !== 'dollar' && field.readsFrom.startsAt !== 'atSign') {
      return false;
    }
    // `$.data` and `$args` read something else; only a lone `$` or `@` is the parent, and a lone
    // one is a single character
    if (field.readsFrom.pathParts.length > 0 || field.readsFrom.to - field.readsFrom.from !== 1) {
      return false;
    }
    return field.methods.some((method) => mapped.has(method.name));
  }

  private static report(field: SelectedField): LintDiagnostic {
    const name = field.outputName!.name;
    const receiver = field.readsFrom.startsAt === 'dollar' ? '$' : '@';
    return {
      code: 'RECEIVER_IS_PARENT',
      severity: 'warning',
      message:
        `\`${receiver}\` here is the object being mapped, not its \`${name}\`, so this maps the parent ` +
        `into \`${name}\`. Write \`${name}\` if you meant the field. To merge the parent's shape in on ` +
        `purpose, drop the name and write \`...@->…\`.`,
      from: field.readsFrom.from,
      to: field.readsFrom.to,
      fix: {
        title: `Change to \`${name}\``,
        from: field.readsFrom.from,
        to: field.readsFrom.to,
        insert: name,
      },
    };
  }
}
