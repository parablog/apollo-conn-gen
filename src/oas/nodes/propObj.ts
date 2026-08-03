import { IType, Obj, Union, Prop, T } from './internal.js';
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

    return Naming.genTypeName(this.obj!.name!) + (this.obj as Obj).nameSuffix();
  }

  dependencies(): IType[] {
    return [this.obj];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [prop-obj:select]', 'in ' + this.name + ', obj: ' + this.obj.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName, this.parent?.kind === 'input');

    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    // R10: reusable-mappings mode collapses the child body to its @mapping spread — the full
    // field prefix above is preserved, only the inlined block is replaced. A spread that closes
    // a cycle (pre-computed back edge) renders its subtree fully inline instead, with deeper
    // spreads suppressed via inlineFallbackDepth. see typeUtils.computeInlinedMappingEdges
    if (context.generateOptions.reusableMappings && context.inlineFallbackDepth === 0) {
      const spread = T.mappingSpreadName(this.obj, selection);
      if (spread) {
        if (T.isInlinedBackEdge(this, spread, context, selection)) {
          context.inlineFallbackDepth++;
          try {
            this.selectBody(context, writer, selection);
          } finally {
            context.inlineFallbackDepth--;
          }
        } else {
          writer.write(T.mappingSpreadSuffix(sanitised, spread)).write('\n');
        }
        trace(context, '<- [prop-obj:select]', 'out (mapped) ' + this.name);
        return;
      }
    }

    this.selectBody(context, writer, selection);

    trace(context, '<- [prop-obj:select]', 'out ' + this.name + ', obj: ' + this.obj?.name);
  }

  private selectBody(context: OasContext, writer: Writer, selection: string[]): void {
    if (this.needsBrackets(this.obj!)) {
      writer.write(' {').write('\n');
      context.enter(this);
    }

    for (const child of this.children) {
      child.select(context, writer, selection);
    }

    if (this.needsBrackets(this.obj!)) {
      context.leave(this);
      writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
    }
    // writer.append('\n');
    if (context.generateOptions.showParentInSelections) {
      writer.write(' # ').write(Naming.getRefName(this.parent!.name));
    }

    writer.write('\n');
  }

  private needsBrackets(child: IType): boolean {
    return (child instanceof Obj || child instanceof Union || child instanceof Composed) && !_.isEmpty(child.props);
  }
}
