import { IWriter } from '../../io/index.js';

export interface Context {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStack(): any[];
}

export abstract class JsonType {
  private readonly name: string;
  private readonly parent: JsonType | null;

  constructor(name: string, parent: JsonType | null) {
    this.name = name;
    this.parent = parent;
  }

  public getName(): string {
    return this.name;
  }

  public getParent(): JsonType | null {
    return this.parent;
  }

  public abstract write(context: Context, writer: IWriter): void;

  protected indent(context: Context): string {
    return ' '.repeat(context.getStack().length);
  }

  protected indentWithSubstract(context: Context, subtract: number): string {
    return ' '.repeat(context.getStack().length - subtract);
  }

  public abstract select(context: Context, writer: IWriter): void;

  public id(): string {
    let paths = '';
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let parent: JsonType | null = this;
    while ((parent = parent.getParent()) !== null) {
      paths = `/${parent.getName()}` + paths;
    }
    return paths + '/' + this.getName();
  }

  // public equals(o: any): boolean {
  //   if (this === o) return true;
  //   if (!(o instanceof Type)) return false;
  //   return this.id() === o.id();
  // }

  // public hashCode(): number {
  //   let hash = 0;
  //   const id = this.id();
  //   for (let i = 0; i < id.length; i++) {
  //     hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  //   }
  //   return hash;
  // }
}
