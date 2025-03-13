import { trace } from '../log/trace.js';
import { JsonType, JsonScalar, JsonObj } from './index.js';
import { JsonContext } from '../jsonContext.js';
import { sanitiseField, sanitiseFieldForSelect } from '../naming.js';
import { IWriter } from '../../io/writer.js';

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class JsonArray extends JsonType {
  private arrayType: JsonType | null = null;

  constructor(name: string, parent: JsonType | null) {
    super(name, parent);
  }

  public setArrayType(type: JsonType): void {
    this.arrayType = type;
  }

  public getArrayType(): JsonType | null {
    return this.arrayType;
  }

  public write(context: JsonContext, writer: IWriter): void {
    trace(context, '[array:write]', '-> in: ' + this.getName());
    const field = sanitiseField(this.getName());
    const itemsType = this.getArrayType();

    if (itemsType === null) {
      writer.write('### NO TYPE FOUND -- FIX MANUALLY! field: ' + field + ': [String]\n');
      return;
    }

    writer.write(this.indent(context));
    writer.write(field);
    writer.write(': [');

    if (itemsType instanceof JsonScalar) {
      writer.write(itemsType.getType());
    } else if (itemsType instanceof JsonObj) {
      writer.write(itemsType.getType());
    } else {
      writer.write(capitalize(itemsType.getName()));
    }

    writer.write(']');

    if (this.getName() !== field) {
      writer.write(' # ' + this.getName());
    }

    writer.write('\n');
    trace(context, '[array:write]', '<- out: ' + this.getName());
  }

  public select(context: JsonContext, writer: IWriter): void {
    trace(context, '[array:select]', '-> in: ' + this.getName());
    const itemsType = this.getArrayType();

    if (itemsType instanceof JsonObj) {
      itemsType.select(context, writer);
    } else {
      const fieldName = sanitiseFieldForSelect(this.getName());
      writer.write(this.indent(context));
      writer.write(fieldName);
      writer.write('\n');
    }

    trace(context, '[array:select]', '<- out: ' + this.getName());
  }

  public toString(): string {
    return this.id() + '[' + (this.getArrayType() ? this.getArrayType()!.getName() : 'undefined') + ']';
  }

  public id(): string {
    return 'array:#' + super.id();
  }

  //   public equals(o: any): boolean {
  //     if (this === o) return true;
  //     if (!(o instanceof ArrayType)) return false;
  //     const other = o as ArrayType;
  //     if (this.arrayType === null && other.arrayType === null) return true;
  //     if (this.arrayType === null || other.arrayType === null) return false;
  //     return this.arrayType.equals(other.arrayType);
  //   }

  //   public hashCode(): number {
  //     let hash = super.hashCode();
  //     if (this.arrayType !== null) {
  //       hash = (Math.imul(31, hash) + this.arrayType.hashCode()) | 0;
  //     }
  //     return hash;
  //   }
}
