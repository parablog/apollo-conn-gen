import { IType, Type, Param, ReferenceObject, Factory, Op, Res, Scalar, Union } from './internal.js';
import { Operation } from 'oas/operation';
import { MediaTypeObject, ParameterObject, ResponseObject, SchemaObject } from 'oas/types';

import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Media } from '../utils/media.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import { Params } from '../utils/params.js';
import { SYN_SUCCESS_RESPONSE } from '../schemas/index.js';
import _ from 'lodash';

// statuses that, per the HTTP spec itself, never carry a body -- these are the only ones where
// inventing a plain "it worked" answer is safe. any other 2xx with no described content might
// still return real data the spec simply forgot to write down. #147
const BODYLESS_STATUS_CODES = new Set(['204', '205']);

// the operation's `responses:` block, keyed by status code or `default`
type ResponsesByCode = Record<string, ResponseObject | ReferenceObject>;

export class Get extends Type implements Op {
  public verb: string = 'GET';

  // set by OasGen.buildPaths when another op's cleaned name collides with this one's. #116
  //   e.g. GET /foo-bar + GET /foo.bar both clean to fooBar — the second becomes fooBar2
  public renamedTo?: string;

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
    const keep = context.generateOptions?.keepFieldNames === true;
    const jsonReason = this.resultJsonReason(context, selection, keep);
    const jsonNote = jsonReason ? Schemas.withJsonNote(context, {}, jsonReason).description : undefined;
    const paramsLine = this.paramsDocLine(context);
    const responseFieldsLine = this.responseFieldsDocLine(context, selection);
    const paginationLine = this.paginationDocLine(context);

