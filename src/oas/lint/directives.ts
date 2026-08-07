import { Kind, parse } from 'graphql';
import type { ConstDirectiveNode, DefinitionNode, DocumentNode, ListValueNode } from 'graphql';

// R14: directives the user declares by hand, keyed by the type or field they belong on.
// e.g. (r14-directives) { "Mutation.*": ["@tag(name: \"require-approval\")"], "User.email": ["@authenticated"] }
export type DirectivesConfig = Record<string, string[]>;

// Directives defined by the federation spec: using one adds it to the federation @link import.
// Anything else is written as-is, and declaring it is up to the user.
// e.g. (r14-directives) "@tag" joins the import list, "@cacheControl(maxAge: 60)" is written as-is
const FEDERATION_DIRECTIVES = new Set([
  '@tag',
  '@inaccessible',
  '@authenticated',
  '@requiresScopes',
  '@policy',
  '@shareable',
  '@override',
  '@external',
  '@provides',
  '@requires',
  '@interfaceObject',
]);

interface Declaration {
  selector: string;
  typeName: string;
  // null means the directive goes on the type line itself; otherwise the field name test
  fieldRegex: RegExp | null;
  directives: string[];
  matched: boolean;
}

// text to add at a position in the schema document
interface Addition {
  position: number;
  text: string;
}

// Writes user-declared directives into the generated schema. The generator stays unaware of them:
// this reads the finished document — the same document the linter reads — and adds each directive
// next to the type or field it names. e.g. (r14-directives) `email: String` -> `email: String @authenticated`
export class Directives {
  // Returns the schema with the directives added — throws on a bad declaration or one that names nothing.
  public static apply(sdl: string, config: DirectivesConfig): string {
    // the config usually comes straight from JSON.parse, so its shape cannot be trusted
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('[directives] the file must be an object of "Type" or "Type.field" keys.');
    }
    const declared = Object.entries(config).map(([selector, directives]) =>
      Directives.parseDeclaration(selector, directives),
    );
    const document = parse(sdl);

    const additions: Addition[] = [];
    for (const definition of document.definitions) {
      Directives.collectAdditions(definition, declared, additions);
    }

    // A declaration that names nothing would ship looking applied — stop instead of warning.
    const unmatched = declared.filter((entry) => !entry.matched).map((entry) => `"${entry.selector}"`);
    if (unmatched.length > 0) {
      throw new Error(`[directives] nothing in the schema matches: ${unmatched.join(', ')}.`);
    }

    const imports = Directives.importAddition(document, declared);
    if (imports) {
      additions.push(imports);
    }

    // add from the end of the document backwards, so earlier positions stay valid
    return additions
      .sort((a, b) => b.position - a.position)
      .reduce((text, addition) => text.slice(0, addition.position) + addition.text + text.slice(addition.position), sdl);
  }

  private static parseDeclaration(selector: string, directives: string[]): Declaration {
    const segments = selector.split('.');
    if (segments.length > 2 || segments.some((segment) => segment.length === 0)) {
      throw new Error(`[directives] invalid selector "${selector}": expected "Type" or "Type.field".`);
    }

    const [typeName, fieldName] = segments;
    if (typeName.includes('*')) {
      throw new Error(`[directives] invalid selector "${selector}": only the field part may use "*".`);
    }
    const isDirectiveString = (directive: unknown) => typeof directive === 'string' && directive.startsWith('@');
    if (!Array.isArray(directives) || directives.length === 0 || !directives.every(isDirectiveString)) {
      throw new Error(`[directives] "${selector}" must map to directive strings starting with "@".`);
    }

    return {
      selector,
      typeName,
      fieldRegex: fieldName === undefined ? null : Directives.fieldRegex(fieldName),
      directives,
      matched: false,
    };
  }

  // The whole field name has to match, so a declaration never reaches past what it names.
  // e.g. (r14-directives) `admin*` covers `adminUsers` but not `notadminUsers`; `email` never covers `emailAddress`
  private static fieldRegex(fieldName: string): RegExp {
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[A-Za-z0-9_]*');
    return new RegExp(`^${escaped}$`);
  }

  private static collectAdditions(
    definition: DefinitionNode,
    declared: Declaration[],
    additions: Addition[],
  ): void {
    if (!('name' in definition) || definition.name === undefined || definition.kind === Kind.DIRECTIVE_DEFINITION) {
      return;
    }

    const typeName = definition.name.value;
    const onType = Directives.directivesFor(
      declared,
      (entry) => entry.fieldRegex === null && entry.typeName === typeName,
    );
    if (onType.length > 0) {
      // after the type name, or after the last `implements` entry when the type has them
      const interfaces = 'interfaces' in definition ? (definition.interfaces ?? []) : [];
      const position = interfaces.length > 0 ? interfaces[interfaces.length - 1].loc!.end : definition.name.loc!.end;
      additions.push({ position, text: ' ' + onType.join(' ') });
    }

    // object, interface and input fields all read `name: Type` — the directives go after the value
    const fields = 'fields' in definition ? (definition.fields ?? []) : [];
    for (const field of fields) {
      const onField = Directives.directivesFor(
        declared,
        (entry) => entry.fieldRegex !== null && entry.typeName === typeName && entry.fieldRegex.test(field.name.value),
      );
      if (onField.length > 0) {
        additions.push({ position: field.type.loc!.end, text: ' ' + onField.join(' ') });
      }
    }
  }

  // Every declaration that applies contributes its directives; the same string is written once.
  private static directivesFor(
    declared: Declaration[],
    applies: (entry: Declaration) => boolean,
  ): string[] {
    const collected = new Set<string>();
    for (const entry of declared) {
      if (applies(entry)) {
        entry.matched = true;
        entry.directives.forEach((directive) => collected.add(directive));
      }
    }
    return Array.from(collected);
  }

  // Adds the federation-spec directives in use to the federation @link import, skipping any
  // already there. e.g. (r14-directives) `import: ["@key"]` becomes `import: ["@key", "@tag"]`
  private static importAddition(document: DocumentNode, declared: Declaration[]): Addition | null {
    const used = new Set<string>();
    for (const entry of declared) {
      for (const directive of entry.directives) {
        const name = /^@[A-Za-z_][A-Za-z0-9_]*/.exec(directive)?.[0];
        if (name && FEDERATION_DIRECTIVES.has(name)) {
          used.add(name);
        }
      }
    }
    if (used.size === 0) {
      return null;
    }

    const imports = Directives.federationImports(document);
    if (!imports) {
      return null;
    }

    const existing = new Set(imports.values.map((value) => (value.kind === Kind.STRING ? value.value : '')));
    const added = Array.from(used)
      .filter((name) => !existing.has(name))
      .sort();
    if (added.length === 0) {
      return null;
    }

    // the import list ends with `]` — the names go just inside it
    return { position: imports.loc!.end - 1, text: added.map((name) => `, "${name}"`).join('') };
  }

  // the `import: […]` list of the federation @link on the schema extension
  private static federationImports(document: DocumentNode): ListValueNode | null {
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.SCHEMA_EXTENSION) {
        continue;
      }
      const links = (definition.directives ?? []).filter((directive) => directive.name.value === 'link');
      for (const link of links) {
        const url = link.arguments?.find((argument) => argument.name.value === 'url')?.value;
        if (url?.kind !== Kind.STRING || !url.value.includes('specs.apollo.dev/federation')) {
          continue;
        }
        const imports = link.arguments?.find((argument) => argument.name.value === 'import')?.value;
        if (imports?.kind === Kind.LIST) {
          return imports;
        }
      }
    }
    return null;
  }
}
