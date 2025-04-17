import { Composed, Factory, Get, IType, Prop, Res, T, Type } from './internal.js';
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
    this.updateName();
  }

  get id(): string {
    return `union:${this.name}`;
  }

  public forPrompt(_context: OasContext): string {
    return `[union] ${Naming.getRefName(this.name)}`;
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
      const type = Factory.fromSchema(context, this, refSchema);
      this.add(type);

      trace(context, ' [union:visit]', 'of type: ' + type);
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
    else if (context.inContextOf('Res', this)) {
      writer.append(Naming.genTypeName(this.name));
      return;
    }
    // generate traditional union
    else {
      const name = _.upperFirst(Naming.getRefName(this.name));

      if (context.generateOptions.consolidateUnion) {
        if (!this.consolidated) {
          this.consolidate(selection);
        }

        // When generating this union in GQL it might look like:
        // union MyUnion = Type1 | Type2 | Type3
        writer.append('#### NOT SUPPORTED YET BY CONNECTORS!!! union ').append(name).append(' = ');

        const childrenTypes = this.children.map((child) => Naming.getRefName(child.name));
        const childrenNames = childrenTypes.join(' | ');
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

        // add to generated set
        this.children.forEach(child => context.generatedSet.add(child.id))

      } else {
        // const selected = this.selectedProps(selection);
        writer
          .append('union ')
          .append(name)
          .append(this.nameSuffix())
          .append(' = ')
          .append(this.children.map((child) => Naming.getRefName(child.name)).join(' | '))
          .append('\n\n');
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

    /* TODO: better selection for Unions
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
    /*T.composables(this).forEach((child) => {
      (child as (Composed)).consolidate(selection);
    });*/

    const ids: Set<string> = new Set();
    const props: Prop[] = [];
    const discriminator = this.discriminator;

    this.children?.forEach((child) => {
      ids.add(child.id)
      props.push(...child.props.values())
    })

    // add the discriminator, if we have one
    if (discriminator) {
      const prop = (this.children || [])
        .map((child) => child.props.get(discriminator))
        .find((prop) => prop !== undefined);

      if (prop) props.push(prop);
    }

    // and finally sort the props and copy them to our original
    props
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((prop) => this.props.set(prop.name, prop));

    // and return the types.ts we've used
    this.consolidated = true;
    return ids;
  }

  private visitProperties(_context: OasContext): void {
    // TODO: pending
  }

  private updateName(): void {
    let name = this.name;
    if (!name) {
      if (this.parent instanceof Res) {
        const op = this.parent!.parent as Get;
        name = op.getGqlOpName() + 'Response';
      } else {
        name = this.parent!.name + `Union`;
      }
    }

    this.name = name;
  }

}
