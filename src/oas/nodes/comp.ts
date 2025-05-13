import { Factory, Get, IType, Prop, ReferenceObject, Res, T, Type } from './internal.js';
import { SchemaObject } from 'oas/types';

import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

export class Composed extends Type {
  constructor(
    parent: IType | undefined,
    public name: string,
    public schema: SchemaObject,
    public consolidated: boolean = false,
  ) {
    super(parent, name);
    this.updateName();
  }

  get id(): string {
    return `comp:${this.kind}:${this.name}`;
  }

  public forPrompt(_context: OasContext): string {
    return `[comp] ${Naming.getRefName(this.name)}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [composed:visit]', 'in: ' + (this.name == null ? '[object]' : this.name));

    // If not in the context of a Composed or Param, log the composed schema.
    if (!context.inContextOf('Composed', this) && !context.inContextOf('Param', this)) {
      trace(context, '[comp]', '   in composed schema: ' + this.name);
    }

    const composedSchema = this.schema;

    // this will be a type declaration
    if (composedSchema.allOf != null) {
      this.visitAllOfNode(context, composedSchema);
    }
    // represents a Union type and should be handled elsewhere
    else if (composedSchema.oneOf != null) {
      throw new Error('Unions should be constructed by its own object');
    }
    // can't hand this yet
    else {
      throw new Error('Composed.visit: unsupported composed schema: ' + this.schema);
    }

    this.visited = true;
    trace(context, '<- [composed:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [comp::generate]', `-> in: ${this.name}`);

    if (context.inContextOf('Res', this)) {
      writer.write(Naming.genTypeName(this.name));
      return;
    }

    if (this.schema.allOf != null) {
      const selected = this.selectedProps(selection);

      if (selected.length > 0) {
        writer.write(this.kind + ' ');
        writer.write(_.upperFirst(Naming.getRefName(this.name)));
        writer.write(this.nameSuffix());
        writer.write(' {\n');

        for (const prop of selected) {
          trace(context, '   [comp::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
          prop.generate(context, writer, selection);
        }

        writer.write('}\n\n');
      }
    }

    trace(context, '<- [comp::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [comp::select]', `-> in: ${this.name}`);
    if (!this.consolidated) {
      this.consolidate(selection);
    }

    const composedSchema = this.schema;
    if (composedSchema.allOf != null) {
      const selected = this.selectedProps(selection);

      for (const prop of selected) {
        prop.select(context, writer, selection);
      }
    } else if (composedSchema.oneOf != null) {
      if (this.children.length === 1) {
        this.children[0].select(context, writer, selection);
      } else {
        throw new Error('Expected exactly one child for a oneOf schema');
      }
    }

    trace(context, '<- [comp::select]', `-> out: ${this.name}`);
  }

  public consolidate(selection: string[]): Set<string> {
    const ids: Set<string> = new Set();
    let props: Map<string, Prop> = new Map();

    const tree = T.print(this);
    const queue: IType[] = Array.from(this.children.values()).filter((child) => !(child instanceof Prop));

    while (queue.length > 0) {
      const node = queue.shift()!;
      ids.add(node.id);

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
    props.forEach((prop, name) => this.props.set(name, prop));

    this.consolidated = true;

    // and return the types we've used
    return ids;
  }

  private visitAllOfNode(context: OasContext, schema: SchemaObject): void {
    const allOfs = schema.allOf || [];
    const refs = allOfs.map((s) => (s as ReferenceObject).$ref);

    trace(context, '-> [composed::all-of]', `in: '${this.name}' of: ${allOfs.length} - refs: ${refs}`);

    for (let i = 0; i < allOfs.length; i++) {
      const allOfItemSchema = allOfs[i];

      const type = Factory.fromSchema(context, this, allOfItemSchema as SchemaObject);
      this.add(type);

      trace(context, '   [composed::all-of]', 'allOf type: ' + type);

      if (type) {
        type.visit(context);
      }
    }

    const tree = T.print(this);
    context.store(this.name, this);
    trace(context, '<- [composed::all-of]', `out: '${this.name}' of: ${allOfs.length} - refs: ${refs}`);
  }

  add(child: IType): IType {
    let name = child.name;
    let idx = 0;

    // TODO: this should not be applicable to Refs
    while (this.children.some((c) => c.name === name)) {
      name = `${child.name}:${++idx}`;
    }

    child.name = name;
    return super.add(child);
  }

  private updateName(): void {
    let name = this.name;

    if (!name) {
      if (this.parent instanceof Res) {
        const op = this.parent!.parent as Get;
        name = op.getGqlOpName() + 'Response';
      } else {
        if (this.schema?.allOf?.length === 1) {
          // because we are going to consolidate the children anyway, we can assume the name of the child.
          // this avoids having a comp with name '[inline:...]' which does not generate properly
          name = _.get(this.schema?.allOf[0], '$ref') as string;
        }
        else
          name = `[inline:${this.parent!.name}]`;
      }
    }

    this.name = name;
  }
}
