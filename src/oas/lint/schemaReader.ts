import { Kind, parse } from 'graphql';
import type {
  DirectiveNode,
  DocumentNode,
  FieldDefinitionNode,
  InterfaceTypeDefinitionNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  StringValueNode,
  TypeNode,
} from 'graphql';
import type { ParsedSchema, SchemaField, SchemaType, Selection } from './types.js';
import { DirectiveTextReader } from './directiveText.js';
import { SelectionReader } from './selectionReader.js';
import _ from 'lodash';

type TypeDefinition = ObjectTypeDefinitionNode | ObjectTypeExtensionNode | InterfaceTypeDefinitionNode;

/** Reads an SDL document into the types and selections the checks work from. */
export class SchemaReader {
  private static readonly ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);
  private static readonly HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

  /**
   * Read the SDL. The user is editing it, so a document that does not parse is reported as
   * unreadable and every check stays quiet rather than working from half a document.
   */
  public static read(sdl: string): ParsedSchema {
    if (!sdl.trim()) {
      return { types: new Map(), selections: [], unreadable: false };
    }

    let document: DocumentNode;
    try {
      document = parse(sdl);
    } catch {
      return { types: new Map(), selections: [], unreadable: true };
    }

    const types = new Map<string, SchemaType>();
    const selections: Selection[] = [];

    for (const definition of SchemaReader.typeDefinitions(document)) {
      SchemaReader.collectType(definition, types);
      SchemaReader.collectMappingSelection(sdl, definition, selections);
      SchemaReader.collectConnectSelections(sdl, definition, selections);
    }

    return { types, selections, unreadable: false };
  }

  private static typeDefinitions(document: DocumentNode): TypeDefinition[] {
    return document.definitions.filter(
      (definition): definition is TypeDefinition =>
        definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
        definition.kind === Kind.OBJECT_TYPE_EXTENSION ||
        definition.kind === Kind.INTERFACE_TYPE_DEFINITION,
    );
  }

  // `extend type Pet` is a second definition of the same type, and so is a duplicate the user has
  // half-finished typing — merge both into one entry rather than letting the later one win.
  private static collectType(definition: TypeDefinition, types: Map<string, SchemaType>): void {
    const name = definition.name.value;
    if (SchemaReader.ROOT_TYPES.has(name)) {
      return;
    }
    const mapping = SchemaReader.directive(definition.directives, 'mapping');
    const merged: SchemaType = types.get(name) ?? { name, fields: [], hasMapping: false, hasSelection: false };
    const known = new Set(merged.fields.map((field) => field.name));

    for (const field of definition.fields ?? []) {
      if (!known.has(field.name.value)) {
        known.add(field.name.value);
        merged.fields.push(SchemaReader.toField(field));
      }
    }
    merged.hasMapping = merged.hasMapping || mapping !== undefined;
    merged.hasSelection = merged.hasSelection || (mapping !== undefined && SchemaReader.selectionArg(mapping) !== undefined);
    types.set(name, merged);
  }

  private static collectMappingSelection(sdl: string, definition: TypeDefinition, selections: Selection[]): void {
    const mapping = SchemaReader.directive(definition.directives, 'mapping');
    const argument = mapping ? SchemaReader.selectionArg(mapping) : undefined;
    const text = argument ? DirectiveTextReader.read(sdl, argument) : null;
    if (!text) {
      return;
    }
    selections.push({
      ownerType: definition.name.value,
      directive: 'mapping',
      fields: SelectionReader.read(text, 'mappingSelection'),
      from: _.first(text.sdlPositions)!,
      to: _.last(text.sdlPositions)!,
    });
  }

  private static collectConnectSelections(sdl: string, definition: TypeDefinition, selections: Selection[]): void {
    for (const field of definition.fields ?? []) {
      const connect = SchemaReader.directive(field.directives, 'connect');
      const argument = connect ? SchemaReader.selectionArg(connect) : undefined;
      const text = argument ? DirectiveTextReader.read(sdl, argument) : null;
      if (!connect || !text) {
        continue;
      }
      selections.push({
        ownerType: definition.name.value,
        ownerField: field.name.value,
        directive: 'connect',
        operationKey: SchemaReader.operationKey(connect),
        fields: SelectionReader.read(text, 'connectSelection'),
        from: _.first(text.sdlPositions)!,
        to: _.last(text.sdlPositions)!,
      });
    }
  }

  /**
   * The operation a @connect calls, spelled the way the generator keys its `paths` map:
   * `@connect(http: { GET: "/pet/findByStatus" })` becomes `get:/pet/findByStatus`.
   */
  private static operationKey(connect: DirectiveNode): string | undefined {
    const http = connect.arguments?.find((argument) => argument.name.value === 'http')?.value;
    if (!http || http.kind !== Kind.OBJECT) {
      return undefined;
    }
    for (const entry of http.fields) {
      const method = entry.name.value.toUpperCase();
      if (SchemaReader.HTTP_METHODS.has(method) && entry.value.kind === Kind.STRING) {
        // the generator writes DELETE as `del:` — see Delete.id
        const prefix = method === 'DELETE' ? 'del' : method.toLowerCase();
        // the URL fills a path parameter from its argument, the paths map keys it by the spec:
        //   GET: "/pet/{$args.petId}"  ->  get:/pet/{petId}
        const path = entry.value.value.replace(/\{\$\w+\.([^}]+)\}/g, '{$1}');
        return `${prefix}:${path}`;
      }
    }
    return undefined;
  }

  private static directive(directives: readonly DirectiveNode[] | undefined, name: string): DirectiveNode | undefined {
    return directives?.find((directive) => directive.name.value === name);
  }

  private static selectionArg(directive: DirectiveNode): StringValueNode | undefined {
    const argument = directive.arguments?.find((entry) => entry.name.value === 'selection');
    return argument && argument.value.kind === Kind.STRING ? argument.value : undefined;
  }

  private static toField(node: FieldDefinitionNode): SchemaField {
    const { typeName, listDepth } = SchemaReader.unwrap(node.type);
    return { name: node.name.value, typeName, listDepth };
  }

  // `[Pet!]!` is a Pet, one list deep
  private static unwrap(node: TypeNode): { typeName: string; listDepth: number } {
    if (node.kind === Kind.NAMED_TYPE) {
      return { typeName: node.name.value, listDepth: 0 };
    }
    const inner = SchemaReader.unwrap(node.type);
    return node.kind === Kind.LIST_TYPE ? { typeName: inner.typeName, listDepth: inner.listDepth + 1 } : inner;
  }
}
