import { Factory, IType } from './internal.js';
import { Prop } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class PropScalar extends Prop {
  private propType?: IType;

  constructor(
    parent: IType,
    name: string,
    public type: string,
    public schema: SchemaObject,
  ) {
    super(parent, name, schema);
  }

  get id(): string {
    return `prop:scalar:${this.name}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    if (!this.propType) {
      this.propType = Factory.fromSchema(context, this, this.schema);
      // this.propType.visit(context);
      this.visited = true;
    }
    context.leave(this);
  }

  public getValue(context: OasContext): string {
    return this.type;
  }

  public forPrompt(context: OasContext): string {
    let result = `[prop] ${this.name}: ${this.type}`;

    if (context.generateOptions.debugParentInSelection) {
      result = result + ` (${Naming.getRefName(this.parent!.name)})`;
    }

    return result;
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '   [prop:select]', this.name);
    const sanitised = Naming.sanitiseFieldForSelect(this.name);
    writer.append(' '.repeat(context.indent + context.stack.length)).append(sanitised);

    for (const child of this.children) {
      child.select(context, writer, selection);
    }

    if (context.generateOptions.debugParentInSelection) {
      writer.append(' # ').append(Naming.getRefName(this.parent!.name));
    }

    writer.append('\n');
  }
}
