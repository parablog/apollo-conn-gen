import { trace } from '../log/trace.js';
import { sanitiseField, sanitiseFieldForSelect, upperFirst } from '../naming.js';
import { JsonType, Context } from './jsonType.js';
import { IWriter } from '../../io/index.js';
import _ from 'lodash';

export class JsonObj extends JsonType {
  private type: string;
  private fields: Map<string, JsonType>;

  constructor(name: string, parent: JsonType | null) {
    super(name, parent);
    this.type = JsonObj.generateType(parent, name);
    this.fields = new Map<string, JsonType>();
  }

  private static generateType(parent: JsonType | null, name: string): string {
    const parentName = parent === null ? '' : upperFirst(sanitiseField(parent.getName()));
    return parentName + upperFirst(sanitiseField(name));
  }

  public add(field: string, type: JsonType): void {
    this.fields.set(field, type);
  }

  public getFields(): Map<string, JsonType> {
    return this.fields;
  }

  public getType(): string {
    return this.type;
  }

  public setType(type: string): void {
    this.type = type;
  }

  public write(context: Context, writer: IWriter): void {
    if (this.fields.size === 0) return;
    trace(context, '[obj:write]', '-> in: ' + this.getType());
    context.enter(this);
    writer.write('type ' + this.getType() + ' {\n');

    for (const field of this.fields.values()) {
      if (field instanceof JsonObj) {
        const name = sanitiseField(field.getName());
        writer.write(context.getIndent() + name + ': ' + field.getType() + '\n');
      } else {
        field.write(context, writer);
      }
    }

    writer.write(context.getIndentWith(1) + '}\n\n');
    context.leave(this);
    trace(context, '[obj:write]', '<- out: ' + this.getType());
  }

  public select(context: Context, writer: IWriter): void {
    if (this.fields.size === 0) return;
    trace(context, '[obj:select]', '-> in: ' + this.getName());
    context.enter(this);

    if (this.getParent() !== null) {
      writer.write(context.getIndentWith(1) + sanitiseFieldForSelect(this.getName()) + ' {\n');
    }

    for (const field of this.fields.values()) {
      field.select(context, writer);
    }

    if (this.getParent() !== null) {
      writer.write(context.getIndentWith(1) + '}\n');
    }

    context.leave(this);
    trace(context, '[obj:select]', '<- out: ' + this.getName());
  }

  public toString(): string {
    return 'obj:' + this.getName() + ':{' + Array.from(this.fields.keys()).join(',') + '}';
  }

  public id(): string {
    return 'obj:#' + super.id();
  }
}
