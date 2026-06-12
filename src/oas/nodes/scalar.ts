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
    if (this.schema.default == null) {
      return;
    }

    // a string default must be quoted — `$(latest)` reads as a field path, `$("latest")` is
    // the literal. Numbers/booleans stay bare. see docs/issues.md #28
    const value = typeof this.schema.default === 'string' ? `"${this.schema.default}"` : String(this.schema.default);
    writer.write(': $(').write(value).write(')');
  }
}
