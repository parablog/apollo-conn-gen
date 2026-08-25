import { OasContext } from '../oasContext.js';
import { IType, Prop } from './internal.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

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

  // Render the whole field commented in the SDL (override generate, not just generateValue: the base
  // Prop.generate writes the uncommented `  field: ` prefix + `!`). A commented field is inert, so the
  // type carries no unresolved field (no CONNECTORS_UNRESOLVED_FIELD) while documenting the cut. #10
  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    // the wrapped value may carry a raw ref (`[#/components/schemas/User]`): reduce refs to their name.
    // A cut object was never visited (no props), so getValue falls back to 'JSON' — name it instead.
    let value = this.ref.getValue(context).replace(/#\/[^\]\s]*\//g, '');
    const inner = (this.ref as { obj?: IType }).obj;
    if (value === 'JSON' && inner?.name) {
      value = Naming.genTypeName(Naming.getRefName(inner.name) ?? inner.name);
    }
    writer
      .write('  # ')
      .write(Naming.sanitiseField(this.name, context.generateOptions?.keepFieldNames === true))
      .write(': ')
      .write(value)
      .write(' - circular reference omitted\n');
  }

  public select(context: OasContext, writer: Writer, _selection: string[]) {
    // Cut the cycle: emit a comment and DO NOT recurse into the wrapped ref. Delegating to
    // `this.ref.select(...)` re-expands the very cycle this node exists to break, re-introducing the
    // recursion into the connector selection (rover then rejects it as CIRCULAR_REFERENCE). Mirrors
    // CircularRef.select. see docs/FIXED.md #10
    writer
      .write(' '.repeat(context.indent + context.stack.length))
      .write(`# ${this.name}: circular reference omitted (re-visit schema and remove the reference)\n`);
  }
}