    if (description || summary || originalPath || jsonNote || paramsLine || responseFieldsLine || paginationLine) {
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
      if (jsonNote) {
        writer.write('\n\n  ').write(jsonNote);
      }
      if (paramsLine) {
        writer.write('\n\n  ').write(paramsLine);
      }
      if (responseFieldsLine) {
        writer.write('\n\n  ').write(responseFieldsLine);
      }
      if (paginationLine) {
        // ride the "Returns ..." paragraph when there is one — the note completes that sentence
        writer.write(responseFieldsLine ? '\n  ' : '\n\n  ').write(paginationLine);
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

  // Why the op returns plain JSON instead of a real type, or undefined if it doesn't. resultType is
  // always a Res wrapper (see res.ts); the real answer is one step in, at Res.response. #132
  //   e.g. (github) get:/watchers answers anyOf [array of user, array of watcher] — no shared
  //   fields, so getWatchers(): JSON gains a "NEEDS ATTENTION" note explaining why
  protected resultJsonReason(context: OasContext, selection: string[], keep: boolean): string | undefined {
    const response = this.resultType instanceof Res ? this.resultType.response : this.resultType;
    if (response instanceof Union) return response.emptyMergeReason(context, selection, keep);

    if (response instanceof Scalar) return response.jsonReason;

    return undefined;
  }

  // Builds the "Params:" note --skip-arg-defaults adds to an operation's description, naming
  // each parameter's default, minimum, maximum, and allowed values with the same spelling the
  // argument itself gets. see docs/FIXED.md #159
  //   e.g. (skip-arg-defaults.yaml) get:/items with page_limit: { type: integer, default: 5,
  //   minimum: 1, maximum: 20 } -> "Params: pageLimit (default 5, min 1, max 20)"
  protected paramsDocLine(context: OasContext): string | undefined {
    if (!context.generateOptions?.skipArgDefaults) {
      return undefined;
    }

    const keep = context.generateOptions?.keepFieldNames === true;
    const notes = this.params
      .map((param) =>
        Schemas.describeParamDefault(Naming.genParamName(param.name, keep), param.schema, param.defaultValue),
      )
      .filter((note): note is string => note !== undefined);

    return notes.length > 0 ? `Params: ${notes.join(', ')}` : undefined;
  }

  // Builds the pagination note --doc-pagination adds to an operation's description, when any
  // parameter's name carries a "page" token or is exactly "cursor"/"offset". A page-sized
  // response otherwise reads as complete, so the note says the one thing the signature can't:
  // a full page is not necessarily the last page. see docs/FIXED.md #170
  //   e.g. (doc-pagination.yaml) get:/items(page_index, page_limit) -> "Returns one page of
  //   results; a full page is not necessarily the last page."
  protected paginationDocLine(context: OasContext): string | undefined {
    if (!context.generateOptions?.docPagination) {
      return undefined;
    }

    const paginates = this.params.some((param) => {
      const tokens = param.name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      return tokens.includes('page') || param.name.toLowerCase() === 'cursor' || param.name.toLowerCase() === 'offset';
    });

    return paginates ? 'Returns one page of results; a full page is not necessarily the last page.' : undefined;
  }

  // Builds the "Returns:" line --doc-response-fields adds to an operation's description, naming
  // the top-level fields of its response, when the flag is on. see docs/FIXED.md #160
  //   e.g. (doc-response-fields.yaml) get:/items answers a list of { id, name, created_at }
  //   objects -> "Returns a list of items with: createdAt, id, name"
  protected responseFieldsDocLine(context: OasContext, selection: string[]): string | undefined {
    if (!context.generateOptions?.docResponseFields) {
      return undefined;
    }

    const keep = context.generateOptions?.keepFieldNames === true;
    return Schemas.describeResponseFields(this.resultType, selection, keep);
  }

  public getGqlOpName(): string {
    if (this.renamedTo) return this.renamedTo;
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
    // e.g. (omni) `get /v1/api-keys/{id}` declares no parameters at all. see docs/FIXED.md #81
    const keep = context.generateOptions?.keepFieldNames === true;
    const parameters = Params.matchToPath(declared, this.operation.path, keep);

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
  // that sends a JSON body, else `default`, else a 2xx that describes no body at all. Nothing
  // found means we invent the answer instead.
  //   e.g. (github) post:/app-manifests/{code}/conversions documents only `201`   #85
  // public: the response-coverage lint check (#176) reuses this same choice instead of picking
  // its own response code, so it can never blame a selection for a representation we never read.
  public findSuccessResponseCode(context: OasContext, responses: ResponsesByCode): string | undefined {
    if (responses['200']) {
      return '200';
    }
    const codes = Object.keys(responses)
      .filter((code) => /^2\d\d$/.test(code))
      .sort();

    const created = codes.find((code) => this.sendsJson(context, responses[code]));
    if (created) return created;

    if (responses.default) return 'default';

    // e.g. a bare `201: { description: created }`, no `content` key -- previously fell all the
    // way through to "nothing found" and got invented as success: Boolean here, before
    // visitResponse ever got a chance to tell a real body-less status from an undescribed one. #147
    return codes.find((code) => {
      const resolved = this.resolveResponse(context, responses[code]);
      return resolved != null && !resolved.content;
    });
  }

  // Resolves a possibly-$ref'd response for a sniff that only picks a code (unreadable ref ->
  // undefined, not thrown -- `visitResponseRef` is the real visit and still throws on those).
  //   e.g. (response-201-only.yaml) `201: { $ref: '#/components/responses/Created' }` -> resolved
  private resolveResponse(context: OasContext, response: ResponseObject | ReferenceObject): ResponseObject | undefined {
    if (!('$ref' in response)) {
      return response;
    }
    const lookup = context.lookupResponse((response as ReferenceObject).$ref!);
    return lookup && !('$ref' in lookup) ? (lookup as ResponseObject) : undefined;
  }

  // True when a response carries a JSON body, so `204` and a contentless one answer false and keep
  // the synthetic.
  //   e.g. (response-201-only.yaml) `201: { content: { application/json } }` -> true   #85
  private sendsJson(context: OasContext, response: ResponseObject | ReferenceObject): boolean {
    const resolved = this.resolveResponse(context, response);
    return resolved ? Media.findJsonMediaType(Object.keys(resolved.content ?? {})) != null : false;
  }

  // `code` is what we're reading right now (a real status, or a $ref path once we've followed one).
  // `statusCode` stays the real status through the $ref, so we still know which one it was.
  //   e.g. (github) del:.../labels/{name} 204: { $ref: '#/components/responses/no_content' }
  private visitResponse(context: OasContext, code: string, response: ResponseObject, statusCode: string = code): void {
    const content = response.content as MediaTypeObject;

    if ('$ref' in response) {
      this.visitResponseRef(context, response as ReferenceObject, statusCode);
    }
    // If the response has a content property, we need to find the JSON content.
    else if (content) {
      const availableKeys = _.keys(response.content);

      trace(context, `  [${code}]`, `Available content types: ${availableKeys.join(', ')}`);
      const keys = Media.findJsonMediaType(availableKeys);
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
    } else if (BODYLESS_STATUS_CODES.has(statusCode)) {
      // a status that never carries a body by definition (204 No Content, 205 Reset Content) —
      // there's nothing to select, so answer with the synthetic success.
      //   e.g. (github) del:/repos/{owner}/{repo}/labels/{name} 204: (no content key at all)
      this.visitResponse(context, '200', SYN_SUCCESS_RESPONSE);
    } else if (/^2\d\d$/.test(statusCode)) {
      // a 2xx that the spec never described the body of — the real API most likely still returns
      // data, it just wasn't written down, so we read the raw response instead of making up an
      // empty "it worked" answer that would hide that data.
      //   e.g. (world anvil) get:/manuscript 200: { description: ok }  — no `content` key   #147
      const reason = `the '${statusCode}' response declares no body — the real API may still return data this spec doesn't describe, so it's read as raw JSON instead of a fabricated empty result.`;
      warn(context, `  [${code}]`, reason);
      const schema = Schemas.withJsonNote(context, {}, reason);
      // build the Res first so the Scalar below is parented to it from birth — building it the
      // other way round (Scalar as a constructor argument to `new Res(...)`) would parent it one
      // level too high, the same trap PropObj's own pre-built `obj` argument fell into.
      const res = new Res(this, 'r', schema);
      res.response = new Scalar(res, 'JSON', schema, reason);
      res.add(res.response);
      res.visited = true;
      this.resultType = res;
      if (!this.children.includes(this.resultType)) {
        this.add(this.resultType);
      }
    } else {
      // not a 2xx at all (the only other response `findSuccessResponseCode` can pick is a
      // `default` block) — outside what this fix covers, so keep the old behavior.
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
    // resolvePointer, not lookupRef: a sniff that may discard the ref must not bump refCount.
    const resolved =
      '$ref' in schema ? (context.resolvePointer((schema as ReferenceObject).$ref!) as SchemaObject) : schema;
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

  private visitResponseRef(context: OasContext, ref: ReferenceObject, statusCode: string): void {
    trace(context, '-> [get::responses::ref]', `in: ${this.name}, ref: ${ref.$ref}`);

    const lookup = context.lookupResponse(ref.$ref!);
    if (!lookup) {
      throw new Error('Could not find a response with ref: ' + ref.$ref);
    }

    if ('$ref' in lookup) {
      throw new Error('Not yet implemented for nested refs');
    }

    this.visitResponse(context, ref.$ref!, lookup as ResponseObject, statusCode);
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
