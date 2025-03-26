import { Factory, IType, ReferenceObject, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export class Body extends Type {
  public schema: SchemaObject;
  public payload?: IType;

  constructor(parent: IType, name: string, schema: SchemaObject) {
    super(parent, name);
    this.schema = schema;
  }

  get id(): string {
    return 'body:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      trace(context, '-> [body:visit]', this.name + ' already visited.');
      return;
    }

    context.enter(this);
    trace(context, '-> [body:visit]', 'in ' + this.name);

    this.visitBodyMedia(context, this.schema);
    this.payload!.name = this.payload!.name + "Input";
    this.payload!.visit(context);
    this.visited = true;

    trace(context, '<- [body:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public forPrompt(context: OasContext): string {
    return 'Body';
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [body:generate]', `-> in: ${this.parent!.name}`);

    if (this.payload) {
      this.payload.generate(context, writer, selection);
    }

    trace(context, '<- [body:generate]', `-> out: ${this.parent!.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [body:select]', `-> in: ${this.parent!.name}`);

    if (this.payload) {
      this.payload.select(context, writer, selection);
    }

    trace(context, '<- [body:select]', `-> out: ${this.parent!.name}`);
  }

  private visitBodyMedia(context: OasContext, schema: SchemaObject | ReferenceObject): void {
    trace(context, '-> [post::body::content]', 'in ' + this.name);

    if ('$ref' in schema) {
      this.visitBodyRef(context, schema as ReferenceObject);
    }
    // If the response has a content property, we need to find the JSON content.
    else if (schema) {
      this.payload = Factory.fromSchema(this, schema as SchemaObject);
    }
    else {
      throw new Error('Not yet implemented for: ' + JSON.stringify(schema));
    }

    trace(context, '<- [post::body::content]', 'out ' + this.name);
  }

  private visitBodyRef(context: OasContext, ref: ReferenceObject): void {
    trace(context, '-> [post::body::ref]', `in: ${this.name}, ref: ${ref.$ref}`);

    const lookup = context.lookupRef(ref.$ref!);
    if (!lookup) {
      throw new Error('Could not find a response with ref: ' + ref.$ref);
    }

    if ('$ref' in lookup) {
      throw new Error('Not yet implemented for nested refs');
    }

    const bodyType: IType = Factory.fromSchema(this, lookup as SchemaObject);
    bodyType.name = ref.$ref;
    this.payload = bodyType;
    trace(context, '<- [post::body::ref]', `out: ${this.name}, ref: ${ref.$ref}`);
  }
}
