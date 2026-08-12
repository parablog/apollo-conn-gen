import { Factory, IType, Prop, ReferenceObject, Scalar, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export class Body extends Type {
  public schema: SchemaObject;
  public payload?: IType;

  constructor(parent: IType, name: string, schema: SchemaObject) {
    super(parent, name);
    this.schema = schema;
    this.kind = 'input'; // all children will have the same type
  }

  get id(): string {
    return 'body:' + this.name;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      trace(context, '-> [body:visit]', this.name + ' already visited.');
      return;
    }

    context.enter(this);
    trace(context, '-> [body:visit]', 'in ' + this.name);

    this.visitBody(context, 'Input', this.schema);
    this.visited = true;

    trace(context, '<- [body:visit]', 'out ' + this.name);
    context.leave(this);
  }
  public forPrompt(context: OasContext): string {
    return 'Body';
  }

  public generate(_context: OasContext, _writer: Writer, _selection: string[]): void {
    // do nothing for body, it will be added automatically
  }

  dependencies(): IType[] {
    return this.payload && !this.isEmptyBody() ? [this.payload] : [];
  }

  // A body a mapping cannot send: no fields of its own and no member that has any. A single value
  // (a Scalar) is NOT this — it is sent whole. e.g. (fieldless-bodies.yaml) { type: object, properties: {} }  #67
  public isEmptyBody(): boolean {
    const payload = this.payload;
    if (!payload || payload instanceof Scalar) {
      return false;
    }
    if (payload.props.size > 0) {
      return false;
    }
    // the children that are not props are the allOf/oneOf members; members that are all scalars
    // carry no fields to pick either. e.g. (github patch:/gists/{gist_id}) a body union of JSON members  #67
    const members = Array.from(payload.children).filter((child) => !(child instanceof Prop));
    return members.length === 0 || members.every((member) => member instanceof Scalar);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [body:select]', `-> in: ${this.parent!.name}`);

    const spacing = ' '.repeat(8);

    if (this.payload instanceof Scalar) {
      // one value, we send it as a whole. #67
      writer.write(spacing + 'body: "$args.input"\n');
    } else if (this.payload && !this.isEmptyBody()) {
      writer.write(spacing + 'body: """\n').write(spacing + '$args.input {\n');

      context.indent += 2;
      this.payload.select(context, writer, selection);
      context.indent -= 2;

      writer.write(spacing + '}\n').write(spacing + '"""\n');
    }

    trace(context, '<- [body:select]', `-> out: ${this.parent!.name}`);
  }

  private visitBody(context: OasContext, name: string, schema: SchemaObject | ReferenceObject): void {
    trace(context, '-> [post::body::content]', 'in ' + this.name);

    if ('$ref' in schema) {
      this.visitBodyRef(context, schema as ReferenceObject);
    }
    // If the response has a content property, we need to find the JSON content.
    else if (schema) {
      const type = Factory.fromSchema(context, this, schema as SchemaObject);
      this.add(type);

      this.payload = type;
      // a scalar keeps its name — it IS the type the argument writes. e.g. { nullable: true } -> JSON  #67
      if (!(type instanceof Scalar)) {
        this.payload!.name = name;
      }
    }
    // don't know how to handle this yet
    else {
      throw new Error('Not yet implemented for: ' + JSON.stringify(schema));
    }

    trace(context, '<- [post::body::content]', 'out ' + this.name);
  }

  private visitBodyRef(context: OasContext, ref: ReferenceObject): void {
    trace(context, '-> [post::body::ref]', `in: ${this.name}, ref: ${ref.$ref}`);

    const lookup = context.lookupRef(ref.$ref!);
    if (!lookup) {
      throw new Error('Could not find a response with ref: ' + ref.$ref);
    }

    if ('$ref' in lookup) {
      throw new Error('Not yet implemented for nested refs');
    }

    this.visitBody(context, ref.$ref, lookup as SchemaObject);
    trace(context, '<- [post::body::ref]', `out: ${this.name}, ref: ${ref.$ref}`);
  }
}
