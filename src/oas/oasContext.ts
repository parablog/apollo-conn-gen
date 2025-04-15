import { trace, warn } from './log/trace.js';
import Oas from 'oas';
import { ParameterObject, ResponseObject, SchemaObject } from 'oas/types';
import { ReferenceObject } from './nodes/internal.js';
import { Naming } from './utils/naming.js';
import { IType } from './nodes/internal.js';

export type GenerateOptions = {
  consolidateUnion: boolean;
  debugParentInSelection: boolean;
};

export class OasContext {
  public static readonly COMPONENTS_SCHEMAS: string = '#/components/schemas/';
  public static readonly COMPONENTS_RESPONSES: string = '#/components/responses/';
  public static readonly PARAMETER_SCHEMAS: string = '#/components/parameters/';
  public generatedSet: Set<string> = new Set();
  public indent: number;

  public stack: IType[] = new Array<IType>();
  public types: Map<string, IType | undefined> = new Map();

  private parser: Oas;
  generateOptions: GenerateOptions;

  constructor(parser: Oas) {
    this.parser = parser;
    this.indent = 0;
    this.generateOptions = {
      consolidateUnion: false, // by default, we consolidate fields until unions are supported
      debugParentInSelection: true, // by default, we don't show where the fields are coming from
    };
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
    if (this.types.has(name)) {
      warn(this, '[store]', `${name} is already stored`);
    }

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
      const definition = this.parser.getDefinition();
      const schemas = definition.components?.schemas ?? {};

      return schemas ? schemas[Naming.getRefName(ref)!] : null;
    }
    return null;
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
