import { IType, Kind, Prop } from './internal.js';
import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Factory } from './factory.js';
import { Naming } from '../utils/naming.js';

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
    for (let i = entry.indexOf(Naming.PATH_SEPARATOR); i !== -1; i = entry.indexOf(Naming.PATH_SEPARATOR, i + 1)) {
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

  public abstract select(context: OasContext, writer: Writer, selection: string[], path: string): void;

  // The nodes this node's written output needs (a field's target type, a wrapper's payload, a
  // map's value …). Leaves return nothing. Overridden per class, next to the code it mirrors.
  public dependencies(_context: OasContext, _selection: string[], _path: string): IType[] {
    return [];
  }

  public selectionSuffix(_context: OasContext): string | undefined {
    return undefined;
  }

  // Overrides path() below when set: a clone kept the path its own field had in the selection. #208
  public pathInSelection?: string;

  // children are addressed by id (name-derived): two same-named siblings would collapse into
  // one path — suffix the duplicate (`[inline:Input]`, `[inline:Input]:1`). see #34
  protected withUniqueName(child: IType): IType {
    let name = child.name;
    let idx = 0;
    while (this.children.some((c) => c.name === name)) {
      name = `${child.name}:${++idx}`;
    }
    child.name = name;
    return child;
  }

  public find(path: string, collection: IType[]): IType | boolean {
    const parts = path.split(Naming.PATH_SEPARATOR);
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
    if (this.pathInSelection) {
      return this.pathInSelection;
    }
    const ancestors = this.ancestors();
    return Naming.abbreviateRef(ancestors.map((t) => t.id).join(Naming.PATH_SEPARATOR));
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
    const ancestors: IType[] = this.ancestors();
    const sameId = ancestors.find((p) => p.id === child.id);
    // Same fix as factory.ts (fromProp), here when attaching a field to its parent: a shared field name is
    // not a loop — compare the schema. docs/FIXED.md #36
    const isCycle = sameId !== undefined && sameId.schema === child.schema;
    let pushed = child;

    if (isCycle) {
      trace(null, '-> [type:add]', 'cycle (same schema instance): ' + child.id);
      const wrapper = Factory.fromCircularRef(this, sameId!);
      this.children.push(wrapper);
      pushed = wrapper;
    } else {
      this.children.push(child);
    }

    return pushed;
  }

  // `_keep` is unused here: the base filter never renumbers a twin, only Obj/Composed/Union's
  // overrides do. It stays required so every override (and every caller) carries it too. #162
  public selectedProps(selection: string[], _keep: boolean, path: string) {
    // Keeps a prop when some selection entry starts with its path on the route that reached this node
    // (propPath). Indexes the selection once into its `>`-boundary prefixes, so each check is one
    // lookup; a scan per prop blew up on large recursive specs. see docs/FIXED.md #10, #242
    const prefixes = selectionPrefixes(selection);
    const pathsToMembers = this.findPathsToMembers();
    return Array.from(this.props.values()).filter((prop) => prefixes.has(this.propPath(prop, path, pathsToMembers)));
  }

  // Returns the selection path of `prop` when this node sits at `path`: the ids of the allOf or
  // oneOf members between this node and the prop's owner stay in, since a folded field keeps its owner.
  // Throws when the owner is not below this node. A filter loop passes findPathsToMembers() in once.
  //   e.g. (simple-allOf-example.yaml) User's city -> …>comp:type:#/c/s/User>obj:type:#/c/s/Address>prop:scalar:city
  public propPath(prop: Prop, path: string, pathsToMembers?: Map<IType, string[]>): string {
    if (prop.pathInSelection) {
      return prop.pathInSelection;
    }
    if (prop.parent === this) {
      return Naming.pathUnder(path, prop.id);
    }
    const pathToMember = (pathsToMembers ?? this.findPathsToMembers()).get(prop.parent!);
    if (!pathToMember) {
      throw new Error(`propPath: ${prop.id} is not under ${this.id}`);
    }
    return Naming.pathUnder(path, ...pathToMember, prop.id);
  }

  // Returns each node below this one that is reached without passing a field, mapped to the ids on
  // the way to it, its own last: the members and nested members whose fields this node reads.
  //   e.g. (simple-allOf-example.yaml) User -> Address: [obj:type:#/components/schemas/Address]
  public findPathsToMembers(): Map<IType, string[]> {
    const pathsToMembers = new Map<IType, string[]>();
    const queue: IType[] = [this];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const pathToMember = pathsToMembers.get(node) ?? [];
      for (const child of node.children) {
        if (child instanceof Prop || pathsToMembers.has(child)) continue;
        pathsToMembers.set(child, [...pathToMember, child.id]);
        queue.push(child);
      }
    }
    return pathsToMembers;
  }

  // Returns the selection path of `child`, one of the nodes dependencies() returned, when this node
  // sits at `path`. A field swapped for its circular-reference comment takes the path of the field
  // it replaced: the comment is shared by type id, so it can belong to another copy of this type.
  //   e.g. (cycle-on-some-routes.yaml) Space.homepage and Doc.folder
  public childPath(context: OasContext, child: IType, path: string): string {
    if (!(child instanceof Prop)) {
      return Naming.pathUnder(path, child.id);
    }
    const replaced = context.propOverrides.get(this.id)?.get(child.name) === child;
    return this.propPath(replaced ? this.props.get(child.name)! : child, path);
  }

  nameSuffix(): string {
    return this.kind === 'input' ? 'Input' : '';
  }
}
