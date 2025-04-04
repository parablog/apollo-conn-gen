import { Factory, IType, Type, T } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export class Response extends Type {
  public schema: SchemaObject;
  public response?: IType;

  constructor(parent: IType, name: string, schema: SchemaObject, response?: IType) {
    super(parent, name);
    this.schema = schema;
    this.response = response;
  }

  get id(): string {
    return 'res:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      trace(context, '-> [res:visit]', this.name + ' already visited.');
      return;
    }

    context.enter(this);
    trace(context, '-> [res:visit]', 'in ' + this.name);

    this.response = Factory.fromSchema(this, this.schema);
    trace(context, '   [res:visit]', 'array type: ' + this.response.id);
    this.visited = true;

    trace(context, '<- [res:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public forPrompt(context: OasContext): string {
    return 'Response';
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [res:generate]', `-> in: ${this.parent!.name}`);

    if (this.response) {
      this.response.generate(context, writer, selection);
    }

    trace(context, '<- [res:generate]', `-> out: ${this.parent!.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [res:select]', `-> in: ${this.parent!.name}`);

    const response = this.response;
    if (response) {
      if (T.isScalar(response)) {
        // best attempt to just copy the value that comes out of the service. most likely the
        // value will have to be replaced by a GQL type. In fact, we could potentially use SYN_ here but
        // it will have to do for now.
        writer
          .append(' '.repeat(context.indent))
          .append('$\n');
      }
      else
        response.select(context, writer, selection);
    }

    trace(context, '<- [res:select]', `-> out: ${this.parent!.name}`);
  }
}
