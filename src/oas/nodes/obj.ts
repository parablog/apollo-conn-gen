import { Arr, Body, Factory, Get, IType, PropArray, Type, Res } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

import _ from 'lodash';

export class Obj extends Type {
  synthetic: boolean = false;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
    this.updateName();
  }

  public forPrompt(_context: OasContext): string {
    return `[object] ${Naming.getRefName(this.name)}`;
  }

  get id(): string {
    return `obj:${this.kind}:${this.name}`;
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
    if (_.isEmpty(this.props)) {
      return;
    }

    if (context.inContextOf('Res', this)) {
      writer.write(Naming.genTypeName(this.name));
      return;
    }

    context.enter(this);
    trace(context, '-> [obj::generate]', `-> in: ${this.name}`);

    const sanitised = Naming.genTypeName(this.name);
    const refName = Naming.getRefName(this.name);

    writer
      .write(this.kind + ' ')
      .write(sanitised === refName ? refName : sanitised)
      .write(this.nameSuffix())
      .write(' {\n');

    const selected = this.selectedProps(selection);

    for (const prop of selected) {
      trace(context, '-> [obj::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
      prop.generate(context, writer, selection);
    }

    writer.write('}\n\n');

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

      if (!this.children.includes(prop)) {
        this.add(prop);
      }
    }

    // required can also be set in a separate array too, apparently
    if (_.isArray(this.schema.required)) {
      this.schema.required.forEach((name) => {
        const prop = this.props.get(name);
        if (prop) prop!.required = true;
      });
    }

    trace(context, '<- [obj::props]', 'out props ' + this.props.size);
  }

  private updateName(): void {
    let name = this.name;
    // If we are an inline object named "items", try to create a better name.
    if (!name || name === 'items') {
      const parent = this.parent;
      const parentName = parent!.name;

      // is our parent an array?
      if (parent instanceof Arr || parent instanceof PropArray) {
        // if so, synthesize a name based on the parent name
        name = Naming.genTypeName(Naming.getRefName(parentName) + 'Item');
      }
      // if the parent is a response, we can use the operation name and append "Response"
      else if (parent instanceof Res) {
        const op = parent.parent as Get;
        name = op.getGqlOpName() + 'Response';
      }
      // for posts
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
        name = `[inline:${this.parent!.name}]`;
      }
    }

    this.name = name;
  }
}
