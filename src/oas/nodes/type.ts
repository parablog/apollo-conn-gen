import { IType, Kind, Prop } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Factory } from './factory.js';

// Build (once per selection array, cached by identity) the set of all `>`-boundary prefixes of every
// selection entry. `someEntry.startsWith(path)` for a `>`-joined `path` is then exactly
// `prefixes.has(path)`, turning per-prop membership from O(selection) into O(1). The same expanded
// selection array is threaded through generation, so the WeakMap is built once and reused. see #10
const selectionPrefixCache = new WeakMap<string[], Set<string>>();
export function selectionPrefixes(selection: string[]): Set<string> {
  let prefixes = selectionPrefixCache.get(selection);
  if (prefixes) return prefixes;
  prefixes = new Set<string>();
  for (const entry of selection) {
    prefixes.add(entry);
    for (let i = entry.indexOf('>'); i !== -1; i = entry.indexOf('>', i + 1)) {
      prefixes.add(entry.slice(0, i));
    }
  }
  selectionPrefixCache.set(selection, prefixes);
  return prefixes;
}

export abstract class Type implements IType {
  public parent?: IType;
  public name: string;
  public children: IType[];
  public circularRef?: IType;
  public kind: Kind;
  public visited: boolean;

  private readonly _props: Map<string, Prop>;

  protected constructor(parent: IType | undefined, name: string) {
    this.parent = parent;
    this.name = name;
    this.children = [];
    this.visited = false;
    this._props = new Map<string, Prop>();
    this.kind = parent?.kind || 'type';
  }

  public abstract visit(context: OasContext): void;

  public abstract forPrompt(context: OasContext): string;

  public abstract select(context: OasContext, writer: Writer, selection: string[]): void;

  public find(path: string, collection: IType[]): IType | boolean {
    const parts = path.split('>');
    let current: IType | undefined;

    let i = 0;
    do {
      const part = parts[i];

      current = collection.find((t) => t.id === part);
      if (!current) {
        return false;
      }

      collection = Array.from(current!.children.values()) || Array.from(current!.props.values()) || [];
      // console.log("found", current);

      i++;
    } while (i < parts.length);

    return current || false;
  }

  public expand(context: OasContext): IType[] {
    trace(context, '-> [expand]', `in: path: ${this.path()}`);
    if (!this.visited) {
      this.visit(context);
    }

    trace(context, '<- [expand]', `out: path: ${this.path()}`);

    // TODO:
    // if ((type instanceof Composed || type instanceof Union) && !type.getProps().isEmpty()) {
    //   return type.props?.values() || [];
    // }
    // else {
    return this.children;
    // }
  }

  public abstract generate(context: OasContext, writer: Writer, selection: string[]): void;

  get id() {
    return this.name;
  }

  get props() {
    return this._props;
  }

  public ancestors(): IType[] {
    return this.parent ? [...this.parent.ancestors(), this] : [this];
  }

  public path(): string {
    const ancestors = this.ancestors();
    return ancestors
      .map((t) => t.id)
      .join('>')
      .replace(/#\/components\/schemas/g, '#/c/s');
  }

  public pathToRoot(): string {
    let builder = '';
    let indent = 0;

    const ancestors = this.ancestors();
    for (let i = 0; i < ancestors.length; i++) {
      builder += ' <- ' + ' '.repeat(indent++) + ancestors[i].id + ' (' + ancestors[i].constructor.name + ')\n';
    }

    return builder;
  }

  public add(child: IType): IType {
    const paths: IType[] = this.ancestors();
    const contains: boolean = paths.map((p) => p.id).includes(child.id);
    let pushed = child;

    if (contains) {
      trace(null, '-> [type:add]', 'already contains child: ' + child.id);
      const ancestor: IType = paths[paths.map((p) => p.id).indexOf(child.id)];
      const wrapper = Factory.fromCircularRef(this, ancestor);
      this.children.push(wrapper);
      pushed = wrapper;
    } else {
      this.children.push(child);
    }

    return pushed;
  }

  public selectedProps(selection: string[]) {
    // A prop is selected when some selection entry starts with its path. Done naively
    // (`selection.find(s => s.startsWith(prop.path()))`) this is O(props x selection) with a
    // path() rebuild per entry, which blows up on large recursive type sets (2700+ types x 20k
    // selection entries -> billions of ops; see docs/issues.md #10). Index the selection once into
    // its set of `>`-boundary prefixes, then membership is O(1) per prop.
    const prefixes = selectionPrefixes(selection);
    return Array.from(this.props.values()).filter((prop) => prefixes.has(prop.path()));
  }

  nameSuffix(): string {
    return this.kind === 'input' ? 'Input' : '';
  }
}
