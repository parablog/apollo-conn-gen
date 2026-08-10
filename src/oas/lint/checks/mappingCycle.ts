import type { LintDiagnostic, NamedSpan, ParsedSchema, SelectedField } from '../types.js';
import { SelectedFields } from '../selectedFields.js';

/** One type's mapping reaching another, and where that is written. */
interface MappingEdge {
  from: string;
  to: string;
  at: NamedSpan;
}

/**
 * A mapping that reaches itself is rejected outright, and the message does not name the types
 * involved:
 *
 *   type Pet @mapping(selection: "owner: owner->Owner") { owner: Owner }
 *   type Owner @mapping(selection: "pet: pet->Pet") { pet: Pet }
 *
 * The generator never writes one — it finds the cycles first and renders one side inline instead
 * (`T.computeInlinedMappingEdges`), using the same walk as below. This check is for schemas written
 * by hand.
 */
export class MappingCycleCheck {
  public static run(schema: ParsedSchema): LintDiagnostic[] {
    const adjacency = MappingCycleCheck.graph(schema);
    const found: LintDiagnostic[] = [];
    // `onStack` is a type we are still inside: reaching one again is a step back into the cycle.
    const state = new Map<string, 'onStack' | 'done'>();
    const path: string[] = [];

    const visit = (name: string): void => {
      state.set(name, 'onStack');
      path.push(name);
      for (const edge of adjacency.get(name) ?? []) {
        if (state.get(edge.to) === 'onStack') {
          found.push(MappingCycleCheck.report(edge, path));
        } else if (!state.has(edge.to)) {
          visit(edge.to);
        }
      }
      path.pop();
      state.set(name, 'done');
    };

    for (const name of adjacency.keys()) {
      if (!state.has(name)) {
        visit(name);
      }
    }
    return found;
  }

  private static graph(schema: ParsedSchema): Map<string, MappingEdge[]> {
    const adjacency = new Map<string, MappingEdge[]>();
    for (const edge of MappingCycleCheck.edges(schema)) {
      const existing = adjacency.get(edge.from) ?? [];
      existing.push(edge);
      adjacency.set(edge.from, existing);
    }
    return adjacency;
  }

  private static edges(schema: ParsedSchema): MappingEdge[] {
    const mapped = new Set([...schema.types.values()].filter((type) => type.hasMapping).map((type) => type.name));
    const found: MappingEdge[] = [];

    for (const selection of schema.selections) {
      if (selection.directive === 'mapping' && mapped.has(selection.ownerType)) {
        MappingCycleCheck.edgesInFields(selection.fields, selection.ownerType, mapped, found);
      }
    }

    // A bare `@mapping` names no types, but the router derives one edge per object-typed field, so
    // those count towards a cycle just the same.
    for (const type of schema.types.values()) {
      if (!type.hasMapping || type.hasSelection || !type.mappingSpan) {
        continue;
      }
      for (const field of type.fields) {
        if (mapped.has(field.typeName)) {
          found.push({ from: type.name, to: field.typeName, at: type.mappingSpan });
        }
      }
    }
    return found;
  }

  private static edgesInFields(
    fields: SelectedField[],
    owner: string,
    mapped: Set<string>,
    found: MappingEdge[],
  ): void {
    for (const field of SelectedFields.readable(fields)) {
      for (const method of field.methods) {
        if (mapped.has(method.name)) {
          found.push({ from: owner, to: method.name, at: method });
        }
      }
      if (field.nested) {
        MappingCycleCheck.edgesInFields(field.nested, owner, mapped, found);
      }
    }
  }

  private static report(edge: MappingEdge, path: string[]): LintDiagnostic {
    const loop = [...path.slice(path.indexOf(edge.to)), edge.to].join(' -> ');
    return {
      code: 'MAPPING_CYCLE',
      severity: 'error',
      message: `This mapping comes back to where it started: ${loop}. Write one side out in full instead of pointing at the type.`,
      from: edge.at.from,
      to: edge.at.to,
    };
  }
}
