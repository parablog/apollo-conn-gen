import { OpenAPIV3 } from 'openapi-types';
import ArraySchemaObject = OpenAPIV3.ArraySchemaObject;
import { SchemaObject } from 'oas/types';

import { IType, Param, ReferenceObject, Type } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export class Arr extends Type {
  public itemsType?: IType;
  public items?: ArraySchemaObject;

  constructor(parent: IType | undefined, name: string) {
    super(parent, name);
  }

  get id(): string {
    return 'array:' + (this.itemsType ? this.itemsType.name : 'unknown-yet');
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }

    context.enter(this);
    trace(context, '-> [array:visit]', 'in');

    this.itemsType?.visit(context);
    this.visited = true;

    trace(context, '-> [array:visit]', 'out');
    context.leave(this);
  }

  public forPrompt(_context: OasContext): string {
    return `[array] ${Naming.getRefName(this.name)}`;
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [array::generate]', `-> in: ${this.name}`);

    writer.write('[');
    if (this.itemsType) {
      this.itemsType.generate(context, writer, selection);
      // A query-string array can't hold a null slot, so a plain array param
      // (`tags: { schema: { type: array, items: { type: string } } }`) becomes `[String!]`, not
      // `[String]`. see docs/FIXED.md #166
      if (this.parent instanceof Param && !Arr.itemsAreNullable(context, this.items)) {
        writer.write('!');
      }
    }
    writer.write(']');

    trace(context, '<- [array::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  // True when the array's items allow null, e.g. items: { type: string, nullable: true }.
  // A $ref item is resolved first, since "nullable: true" may live on the referenced schema instead.
  private static itemsAreNullable(context: OasContext, items: SchemaObject | ReferenceObject | undefined): boolean {
    if (!items) return false;
    const resolved = ('$ref' in items ? context.resolvePointer(items.$ref ?? null) : items) as SchemaObject | undefined;
    return resolved?.nullable === true;
  }

  dependencies(): IType[] {
    return this.itemsType ? [this.itemsType] : [];
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [array::select]', `-> in: ${this.name}`);

    if (this.itemsType) {
      this.itemsType.select(context, writer, selection);
    }

    trace(context, '<- [array::select]', `-> out: ${this.name}`);
  }
}
