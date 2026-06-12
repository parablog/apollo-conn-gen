import { Composed, Factory, Get, IType, Prop, Res, T, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class Union extends Type {
  public schemas: SchemaObject[];
  // OAS discriminator: `propertyName` is the source JSON field carrying the type tag,
  // `discriminatorMapping` maps each tag value to a schema ref (value -> "#/.../Type").
  public discriminator?: string;
  public discriminatorMapping?: Record<string, string>;
  // R2: when this discriminated union's members all share one allOf base, it is promoted to a
  // GraphQL interface. `interfaceBaseRef` is the base schema ref ("#/.../Product"); when set,
  // generate() returns the interface name (not the union name) and emits no `union` line. Set by
  // promoteInterfaces (a post-collect pass) — never in visit().
  public interfaceBaseRef?: string;

  constructor(
    parent: IType,
    name: string,
    schemas: SchemaObject[],
    public consolidated: boolean = false,
    disc?: { propertyName?: string; mapping?: Record<string, string> },
  ) {
    super(parent, name);
    this.schemas = schemas;
    this.discriminator = disc?.propertyName;
    this.discriminatorMapping = disc?.mapping;
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
      // members are absorbed into the merged object whenever we downgrade — in consolidate
      // mode, and in v0.4 mode when there is no discriminator (no tag field for ->match, so
      // generate() emits the merged object there too). see docs/issues.md #25
      if (context.generateOptions.consolidateUnions || !this.discriminator) {
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
      // R2: when promoted to an interface, the field returns the base interface, not the union name.
      writer.write(Naming.genTypeName(this.interfaceBaseRef ?? this.name));
      return;
    }
    // generate traditional union
    else {
      // Definition/reference agreement, like comp.ts: references emit genTypeName(name), so the
      // union line (and its consolidate-downgrade type) must too. see docs/issues.md #15, #6
      const sanitised = Naming.genTypeName(this.name);
      const refName = Naming.getRefName(this.name);
      const name = sanitised === refName ? refName : sanitised;

      if (context.generateOptions.consolidateUnions) {
        this.generateMergedObject(context, writer, selection, name, '#### NOT SUPPORTED YET BY CONNECTORS!!! union ');
      } else if (!this.discriminator) {
        // No tag field for `->match` to dispatch on, so a real union cannot be selected — the
        // selection already falls back to the flat merged form (see select); emit the matching
        // merged object here, or SDL says `union` while the selection selects a group on it
        // (GROUP_SELECTION_IS_NOT_OBJECT). see docs/issues.md #25
        this.generateMergedObject(context, writer, selection, name, '#### no discriminator — union degraded to a merged object: ');
      } else if (this.interfaceBaseRef) {
        // R2: promoted to an interface — the base (emitted as `interface`) and the members
        // (each `... implements Base`) carry the type system; emit no `union X = A | B` line.
        trace(context, '   [union::generate]', `[interface] suppressing union line for ${this.name}`);
      } else {
        // add the prop parent paths to a set so we can only include those parents that have been selected
        const propParentsPathSet = new Set(this.selectedProps(selection).map((p) => p.parent!.path()));

        // we should only include the names of those properties that have been selected
        const filtered = this.children.filter((c) => propParentsPathSet.has(c.path()));

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

  // The downgrade shape both passes share: an info comment naming the original union, then one
  // object type carrying every member's selected fields (the selection selects the same flat set).
  private generateMergedObject(
    context: OasContext,
    writer: Writer,
    selection: string[],
    name: string,
    headline: string,
  ): void {
    if (!this.consolidated) {
      this.consolidate(selection).forEach((type) => context.decRefCount(type.name));
    }

    const childrenTypes = this.children.map((child) => Naming.getRefName(child.name));
    writer.write(headline).write(name).write(' = ').write(childrenTypes.join(' | ')).write('\n\n');

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
      if (!generated.has(prop.id)) prop.generate(context, writer, selection);
      generated.add(prop.id);
    }

    writer.write('} \n### End replacement for ').write(this.name).write('\n\n');
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [union::select]', `-> in: ${this.name}`);

    if (!this.consolidated) {
      this.consolidate(selection);
    }

    // R2: when we emit a *real* `union X = A | B` (not the consolidate downgrade) and the
    // spec gives us a discriminator, produce the composable abstract-type selection
    // (connect v0.4): a spread `->match` whose branches set a string-literal __typename per
    // concrete member. Without a discriminator, or when consolidating, fall back to the flat
    // merged selection (the consolidate-downgrade shape).
    if (!context.generateOptions.consolidateUnions && this.discriminator) {
      this.selectAbstract(context, writer, selection);
      trace(context, '<- [union::select]', `-> out: ${this.name}`);
      return;
    }

    const selected = this.selectedProps(selection);
    const generated = new Set<string>();
    for (const prop of selected) {
      if (!generated.has(prop.id)) prop.select(context, writer, selection);
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

  /**
   * R2: emit the connect-v0.4 abstract-type selection for a real union. Shape (verified to
   * compose under fed v2.13 / connect v0.4):
   *
   *   ... <discriminator>->match(
   *     ["<value>", $ { __typename: $("Book") <Book fields> }],
   *     ["<value>", $ { __typename: $("Movie") <Movie fields> }]
   *   )
   *
   * `__typename` is a string literal (required by the composer); per-member fields come from
   * each member's own `select`, scoped by the current selection.
   */
  private selectAbstract(context: OasContext, writer: Writer, selection: string[]): void {
    const base = context.indent;
    const pad = (n: number) => ' '.repeat(Math.max(n, 0));

    // The match operates on the *source* JSON field; quote it if not a bare identifier
    // (e.g. OAS discriminators like `@type`).
    const field = /^[_A-Za-z][_0-9A-Za-z]*$/.test(this.discriminator!)
      ? this.discriminator!
      : `"${this.discriminator!}"`;

    // Only members with at least one selected prop participate.
    const members = this.children.filter((child) =>
      Array.from(child.props.values()).some((p) => selection.find((s) => s.startsWith(p.path()))),
    );

    writer.write(pad(base)).write(`... ${field}->match(\n`);

    members.forEach((child, idx) => {
      const typeName = Naming.getRefName(child.name)!;
      const value = this.discriminatorValue(child) ?? typeName.toLowerCase();

      writer.write(pad(base + 2)).write(`["${value}", $ {\n`);
      writer.write(pad(base + 4)).write(`__typename: $("${typeName}")\n`);

      // Member fields via the child's own select (scoped by selection). `select` writes at
      // `context.indent + stack.length`, so offset indent to land fields at base + 4.
      const savedIndent = context.indent;
      context.indent = base + 4 - context.stack.length;
      child.select(context, writer, selection);
      context.indent = savedIndent;

      writer
        .write(pad(base + 2))
        .write(idx < members.length - 1 ? '}],' : '}]')
        .write('\n');
    });

    writer.write(pad(base)).write(')\n');
  }

  /** Reverse-lookup an OAS discriminator value (e.g. "book") for a concrete member type. */
  private discriminatorValue(child: IType): string | null {
    const mapping = this.discriminatorMapping;
    if (!mapping) return null;
    const childRef = Naming.getRefName(child.name);
    for (const [value, ref] of Object.entries(mapping)) {
      if (Naming.getRefName(ref) === childRef) return value;
    }
    return null;
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
        .forEach((prop) => props.push(prop));

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
        .forEach((prop) => collected.push(prop));
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
