import { IType, Obj, Union, Prop, T } from './internal.js';
import _ from 'lodash';
import { SchemaObject } from 'oas/types';
import { trace, warn } from '../log/trace.js';
import { Composed } from './comp.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';

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

  // Why this field has nothing real to write and must fall back to plain JSON, or undefined when
  // it doesn't. getValue() and effectiveDescription() both call this, so the warn() log and the
  // docstring above the field always give the same reason. see docs/FIXED.md #145
  private jsonDegradeReason(context: OasContext): string | undefined {
    // we'll make an assumption here: that if the child obj has no properties,
    // then it's a free-form JSON payload. not sure if the right one, but it will
    // compose for now. e.g. History.emptyBox: { type: object, properties: {} } -> emptyBox: JSON
    if (_.isEmpty(this.obj?.props)) {
      return 'this object declares no properties of its own — sent as raw JSON instead.';
    }

    // every field of the target was removed: no type is written for it, so the field is free-form
    // JSON. e.g. (confluence) ContentHistory's contributors: { $ref: Contributors } -> JSON  #101
    if (T.everyFieldRemoved(this.obj, context)) {
      return `every field of ${Naming.getRefName(this.obj!.name!)} was removed to break a reference cycle, leaving no type to write — sent as raw JSON instead.`;
    }

    return undefined;
  }

  public getValue(context: OasContext): string {
    const reason = this.jsonDegradeReason(context);
    if (reason) {
      warn(context, '[prop-obj]', reason);
      return 'JSON';
    }

    return Naming.genTypeName(this.obj!.name!) + (this.obj as Obj).nameSuffix();
  }

  // Adds the JSON-degrade reason to the field's docstring, same reason warn() already logged.
  // e.g. (only-field-in-a-cycle) contributors gains a "NEEDS ATTENTION" note; createdDate doesn't.
  protected effectiveDescription(context: OasContext): string | undefined {
    const reason = this.jsonDegradeReason(context);
    return reason ? Schemas.withDegradeNote(this.schema, reason).description : super.effectiveDescription(context);
  }

  dependencies(context: OasContext): IType[] {
    // a field written as JSON points at no type, so it keeps nothing reachable (#26). #101
    return T.everyFieldRemoved(this.obj, context) ? [] : [this.obj];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-obj:select]', 'in ' + this.name + ', obj: ' + this.obj.name);

    const sanitised = this.fieldForSelect();

    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);
    if (this.isOptionalInSelection(context)) {
      writer.write('?');
    }

    // a target with every field removed is JSON: the value is taken whole, no block opens. #101
    //   e.g. (confluence) `contributors?` alone, not `contributors? { # publishers … omitted }`
    const wholeValue = T.everyFieldRemoved(this.obj, context);
    const brackets = this.needsBrackets(this.obj!) && !wholeValue;
    if (brackets) {
      writer.write(' {').write('\n');
      context.enter(this);
    }

    if (!wholeValue) {
      for (const child of this.children) {
        child.select(context, writer, selection);
      }
    }

    if (brackets) {
      context.leave(this);
      writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
    }
    // writer.append('\n');
    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');

    trace(context, '<- [prop-obj:select]', 'out ' + this.name + ', obj: ' + this.obj?.name);
  }

  private needsBrackets(child: IType): boolean {
    return (child instanceof Obj || child instanceof Union || child instanceof Composed) && !_.isEmpty(child.props);
  }
}
