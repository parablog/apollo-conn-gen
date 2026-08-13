import { IType, Type, Param, ReferenceObject, Factory, Op } from './internal.js';
import { Operation } from 'oas/operation';
import { MediaTypeObject, ParameterObject, ResponseObject, SchemaObject } from 'oas/types';

import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import { Params } from '../utils/params.js';
import { SYN_SUCCESS_RESPONSE } from '../schemas/index.js';
import _ from 'lodash';

const JSON_MEDIA_TYPE = /^application\/(?:.*\+)?json/i;

// the operation's `responses:` block, keyed by status code or `default`
type ResponsesByCode = Record<string, ResponseObject | ReferenceObject>;

export class Get extends Type implements Op {
  public verb: string = 'GET';

  public resultType?: IType;
  public params: Param[] = [];
  public summary?: string;
  public description?: string;

  constructor(
    name: string,
    public operation: Operation,
  ) {
    super(undefined, name);
    this.summary = operation.getSummary();
    this.description = operation.getDescription();
  }

  get id(): string {
    return `get:${this.name}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      trace(context, '-> [get:visit]', this.name + ' already visited.');
      return;
    }

    context.enter(this);
    trace(context, '-> [get:visit]', 'in ' + this.name);

    // 1. Visit params.
    this.visitParameters(context);

    // 2. Visit responses
    this.visitResponses(context);
    this.visited = true;

    trace(context, '<- [get:visit]', 'out ' + this.name);
    context.leave(this);
  }

  public forPrompt(_context: OasContext): string {
    return `[get] ${this.name}`;
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [get::generate]', `-> in: ${this.name}`);

    const description = this.operation.getDescription();
    const summary = this.operation.getSummary();
    const originalPath = this.operation.path;

    if (description || summary || originalPath) {
      writer.write('  """\n').write('  ');
      if (description) {
        writer.write(description).write(' ');
      }
      if (summary) {
        writer.write(summary).write(' ');
      }
      if (originalPath) {
        writer.write('(').write(originalPath).write(')');
      }
      writer.write('\n  """\n');
    }

    this.writeOpName(context, writer);
    this.generateParameters(context, writer, selection);

    if (this.resultType) {
      writer.write(': ');
      this.resultType.generate(context, writer, selection);
    }

    writer.write('\n');
    trace(context, '<- [get::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(_context: OasContext, _writer: Writer, _selection: string[]) {
    // do nothing
  }

  public getGqlOpName(): string {
    return Naming.genOperationName(this.operation.path, this.operation);
  }

  protected writeOpName(context: OasContext, writer: Writer): void {
    let name = this.getGqlOpName();

    // Use the new name mapper if available
    if (context.generateOptions.mapper) {
      name = context.generateOptions.mapper.operationName(name);
    }

    writer.write('  ').write(_.lowerFirst(name));
  }

  protected visitParameters(context: OasContext): void {
    trace(context, '-> [get::params]', 'in: ' + this.name);

    // a `$ref` parameter has no name of its own until it is resolved, and the match below needs one
    // e.g. (digitalocean) `$ref: '#/paths/~1widgets~1%7Bwidget_id%7D/get/parameters/0'`. see #3
    const declared = (this.operation.getParameters() ?? []).map((p) => {
      const resolved = '$ref' in p ? context.resolvePointer((p as ReferenceObject).$ref!) : undefined;
      return (resolved as ParameterObject) ?? p;
    });

    // every `{token}` in the path needs a parameter of the same name, whatever the spec called it
    // e.g. (omni) `get /v1/api-keys/{id}` declares no parameters at all. see docs/issues.md #81
    const parameters = Params.matchToPath(declared, this.operation.path);

    this.params = parameters
      .filter((p) => !p.in || (p.in && (p.in as string).toLowerCase() !== 'header'))
      .filter((p: ParameterObject) => {
        // If skipOptionalArgs is true, only include required parameters
        // Otherwise, include all parameters
        return context.generateOptions?.skipOptionalArgs ? p.required : true;
      })
      .map((p: ParameterObject) => this.visitParameter(context, this, p));

    trace(context, '<- [get::params]', 'out: ' + this.name);
  }

  protected visitResponses = (context: OasContext) => {
    const responses = (this.operation.schema.responses ?? {}) as ResponsesByCode;

    const code = this.findSuccessResponseCode(context, responses);
    if (!code) {
      // nothing documented we can read — synthesize the success response instead
      this.visitResponse(context, '200', SYN_SUCCESS_RESPONSE);
      return;
    }

    this.visitResponse(context, code, responses[code] as ResponseObject);
  };

  // Finds the code of the response we read: `200` if the spec has one, else the lowest other 2xx
  // that sends a JSON body, else `default`. Nothing found means we invent the answer instead.
  //   e.g. (github) post:/app-manifests/{code}/conversions documents only `201`   #85
  private findSuccessResponseCode(context: OasContext, responses: ResponsesByCode): string | undefined {
    if (responses['200']) {
      return '200';
    }
    const created = Object.keys(responses)
      .filter((code) => /^2\d\d$/.test(code))
      .sort()
      .find((code) => this.sendsJson(context, responses[code]));

    return created ?? (responses.default ? 'default' : undefined);
  }

  // True when a response carries a JSON body, so `204` and a contentless one answer false and keep
  // the synthetic. A reference we cannot read is skipped, not thrown on: we are only picking a code.
  //   e.g. (response-201-only.yaml) `201: { content: { application/json } }` -> true   #85
  private sendsJson(context: OasContext, response: ResponseObject | ReferenceObject): boolean {
    let resolved = response;
    if ('$ref' in response) {
      const lookup = context.lookupResponse((response as ReferenceObject).$ref!);
      if (!lookup || '$ref' in lookup) {
        return false;
      }
      resolved = lookup as ResponseObject;
    }
    return Object.keys((resolved as ResponseObject).content ?? {}).some((key) => JSON_MEDIA_TYPE.test(key));
  }

  private visitResponse(context: OasContext, code: string, response: ResponseObject): void {
    const content = response.content as MediaTypeObject;

    if ('$ref' in response) {
      this.visitResponseRef(context, response as ReferenceObject);
    }
    // If the response has a content property, we need to find the JSON content.
    else if (content) {
      const availableKeys = _.keys(response.content);

      trace(context, `  [${code}]`, `Available content types: ${availableKeys.join(', ')}`);
      const keys = _.first(availableKeys.filter((k) => JSON_MEDIA_TYPE.test(k)));
      trace(context, `  [${code}]`, `Matched JSON key: ${keys || 'none'}`);

      const json = keys ? response.content![keys] : undefined;
      if (!json) {
        warn(context, `  [${code}]`, 'No JSON content found!');
        // non-JSON content (github /markdown returns text/html): nothing a connector can
        // select — fall back to the synthetic success response, like a missing body. #33
        this.visitResponse(context, '200', SYN_SUCCESS_RESPONSE);
      } else {
        this.visitResponseContent(context, code, json);
      }
    } else {
      // the response declares no content — nothing to select, so answer with the synthetic
      // success. Don't gate this on `code`: a $ref'd shared response (DO's `no_content`)
      // arrives with the ref string as `code`, not "200". #33
      this.visitResponse(context, '200', SYN_SUCCESS_RESPONSE);
    }
  }

  private visitResponseContent(context: OasContext, _code: string, media: MediaTypeObject): void {
    trace(context, '-> [get::responses::content]', 'in ' + this.name);
    let schema = media!.schema as SchemaObject;

    if (!schema) {
      throw new Error('No schema content found!');
    }

    // a response schema with no fields to select (googlebooks `Empty`: description +
    // `properties: {}`) — synthesize the same `success: Boolean` response as a missing body. #31
    const resolved = '$ref' in schema ? (context.lookupRef((schema as ReferenceObject).$ref!) as SchemaObject) : schema;
    if (resolved && (Schemas.isEmpty(resolved) || Schemas.isShapelessObject(resolved))) {
      schema = SYN_SUCCESS_RESPONSE.content!['application/json'].schema as SchemaObject;
    }

    this.resultType = Factory.fromResponse(context, this, schema);
    // PENDING: do not visit anymore
    // if (this.resultType) {
    //   this.resultType.visit(context);
    // }

    if (this.resultType && !this.children.includes(this.resultType)) {
      this.add(this.resultType);
    }

    trace(context, '<- [get::responses::content]', 'out ' + this.name);
  }

  private visitResponseRef(context: OasContext, ref: ReferenceObject): void {
    trace(context, '-> [get::responses::ref]', `in: ${this.name}, ref: ${ref.$ref}`);

    const lookup = context.lookupResponse(ref.$ref!);
    if (!lookup) {
      throw new Error('Could not find a response with ref: ' + ref.$ref);
    }

    if ('$ref' in lookup) {
      throw new Error('Not yet implemented for nested refs');
    }

    this.visitResponse(context, ref.$ref!, lookup as ResponseObject);
    trace(context, '<- [get::responses::ref]', `out: ${this.name}, ref: ${ref.$ref}`);
  }

  // one argument list for the whole operation; mutations pass their body as the last arg
  // (`(id: ID!, input: PetInput!)`) — a second parenthesised list is not valid GraphQL. #27
  protected generateParameters(context: OasContext, writer: Writer, selection: string[], bodyArg?: string): void {
    const sorted = this.params.sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));

    if (sorted.length === 0 && !bodyArg) {
      return;
    }

    writer.write('(');

    sorted.forEach((parameter, index) => {
      if (index > 0) {
        writer.write(', ');
      }
      parameter.generate(context, writer, selection);
    });

    if (bodyArg) {
      if (sorted.length > 0) {
        writer.write(', ');
      }
      writer.write(bodyArg);
    }

    writer.write(')');
  }

  private visitParameter(context: OasContext, parent: Type, p: ParameterObject): Param {
    trace(context, '->[visitParameter]', 'begin: ' + p.name);

    const param = Factory.fromParam(context, parent, p);
    param.visit(context);

    trace(context, '<-[visitParameter]', 'end: ' + p.name);
    return param;
  }
}
