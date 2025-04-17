import { IType, Prop, T, Type } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

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

  public override getValue(context: OasContext): string {
    if (this.items && T.isContainer(this.items)) {
      const type = Naming.genTypeName(this.items.name) + (this.items as Type).nameSuffix();
      return `[${type}]`;
    }

    return `[${this.items!.name}]`;
  }

  public forPrompt(context: OasContext): string {
    if (this.items && T.isContainer(this.items)) {
      return `[prop] ${this.name}: [${Naming.genTypeName(this.items?.name)}] (Array)`;
    }

    return `[prop] ${this.name}: [${this.items!.name}] (Array)`;
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-array:select]', 'in: ' + this.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName);
    writer.append(' '.repeat(context.indent + context.stack.length)).append(sanitised);

    if (this.needsBrackets(this.items!)) {
      writer.append(' {');
      writer.append('\n');
      context.enter(this);
    }

    // Select each child of the items Prop.
    if (this.needsBrackets(this.items)) {
      const selected = Array.from(this.items!.children.values())
        .filter((prop) => selection.find((s) => s.startsWith(prop.path())));

      for (const child of selected) {
        child.select(context, writer, selection);
      }
    }

    if (this.needsBrackets(this.items!)) {
      context.leave(this);
      writer.append(' '.repeat(context.indent + context.stack.length)).append('}');
    }
    // writer.append('\n');
    if (context.generateOptions.debugParentInSelection) {
      writer.append(' # ').append(Naming.getRefName(this.parent!.name));
    }

    writer.append('\n');

    trace(context, '<- [prop:array:select]', 'out');
  }

  public needsBrackets(child?: IType): boolean {
    if (!child) return false;
    return T.isContainer(child)
  }
}
