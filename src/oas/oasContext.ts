import { trace, warn } from './log/trace.js';
import Oas from 'oas';
import { ParameterObject, ResponseObject, SchemaObject } from 'oas/types';
import { DEFAULT_VERSIONS } from '../versions.js';
import { ReferenceObject } from './nodes/internal.js';
import { Naming } from './utils/naming.js';
import { IType } from './nodes/internal.js';

import { Mapper } from './mapper/index.js';

export type GenerateOptions = {
  consolidateUnions: boolean;
  showParentInSelections: boolean;
  federationVersion?: string;
  connectorSpecVersion?: string;
  mapper?: Mapper;
  skipOptionalArgs?: boolean;
  inferEntityResolvers?: boolean;
};

export class OasContext {
  public static readonly COMPONENTS_SCHEMAS: string = '#/components/schemas/';
  public static readonly COMPONENTS_RESPONSES: string = '#/components/responses/';
  public static readonly PARAMETER_SCHEMAS: string = '#/components/parameters/';

  public generatedSet: Set<string> = new Set();
  public indent: number;

  public stack: IType[] = new Array<IType>();
  public types: Map<string, IType | undefined> = new Map();
  public generateOptions: GenerateOptions;
  public refCount: Map<string, number> = new Map();

  private parser: Oas;

  constructor(parser: Oas, options?: GenerateOptions) {
    this.parser = parser;
    this.indent = 0;
    this.generateOptions = options || {
      consolidateUnions: true, // by default, we consolidate fields until unions are supported
      showParentInSelections: true, // by default, we don't show where the fields are coming from
      federationVersion: DEFAULT_VERSIONS.federationVersion,
      connectorSpecVersion: DEFAULT_VERSIONS.connectorSpecVersion,
    };
  }

  public reset(): void {
    this.generatedSet?.clear();
  }

  public enter(type: IType): void {
    this.stack.push(type);
    trace(this, '-> [context::enter]', type.id);
  }

  public leave(type: IType): void {
    this.stack.pop();
    trace(this, '<- [context::leave]', type.id);
  }

  public size() {
    return this.stack.length;
  }

  public store(name: string, type: IType): void {
    trace(this, '[context::store]', 'store ' + type.id);
    this.types.set(name, undefined);
  }

  public lookupResponse(ref: string): ResponseObject | ReferenceObject | null {
    if (ref && ref.startsWith(OasContext.COMPONENTS_RESPONSES)) {
      const definition = this.parser.getDefinition();
      const responses = definition.components?.responses ?? {};

      // get the response schema
      return responses[Naming.getRefName(ref)!] ?? null;
    }

    // Generic JSON-pointer response ref (e.g. #/paths/<path>/<verb>/responses/<code>).
    if (ref && ref.startsWith('#/')) {
      return (this.resolvePointer(ref) as ResponseObject) ?? null;
    }

    return null;
  }

  public lookupRef(ref: string | null): SchemaObject | null {
    if (ref && ref.startsWith(OasContext.COMPONENTS_SCHEMAS)) {
      const currentCount = this.refCount.get(ref) || 0;
      this.refCount.set(ref, currentCount + 1);

      const definition = this.parser.getDefinition();
      const schemas = definition.components?.schemas ?? {};

      return schemas ? schemas[Naming.getRefName(ref)!] : null;
    }

    // Generic JSON-pointer schema ref (e.g. a schema $ref'd via #/paths/<path>/... rather than
    // #/components/schemas). Not a named component, so it does NOT participate in refCount /
    // consolidation — resolve it directly against the document.
    if (ref && ref.startsWith('#/')) {
      return (this.resolvePointer(ref) as SchemaObject) ?? null;
    }

    return null;
  }

  public decRefCount(ref: string): void {
    if (ref && ref.startsWith(OasContext.COMPONENTS_SCHEMAS)) {
      const currentCount = this.refCount.get(ref) || 0;
      if (currentCount > 0) {
        this.refCount.set(ref, currentCount - 1);
      }
    }
  }

  public lookupParam(ref: string): ParameterObject | boolean {
    if (ref && ref.startsWith(OasContext.PARAMETER_SCHEMAS)) {
      const definition = this.parser.getDefinition();
      const parameters = definition.components?.parameters ?? {};

      // get the parameter schema
      const name = Naming.getRefName(ref)!;
      return (parameters[name] as ParameterObject) ?? false;
    }

    // Generic JSON-pointer (e.g. shared params $ref'd into #/paths/<path>/<verb>/parameters/N — as
    // DigitalOcean does — which the bundler leaves intact since it isn't a #/components ref). Resolve
    // against the parsed definition, following up to a few ref hops.
    if (ref && ref.startsWith('#/')) {
      let resolved: unknown = this.resolvePointer(ref);
      for (let i = 0; i < 5 && resolved && typeof resolved === 'object' && '$ref' in (resolved as object); i++) {
        resolved = this.resolvePointer((resolved as ReferenceObject).$ref);
      }
      return (resolved as ParameterObject) ?? false;
    }

    return false;
  }

  // Resolve an internal JSON pointer (`#/a/b/0`) against the parsed OAS document. Decodes the
  // RFC-6901 escapes (`~1`->`/`, `~0`->`~`) so path keys like `/v2/account/keys` resolve.
  public resolvePointer(ref: string | null): unknown {
    if (!ref || !ref.startsWith('#/')) return undefined;
    const decode = (p: string) => {
      // RFC-6901 unescape, then percent-decode (path keys are encoded in the pointer, e.g.
      // #/paths/~1v2~1apps~1%7Bapp_id%7D -> key "/v2/apps/{app_id}").
      const unescaped = p.replace(/~1/g, '/').replace(/~0/g, '~');
      try {
        return decodeURIComponent(unescaped);
      } catch {
        return unescaped;
      }
    };
    const parts = ref.slice(2).split('/').map(decode);
    let cur: unknown = this.parser.getDefinition();
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  public inContextOf(type: string, node: IType): boolean {
    // console
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i] === node) {
        continue;
      }

      if (this.stack[i].constructor.name === type) {
        return true;
      }
    }

    return false;
  }
}
