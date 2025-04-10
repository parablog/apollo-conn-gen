import { Factory, IType, Prop, Ref, T, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

export class Union extends Type {
  public schemas: SchemaObject[];
  public discriminator?: string;

  constructor(
    parent: IType,
    name: string,
    schemas: SchemaObject[],
    public consolidated: boolean = false,
  ) {
    super(parent, name);
    this.schemas = schemas;
    this.discriminator = _.get((parent as Prop).schema, 'discriminator')?.propertyName;
    this.updateName();
  }

  get id(): string {
    return `union:${this.name}`;
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
    }
    // generate traditional union
    else {
      const name = _.upperFirst(Naming.getRefName(this.name));

      if (!context.generateOptions.consolidateUnion) {
        this.children.forEach((child) => {
          if (child instanceof Ref) {
            (child as Ref).refType?.generate(context, writer, selection);
          } else child.generate(context, writer, selection);
        });

        // const selected = this.selectedProps(selection);
        writer
          .append('union ')
          .append(name)
          .append(this.nameSuffix())
          .append(' = ')
          .append(this.children.map((child) => Naming.getRefName(child.name)).join(' | '))
          .append('\n\n');
      } else {
        // When generating this union in GQL it might look like:
        // union MyUnion = Type1 | Type2 | Type3
        writer.append('#### NOT SUPPORTED YET BY CONNECTORS!!! union ').append(name).append(' = ');

        const childrenNames = this.children.map((child) => Naming.getRefName(child.name)).join(' | ');

        writer.append(childrenNames).append('\n\n');

        trace(context, '   [union::generate]', `[union] -> object: ${this.name}`);

        writer
          .append(this.kind + ' ')
          .append(name)
          .append(this.nameSuffix())
          .append(' { #### replacement for Union ')
          .append(name)
          .append('\n');

        const selected = this.selectedProps(selection);
        for (const prop of selected) {
          trace(context, '   [union::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
          prop.generate(context, writer, selection);
        }

        writer.append('} \n### End replacement for ').append(this.name).append('\n\n');
      }
    }

    trace(context, '<- [union::generate]', 'out: ' + schemas);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [union::select]', `-> in: ${this.name}`);

    if (context.generateOptions.consolidateUnion) {
      if (!this.consolidated) {
        this.consolidate(selection);
      }

      const selected = this.selectedProps(selection);
      for (const prop of selected) {
        prop.select(context, writer, selection);
      }
    } else {
      // collect all property names from children and write them here
      this.children.forEach((child) => {
        child.select(context, writer, selection);
      });
    }

    /* TODO:
    dataPoints: dataFormat->match(
    ["raw", $.dataPoints],
    ["normal", $.dataPoints {
      priceDateTime
      # all other fields
    }],
    [@, $ { # optimized
      priceDateTime
      # all other fields
      }
    ])
     */

    trace(context, '<- [union::select]', `-> out: ${this.name}`);
  }

  public consolidate(selection: string[]): Set<string> {
    const ids: Set<string> = new Set();
    const props: Prop[] = [];
    const discriminator = this.discriminator;

    const queue = T.containers(this);
    while (queue.length > 0) {
      const node = queue.shift()!;
      ids.add(node.id);

      // process each prop, renaming the ones that have a name clash with others. if a selection
      // is passed, then only add those, otherwise add all.
      for (const prop of _.isEmpty(selection)
        ? Array.from(node.props.values()) // include all
        : Array.from(node.props.values())
            .filter((i) => selection.find((s) => s.startsWith(i.path()))) // include selected only
            .filter((i) => i.name !== discriminator)) {
        // remove discriminator props
        // rename every prop there is if there's a conflict, then add it to props
        this.updatePropName(prop, props, selection);
        props.push(prop);
      }

      // find the other containers and add them to the queue
      queue.push(...T.containers(node));
    }

    // add the discriminator, if we have one
    if (discriminator) props.push(this.children[0].props.get(discriminator)!);

    // and finally sort the props and copy them to our original
    props.sort((a, b) => a.name.localeCompare(b.name)).forEach((prop) => this.props.set(prop.name, prop));

    // and return the types.ts we've used
    this.consolidated = true;
    return ids;
  }

  private updatePropName(prop: Prop, props: Prop[], selection: string[]) {
    let name = prop.name;

    let counter = 0;
    while (props.find((p) => p.name === name)) {
      name = `${prop.name}${++counter}`;
    }

    if (name !== prop.name) {
      prop.name = name;
      // we need to extend the selection too, because a new property has been created
      selection.push(prop.path());
    }
  }

  private visitProperties(_context: OasContext): void {
    // do nothing?
  }

  private updateName(): void {
    this.name = this.parent!.name + `Union`;
  }
}
