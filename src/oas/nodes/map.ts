import { Arr, Composed, Factory, IType, Obj, Res, Type, T, Scalar } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class Map extends Type {
  public valueType?: IType;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
    this.updateName();
  }

  public forPrompt(_context: OasContext): string {
    return `[map] ${Naming.getRefName(this.name)}`;
  }

  get id(): string {
    return `map:${this.kind}:${this.name}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [map:visit]', 'in ' + this.name);

    // two maps can share a field name but hold different values — the second one takes a new name (#9).
    // e.g. (stripe) coupon and restrictions both have a currency_options map  #78
    if (this.name) {
      const ownedByOtherSide = T.ownedByOtherSide(this, context);
      if (!ownedByOtherSide && T.collidesWithStoredType(this, context)) {
        T.resolveNameConflict(this, context);
      }
      if (!ownedByOtherSide && !context.types.has(this.name)) {
        context.store(this.name, this);
      }
    }

    // resolve the name first: an inline value is named `[inline:<map name>]`, so two same-named
    // maps over different inline shapes must split before the value is built. see docs/FIXED.md #107
    // e.g. (github) base-gist and gist-simple both hold a files map with different value fields
    this.visitAdditionalProperties(context);
    this.visited = true;

    trace(context, '<- [map:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    if (!this.valueType) {
      return;
    }

    if (context.inContextOf(Res, this)) {
      // `->entries` answers a list, so a whole response that is a dictionary reads as a list of
      // entries. A map under a property already reads that way, from PropMap.getValue. see docs/FIXED.md #90
      writer.write('[').write(Naming.genTypeName(this.name)).write(this.nameSuffix()).write(']');
      return;
    }

    context.enter(this);
    trace(context, '-> [map::generate]', `-> in: ${this.name}`);

    const sanitised = Naming.genTypeName(this.name);
    const refName = Naming.getRefName(this.name);

    writer
      .write(this.kind + ' ')
      .write(sanitised === refName ? refName : sanitised)
      .write(this.nameSuffix())
      .write(' {\n');

    // Generate the map as an array of key-value pairs
    writer
      .write('  key: String\n') // Keys are always present in maps, but not necessarily required in schema
      .write('  value: ');

    // Write the value type name without hardcoded required markers
    if (this.valueType) {
      if (this.valueType instanceof Arr) {
        // For arrays, generate [ItemType] format (let the array type handle its own nullability)
        if (this.valueType.itemsType && this.valueType.itemsType.name) {
          writer.write('[' + this.valueTypeName(this.valueType.itemsType) + ']');
        } else {
          writer.write('[JSON]');
        }
      } else {
        // For other types, use the type name directly without hardcoded !
        writer.write(this.valueTypeName(this.valueType));
      }
    } else {
      writer.write('JSON');
    }
    writer.write('\n}\n\n');

    trace(context, '<- [map::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  // Returns the type name of the value, with a suffix if there's a ref to a container (i.e. for inputs):
  // e.g. github manifests: { additionalProperties: $ref manifest } -> value: ManifestInput  #68
  private valueTypeName(value: IType): string {
    // A value that would emit an empty type is never written (#19) — its value is free-form JSON.
    // Obj and Composed emit from their props; a Map always has key/value and a Union its members,
    // so neither degrades. e.g. (docker /commit) ExposedPorts: { additionalProperties: { type: object } } -> value: JSON  #70
    if ((value instanceof Obj || value instanceof Composed) && value.props.size === 0) {
      return 'JSON';
    }
    return Naming.genTypeName(value.name) + (T.isContainer(value) ? (value as Type).nameSuffix() : '');
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [map::select]', `-> in: ${this.name}`);

    // A map that is the whole response is read by Res.select, which owns the response root; here
    // the map is under a property, and PropMap has already written the field name and the arrow.
    if (this.valueType) {
      this.valueType.select(context, writer, selection);
    }

    trace(context, '<- [map::select]', `-> out: ${this.name}`);
  }

  // The `->entries { key value { … } }` body; the caller writes what comes in front of the arrow.
  // e.g. (map-response-root.yaml) `$` for a whole-response map, `labels` for one under a property.
  public selectEntries(context: OasContext, writer: Writer, selection: string[]): void {
    writer.write('->entries {').write('\n');
    context.enter(this);

    writer.write(' '.repeat(context.indent + context.stack.length)).write('key\n');
    writer.write(' '.repeat(context.indent + context.stack.length)).write('value');

    if (this.needsValueSelection()) {
      writer.write(' {').write('\n');
      context.enter(this);
      this.valueType!.select(context, writer, selection);
      context.leave(this);
      writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
    }
    writer.write('\n');

    context.leave(this);
    writer.write(' '.repeat(context.indent + context.stack.length)).write('}');
  }

  // a value with fields opens a `value { … }` block; a plain value is read whole. #70
  private needsValueSelection(): boolean {
    return Boolean(this.valueType && !T.isLeaf(this.valueType));
  }

  private visitAdditionalProperties(context: OasContext): void {
    // check if it's a map
    if (!this.schema.additionalProperties || typeof this.schema.additionalProperties !== 'object') {
      return;
    }

    const additionalProps = this.schema.additionalProperties as SchemaObject;

    // If additionalProperties is an empty object, create a JSON scalar type
    if (Object.keys(additionalProps).length === 0) {
      trace(context, '-> [map::additionalProps]', 'empty additionalProperties schema, using JSON');
      this.valueType = new Scalar(this, 'JSON', { type: 'object' } as SchemaObject);
      this.add(this.valueType);
      this.valueType.visit(context);
      trace(context, '<- [map::additionalProps]', 'out value type: JSON');
      return;
    }

    trace(context, '-> [map::additionalProps]', 'processing additional properties');

    this.valueType = Factory.fromSchema(context, this, additionalProps);
    this.add(this.valueType);
    this.valueType.visit(context);

    trace(context, '<- [map::additionalProps]', 'out value type: ' + this.valueType.name);
  }

  dependencies(): IType[] {
    return this.valueType ? [this.valueType] : [];
  }

  private updateName(): void {
    let name = this.name;

    // If we don't have a name, try to create one based on the parent
    if (!name || name === 'items') {
      const parent = this.parent;
      const parentName = parent?.name;

      if (parentName) {
        name = Naming.genTypeName(Naming.getRefName(parentName) + 'Entry');
      } else {
        name = '[inline:MapEntry]';
      }
    } else {
      // Add "Entry" suffix to existing names to make them more descriptive
      name = Naming.genTypeName(Naming.getRefName(name) + 'Entry');
    }

    this.name = name;
  }
}
