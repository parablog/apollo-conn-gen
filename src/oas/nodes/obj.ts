import { Arr, Body, Factory, Get, IType, PropArray, Type, Res, T } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import type { EntityResolver } from './entity.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

import _ from 'lodash';

export class Obj extends Type {
  nameConflict: boolean = false;
  // R1: type-level entity resolvers discovered for this type (empty unless inferred).
  // Set by `inferEntityResolvers`; drives @key + type-level @connect/$this in generate().
  entityResolvers: EntityResolver[] = [];
  // R2: when promoted to a GraphQL interface (a shared allOf base of a discriminated oneOf),
  // emit `interface` instead of `type`. Id-neutral on purpose — `id` embeds `kind`, so we must
  // NOT mutate `kind` (it would desync generatedSet/dedup/deletion keys). Set by promoteInterfaces.
  emitAsInterface: boolean = false;

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

    // A non-$ref inline object whose name is already taken is a different shape that would collapse
    // onto the existing type (dropping fields) — qualify it. Skip `[inline:…]` consolidated allOf/oneOf
    // members (comp.ts:220, updateName below): they fold into their parent Composed and never emit
    // standalone, so they must keep a shared id for duplicate $ref instances to dedup. see docs/issues.md #9
    if (context.types.has(this.name) && !T.isRef(this.name) && !this.name.startsWith('[inline:')) {
      this.resolveNameConflict(context);
    }

    this.visitProperties(context);
    this.visited = true;

    if (this.name) {
      if (!T.isRef(this.name) && context.types.has(this.name)) this.nameConflict = true;
      else context.store(this.name, this);
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
      .write(this.emitAsInterface ? 'interface ' : this.kind + ' ')
      .write(sanitised === refName ? refName : sanitised)
      .write(this.nameSuffix());

    // Entity resolution (R1): when this type was identified as an entity, emit one
    // repeatable @key per distinct key (sorted, deterministic) plus a type-level
    // @connect resolver per discovered GET-by-key endpoint. This is the modern
    // Connectors form — the resolver lives on the type via $this, keeping federation
    // plumbing off the public Query type.
    const resolvers = this.entityResolvers;
    if (resolvers.length > 0) {
      for (const key of Array.from(new Set(resolvers.map((r) => r.keyFields))).sort()) {
        writer.write(` @key(fields: "${key}")`);
      }
      for (const resolver of resolvers) {
        this.writeEntityConnector(context, writer, resolver, selection);
      }
      writer.write('\n{\n');
    } else {
      writer.write(' {\n');
    }

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

  /**
   * Emit a type-level `@connect` entity resolver (R1). The resolver fetches this entity by
   * its key via the discovered GET-by-key endpoint, using `$this.<key>` (the entity's own
   * key fields) instead of the `$args.<name>` a Query-field connector would use. The
   * selection re-uses this object's own field selection, exactly like the response mapping
   * of the equivalent Query connector.
   */
  private writeEntityConnector(
    context: OasContext,
    writer: Writer,
    resolver: EntityResolver,
    selection: string[],
  ): void {
    const i4 = ' '.repeat(4);
    const i6 = ' '.repeat(6);

    // Rewrite each {param} to {$this.param} (vs {$args.param} for Query-field connectors).
    const path = resolver.path.replace(/\{([a-zA-Z0-9]+)\}/g, '{$this.$1}');

    writer
      .write('\n')
      .write(i4)
      .write('@connect(\n')
      .write(i6)
      .write(`source: "${resolver.source}"\n`)
      .write(i6)
      .write(`http: { ${resolver.verb}: "${path}" }\n`)
      .write(i6)
      .write('selection: """\n');

    // Base the selection at 6 spaces like a Query connector. `select` adds
    // `context.stack.length` (this object is mid-generation on the stack), so subtract it.
    context.indent = 6 - context.stack.length;
    this.select(context, writer, selection);

    writer.write(i6).write('"""\n').write(i4).write(')');
  }

  private visitProperties(context: OasContext): void {
    const hasProperties = this.schema.properties && Object.keys(this.schema.properties).length > 0;
    const hasAdditionalProperties =
      this.schema.additionalProperties && typeof this.schema.additionalProperties === 'object';

    if (!hasProperties && !hasAdditionalProperties) {
      return;
    }

    trace(
      context,
      '-> [obj::props]',
      `processing ${hasProperties ? 'properties' : ''}${hasProperties && hasAdditionalProperties ? ' and ' : ''}${hasAdditionalProperties ? 'additionalProperties' : ''}`,
    );

    if (hasProperties) {
      const properties = this.schema.properties as Record<string, SchemaObject>;
      const sorted = Object.entries(properties).sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()));

      for (const [key, schemaValue] of sorted) {
        const prop = Factory.fromProp(context, this, key, schemaValue);
        this.props.set(prop.name, prop);

        if (!this.children.includes(prop)) {
          this.add(prop);
        }
      }
    }

    if (hasAdditionalProperties) {
      const additionalProp = Factory.fromProp(
        context,
        this,
        '[key: string]',
        this.schema.additionalProperties as SchemaObject,
      );
      this.props.set(additionalProp.name, additionalProp);

      if (!this.children.includes(additionalProp)) {
        this.add(additionalProp);
      }
    }

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

  // Qualify a colliding inline name with its container (nearest non-prop ancestor), e.g. `listPrice`
  // under `offersItem` -> `OffersItemListPrice`, bumping `2`, `3`… until free. Both parts go through
  // genTypeName so the result is always a valid identifier (the container name may itself be an
  // `[inline:…]` placeholder) and is idempotent under emission. see docs/issues.md #9
  private resolveNameConflict(context: OasContext) {
    const base = Naming.genTypeName(T.findNonPropParent(this.parent!).name) + Naming.genTypeName(this.name);
    let candidate = base;
    for (let n = 2; context.types.has(candidate); n++) {
      candidate = `${base}${n}`;
    }
    this.name = candidate;
  }
}
