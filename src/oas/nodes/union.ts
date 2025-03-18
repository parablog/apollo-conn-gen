import { IType, Type } from './type.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Factory } from './factory.js';
import { Prop } from './props/prop.js';
import { Ref } from './ref.js';

export class Union extends Type {
  get id(): string {
    return `union:${this.name}`;
  }
  public schemas: SchemaObject[];

  constructor(
    parent: IType,
    name: string,
    schemas: SchemaObject[],
    public consolidated: boolean = false,
  ) {
    super(parent, name);
    this.schemas = schemas;
  }

  public forPrompt(_context: OasContext): string {
    return `${Naming.getRefName(this.name)} (Union)`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }
    const schemas = this.schemas.map((s) => s.type);

    context.enter(this);
    trace(context, '-> [union:visit]', 'in: ' + schemas);

    if (!context.inContextOf('Composed', this)) {
      trace(context, '[union]', 'In union: ' + this.parent?.name);
    }

    for (const refSchema of this.schemas) {
      const type = Factory.fromSchema(this, refSchema);
      trace(context, ' [union:visit]', 'of type: ' + type);

      type.visit(context);
    }

    if (!context.inContextOf('Param', this)) {
      this.visitProperties(context);
    }

    if (this.name != null) {
      context.store(this.name, this);
    }

    this.visited = true;
    trace(context, '<- [union:visit]', 'out: ' + schemas);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    const schemas = this.schemas.map((s) => s.type);
    trace(context, '-> [union::generate]', 'in: ' + schemas);

    /* params with Unions are weird, but here's an example:
     * id: oneOf [string, Enum {me}] */
    if (context.inContextOf('Param', this)) {
      for (const child of this.children) {
        child.generate(context, writer, selection);
      }
    } else {
      // When generating this union in GQL it might look like:
      // union MyUnion = Type1 | Type2 | Type3
      writer
        .append('#### NOT SUPPORTED YET BY CONNECTORS!!! union ')
        .append(Naming.getRefName(this.name))
        .append(' = ');

      const childrenNames = this.children.map((child) => Naming.getRefName(child.name)).join('# | ');

      writer.append(childrenNames).append('#\n\n');

      trace(context, '   [union::generate]', `[union] -> object: ${this.name}`);

      writer
        .append('type ')
        .append(Naming.getRefName(this.name))
        .append(' { #### replacement for Union ')
        .append(this.name)
        .append('\n');

      const selected = this.selectedProps(selection);
      for (const prop of selected) {
        trace(context, '   [union::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
        prop.generate(context, writer, selection);
      }

      writer.append('} \n### End replacement for ').append(this.name).append('\n\n');
    }

    trace(context, '<- [union::generate]', 'out: ' + schemas);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [union::select]', `-> in: ${this.name}`);
    if (!this.consolidated) {
      this.consolidate(selection);
    }

    const selected = this.selectedProps(selection);

    for (const prop of selected) {
      prop.select(context, writer, selection);
    }

    trace(context, '<- [union::select]', `-> out: ${this.name}`);
  }

  public consolidate(selection: string[]): Set<string> {
    const ids: Set<string> = new Set();
    let props: Map<string, Prop> = new Map();

    const queue: IType[] = Array.from(this.children.values()).filter((child) => !(child instanceof Prop));

    while (queue.length > 0) {
      const node = queue.shift()!;

      ids.add(node instanceof Ref ? (node as Ref).refType!.id : node.id);

      if (selection.length > 0) {
        node.props.forEach((prop) => {
          if (selection.find((s) => s.startsWith(prop.path()))) {
            props.set(prop.name, prop);
          }
        });
      } else {
        node.props.forEach((prop) => props.set(prop.name, prop));
      }

      // sort props
      props = new Map([...props.entries()].sort());

      const children = Array.from(node.children.values()).filter((child) => !(child instanceof Prop));

      queue.push(...children);
    }

    // copy all collected props from children into this node
    props.forEach((prop) => this.props.set(prop.name, prop));

    this.consolidated = true;

    // and return the types.ts we've used
    return ids;
  }

  private visitProperties(_context: OasContext): void {
    // do nothing?
    // for (const [_, prop] of collected.entries()) {
    //   trace(context, '   [union]', 'prop: ' + prop);
    //   this.props.set(prop.name, prop);
    //
    //   if (!this.children.includes(prop))
    //     this.add(prop);
    // }
  }
}
