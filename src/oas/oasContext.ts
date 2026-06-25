import { trace, warn } from './log/trace.js';
import Oas from 'oas';
import { ParameterObject, ResponseObject, SchemaObject } from 'oas/types';
import { DEFAULT_VERSIONS } from '../versions.js';
import { ReferenceObject } from './nodes/internal.js';
import { Naming } from './utils/naming.js';
import { IType } from './nodes/internal.js';

import { Mapper } from './mapper/index.js';

// per-operation request rewiring, keyed by op id (`get:/pets/{id}`): replace the HTTP path,
// query params (raw JSONSelection values, e.g. `$('2024-01')`), headers (string templates,
// e.g. `{$config.key}`) and/or the whole body mapping; null drops one, unknown keys append
export type RequestOverride = {
  path?: string;
  queryParams?: Record<string, string | null>;
  headers?: Record<string, string | null>;
  body?: string | null;
};

// R6: per-batch-endpoint settings. The only knob is the size cap; everything else
// (entity, key, request, selection) is inferred. `{}`/`null` = defaults.
export type BatchEntry = { maxSize?: number };

// R6: batch endpoints, keyed by op id. e.g. { "post:/products/batch": { maxSize: 50 } }
export type BatchConfig = Record<string, BatchEntry | null>;

export type GenerateOptions = {
  baseURL?: string;
  overrides?: Record<string, RequestOverride>;
  batch?: BatchConfig;
  showParentInSelections: boolean;
  federationVersion?: string;
  connectorSpecVersion?: string;
  mapper?: Mapper;
  skipOptionalArgs?: boolean;
  inferEntityResolvers?: boolean;
  emitConnectorErrors?: boolean;
  skipAuth?: boolean;
};

// Max nested $ref hops resolvePointer will follow before giving up (guards against ref cycles).
const MAX_REF_DEPTH = 5;

// Split a JSON pointer (`#/a/b~1c`) into decoded segments: RFC-6901 unescape (`~1`->`/`, `~0`->`~`),
// then percent-decode, since pointers encode path keys (e.g. `#/paths/~1v2~1apps~1%7Bid%7D`).
function decodePointer(ref: string): string[] {
  return ref
    .slice(2)
    .split('/')
    .map((segment) => {
      const unescaped = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      try {
        return decodeURIComponent(unescaped);
      } catch {
        return unescaped;
      }
    });
}

export class OasContext {
  public static readonly COMPONENTS_SCHEMAS: string = '#/components/schemas/';
  public static readonly COMPONENTS_RESPONSES: string = '#/components/responses/';
  public static readonly PARAMETER_SCHEMAS: string = '#/components/parameters/';

  public generatedSet: Set<string> = new Set();
  public indent: number;

  // #13: SDL-only prop replacements, keyed by the emitted instance. When same-id instances
  // diverge on cycle cuts, generate() emits the donor's un-cut field while every path's
  // *selection* keeps its own cut comment (mutating props leaked the field into the cut
  // position's selection -> rover CIRCULAR_REFERENCE). Set by TypesCollector.collect.
  // e.g. (confluence): two `Space` instances in one op —
  //   under Content: Space { # history — cut }   <- collected first, wins emission
  //   under Result:  Space { history: SpaceHistory }
  //   entry: keptSpace -> { "history" -> donor prop }  => SDL emits `history: SpaceHistory`,
  //   the Content path's selection still reads `# history: circular reference omitted`
  public sdlPropOverrides: Map<IType, Map<string, IType>> = new Map();

  public stack: IType[] = new Array<IType>();
  public types: Map<string, IType | undefined> = new Map();
  public generateOptions: GenerateOptions;
  public refCount: Map<string, number> = new Map();

  private parser: Oas;

  constructor(parser: Oas, options?: GenerateOptions) {
    this.parser = parser;
    this.indent = 0;
    this.generateOptions = options || {
      showParentInSelections: true, // by default, we don't show where the fields are coming from
      federationVersion: DEFAULT_VERSIONS.federationVersion,
      connectorSpecVersion: DEFAULT_VERSIONS.connectorSpecVersion,
    };
  }

  public reset(): void {
    this.generatedSet?.clear();
    this.sdlPropOverrides.clear();
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
    this.types.set(name, type);

    // Also reserve the *emitted* GraphQL name: an inline object named by its property key must not
    // collide with a component's emitted name ('user' vs '#/c/s/User' both emit `User`). see issues.md #12
    const emitted = Naming.genTypeName(name);
    if (emitted !== name) {
      this.types.set(emitted, type);
    }
  }

  public lookupResponse(ref: string): ResponseObject | ReferenceObject | null {
    if (ref && ref.startsWith(OasContext.COMPONENTS_RESPONSES)) {
      const definition = this.parser.getDefinition();
      const responses = definition.components?.responses ?? {};

      // get the response schema
      return responses[Naming.getRefName(ref)!] ?? null;
    }

    // generic JSON-pointer response ref (e.g. #/paths/…/responses/<code>). see docs/issues.md #3
    if (ref && ref.startsWith('#/')) {
      return (this.resolvePointer(ref) as ResponseObject) ?? null;
    }

    return null;
  }

  public lookupRef(ref: string | null): SchemaObject | null {
    if (ref && ref.startsWith(OasContext.COMPONENTS_SCHEMAS)) {
      const definition = this.parser.getDefinition();
      const schemas = definition.components?.schemas ?? {};
      // the named component, when the ref points AT one (`#/components/schemas/User` -> `User`)
      const direct = schemas[Naming.getRefName(ref)!];

      if (direct) {
        // count the reference only when it actually resolves to a named component
        const currentCount = this.refCount.get(ref) || 0;
        this.refCount.set(ref, currentCount + 1);
        return direct;
      }
      // not a named component but a pointer INTO one (openai:
      // `#/components/schemas/CreateCompletionRequest/properties/logit_bias`) — walk it below. #33
    }

    // generic JSON-pointer schema ref (e.g. #/paths/…); not a named component, so it skips
    // refCount/consolidation. see docs/issues.md #3
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

    // generic JSON-pointer param ref (e.g. shared params via #/paths/…/parameters/N). see docs/issues.md #3
    if (ref && ref.startsWith('#/')) {
      return (this.resolvePointer(ref) as ParameterObject) ?? false;
    }

    return false;
  }

  // Resolve an internal JSON pointer (`#/a/b/0`) against the parsed OAS document, following nested
  // $ref chains (a pointer may land on another `{ $ref }`). `depth` bounds ref-chasing.
  public resolvePointer(ref: string | null, depth = 0): unknown {
    if (!ref || !ref.startsWith('#/') || depth > MAX_REF_DEPTH) return undefined;

    let cur: unknown = this.parser.getDefinition();
    for (const segment of decodePointer(ref)) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[segment];
    }

    if (cur != null && typeof cur === 'object' && '$ref' in cur) {
      return this.resolvePointer((cur as ReferenceObject).$ref, depth + 1);
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
