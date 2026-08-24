import { Factory, IType, ReferenceObject, Scalar, Type } from './internal.js';
import { ParameterObject, SchemaObject } from 'oas/types';
import _ from 'lodash';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';

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
    // see docs/FIXED.md #11
    const argSchema =
      this.schema && (this.schema.anyOf || this.schema.oneOf)
        ? ({ type: 'string' } as SchemaObject)
        : Param.degradeObjectLikeSchema(context, this.schema);
    const type = Factory.fromSchema(context, this, argSchema);
    this.add(type);

    this.resultType = type;
    // Same ID promotion as fromProp's field sites in factory.ts, regardless of declared type. #142/#146
    const GQL_SCALARS = ['String', 'Int', 'Float', 'Boolean'];
    if (this.resultType instanceof Scalar && GQL_SCALARS.includes(this.resultType.name)) {
      const looksLikeId = this.name === 'id' || this.name.endsWith('Id') || this.name.endsWith('ID');
      if (looksLikeId) {
        this.resultType.name = 'ID';
      }
    }
    trace(context, '   [param:visit]', 'type: ' + this.resultType);
    this.resultType.visit(context);

    trace(context, '<- [param:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  // Why this argument's own type gave up and became plain JSON, or undefined for a real
  // scalar/object. e.g. `schema: { type: url }` names a type GraphQL has no scalar for.
  // see docs/FIXED.md #156
  private jsonReason(): string | undefined {
    return this.resultType instanceof Scalar ? this.resultType.jsonReason : undefined;
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [param::generate]', `-> in: ${this.name}`);

    // Arguments sit in one comma-separated list, so the note is a quoted string right before the
    // name: `"NEEDS ATTENTION: ..." filter: JSON`. Block-quote only if the text needs it.
    const reason = this.jsonReason();
    if (reason) {
      const note = Schemas.withJsonNote({}, reason).description!;
      if (note.includes('\n') || note.includes('\r') || note.includes('"') || note.includes('\\')) {
        writer.write('"""\n').write(note).write('\n""" ');
      } else {
        writer.write('"').write(note).write('" ');
      }
    }

    writer.write(Naming.genParamName(this.name));
    writer.write(': ');

    this.resultType.generate(context, writer, selection);

    // A required argument whose value may be null cannot take `!` — GraphQL cannot say "must be
    // sent, may be null". e.g. since: { required: true, schema: { type: string, nullable: true } }. #55
    if (this.required && this.schema?.nullable !== true) {
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
  // JSON). see docs/FIXED.md #40
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
    // an OAS param can declare `type: string` with a JSON number/boolean default (spec-authoring
    // slip) — writing it unquoted mismatches the arg's own String type. #127
    //   e.g. (omni) count: { type: string, default: 100 } -> String = "100", not String = 100
    const scalar = this.resultType instanceof Scalar ? this.resultType.name : undefined;

    if (scalar === 'String' && (typeof value === 'number' || typeof value === 'boolean')) {
      writer.write(' = "').write(String(value)).write('"');
    } else if (typeof value === 'number') {
      writer.write(' = ').write(value.toString());
    } else if (typeof value === 'boolean') {
      writer.write(' = ').write(value ? 'true' : 'false');
    } else if (typeof value === 'string') {
      writer.write(' = "').write(String(value)).write('"');
    }
  }
}
