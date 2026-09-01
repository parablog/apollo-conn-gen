import { Arr, Body, Composed, Factory, Get, IType, Prop, PropArray, Type, Res, T } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import type { EntityResolver } from './entity.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

import _ from 'lodash';

export class Obj extends Type {
  // R1: type-level entity resolvers discovered for this type (empty unless inferred).
  // Set by `inferEntityResolvers`; drives @key + type-level @connect/$this in generate().
  entityResolvers: EntityResolver[] = [];
  // #161: key-only reference fields discovered for this type (empty unless inferred).
  // Set by `inferEntityLinks`; flows through generate()/select()/dependencies() via selectedProps().
  entityLinkProps: Prop[] = [];
  // R2: when promoted to a GraphQL interface (a shared allOf base of a discriminated oneOf),
  // emit `interface` instead of `type`. Id-neutral on purpose — `id` embeds `kind`, so we must
  // NOT mutate `kind` (it would desync generatedSet/dedup/deletion keys). Set by promoteAllOfBase.
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

    if (!context.inContextOf(Composed, this)) {
      trace(context, '[obj]', 'In object: ' + (this.name ? this.name : this.parent?.name));
    }

    const collides =
      T.collidesWithStoredType(this, context) ||
      T.collidesWithContainedComponent(this) ||
      T.collidesWithReservedComponentName(this, context);
    if (collides) {
      T.resolveNameConflict(this, context);
    }

    this.visitProperties(context);
    this.visited = true;

    // register as the occupant that later same-named types check against. see #9/#12
    if (this.name && !this.nameOwnedByAnother(context)) {
      context.store(this.name, this);
    }

    trace(context, '<- [obj:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    if (_.isEmpty(this.props)) {
      return;
    }

    if (context.inContextOf(Res, this)) {
      writer.write(Naming.genTypeName(this.name));
      return;
    }

