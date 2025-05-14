import { trace, warn } from './log/trace.js';
import Oas from 'oas';
import { ParameterObject, ResponseObject, SchemaObject } from 'oas/types';
import { ReferenceObject } from './nodes/internal.js';
import { Naming } from './utils/naming.js';
import { IType } from './nodes/internal.js';

export type GenerateOptions = {
  consolidateUnions: boolean;
  showParentInSelections: boolean;
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
    };
  }

  // reset the state of the context
  public reset(): void {
    this.indent = 0;
    this.stack = new Array<IType>();
    this.types.clear();
    this.refCount.clear();
    this.generatedSet.clear();
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

    return false;
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
