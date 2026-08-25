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
    // Why this became JSON instead of a real type, or undefined for a genuine scalar. #132
    public jsonReason?: string,
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

  // whether this default covers a missing key, e.g. (coalesce-floor) `tag`'s `default: latest`
  // below federation v2.14 covers nothing — no `??` grammar to fall back to. see docs/FIXED.md #165
  public coalescesDefault(context: OasContext): boolean {
    if (this.schema.default == null) {
      return false;
    }

    const ownerSchema = (this.parent?.parent as { schema?: SchemaObject } | undefined)?.schema;
    if (ownerSchema?.format === APOLLO_SYNTHETIC_OBJ) {
      return true;
    }

    const connect = context.generateOptions.connectorSpecVersion ?? DEFAULT_VERSIONS.connectorSpecVersion;
    const federation = context.generateOptions.federationVersion ?? DEFAULT_VERSIONS.federationVersion;
    return meetsMinimum(connect, 'v0.4') && meetsMinimum(federation, 'v2.14');
  }

  public select(context: OasContext, writer: Writer, _selection: string[]) {
    if (!this.coalescesDefault(context)) {
      // no default, or a real field below the gate with no safe literal-replacement form —
      // write nothing, same as a field with no default. see docs/FIXED.md #165
      return;
    }

    // a string default must be quoted — `$(latest)` reads as a field path, `$("latest")` is
    // the literal. Numbers/booleans stay bare. see docs/FIXED.md #28
    const value = typeof this.schema.default === 'string' ? `"${this.schema.default}"` : String(this.schema.default);

    const ownerSchema = (this.parent?.parent as { schema?: SchemaObject } | undefined)?.schema;
    if (ownerSchema?.format === APOLLO_SYNTHETIC_OBJ) {
      // the synthetic `success` field has no payload counterpart to coalesce from — keep $(true)
      writer.write(': $(').write(value).write(')');
      return;
    }

    // emit `tag: tag ?? $("latest")` — real value first, default as fallback. see ROADMAP R7
    writer.write(': ').write(this.parent!.name).write(' ?? $(').write(value).write(')');
  }
}
