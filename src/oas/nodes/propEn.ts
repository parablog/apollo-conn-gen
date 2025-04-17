import { SchemaObject } from 'oas/types';
import { IType, Prop } from './internal.js';
import { Writer } from '../io/writer.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { trace } from '../log/trace.js';

export class PropEn extends Prop {
  private type: string;

  constructor(parent: IType, name: string, type: string, schema: SchemaObject) {
    super(parent, name, schema);
    this.type = type;
  }

  get id(): string {
    return 'prop:enum:' + this.name;
  }

  generate(context: OasContext, writer: Writer, _selection: string[]) {
    super.generate(context, writer, _selection);
  }

  public visit(context: OasContext): void {
    // do nothing
  }

  public forPrompt(context: OasContext): string {
    return `[prop] enum: ${Naming.getRefName(this.type)}`;
  }

  public getValue(_context: OasContext): string {
    return Naming.getRefName(this.type);
  }

  dependencies(): IType[] {
    return Array.from(this.children.values());
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '   [prop:select]', this.name);
    const sanitised = Naming.sanitiseFieldForSelect(this.name);
    writer
      .append(' '.repeat(context.indent + context.stack.length))
      .append(sanitised);

    if (context.generateOptions.debugParentInSelection) {
      writer.append(' # ').append(Naming.getRefName(this.parent!.name));
    }

    writer.append('\n');
  }
}