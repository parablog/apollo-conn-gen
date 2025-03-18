import {
  IType, Type
} from '../internal.js';
import { SchemaObject } from 'oas/types';
import { OasContext } from '../../oasContext.js';
import { Writer } from '../../io/writer.js';
import { Naming } from '../../utils/naming.js';

export abstract class Prop extends Type {
  public required: boolean = false;

  constructor(
    parent: IType | undefined,
    name: string,
    public schema: SchemaObject,
  ) {
    super(parent, name);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    const description = this.schema.description;
    if (description != null) {
      if (description.includes('\n') || description.includes('\r') || description.includes('"')) {
        writer.append('  """\n').append('  ').append(description).append('\n  """\n');
      } else {
        writer.append('  "').append(description).append('"\n');
      }
    }

    writer.append('  ').append(Naming.sanitiseField(this.name)).append(': ');

    this.generateValue(context, writer);

    if (this.required) {
      writer.append('!');
    }

    // TODO: source
    // writer.append(" # ").append(this.parent);

    writer.append('\n');
  }

  public abstract getValue(context: OasContext): string;

  protected generateValue(context: OasContext, writer: Writer): void {
    writer.append(this.getValue(context));
  }
}
