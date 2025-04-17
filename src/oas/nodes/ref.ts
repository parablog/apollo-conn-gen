import { Arr, Factory, IType, Prop, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

import { ReferenceObject } from './referenceObject.js';

/**
 * @deprecated This class is deprecated and should not be used in new code.
 */
export class Ref extends Type {
  public refType?: IType;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: ReferenceObject | null,
  ) {
    super(parent, name);
  }

  get id(): string {
    return 'ref:' + this.schema?.$ref;
  }

  get props(): Map<string, Prop> {
    return this.refType?.props ?? new Map();
  }

  public forPrompt(_context: OasContext): string {
    return `[ref] ${Naming.getRefName(this.name)}`;
  }

  public visit(context: OasContext): void {
    // console.log('schema', this.schema);
    if (this.visited) {
      return;
    }
    const ref = this.schema?.$ref ?? '';

    context.enter(this);
    trace(context, '-> [ref:visit]', 'in: ' + ref);

    const schema: SchemaObject | null = context.lookupRef(ref);
    if (!schema) {
      throw new Error('Schema not found for ref: ' + ref);
    }

    this.refType = Factory.fromSchema(context, this, schema);
    // Set the name of the resolved type to the reference string.
    this.refType.name = ref;
    this.refType.visit(context);

    this.visited = true;
    trace(context, '<- [ref:visit]', 'out: ' + ref);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    context.enter(this);
    trace(context, '-> [ref::generate]', `-> in: ${this.name}`);

    // If we're in a Response context and the resolved type is an Arr,
    // generate it with array notation.
    if (context.inContextOf('Response', this) && this.refType instanceof Arr) {
      writer.append('[').append(this.firstChild().name).append(']');
    } else {
      // Rewrite terrible names to something more sensible.
      const sanitised = Naming.genTypeName(this.name);
      const refName = Naming.getRefName(this.name);
      writer.write(sanitised === refName ? refName : sanitised);
    }

    trace(context, '<- [ref::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [ref::select]', `-> in: ${this.name}`);
    if (this.refType) {
      this.refType.select(context, writer, selection);
    }
    trace(context, '<- [ref::select]', `-> out: ${this.name}`);
  }

  private firstChild() {
    return this.refType!.children[0];
  }
}
