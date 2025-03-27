import { Body, IType, Post, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Arr } from './arr.js';
import { Factory } from './factory.js';
import { Get } from './get.js';
import { PropArray } from './propArray.js';
import { Ref } from './ref.js';
import { Response } from './response.js';

export class Obj extends Type {
  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
    this.updateName();
  }

  public forPrompt(_context: OasContext): string {
    return `${Naming.getRefName(this.name)} (Obj)`;
  }

  get id(): string {
    return `obj:${this.name}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [obj:visit]', 'in ' + this.name);

    if (!context.inContextOf('Composed', this)) {
      trace(context, '[obj]', 'In object: ' + (this.name ? this.name : this.parent?.name));
    }

    this.visitProperties(context);
    this.visited = true;

    if (this.name) {
      context.store(this.name, this);
    }

    trace(context, '<- [obj:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    if (this.props.size === 0) {
      return;
    }

    if (context.inContextOf('Response', this)) {
      writer.append(Naming.genTypeName(this.name));
      return;
    }

    context.enter(this);
    trace(context, '-> [obj::generate]', `-> in: ${this.name}`);

    const sanitised = Naming.genTypeName(this.name);
    const refName = Naming.getRefName(this.name);

    writer
      .append(this.kind + ' ')
      .append(sanitised === refName ? refName : sanitised)
      .append(this.nameSuffix())
      .append(' {\n');

    const selected = this.kind == "input"
      ? this.props.values() // select all values for inputs, no selection applies here
      : this.selectedProps(selection);

    for (const prop of selected) {
      trace(context, '-> [obj::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
      prop.generate(context, writer, selection);
    }

    writer.append('}\n\n');

    trace(context, '<- [obj::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [obj::select]', `-> in: ${this.name}`);

    const selected = this.selectedProps(selection);
    for (const prop of selected) {
      prop.select(context, writer, selection);
    }

    trace(context, '<- [obj::select]', `-> out: ${this.name}`);
  }

  private updateName(): void {
    let name = this.name;
    // If we are an inline object named "items", try to create a better name.
    if (!name || name === 'items') {
      const parent = this.parent;
      const parentName = parent!.name;

      // if the parent is a reference, we can use the name of the obj itself
      if (parent instanceof Ref) {
        name = parentName.replace('ref:', 'obj:');
      }
      // else is our parent an array?
      else if (parent instanceof Arr || parent instanceof PropArray) {
        // if so, synthesize a name based on the parent name
        name = Naming.genTypeName(Naming.getRefName(parentName) + 'Item');
      }
      // if the parent is a response, we can use the operation name and append "Response"
      else if (parent instanceof Response) {
        const op = parent.parent as Get;
        name = op.getGqlOpName() + 'Response';
      }
      else if (parent instanceof Body) {
        // const op = parent.parent as Post;
        name = this.name + 'Input';
      }
      // if the parent is an object then we can use the parent name
      else if (parent instanceof Obj) {
        name = parentName + 'Obj';
      }
      // extreme case -- we synthesize an anonymous name
      else {
        name = `[anonymous:${this.parent!.name}]`;
      }
    }

    this.name = name;
  }

  private visitProperties(context: OasContext): void {
    if (!this.schema.properties) {
      return;
    }

    const properties = this.schema.properties as Record<string, SchemaObject>;
    const propKeys = Object.keys(properties);
    trace(context, '-> [obj::props]', 'in props ' + (propKeys.length === 0 ? '0' : propKeys.length.toString()));

    if (propKeys.length === 0) {
      trace(context, '<- [obj::props]', 'no props ' + this.props.size);
      return;
    }

    const sorted = Object.entries(properties).sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));

    for (const [key, schemaValue] of sorted) {
      const prop = Factory.fromProp(context, this, key, schemaValue);
      this.props.set(prop.name, prop);

      // TODO: we should not be adding this twice
      if (!this.children.includes(prop)) {
        this.add(prop);
      }
    }

    trace(context, '<- [obj::props]', 'out props ' + this.props.size);
  }
}
