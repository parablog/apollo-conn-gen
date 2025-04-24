import { JsonType, Context } from './jsonType.js';
import { IWriter } from '../../io/writer.js';
import { trace } from '../log/trace.js';
import { sanitiseField, sanitiseFieldForSelect } from '../naming.js';

export class JsonScalar extends JsonType {
  private readonly type: string;

  constructor(name: string, parent: JsonType | null, type: string) {
    super(name, parent);
    this.type = type;
  }

  public getType(): string {
    return this.type;
  }

  public write(context: Context, writer: IWriter): void {
    const name = this.getName();
    const isProtectedName = this.protectedName;

    trace(context, '[scalar:write]', '-> in: ' + name);
    writer.write(context.getIndent());

    const field = isProtectedName ? '_value' : sanitiseField(name);
    writer.write(field);

    writer.write(': ');
    writer.write(this.getType());

    // add a comment that you cannot use that name
    if (isProtectedName) writer.write(` # '${name}' cannot be used as a field name, it's been replaced by '_value'`);

    writer.write('\n');
    trace(context, '[scalar:write]', '<- out: ' + name);
  }

  public select(context: Context, writer: IWriter): void {
    trace(context, '[scalar:select]', '-> in: ' + this.getName());

    writer.write(context.getIndent());

    if (!this.protectedName) {
      const originalName = this.getName();
      const fieldName = sanitiseFieldForSelect(originalName);
      writer.write(fieldName);
    } else {
      writer.write(`_value: ${this.getName()}`);
    }

    writer.write('\n');

    trace(context, '[scalar:select]', '<- out: ' + this.getName());
  }

  public toString(): string {
    return this.id() + '{' + this.getType() + '}';
  }

  public id(): string {
    return 'scalar:#' + super.id();
  }
}