    // a type with every field removed would print nothing real between its braces, which does
    // not parse; its references are JSON (propObj), so nothing points here. see docs/FIXED.md #101
    //   e.g. (confluence) type Contributors { # publishers: … - circular reference omitted }
    if (T.everyFieldRemoved(this, context)) {
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
    const keep = context.generateOptions?.keepFieldNames === true;
    const resolvers = this.entityResolvers;
    if (resolvers.length > 0) {
      for (const key of Array.from(new Set(resolvers.map((r) => r.keyFields))).sort()) {
        const sanitisedKey = key
          .split(' ')
          .map((field) => this.props.get(field)?.renamedTo ?? Naming.sanitiseField(field, keep))
          .join(' ');
        writer.write(` @key(fields: "${sanitisedKey}")`);
      }
      for (const resolver of resolvers) {
        if (resolver.batch) {
          this.writeBatchConnector(context, writer, resolver, selection);
        } else {
          this.writeEntityConnector(context, writer, resolver, selection);
        }
      }
      writer.write('\n{\n');
    } else {
      writer.write(' {\n');
    }

    const selected = this.selectedProps(selection, keep);
    // a field cycle detection removed on another route is not written here either — the comment
    // takes its place. #89
    const overrides = context.propOverrides.get(this.id);

    for (const prop of selected) {
      const emitted = (overrides?.get(prop.name) as typeof prop) ?? prop;
      trace(context, '-> [obj::generate]', `-> property: ${emitted.name} (parent: ${emitted.parent!.name})`);
      emitted.generate(context, writer, selection);
    }

    writer.write('}\n\n');

    trace(context, '<- [obj::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  // siblings that clean to one field name write once — generate, select and dependencies all
  // read this list, so the three agree. e.g. (trello) prefs/background + prefs_background  #69
  public override selectedProps(selection: string[], keep: boolean) {
    return T.numberTwinFields([...super.selectedProps(selection, keep), ...this.entityLinkProps], keep);
  }

  // the selected props (a field removed on another route swapped for its comment, like generate does — #89)
  dependencies(context: OasContext, selection: string[]): IType[] {
    const overrides = context.propOverrides.get(this.id);
    const keep = context.generateOptions?.keepFieldNames === true;
    return this.selectedProps(selection, keep).map((prop) => overrides?.get(prop.name) ?? prop);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [obj::select]', `-> in: ${this.name}`);

    // a route that kept the field writes the same comment as the routes where it was removed. #89
    const overrides = context.propOverrides.get(this.id);
    const keep = context.generateOptions?.keepFieldNames === true;
    const selected = this.selectedProps(selection, keep);
    for (const prop of selected) {
      (overrides?.get(prop.name) ?? prop).select(context, writer, selection);
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
    const keep = context.generateOptions?.keepFieldNames === true;
    const path = resolver.path.replace(
      /\{([a-zA-Z0-9_]+)\}/g,
      (_match, param) => `{$this.${this.props.get(param)?.renamedTo ?? Naming.sanitiseField(param, keep)}}`,
    );

    writer
      .write('\n')
      .write(i4)
      .write('@connect(\n')
      .write(i6)
      .write(`source: "${resolver.source}"\n`)
      .write(i6);

    // The op this resolver was inferred from may carry per-@connect auth (a per-op-mode header,
    // or apiKey-in-query in any mode — @source has no queryParams). Without it the router-side
    // entity fetch hits the protected endpoint unauthenticated. Same emission shape as an op
    // connector's requestMethod; uniform-mode header auth stays on @source and is not repeated.
    if (resolver.headerAuth || resolver.queryAuth) {
      const i8 = ' '.repeat(8);
      writer.write('http: {\n').write(i8).write(`${resolver.verb}: "${path}"\n`);
      if (resolver.queryAuth) {
        writer
          .write(i8)
          .write('queryParams: """\n')
          .write(' '.repeat(10))
          .write(`"${resolver.queryAuth.name}": ${resolver.queryAuth.value}\n`)
          .write(i8)
          .write('"""\n');
      }
      if (resolver.headerAuth) {
        writer
          .write(i8)
          .write('headers: [{ name: "')
          .write(resolver.headerAuth.name)
          .write('", value: "')
          .write(resolver.headerAuth.value)
          .write('" }]\n');
      }
      writer.write(i6).write('}\n');
    } else {
      writer.write(`http: { ${resolver.verb}: "${path}" }\n`);
    }

    writer.write(i6).write('selection: """\n');

    // Base the selection at 6 spaces like a Query connector. `select` adds
    // `context.stack.length` (this object is mid-generation on the stack), so subtract it.
    context.indent = 6 - context.stack.length;
    this.select(context, writer, selection);

    writer.write(i6).write('"""\n').write(i4).write(')');
  }

  // R6: a batch @connect — like writeEntityConnector, but $batch replaces $this, the keys ride in
  // the request (queryParams or body), and a `batch: { maxSize }` cap is added.
  private writeBatchConnector(
    context: OasContext,
    writer: Writer,
    resolver: EntityResolver,
    selection: string[],
  ): void {
    const i4 = ' '.repeat(4);
    const i6 = ' '.repeat(6);
    const i8 = ' '.repeat(8);
    const batchSpec = resolver.batch!;

    writer
      .write('\n')
      .write(i4)
      .write('@connect(\n')
      .write(i6)
      .write(`source: "${resolver.source}"\n`)
      .write(i6)
      .write(`http: { ${resolver.verb}: "${resolver.path}"\n`);

    // the keys: a query param (`id: $batch.id`) or a request body (`ids: $batch.id`)
    const label = batchSpec.queryParams ? 'queryParams' : 'body';
    const value = batchSpec.queryParams ?? batchSpec.body!;
    writer
      .write(i8)
      .write(`${label}: """\n`)
      .write(i8)
      .write(value + '\n')
      .write(i8)
      .write('"""\n')
      .write(i6)
      .write('}\n');

    // selection reuses the entity's own fields; wrap as `$.results { … }` for a wrapped response
    writer.write(i6).write('selection: """\n');
    if (batchSpec.wrapperKey) {
      writer.write(i6).write(`$.${batchSpec.wrapperKey} {\n`);
    }
    context.indent = (batchSpec.wrapperKey ? 8 : 6) - context.stack.length;
    this.select(context, writer, selection);
    if (batchSpec.wrapperKey) {
      writer.write(i6).write('}\n');
    }
    writer.write(i6).write('"""\n');

    writer.write(i6).write(`batch: { maxSize: ${batchSpec.maxSize} }\n`).write(i4).write(')');
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

    // The key is always there, but the value may still be null — that field stays nullable.
    // e.g. reqNullable: { type: string, nullable: true } -> String. #55. A collapsed anyOf (#177)
    // moves prop.schema elsewhere, so the property's own declared schema is checked too.
    if (_.isArray(this.schema.required)) {
      const properties = this.schema.properties as Record<string, SchemaObject> | undefined;
      this.schema.required.forEach((name) => {
        const prop = this.props.get(name);
        const declared = properties?.[name];
        if (prop && prop.schema?.nullable !== true && declared?.nullable !== true) prop.required = true;
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

  // another non-ref type still owns this name (we were exempt from renaming) — don't replace it. see #9
  private nameOwnedByAnother(context: OasContext): boolean {
    return !T.isRef(this.name) && context.types.has(this.name);
  }
}
