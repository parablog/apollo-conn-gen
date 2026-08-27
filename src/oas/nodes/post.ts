import { Arr, Factory, Get, Body, ReferenceObject, Scalar, T, Type } from './internal.js';
import { Writer } from '../io/writer.js';
import { OasContext } from '../oasContext.js';
import { Operation } from 'oas/operation';
import { SchemaObject } from 'oas/types';
import { trace, warn } from '../log/trace.js';
import { Media } from '../utils/media.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import _ from 'lodash';

// container for the schema and media types, so we can
// include www-encoded bodies
interface ReferencedBody {
  schema: SchemaObject;
  mediaType: string;
}

export class Post extends Get {
  public body?: Body;
  public verb: string = 'POST';

  constructor(
    name: string,
    public operation: Operation,
  ) {
    super(name, operation);
  }

  get id(): string {
    return `post:${this.name}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      trace(context, '-> [post:visit]', this.name + ' already visited.');
      return;
    }

    context.enter(this);
    trace(context, '-> [post:visit]', 'in ' + this.name);

    // 1. Visit params.
    this.visitParameters(context);

    // 2. Visit body
    this.visitBody(context);

    // 3. Visit responses
    this.visitResponses(context);
    this.visited = true;

    trace(context, '<- [post:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public getGqlOpName(): string {
    if (this.renamedTo) return this.renamedTo;
    return 'create' + _.upperFirst(Naming.genOperationName(this.operation.path, this.operation));
  }

  public forPrompt(_context: OasContext): string {
    return `[post] ${this.name}`;
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    throw new Error('select not implemented.');
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [post::generate]', `-> in: ${this.name}`);

    const summary = this.operation.getSummary();
    const originalPath = this.operation.path;
    const keep = context.generateOptions?.keepFieldNames === true;
    const jsonReason = this.resultJsonReason(selection, keep);
    const paramsLine = this.paramsDocLine(context);
    const responseFieldsLine = this.responseFieldsDocLine(context, selection);

    if (summary || originalPath || jsonReason || paramsLine || responseFieldsLine) {
      writer.write('  """\n').write('  ');
      if (summary) {
        writer.write(summary).write(' ');
      }
      if (originalPath) {
        writer.write('(').write(originalPath).write(')');
      }
      if (jsonReason) {
        writer.write('\n\n  ').write(Schemas.withJsonNote({}, jsonReason).description!);
      }
      if (paramsLine) {
        writer.write('\n\n  ').write(paramsLine);
      }
      if (responseFieldsLine) {
        writer.write('\n\n  ').write(responseFieldsLine);
      }
      writer.write('\n  """\n');
    }

    this.writeOpName(context, writer);

    this.generateParameters(context, writer, selection, this.bodyArg());

    if (this.resultType) {
      writer.write(': ');
      this.resultType.generate(context, writer, selection);
    }

    writer.write('\n');
    trace(context, '<- [post::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  private visitBody(context: OasContext) {
    trace(context, '-> [post::visitBody]', `in: ${this.name}`);

    const mediaTypes = this.operation.getRequestBodyMediaTypes();
    if (mediaTypes.length === 0) {
      // `requestBody: { $ref: '#/components/requestBodies/…' }` reports no media types — the
      // mutation used to come out with no input and no body at all. see docs/FIXED.md #74
      const referenced = this.resolveBodySchemaReference(context);
      if (referenced) {
        this.body = Factory.fromBody(context, this, referenced.schema, referenced.mediaType) as Body;
        this.body.visit(context);
      }
      return;
    }

    const mediaType = Post.findSendableMediaType(mediaTypes);
    if (!mediaType) {
      const multipart = this.findSendablePlainMultipart(mediaTypes);
      if (multipart) {
        this.body = Factory.fromBody(context, this, multipart.schema, multipart.mediaType) as Body;
        this.body.visit(context);
        return;
      }

      warn(context, '  [post::visitBody]', `Cannot send ${mediaTypes.join(', ')}: ${this.name} goes out with no body.`);
      return;
    }

    const body = this.operation.getRequestBody(mediaType);
    if (!body) {
      warn(context, '  [post::visitBody]', `No valid body found!`);
      return;
    }

    // if it is an array, throw an error for now
    if (Array.isArray(body)) {
      throw new Error('Array body not yet implemented.');
    }

    if (!body.schema) {
      warn(context, '  [post::visitBody]', `No schema found!`);
      return;
    }

    this.body = Factory.fromBody(context, this, body.schema, mediaType) as Body;
    this.body.visit(context);

    trace(context, '<- [post::visitBody]', `out: ${this.name}`);
  }

  // Find which content type the body is read from: JSON if the operation offers it, else a form.
  // Multipart and binary have no mapping we can write, so they are not picked at all.
  // e.g. (stripe) post:/v1/customers: [application/x-www-form-urlencoded] -> the form   #83
  private static findSendableMediaType(mediaTypes: string[]): string | undefined {
    const json = Media.findJsonMediaType(mediaTypes);
    return json ?? mediaTypes.find((type) => type.toLowerCase().startsWith('application/x-www-form-urlencoded'));
  }

  // A multipart body whose fields are all plain text is sent as a form instead of dropped, the same
  // way #83 already sends `application/x-www-form-urlencoded` bodies.
  // e.g. (swagger2-formdata.yaml) /upload's title and description fields -> sent as a form   #137
  private findSendablePlainMultipart(mediaTypes: string[]): ReferencedBody | undefined {
    const multipart = mediaTypes.find((type) => type.toLowerCase().startsWith('multipart/form-data'));
    if (!multipart) return undefined;

    const body = this.operation.getRequestBody(multipart);
    if (!body || Array.isArray(body) || !body.schema || !Schemas.isPlainStringForm(body.schema)) {
      return undefined;
    }
    return { schema: body.schema, mediaType: 'application/x-www-form-urlencoded' };
  }

  // The schema inside a body the spec wrote as a reference. e.g. (request-body-component-ref.yaml)
  //   requestBody: { $ref: '#/components/requestBodies/CreateThing' }   <- resolved here
  //   CreateThing: { required: true, content: { application/json: { schema: $ref Thing } } }
  private resolveBodySchemaReference(context: OasContext): ReferencedBody | undefined {
    const raw = _.get(this.operation, 'schema.requestBody') as ReferenceObject | undefined;
    // if there's no reference, bail
    if (!raw || !('$ref' in raw)) {
      return undefined;
    }

    // resolve the pointer
    const requestBody = context.resolvePointer(raw.$ref) as
      | { content?: Record<string, { schema?: SchemaObject }> }
      | undefined;

    const content = requestBody?.content ?? {};
    const contentTypes = Object.keys(content);
    const mediaType = Post.findSendableMediaType(contentTypes);
    if (!mediaType) {
      if (contentTypes.length > 0) {
        warn(
          context,
          '  [post::visitBody]',
          `Cannot send ${contentTypes.join(', ')}: ${this.name} goes out with no body.`,
        );
      }
      return undefined;
    }

    const schema = content[mediaType].schema;
    return schema ? { schema, mediaType } : undefined;
  }

  // The `input:` argument for the op's body, or undefined when there is none. The argument
  // and the type definition must write the same name, e.g. `ssh_keys` -> `SshKeysItemInput` in both. #15 #30
  private bodyArg(): string | undefined {
    if (!this.body || !this.body.payload) return undefined;

    // A body with nothing to send takes no argument — its name would point at a type that is
    // never written. e.g. (fieldless-bodies.yaml) { type: object, properties: {} } emitted `input: InputInput!`  #67
    if (this.body.isEmptyBody()) return undefined;

    // A body that is one value takes it whole. e.g. (fieldless-bodies.yaml) { nullable: true } -> input: JSON!  #67
    if (this.body.payload instanceof Scalar) {
      return 'input: ' + this.body.payload.name + '!';
    }

    // A body that is an array takes the item's type, as a list. e.g. gong `fields`:
    // { type: array, items: $ref GenericSchemaFieldRequest } -> [GenericSchemaFieldRequestInput!]!  #66
    if (this.body.payload instanceof Arr) {
      const item = this.body.payload.itemsType as Type;
      const itemName = T.isContainer(item) ? Naming.genTypeName(item.name) + item.nameSuffix() : item.name;
      return 'input: [' + itemName + '!]!';
    }

    const payload = this.body.payload as Type;
    const sanitised = Naming.genTypeName(payload.name!);
    const refName = Naming.getRefName(payload.name!);
    return 'input: ' + (sanitised === refName ? refName : sanitised) + payload.nameSuffix() + '!';
  }
}
