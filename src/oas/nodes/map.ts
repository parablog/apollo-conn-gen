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

    this.visitAdditionalProperties(context);
    this.visited = true;

    // two maps can share a field name but hold different values — the second one takes a new name (#9).
    // e.g. (stripe) coupon and restrictions both have a currency_options map  #78
    if (this.name) {
      // look up the type already stored under this name, by its raw or written form (#12). When it
      // belongs to the other side (body vs response) both keep the name — one of them ends in Input.
      // e.g. (map-input-suffix.yaml) labels is on both sides: LabelsEntryInput and LabelsEntry  #78
      const stored = context.types.get(this.name) ?? context.types.get(Naming.genTypeName(this.name));
      const ownedByOtherSide = stored != null && stored.kind !== this.kind;
      if (!ownedByOtherSide && T.collidesWithStoredType(this, context)) {
        T.resolveNameConflict(this, context);
      }
      if (!ownedByOtherSide && !context.types.has(this.name)) {
        context.store(this.name, this);
      }
    }

    trace(context, '<- [map:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    if (!this.valueType) {
      return;
    }

    if (context.inContextOf(Res, this)) {
      writer.write(Naming.genTypeName(this.name));
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

    if (this.valueType) {
      this.valueType.select(context, writer, selection);
    }

    trace(context, '<- [map::select]', `-> out: ${this.name}`);
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
