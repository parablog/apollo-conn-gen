import { OasContext } from '../oasContext.js';
import { IType, Prop } from './internal.js';
import { Writer } from '../io/writer.js';

export class PropCircRef extends Prop {
  private ref: Prop;

  constructor(parent: IType, child: Prop) {
    super(parent, child.name, child.schema);
    this.ref = child;
  }

  get id(): string {
    return `prop:circular-ref:#${this.name}`;
  }

  public override add(child: IType): IType {
    // do nothing
    return child;
  }

  public visit(context: OasContext): void {
    // do nothing
  }

  public getValue(_context: OasContext): string {
    return '';
  }

  public forPrompt(context: OasContext): string {
    return `[prop] ${this.name}: Circular reference to: ${this.ref.forPrompt(context)} `;
  }

  generateValue(context: OasContext, writer: Writer) {
    writer.append('# ');
    this.ref.generateValue(context, writer);
    writer.append(`# Circular reference detected! Please re-visit the schema and remove the reference.\n`);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    // do nothing
    writer.append('# ');
    this.ref.select(context, writer, selection);
  }
}
