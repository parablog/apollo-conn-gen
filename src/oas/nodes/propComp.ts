import { IType, Obj, Union, Prop } from './internal.js';
import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { Composed } from './comp.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class PropComp extends Prop {
  public comp?: IType;

  constructor(
    parent: IType,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name, schema);
  }

  public forPrompt(_context: OasContext): string {
    const type: string = this.schema.oneOf ? 'Union' : this.schema.allOf ? 'Composed' : 'Unknown';
    return '[prop] ' + _.lowerFirst(this.name) + ': ' + Naming.getRefName(this.comp!.name) + ` (${type})`;
  }

  get id(): string {
    return 'prop:comp:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    const comp = this.comp!;
    trace(context, '-> [prop-comp:visit]', 'in ' + this.name + ', obj: ' + comp.name);

    comp.visit(context);
    if (!this.children.includes(comp)) {
      this.add(comp);
    }
    this.visited = true;

    trace(context, '<- [prop-comp:visit]', 'out ' + this.name + ', obj: ' + comp.name);
    context.leave(this);
  }

  public getValue(_context: OasContext): string {
    return Naming.genTypeName(this.comp!.name!) + (this.comp as Composed).nameSuffix();
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    const comp = this.comp!;
    trace(context, '-> [prop-comp:select]', 'in ' + this.name + ', obj: ' + comp.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName);

    writer.append(' '.repeat(context.indent + context.stack.length)).append(sanitised);

    if (this.needsBrackets(comp)) {
      writer.append(' {').append('\n');
      context.enter(this);
    }

    for (const child of this.children) {
      child.select(context, writer, selection);
    }

    if (this.needsBrackets(comp)) {
      context.leave(this);
      writer.append(' '.repeat(context.indent + context.stack.length)).append('}');
    }
    // writer.append('\n');
    if (context.generateOptions.showParentInSelections) {
      writer.append(' # ').append(Naming.getRefName(this.parent!.name));
    }

    writer.append('\n');

    trace(context, '<- [prop-comp:select]', 'out ' + this.name + ', obj: ' + comp?.name);
  }

  private needsBrackets(child: IType): boolean {
    return child instanceof Union || child instanceof Composed || (child instanceof Obj && !_.isEmpty(child.props));
  }
}
