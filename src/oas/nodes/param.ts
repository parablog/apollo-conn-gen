import { Factory, IType, ReferenceObject, Type } from './internal.js';
import { ParameterObject, SchemaObject } from 'oas/types';
import _ from 'lodash';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class Param extends Type {
  public resultType!: IType;

  constructor(
    parent: IType,
    name: string,
    public schema: SchemaObject,
    public required: boolean,
    public defaultValue: unknown,
    public parameter: ParameterObject,
  ) {
    super(parent, name);
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [param:visit]', 'in: ' + this.name);

    // A GraphQL argument must be a single scalar; a param schema that is anyOf/oneOf (e.g.
    // DigitalOcean's `id | fingerprint` path param) has no single arg type — coerce to String.
    // see docs/issues.md #11
    const argSchema =
      this.schema && (this.schema.anyOf || this.schema.oneOf)
        ? ({ type: 'string' } as SchemaObject)
        : Param.degradeObjectLikeSchema(context, this.schema);
    const type = Factory.fromSchema(context, this, argSchema);
    this.add(type);

    this.resultType = type;
    trace(context, '   [param:visit]', 'type: ' + this.resultType);
    this.resultType.visit(context);

    trace(context, '<- [param:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [param::generate]', `-> in: ${this.name}`);

    writer.write(Naming.genParamName(this.name));
    writer.write(': ');

    this.resultType.generate(context, writer, selection);

    if (this.required) {
      writer.write('!');
    }

    if (this.defaultValue !== null && this.defaultValue !== undefined) {
      this.writeDefaultValue(writer);
    }

    trace(context, '<- [param::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public forPrompt(context: OasContext): string {
    return `Param{ name=${this.name}, required=${this.required}, defaultValue=${this.defaultValue}, props=${this.props}, resultType=${this.resultType} }`;
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    // do nothing
  }

  // A GraphQL argument can't carry an inline object/allOf body either (same problem as the
  // anyOf/oneOf coercion above) — degrade it, or just an array's items, to the existing
  // shapeless-object -> JSON scalar fallback (#19), so array cardinality survives ([JSON], not
  // JSON). see docs/issues.md #40
  private static degradeObjectLikeSchema(context: OasContext, schema: SchemaObject): SchemaObject {
    if (Param.isObjectLike(context, schema)) {
      return {} as SchemaObject;
    }
    if (schema?.type === 'array' && schema.items && Param.isObjectLike(context, schema.items as SchemaObject)) {
      return { ...schema, items: {} } as SchemaObject;
    }
    return schema;
  }

  // resolves a bare $ref (read-only — resolvePointer, not lookupRef, so this sniff doesn't bump
  // refCount for a schema we're about to discard) and checks whether it's the kind of object
  // Factory routes to Obj/Composed (oneOf/anyOf go through Union instead, already handled there).
  private static isObjectLike(context: OasContext, schema: SchemaObject | ReferenceObject | undefined): boolean {
    if (!schema) return false;
    const resolved = ('$ref' in schema ? context.resolvePointer(schema.$ref ?? null) : schema) as
      | SchemaObject
      | undefined;
    return !!resolved && (resolved.type === 'object' || resolved.allOf != null || !_.isEmpty(resolved.properties));
  }

  // Emit ` = <value>` only for types we can render as a GraphQL literal; otherwise skip the whole
  // default (a dangling ` = ` is a compose syntax error, an omitted default is always valid). #17
  private writeDefaultValue(writer: Writer): void {
    const value = this.defaultValue;

    if (typeof value === 'number') {
      writer.write(' = ').write(value.toString());
    } else if (typeof value === 'boolean') {
      writer.write(' = ').write(value ? 'true' : 'false');
    } else if (typeof value === 'string') {
      writer.write(' = "').write(String(value)).write('"');
    }
  }
}
