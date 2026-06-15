import { JsonArray } from '../walker/types/jsonArray.js';
import { JsonObj } from '../walker/types/jsonObj.js';
import { JsonScalar } from '../walker/types/jsonScalar.js';
import { JsonType } from '../walker/types/jsonType.js';

export class JsonContext {
  private stack: JsonType[];
  private types: Map<string, JsonType>;
  private indent: number = 0;
  public verbose: boolean = false;

  constructor() {
    this.stack = [];
    this.types = new Map<string, JsonType>();
  }

  public getStack(): JsonType[] {
    return this.stack;
  }

  public getIndent(): string {
    return ' '.repeat(this.stack.length + this.indent);
  }

  public getIndentWith(subtract: number): string {
    return ' '.repeat(this.stack.length - subtract + this.indent);
  }

  public setIndent(indent: number): void {
    this.indent = indent;
  }

  public enter(element: JsonType): void {
    // trace(this, "[context]", "-> enter: (" + this.stack.length + ") " + element.getName());
    this.stack.push(element);
  }

  public leave(_element: JsonType): void {
    // trace(this, "[context]", "<- leave: (" + this.stack.length + ") " + element.getName());
    this.stack.pop();
  }

  public store(type: JsonType): void {
    if (this.types.has(type.id())) {
      this.merge(type);
    } else {
      this.types.set(type.id(), type);
    }
  }

  // converge both instances on the field union: the stored one feeds getTypes(), the incoming
  // one is what the parent's field map (the written tree) points at. #35
  private merge(type: JsonType): void {
    const source = this.types.get(type.id());
    // Only merge if both are Obj instances
    if (source instanceof JsonObj && type instanceof JsonObj) {
      type.getFields().forEach((value: JsonType, key: string) => {
        // an unknown-shape twin (`[]`/`{}` walked to the JSON scalar) must not clobber a typed field
        const existing = source.getFields().get(key);
        if (existing && this.isUnknownShape(value) && !this.isUnknownShape(existing)) {
          type.getFields().set(key, existing);
          return;
        }
        source.getFields().set(key, value);
      });
      // and back the other way: fields only earlier documents knew about
      source.getFields().forEach((value: JsonType, key: string) => {
        if (!type.getFields().has(key)) {
          type.getFields().set(key, value);
        }
      });
      this.types.set(source.id(), source);
    }
  }

  // `[]` / `{}` values walk to the JSON scalar (unknown shape) — see #19/#21/#35
  private isUnknownShape(type: JsonType): boolean {
    if (type instanceof JsonScalar) {
      return type.getType() === 'JSON';
    }
    if (type instanceof JsonArray) {
      const items = type.getArrayType();
      return items === null || this.isUnknownShape(items);
    }
    return false;
  }

  public getTypes(): JsonType[] {
    return Array.from(this.types.values());
  }
}
