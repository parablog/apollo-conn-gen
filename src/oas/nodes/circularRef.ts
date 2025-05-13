import { IType, Type } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class CircularRef extends Type {
  public ref?: IType;

  constructor(parent: IType, name: string) {
    super(parent, name);
  }

  get id(): string {
    return `circular-ref:#${this.ref?.id}`;
  }

  public forPrompt(_: OasContext): string {
    return `${Naming.getRefName(this.ref!.name)} (Circular Ref in: ${this.parent?.id})`;
  }

  public add(_child: IType): IType {
    throw new Error('Should not be adding a child to a circular ref');
  }

  public visit(context: OasContext): void {
    trace(context, '-> [circular-ref:visit]', `-> in: ${this.name}`);
    // Do nothing, this type is always visited.
    trace(context, '<- [circular-ref:visit]', `-> out: ${this.name}`);
  }

  public generate(context: OasContext, _writer: Writer): void {
    trace(context, '-> [circular-ref:generate]', `-> in: ${this.name}`);
    // Do nothing, we can't really generate a circular reference.
    trace(context, '<- [circular-ref:generate]', `-> out: ${this.name}`);
  }

  public select(context: OasContext, writer: Writer): void {
    trace(context, '-> [circular-ref:select]', `-> in: ${this.name}`);

    writer
      .write(' '.repeat(context.indent + context.stack.length))
      .write(`# Circular reference to '${this.name}' detected! Please re-visit the schema and remove the reference.\n`);

    trace(context, '<- [circular-ref:select]', `-> out: ${this.name}`);
  }
}
