import { IWriter } from '../../io/index.js';
import { isProtected } from '../naming.js';
import { JsonContext } from '../jsonContext.js';

export type Context = JsonContext;

export abstract class JsonType {
  private readonly name: string;
  private readonly parent: JsonType | null;

  // if the name is a protected name and should be escaped
  protected readonly protectedName: boolean;

  constructor(name: string, parent: JsonType | null) {
    this.name = name;
    this.parent = parent;
    this.protectedName = isProtected(name);
  }

  public getName(): string {
    return this.name;
  }

  public getParent(): JsonType | null {
    return this.parent;
  }

  public abstract write(context: Context, writer: IWriter): void;

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
}
