import { IType, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { DEFAULT_VERSIONS, meetsMinimum } from '../../versions.js';
import { APOLLO_SYNTHETIC_OBJ } from '../schemas/index.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

export class Scalar extends Type {
  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  get id(): string {
    return `scalar:${this.schema.type}`;
  }

  public visit(_context: OasContext): void {
    this.visited = true;
  }

  public forPrompt(_context: OasContext): string {
    return String(this.schema.type);
  }

  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    context.enter(this);
    trace(context, '-> [scalar::generate]', `-> in: ${this.name}`);
    writer.write(this.name);
    trace(context, '<- [scalar::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, _selection: string[]) {
    if (this.schema.default == null) {
      return;
    }

    // a string default must be quoted — `$(latest)` reads as a field path, `$("latest")` is
    // the literal. Numbers/booleans stay bare. see docs/issues.md #28
    const value = typeof this.schema.default === 'string' ? `"${this.schema.default}"` : String(this.schema.default);

    // the synthetic `success` field has no payload counterpart to coalesce from — keep $(true)
    const ownerSchema = (this.parent?.parent as { schema?: SchemaObject } | undefined)?.schema;
    const synthetic = ownerSchema?.format === APOLLO_SYNTHETIC_OBJ;

    const connect = context.generateOptions.connectorSpecVersion ?? DEFAULT_VERSIONS.connectorSpecVersion;
    const federation = context.generateOptions.federationVersion ?? DEFAULT_VERSIONS.federationVersion;

    // emit `tag: tag ?? $("latest")` — real value first, default as fallback. see ROADMAP R7
    // `??` needs connect v0.4 + federation v2.14; older targets keep the replacing literal
    if (!synthetic && meetsMinimum(connect, 'v0.4') && meetsMinimum(federation, 'v2.14')) {
      writer.write(': ').write(this.parent!.name).write(' ?? $(').write(value).write(')');
    } else {
      writer.write(': $(').write(value).write(')');
    }
  }
}
