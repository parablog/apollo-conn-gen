import { IType, Type } from './internal.js';
import { SchemaObject } from 'oas/types';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';

export abstract class Prop extends Type {
  public required: boolean = false;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  public generate(context: OasContext, writer: Writer, _selection: string[]): void {
    const description = this.schema.description;
    if (description != null) {
      if (
        description.includes('\n') ||
        description.includes('\r') ||
        description.includes('"') ||
        description.includes('\\')
      ) {
        writer.write('  """\n').write('  ').write(description).write('\n  """\n');
      } else {
        writer.write('  "').write(description).write('"\n');
      }
    }

    writer.write('  ').write(Naming.sanitiseField(this.name)).write(': ');

    this.generateValue(context, writer);

    if (this.required) {
      writer.write('!');
    }

    writer.write('\n');
  }

  public abstract getValue(context: OasContext): string;

  generateValue(context: OasContext, writer: Writer): void {
    writer.write(this.getValue(context));
  }
}
