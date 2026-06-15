import { Arr, IType, Prop, T, Type } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { context } from 'esbuild';

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
      writer.write(']\n');

      // because it's a scalar array, we can assume that's all we need to generate
      context.generatedSet.add(this.items!.id);
    } else {
      super.generateValue(context, writer);
    }
  }

  public override getValue(context: OasContext): string {
    if (this.items && T.isContainer(this.items)) {
      const type = Naming.genTypeName(this.items.name) + (this.items as Type).nameSuffix();
      return `[${type}]`;
    }

    return `[${this.items!.name}]`;
  }

  public forPrompt(_context: OasContext): string {
    if (this.items && T.isContainer(this.items)) {
      return `[prop] ${this.name}: [${Naming.genTypeName(this.items?.name)}] (Array)`;
    }

    return `[prop] ${this.name}: [${this.items!.name}] (Array)`;
  }

  dependencies(): IType[] {
    return this.items ? [this.items] : [];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-array:select]', 'in: ' + this.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName, this.parent?.kind === 'input');
    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    // R10: array-of-object items collapse to the item type's @mapping spread (prefix preserved);
    // back edges render fully inline. see typeUtils.computeInlinedMappingEdges
    if (context.generateOptions.reusableMappings && context.inlineFallbackDepth === 0) {
      const spread = T.mappingSpreadName(this.items, selection);
      if (spread) {
        if (T.isInlinedBackEdge(this, spread, context, selection)) {
          context.inlineFallbackDepth++;
          try {
            this.selectBody(context, writer, selection);
          } finally {
            context.inlineFallbackDepth--;
          }
        } else {
          writer.write(` { ...${spread} }`).write('\n');
        }
        trace(context, '<- [prop:array:select]', 'out (mapped) ' + this.name);
        return;
      }
    }

    this.selectBody(context, writer, selection);

    trace(context, '<- [prop:array:select]', 'out');
  }

  private selectBody(context: OasContext, writer: Writer, selection: string[]): void {
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
  }

  public needsBrackets(child?: IType): boolean {
    if (!child) return false;
    return T.isContainer(child);
  }
}
