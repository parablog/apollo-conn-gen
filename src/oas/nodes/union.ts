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

      type.visit(context);
      trace(context, ' [union:visit]', 'of type: ' + type);
    }

    if (!context.inContextOf('Param', this)) {
      this.visitProperties(context);
    }

    if (this.name != null) {
      context.store(this.name, this);
      if (context.generateOptions.consolidateUnions) {
        this.children.forEach((child) => context.decRefCount(child.name));
      }
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
    } else if (context.inContextOf('Res', this)) {
      writer.write(Naming.genTypeName(this.name));
      return;
    }
    // generate traditional union
    else {
      const name = _.upperFirst(Naming.getRefName(this.name));

      if (context.generateOptions.consolidateUnions) {
        if (!this.consolidated) {
          this.consolidate(selection).forEach((type) => context.decRefCount(type.name));
        }

        // When generating this union in GQL it might look like:
        // union MyUnion = Type1 | Type2 | Type3
        writer.write('#### NOT SUPPORTED YET BY CONNECTORS!!! union ').write(name).write(' = ');

        const childrenTypes = this.children.map((child) => Naming.getRefName(child.name));
        const childrenNames = childrenTypes.join(' | ');
        writer.write(childrenNames).write('\n\n');

        trace(context, '   [union::generate]', `[union] -> object: ${this.name}`);

        writer
          .write(this.kind + ' ')
          .write(name)
          .write(this.nameSuffix())
          .write(' { #### replacement for Union ')
          .write(name)
          .write('\n');

        const selected = this.selectedProps(selection);
        const generated = new Set<string>();
        for (const prop of selected) {
          trace(context, '   [union::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
          if (!generated.has(prop.id))
            prop.generate(context, writer, selection);
          generated.add(prop.id);
        }

        writer.write('} \n### End replacement for ').write(this.name).write('\n\n');
      } else {
        // add the prop parent paths to a set so we can only include those parents that have been selected
        const propParentsPathSet = new Set(this.selectedProps(selection).map(p => p.parent!.path()));

        // we should only include the names of those properties that have been selected
        const filtered = this.children.filter(c => propParentsPathSet.has(c.path()));

        writer
          .write('union ')
          .write(name)
          .write(this.nameSuffix())
          .write(' = ')
          .write(filtered.map((child) => Naming.getRefName(child.name)).join(' | '))
          .write('\n\n');
      }
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
    const generated = new Set<string>();
    for (const prop of selected) {
      if (!generated.has(prop.id))
        prop.select(context, writer, selection);
      generated.add(prop.id);
    }

    /*if (context.generateOptions.consolidateUnions) {
      if (!this.consolidated) {
        this.consolidate(selection);
      }

      const selected = this.selectedProps(selection);
      const generated = new Set<string>();
      for (const prop of selected) {
        if (!generated.has(prop.id))
          prop.select(context, writer, selection);
        generated.add(prop.id);
      }
    } else {
      // add the prop parent paths to a set so we can only include those parents that have been selected
      const propParentsPathSet = new Set(this.selectedProps(selection).map(p => p.parent!.path()));

      // we should only include the names of those properties that have been selected
      this.children
        .filter(c => propParentsPathSet.has(c.path()))
        .forEach((child) => {
          child.select(context, writer, selection);
        });
    }*/

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

  public consolidate(selection: string[]): Set<IType> {
    T.composables(this).forEach((child) => {
      (child as Composed).consolidate(selection);
    });

    const ids: Set<IType> = new Set();
    const props: Prop[] = [];
    const discriminator = this.discriminator;

    this.children?.forEach((child) => {
      // .filter((prop) => selection.find((s) => s.startsWith(prop.path())))
      ids.add(child);

      Array.from(child.props.values())
        .filter((prop) => selection.find((s) => s.startsWith(prop.path())))
        .forEach(prop => props.push(prop));

      // props.push(...child.props.values());
    });

    // add the discriminator, if we have one
    if (discriminator) {
      const prop = (this.children || [])
        .map((child) => child.props.get(discriminator))
        .find((prop) => prop !== undefined);

      if (prop) props.push(prop);
    }

    // and finally sort the props and copy them to our original
    props.sort((a, b) => a.name.localeCompare(b.name)).forEach((prop) => this.props.set(prop.name, prop));

    // and return the types.ts we've used
    this.consolidated = true;

    // now remove every added ID
    const queue: IType[] = Array.from(this.children.values());
    while (queue.length > 0) {
      const node = queue.shift()!;
      const containers = T.containers(node);
      containers.forEach((c) => ids.add(c));
      // queue.push(...node.children);
    }

    return ids;
  }

  private visitProperties(_context: OasContext): void {
    // TODO: pending
  }

  public selectedProps(selection: string[]) {
    const collected: Prop[] = [];

    this.children.forEach((child) => {
      Array.from(child.props.values())
        .filter((prop) => selection.find((s) => s.startsWith(prop.path())))
        .forEach(prop => collected.push(prop));
    });

    return collected;
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
