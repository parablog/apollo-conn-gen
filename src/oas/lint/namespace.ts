import { Kind, assertName, parse } from 'graphql';
import type { DefinitionNode, DocumentNode, NameNode, TypeNode } from 'graphql';

// The three names GraphQL keeps for the operation roots: their fields take the prefix, they do not.
const ROOT_TYPE_NAMES = new Set(['Query', 'Mutation', 'Subscription']);

// one span of the document to replace, in the shape LintFix already uses
interface Edit {
  from: number;
  to: number;
  insert: string;
}

// Prefixes every type and root field with the service name, so connectors generated separately
// compose without colliding. Splices the finished document like Directives does, never re-printing.
// e.g. (apikey-header-prefix.yaml) `--service-prefix ACME` -> `type ACME_WidgetsResponse`, `acme_widgets`
export class Namespace {
  // Returns the schema with the prefixes written in — throws on a prefix that is not a GraphQL name.
  public static apply(sdl: string, prefix: string): string {
    // a bad prefix would otherwise produce a document that no longer parses
    assertName(prefix);
    const typePrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const fieldPrefix = prefix.toLowerCase();

    const document = parse(sdl);
    const typeRenames = Namespace.typeRenames(document, typePrefix);

    const edits: Edit[] = [];
    for (const definition of document.definitions) {
      Namespace.collectEdits(definition, typeRenames, fieldPrefix, edits);
    }
    Namespace.collectTypeReferences(document, typeRenames, edits);

    // replace from the end backwards, so earlier offsets stay valid
    return edits
      .sort((a, b) => b.from - a.from)
      .reduce((text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to), sdl);
  }

  // Every named type the document defines, minus the operation roots; the original casing stays.
  // e.g. (stripe) `account_requirements_error` -> `Stripe_account_requirements_error`
  private static typeRenames(document: DocumentNode, typePrefix: string): Map<string, string> {
    const renames = new Map<string, string>();
    for (const definition of document.definitions) {
      const name = Namespace.definedTypeName(definition)?.value;
      if (name && !ROOT_TYPE_NAMES.has(name)) {
        renames.set(name, `${typePrefix}_${name}`);
      }
    }
    return renames;
  }

  // the node, not the string: the caller needs its offsets to replace it in place
  private static definedTypeName(definition: DefinitionNode): NameNode | null {
    switch (definition.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.UNION_TYPE_DEFINITION:
      case Kind.INTERFACE_TYPE_DEFINITION:
      case Kind.SCALAR_TYPE_DEFINITION:
        return definition.name;
      default:
        return null;
    }
  }

  // The definition's own name, and — on a root type only — each of its field names.
  private static collectEdits(
    definition: DefinitionNode,
    typeRenames: Map<string, string>,
    fieldPrefix: string,
    edits: Edit[],
  ): void {
    const node = Namespace.definedTypeName(definition);
    if (!node) {
      return;
    }

    const name = node.value;
    const renamed = typeRenames.get(name);
    if (renamed) {
      edits.push({ from: node.loc!.start, to: node.loc!.end, insert: renamed });
      return;
    }

    // a root type keeps its name; the fields hanging off it are what would collide
    if (!ROOT_TYPE_NAMES.has(name) || !('fields' in definition)) {
      return;
    }
    for (const field of definition.fields ?? []) {
      edits.push({
        from: field.name.loc!.start,
        to: field.name.loc!.end,
        insert: `${fieldPrefix}_${field.name.value}`,
      });
    }
  }

  // Field and argument types, `implements` entries and union members. Only type nodes are walked,
  // so a directive's strings are never touched. e.g. `@source(name: "api")` stays as written.
  private static collectTypeReferences(document: DocumentNode, typeRenames: Map<string, string>, edits: Edit[]): void {
    const reference = (node: TypeNode): void => {
      const named = Namespace.namedType(node);
      const renamed = typeRenames.get(named.name.value);
      if (renamed) {
        edits.push({ from: named.name.loc!.start, to: named.name.loc!.end, insert: renamed });
      }
    };

    for (const definition of document.definitions) {
      const fields = 'fields' in definition ? (definition.fields ?? []) : [];
      for (const field of fields) {
        reference(field.type);
        const args = 'arguments' in field ? (field.arguments ?? []) : [];
        for (const argument of args) {
          reference(argument.type);
        }
      }
      const interfaces = 'interfaces' in definition ? (definition.interfaces ?? []) : [];
      interfaces.forEach(reference);
      const members = 'types' in definition ? (definition.types ?? []) : [];
      members.forEach(reference);
    }
  }

  // `[Pet!]!` is a Pet — the wrappers carry no name, and the inner node keeps its own offsets.
  private static namedType(node: TypeNode): { name: { value: string; loc?: { start: number; end: number } } } {
    return node.kind === Kind.NAMED_TYPE ? node : Namespace.namedType(node.type);
  }
}
