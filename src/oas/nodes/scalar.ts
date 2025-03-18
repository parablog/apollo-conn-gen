import { IType, Type } from './type.js';
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
  public visit(_context: OasContext): void {
    this.visited = true;
  }

  public forPrompt(_context: OasContext): string {
    return `Scalar Node - Name: ${this.name}, Value: ${this.schema}`;
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [scalar::generate]', `-> in: ${this.name}`);
    writer.write(this.name);
    trace(context, '<- [scalar::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    // Scalars do not need to be selected.
  }
}
