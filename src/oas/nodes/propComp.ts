import { IType, Obj, Union, Prop, T } from './internal.js';
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

  dependencies(): IType[] {
    return this.comp ? [this.comp] : [];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    const comp = this.comp!;
    trace(context, '-> [prop-comp:select]', 'in ' + this.name + ', obj: ' + comp.name);

    const fieldName = this.name;
    const sanitised = Naming.sanitiseFieldForSelect(fieldName, this.parent?.kind === 'input');

    writer.write(' '.repeat(context.indent + context.stack.length)).write(sanitised);

    // R10: composed (allOf) children collapse to their @mapping spread; unions stay inline;
    // back edges render fully inline. see typeUtils.computeInlinedMappingEdges
    if (context.generateOptions.reusableMappings && context.inlineFallbackDepth === 0) {
      const spread = T.mappingSpreadName(comp, selection);
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
        trace(context, '<- [prop-comp:select]', 'out (mapped) ' + this.name);
        return;
      }
    }

    this.selectBody(context, writer, selection);

    trace(context, '<- [prop-comp:select]', 'out ' + this.name + ', obj: ' + comp?.name);
  }

  private selectBody(context: OasContext, writer: Writer, selection: string[]): void {
    const comp = this.comp!;

    if (this.needsBrackets(comp)) {
      writer.write(' {').write('\n');
      context.enter(this);
    }

    for (const child of this.children) {
      child.select(context, writer, selection);
    }

    if (this.needsBrackets(comp)) {
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
    return child instanceof Union || child instanceof Composed || (child instanceof Obj && !_.isEmpty(child.props));
  }
}
