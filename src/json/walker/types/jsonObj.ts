import { JsonContext } from '../jsonContext.js';
import { trace } from '../log/trace.js';
import { sanitiseField, sanitiseFieldForSelect } from '../naming.js';
import { JsonType } from './index.js';
import { IWriter } from '../../io/index.js';

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class JsonObj extends JsonType {
  private type: string;
  private fields: Map<string, JsonType>;

  constructor(name: string, parent: JsonType | null) {
    super(name, parent);
    this.type = JsonObj.generateType(parent, name);
    this.fields = new Map<string, JsonType>();
  }

  private static generateType(parent: JsonType | null, name: string): string {
    const parentName = parent === null ? '' : capitalize(sanitiseField(parent.getName()));
    return parentName + capitalize(sanitiseField(name));
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

  public write(context: JsonContext, writer: IWriter): void {
    if (this.fields.size === 0) return;
    trace(context, '[obj:write]', '-> in: ' + this.getType());
    context.enter(this);
    writer.write('type ' + this.getType() + ' {\n');

    for (const field of this.fields.values()) {
      if (field instanceof JsonObj) {
        const name = sanitiseField(field.getName());
        writer.write(this.indent(context) + name + ': ' + field.getType() + '\n');
      } else {
        field.write(context, writer);
      }
    }

    writer.write('}\n');
    context.leave(this);
    trace(context, '[obj:write]', '<- out: ' + this.getType());
  }

  public select(context: JsonContext, writer: IWriter): void {
    if (this.fields.size === 0) return;
    trace(context, '[obj:select]', '-> in: ' + this.getName());
    context.enter(this);

    if (this.getParent() !== null) {
      writer.write(this.indentWithSubstract(context, 1) + sanitiseFieldForSelect(this.getName()) + ' {\n');
    }

    for (const field of this.fields.values()) {
      field.select(context, writer);
    }

    if (this.getParent() !== null) {
      writer.write(this.indentWithSubstract(context, 1) + '}\n');
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // public equals(o: any): boolean {
  //   if (this === o) return true;
  //   if (!(o instanceof Obj)) return false;
  //   const other = o as Obj;
  //   if (this.fields.size !== other.fields.size) return false;
  //   for (const [key, value] of this.fields.entries()) {
  //     const otherValue = other.fields.get(key);
  //     if (!otherValue || !value.equals(otherValue)) {
  //       return false;
  //     }
  //   }
  //   return true;
  // }

  // public hashCode(): number {
  //   let hash = 0;
  //   const str = this.type;
  //   for (let i = 0; i < str.length; i++) {
  //     hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  //   }
  //   for (const key of Array.from(this.fields.keys()).sort()) {
  //     for (let i = 0; i < key.length; i++) {
  //       hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  //     }
  //   }
  //   return hash;
  // }
}
