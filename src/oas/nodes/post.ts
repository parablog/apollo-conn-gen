import { Factory, Get, Body, Type } from './internal.js';
import { Writer } from '../io/writer.js';
import { OasContext } from '../oasContext.js';
import { Operation } from 'oas/operation';
import { trace, warn } from '../log/trace.js';
import { Naming } from '../utils/naming.js';
import _ from 'lodash';

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

    if (summary || originalPath) {
      writer.write('  """\n').write('  ');
      if (summary) {
        writer.write(summary).write(' ');
      }
      if (originalPath) {
        writer.write('(').write(originalPath).write(')');
      }
      writer.write('\n  """\n');
    }

    writer.write('  ').write(this.getGqlOpName());

    this.generateParameters(context, writer, selection);
    this.generateBodyInput(context, writer);

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
      return;
    }

    const mediaType = _.first(mediaTypes.filter((k) => /^application\/(?:.*\+)?json/i.test(k)));
    if (!mediaType) {
      warn(context, '  [post::visitBody]', `No JSON media type found!`);
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

    this.body = Factory.fromBody(context, this, body.schema) as Body;
    this.body.visit(context);

    trace(context, '<- [post::visitBody]', `out: ${this.name}`);
  }

  private generateBodyInput(context: OasContext, writer: Writer) {
    if (!this.body || !this.body.payload) return;

    const payload = this.body.payload as Type;

    writer.write('(');

    const name = Naming.getRefName(payload.name!) + payload.nameSuffix();
    writer.write('input').write(': ').write(name).write('!');

    writer.write(')');
  }
}
