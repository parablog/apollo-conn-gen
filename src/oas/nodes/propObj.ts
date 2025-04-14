import { IType, Obj, Union } from './internal.js';
import { Prop } from './internal.js';
import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { Composed } from './comp.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class PropObj extends Prop {
  constructor(
    parent: IType,
    name: string,
    public schema: SchemaObject,
    public obj: IType,
  ) {
    super(parent, name, schema);
    if (!obj) {
      throw new Error('obj parameter is required');
    }

    // TODO: check if re-parenting is necessary?!?!
    if (obj.parent !== this) {
      obj.parent = this;
    }
  }

  public forPrompt(_context: OasContext): string {
    return '[prop] ' + _.lowerFirst(this.name) + ': ' + Naming.getRefName(this.obj.name) + ' (Obj)';
  }

  get id(): string {
    return 'prop:obj:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [prop-obj:visit]', 'in ' + this.name + ', obj: ' + this.obj.name);

    this.obj.visit(context);
    if (!this.children.includes(this.obj)) {
      this.add(this.obj);
    }
    this.visited = true;

    trace(context, '<- [prop-obj:visit]', 'out ' + this.name + ', obj: ' + this.obj.name);
    context.leave(this);
  }

  public getValue(context: OasContext): string {
    // we'll make an assumption here: that if the child obj has no properties,
    // then it's a free-form JSON payload. not sure if the right one, but it will
    // compose for now.
    if (_.isEmpty(this.obj?.props)) return 'JSON';

    return Naming.genTypeName(this.name);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-obj:select]', 'in ' + this.name + ', obj: ' + this.obj.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName);

    writer.append(' '.repeat(context.indent + context.stack.length)).append(sanitised);

    if (this.needsBrackets(this.obj!)) {
      writer.append(' {').append('\n');
      context.enter(this);
    }

    for (const child of this.children) {
      child.select(context, writer, selection);
    }

    if (this.needsBrackets(this.obj!)) {
      context.leave(this);
      writer.append(' '.repeat(context.indent + context.stack.length)).append('}');
    }
    // writer.append('\n');
    if (context.generateOptions.debugParentInSelection) {
      writer.append(' # ').append(Naming.getRefName(this.parent!.name));
    }

    writer.append('\n');

    trace(context, '<- [prop-obj:select]', 'out ' + this.name + ', obj: ' + this.obj?.name);
  }

  private needsBrackets(child: IType): boolean {
    return (child instanceof Obj || child instanceof Union || child instanceof Composed) && !_.isEmpty(child.props);
  }
}
