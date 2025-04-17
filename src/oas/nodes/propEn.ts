import { Prop } from './prop.js';
import { IType } from './iType.js';
import { En } from './en.js';
import { Writer } from '../io/writer.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { trace } from '../log/trace.js';

export class PropEn extends Prop {
  private en: En;
  private type: string;

  dependencies(): IType[] {
    return [this.en];
  }

  constructor(parent: IType, name: string, type: string, en: En) {
    super(parent, name, en.schema);
    this.type = type;
    this.en = en;
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
    throw new Error('Method not implemented.');
  }

  public getValue(_context: OasContext): string {
    return Naming.getRefName(this.type);
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