import { IType, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export class Scalar extends Type {
  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  get id(): string {
    return `scalar:${this.schema.type}`;
  }

  public visit(_context: OasContext): void {
    this.visited = true;
  }

  public forPrompt(_context: OasContext): string {
    return String(this.schema.type);
  }

  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    context.enter(this);
    trace(context, '-> [scalar::generate]', `-> in: ${this.name}`);
    writer.write(this.name);
    trace(context, '<- [scalar::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(_context: OasContext, writer: Writer, _selection: string[]) {
    if (this.schema.default) {
      writer
        .append(': ') // We'll append the value as a literal. No type checking for now.
        .append('$(')
        .append(this.schema.default)
        .append(')');
    }
  }
}
