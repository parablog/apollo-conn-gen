import { IType, Type, Param, ReferenceObject, Factory } from './internal.js';
import { Operation } from 'oas/operation';
import { MediaTypeObject, ParameterObject, ResponseObject, SchemaObject } from 'oas/types';

import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { SYN_SUCCESS_RESPONSE } from '../schemas/index.js';

export class Get extends Type {
  public resultType?: IType;
  public params: Param[] = [];

  constructor(
    name: string,
    public operation: Operation,
  ) {
    super(undefined, name);
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
    return `[GET] ${this.name}`;
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [get::generate]', `-> in: ${this.name}`);

    const summary = this.operation.getSummary();
    const originalPath = this.operation.path;

    if (summary || originalPath) {
      writer.append('  """\n').append('  ');
      if (summary) {
        writer.append(summary).append(' ');
      }
      if (originalPath) {
        writer.append('(').append(originalPath).append(')');
      }
      writer.append('\n  """\n');
    }

    writer.append('  ').append(this.getGqlOpName());
    this.generateParameters(context, writer, selection);

    if (this.resultType) {
      writer.append(': ');
      this.resultType.generate(context, writer, selection);
    }

    writer.append('\n');
    trace(context, '<- [get::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(_context: OasContext, _writer: Writer, _selection: string[]) {
    // do nothing
  }

  public getGqlOpName(): string {
    return Naming.genOperationName(this.operation.path, this.operation);
  }

  protected visitParameters(context: OasContext): void {
    trace(context, '-> [get::params]', 'in: ' + this.name);

    const parameters = this.operation.getParameters();

    if (parameters && parameters.length > 0) {
      this.params = parameters
        .filter((p) => !p.in || (p.in && (p.in as string).toLowerCase() !== 'header'))
        .map((p: ParameterObject) => this.visitParameter(context, this, p));
    } else {
      this.params = [];
    }

    trace(context, '<- [get::params]', 'out: ' + this.name);
  }

  protected visitResponses = (context: OasContext) => {
    const statusCodes = this.operation.getResponseStatusCodes();

    if (!statusCodes.includes('200') && !statusCodes.includes('default')) {
      // we can potentially synthesize an Empty response here:
      this.visitResponse(context, '200', SYN_SUCCESS_RESPONSE);
      this.resultType

      return;
      // TODO: throw new Error('Could not find a valid 200 response');
    }

    const responses = this.operation.schema.responses;
    if (responses!['200']) {
      this.visitResponse(context, '200', responses!['200'] as ResponseObject);
    } else if (responses!.default) {
      this.visitResponse(context, 'default', responses!.default as ResponseObject);
    } else {
      throw new Error("Could not find a '200' or 'default' response");
    }
  };

  private visitResponse(context: OasContext, code: string, response: ResponseObject): void {
    const content = response.content as MediaTypeObject;

    if ('$ref' in response) {
      this.visitResponseRef(context, response as ReferenceObject);
    }
    // If the response has a content property, we need to find the JSON content.
    else if (content) {
      const json = response.content!['application/json']!;
      if (!json) {
        warn(context, `  [${code}]`, 'no entry found for content application/json!');
      } else {
        this.visitResponseContent(context, code, json);
      }
    } else if (code === 'default') {
      // there is no response for this operation
      // TODO: should we synthesize one?
    } else {
      throw new Error('Not yet implemented for: ' + JSON.stringify(response));
    }
  }

  private visitResponseContent(context: OasContext, _code: string, media: MediaTypeObject): void {
    trace(context, '-> [get::responses::content]', 'in ' + this.name);
    const schema = media!.schema as SchemaObject;

    if (!schema) {
      throw new Error('No schema content found!');
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

  protected generateParameters(context: OasContext, writer: Writer, selection: string[]): void {
    const sorted = this.params.sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));

    if (sorted.length === 0) {
      return;
    }

    writer.append('(');

    sorted.forEach((parameter, index) => {
      if (index > 0) {
        writer.append(', ');
      }
      parameter.generate(context, writer, selection);
    });

    writer.append(')');
  }

  private visitParameter(context: OasContext, parent: Type, p: ParameterObject): Param {
    trace(context, '->[visitParameter]', 'begin: ' + p.name);

    const param = Factory.fromParam(context, parent, p);
    param.visit(context);

    trace(context, '<-[visitParameter]', 'end: ' + p.name);
    return param;
  }
}
