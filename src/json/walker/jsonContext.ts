import { JsonObj, JsonType } from '../index.js';

export class JsonContext {
  private stack: JsonType[];
  private types: Map<string, JsonType>;

  constructor() {
    this.stack = [];
    this.types = new Map<string, JsonType>();
  }

  public getStack(): JsonType[] {
    return this.stack;
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

  private merge(type: JsonType): void {
    const source = this.types.get(type.id());
    // Only merge if both are Obj instances
    if (source instanceof JsonObj && type instanceof JsonObj) {
      type.getFields().forEach((value: JsonType, key: string) => {
        source.getFields().set(key, value);
      });
      this.types.set(source.id(), source);
    }
  }

  public getTypes(): JsonType[] {
    return Array.from(this.types.values());
  }
}
