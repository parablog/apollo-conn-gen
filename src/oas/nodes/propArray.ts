import { Arr, En, IType, Prop, Scalar, T, Type } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';

export class PropArray extends Prop {
  public items?: IType;

  get id(): string {
    return `prop:array:#${this.name}`;
  }

  public override visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [prop-array:visit]', 'in');

    trace(context, '   [prop-array:visit]', 'type: ' + this.items);
    this.items?.visit(context);
    this.visited = true;

    trace(context, '<- [prop:array:visit]', 'out');
    context.leave(this);
  }

  public setItems(items: IType): void {
    this.items = items;
    if (!this.children.includes(items)) {
      this.add(items);
    }
  }

  generateValue(context: OasContext, writer: Writer) {
    if (T.isScalarArray(this.items!)) {
      const arr: Arr = this.items as Arr;

      writer.write('[');
      arr.generate(context, writer, []);
      // no newline: the caller writes `!` for a required field and ends the line. #59
      writer.write(']');

      // because it's a scalar array, we can assume that's all we need to generate
      context.generatedSet.add(this.items!.id);
    } else {
      super.generateValue(context, writer);
    }
  }

  // The field's type, one pair of brackets per list. A list of lists names what is at the bottom —
  // it used to write the inner list's own name, which nothing defines.
  //   e.g. (box) name_conflicts -> `[[NameConflictsItem]]`, not `[name_conflicts]`      #59
  public override getValue(context: OasContext): string {
    const inner = T.findLastArrayItemIn(this.items)!;
    // a list of enum values must point at the enum's real emitted name, not its raw one — an inline
    // enum with no field of its own is literally named "enum", which becomes "Enum" once written out.
    //   e.g. (motion) include: { type: array, items: { type: string, enum: [workHours] } }
    //   -> include: [Enum], matching `enum Enum { ... }` — not `include: [enum]`, pointing at nothing   #170
    const name = T.isContainer(inner)
      ? Naming.genTypeName(inner.name) + (inner as Type).nameSuffix()
      : inner instanceof En
        ? Naming.genTypeName(inner.name)
        : inner.name;

    // one pair of brackets per list on the way down
    let value = `[${name}]`;
    for (let node = this.items; node instanceof Arr; node = node.itemsType) {
      value = `[${value}]`;
    }
    return value;
  }

  public forPrompt(_context: OasContext): string {
    if (this.items && T.isContainer(this.items)) {
      return `[prop] ${this.name}: [${Naming.genTypeName(this.items?.name)}] (Array)`;
    }

    return `[prop] ${this.name}: [${this.items!.name}] (Array)`;
  }

  // Why this list gave up on its items and sends plain JSON instead, or undefined if the list holds
  // a real type — the same reason `getValue()` above already wrote `[JSON]` for.
  //   e.g. (slack) archivedChannels: { items: { type: object } } -> archivedChannels: [JSON]
  private jsonReason(context: OasContext): string | undefined {
    const inner = T.findLastArrayItemIn(this.items);
    if (!(inner instanceof Scalar) || inner.name !== 'JSON') {
      return undefined;
    }
    if (Schemas.isShapelessObject(inner.schema)) {
      return 'items in array have types that declare no fields - returning JSON type';
    }
    if (Schemas.holdsPlainValues(context, inner.schema)) {
      return 'items in array have mixed array types - returning JSON type';
    }
    if (Schemas.holdsMixedPlainAndObjectValues(context, inner.schema)) {
      return 'items in array have both plain and object values - returning JSON type';
    }
    return undefined;
  }

  // Adds the JSON reason to the field's docstring, same reason the build log already shows.
  //   e.g. (slack) archivedChannels gains a "NEEDS ATTENTION" note; a normal list doesn't.
  protected override effectiveDescription(context: OasContext): string | undefined {
    const reason = this.jsonReason(context);
    return reason ? Schemas.withJsonNote(this.schema, reason).description : super.effectiveDescription(context);
  }

  dependencies(): IType[] {
    return this.items ? [this.items] : [];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-array:select]', 'in: ' + this.name);

    const sanitised = this.fieldForSelect(context);
    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    // #16/#165: items with a default only cover a missing key when it's actually written, e.g.
    // (r7r8-selection) `emails: emails ?? $("")` — below the gate it writes nothing, so `?` stays
    const itemsHaveDefault = this.items instanceof Scalar && this.items.coalescesDefault(context);
    if (!itemsHaveDefault && this.isOptionalInSelection(context)) {
      writer.write('?');
    }

    if (this.needsBrackets(this.items!)) {
      writer.write(' {');
      writer.write('\n');
      context.enter(this);
    }

    // now allow the items type to select its properties
    this.items!.select(context, writer, selection);

    if (this.needsBrackets(this.items!)) {
      context.leave(this);
      writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
    }
    // writer.append('\n');
    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');

    trace(context, '<- [prop:array:select]', 'out');
  }

  // Whether the selection opens a `{ }` block for what the list holds. A list of lists opens one
  // block for the type at the bottom, or its fields are written as the parent's own.
  //   e.g. (box) post:/zip_downloads name_conflicts: array of array of object    #59
  public needsBrackets(child?: IType): boolean {
    const inner = T.findLastArrayItemIn(child);
    return inner != null && T.isContainer(inner);
  }
}
