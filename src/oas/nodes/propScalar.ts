import { Factory, IType, Prop, Scalar } from './internal.js';
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
    // set when an out-of-Int32 `integer` was widened to String (gqlScalarFor): the upstream JSON
    // still carries a number, so response selections must coerce it or the field resolves null.
    public stringifiedNumber: boolean = false,
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
      const type = Factory.fromSchema(context, this, this.schema);
      this.add(type);
      this.propType = type;
      this.visited = true;
    }
    context.leave(this);
  }

  public getValue(_context: OasContext): string {
    return this.type;
  }

  public forPrompt(context: OasContext): string {
    let result = `[prop] ${this.name}: ${this.type}`;

    if (context.generateOptions.showParentInSelections) {
      result = result + ` (${Naming.getRefName(this.parent!.name)})`;
    }

    return result;
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '   [prop:select]', this.name);
    let sanitised = this.fieldForSelect(context);
    if (this.stringifiedNumber && this.parent?.kind !== 'input') {
      // `field: field->jsonStringify` (or `alias: key->jsonStringify` when renamed)
      sanitised = sanitised.includes(':')
        ? `${sanitised}->jsonStringify`
        : `${sanitised}: ${sanitised}->jsonStringify`;
    }
    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    // aliasing already writes its own colon, and only an actually-written default covers a
    // missing key — a real field's default writes nothing below the gate. see docs/FIXED.md #165
    const writesDefaultFallback =
      sanitised === this.name && this.propType instanceof Scalar && this.propType.coalescesDefault(context);
    if (writesDefaultFallback) {
      for (const child of this.children) {
        child.select(context, writer, selection);
      }
    } else if (this.isOptionalInSelection(context)) {
      // the default branch above already covers a missing key with `??` — no `?` on top
      writer.write('?');
    }

    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');
  }
}
