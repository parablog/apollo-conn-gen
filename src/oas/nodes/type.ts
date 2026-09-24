import { IType, Kind, MemberRoute, Prop, QueuedNode, ReferenceObject, SelectedField, T } from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Factory } from './factory.js';
import { Naming } from '../utils/naming.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export abstract class Type implements IType {
  public parent?: IType;
  public name: string;
  public children: IType[];
  public circularRef?: IType;
  public kind: Kind;
  public visited: boolean;

  private readonly _props: Map<string, Prop>;
  // Holds the numbered names this type gave its twin fields; a field folded into another type is
  // numbered there on its own. see docs/FIXED.md #69 #113 #242
  private readonly numberedNames = new Map<Prop, string>();

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

  public abstract select(
    context: OasContext,
    writer: Writer,
    selection: ExpandedSelection,
    path: string,
    fieldName?: string,
  ): void;

  // The nodes this node's written output needs (a field's target type, a wrapper's payload, a
  // map's value …). Leaves return nothing. Overridden per class, next to the code it mirrors.
  public dependencies(_context: OasContext, _selection: ExpandedSelection, _path: string): IType[] {
    return [];
  }

  public selectionSuffix(_context: OasContext): string | undefined {
    return undefined;
  }

  // Overrides path() below when set: a clone kept the path its own field had in the selection. #208
  public pathInSelection?: string;

  // children are addressed by id (name-derived): two same-named siblings would collapse into
  // one path — suffix the duplicate (`[inline:Input]`, `[inline:Input]:1`). see #34
  // Keeps a $ref-named child's name: it is the one node built for that $ref. #242
  protected withUniqueName(child: IType): IType {
    if (T.isRef(child.name)) {
      return child;
    }
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

  public abstract generate(context: OasContext, writer: Writer, selection: ExpandedSelection, fieldName?: string): void;

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

  // Puts a comment node in place of an inline member with the id and schema of a node above it, which
  // repeats that node. A field, or a type named by a $ref, is not checked: a loop through it is ended
  // by the one node built per $ref and the selection walk. docs/FIXED.md #36 #242
  //   e.g. (motion) FoldersV2Response's nested items unions repeat their inline members
  public add(child: IType): IType {
    const isInlineMember = !(child instanceof Prop) && !T.isRef(child.name);
    const sameId = isInlineMember ? this.ancestors().find((p) => p.id === child.id) : undefined;
    if (sameId !== undefined && sameId.schema === child.schema) {
      trace(null, '-> [type:add]', 'cycle (same schema instance): ' + child.id);
      const wrapper = Factory.fromCircularRef(this, sameId);
      this.children.push(wrapper);
      return wrapper;
    }
    this.children.push(child);
    return child;
  }

  // Builds a member of this composition or union. A member already being built, with no field
  // between it and this node, reaches itself through members only and has no field to comment
  // out, so it is left out as a comment node and named in a warning. see docs/FIXED.md #10, #242
  //   e.g. (composed-loops.yaml) Self: allOf [ $ref Self, { x } ]
  protected buildMember(context: OasContext, schema: SchemaObject | ReferenceObject): IType {
    const member = Factory.fromSchema(context, this, schema);
    if (!context.isOpenWithoutField(member)) {
      return member;
    }
    warn(
      context,
      '[member]',
      `${Naming.getRefName(member.name)} is already being built when ${Naming.getRefName(this.name)} takes it as a member, with no field between them — the member is left out`,
    );
    return Factory.fromRefCircRef(this, member, (schema as ReferenceObject).$ref ?? member.name);
  }

  // Returns the fields this node writes at `path`, twin names numbered: generate, select and
  // dependencies all read this list, so the three agree. see docs/FIXED.md #69 #162
  //   e.g. (trello) boards: prefs/background + prefs_background -> prefsBackground, prefsBackground2
  public selectedProps(selection: ExpandedSelection, keep: boolean, path: string): Prop[] {
    return this.findWrittenFields(selection, keep, path).map((field) => field.prop);
  }

  // Returns the selected fields, each with the name it is written under here, twins numbered. #69
  //   e.g. (keep-twin-fields.yaml) foo_bar + fooBar, flag off -> fooBar, fooBar2
  protected findWrittenFields(selection: ExpandedSelection, keep: boolean, path: string): SelectedField[] {
    const fields = this.findSelectedFields(selection, path);
    this.numberFieldNames(fields, keep);
    return fields;
  }

  // Names each field as this type writes it, numbering twins; a number given once stays. #69 #113
  //   e.g. (trello) boards: prefs/background + prefs_background -> prefsBackground, prefsBackground2
  public numberFieldNames(fields: SelectedField[], keep: boolean): void {
    T.numberTwinFields(fields, keep, this.numberedNames);
  }

  // Returns the name `prop` is written under in this type: its twin number here, else its own name.
  //   e.g. (confluence) LookAndFeel.links -> links
  public findFieldName(prop: Prop, keep: boolean): string {
    return this.numberedNames.get(prop) ?? Naming.sanitiseField(prop.name, keep);
  }

  // Each written field as this type writes it, at the path of the occurrence that selected it, so a
  // comment standing in for a field walks at the path of the field it replaced. Obj and Composed. #242
  //   e.g. (cycle-on-some-routes.yaml) Space.homepage's comment at …>obj:type:#/c/s/Space>prop:obj:homepage
  protected findFieldDependencies(context: OasContext, selection: ExpandedSelection, path: string): QueuedNode[] {
    const keep = context.generateOptions?.keepFieldNames === true;
    return this.findWrittenFields(selection, keep, path).map((field) => ({
      node: this.emittedProp(context, field.prop),
      path: field.path,
    }));
  }

  // Returns the fields this node writes when it sits at `path`, each with the path of the occurrence
  // that selected it: its own fields first, then each member route's fields in route order. A name
  // selected on two routes keeps the later one, as merging the parts always did. see docs/FIXED.md #242
  //   e.g. (shared-allof-members.yaml) D>A>detail>x and D>E>A>detail>y selected -> detail at D>E>A>detail
  public findSelectedFields(selection: ExpandedSelection, path: string, routes?: MemberRoute[]): SelectedField[] {
    const byName = new Map<string, SelectedField>();
    const keepIfSelected = (prop: Prop, fieldPath: string) => {
      if (selection.isSelected(prop, fieldPath)) {
        byName.set(prop.name, { prop, path: fieldPath });
      }
    };
    for (const prop of this.props.values()) {
      if (prop.parent === this) {
        keepIfSelected(prop, this.findClonePath(prop, path) ?? Naming.pathUnder(path, prop.id));
      }
    }
    for (const route of routes ?? this.findMemberRoutes()) {
      for (const prop of route.member.props.values()) {
        keepIfSelected(prop, prop.pathInSelection ?? Naming.pathUnder(path, ...route.ids, prop.id));
      }
    }
    return Array.from(byName.values());
  }

  // Returns the selection path of `prop` when this node sits at `path`: the ids of the allOf or
  // oneOf members between this node and the prop's owner stay in, since a folded field keeps its
  // owner; a member reached twice gives its first route. Throws when the owner is not below this node.
  //   e.g. (simple-allOf-example.yaml) User's city -> …>comp:type:#/c/s/User>obj:type:#/c/s/Address>prop:scalar:city
  public propPath(prop: Prop, path: string, routes?: MemberRoute[]): string {
    const clonePath = this.findClonePath(prop, path);
    if (clonePath) {
      return clonePath;
    }
    if (prop.parent === this) {
      return Naming.pathUnder(path, prop.id);
    }
    const route = (routes ?? this.findMemberRoutes()).find((memberRoute) => memberRoute.member === prop.parent);
    if (!route) {
      throw new Error(`propPath: ${prop.id} is not under ${this.id}`);
    }
    return Naming.pathUnder(path, ...route.ids, prop.id);
  }

  // Returns where a clone's member field sits on the route `path` belongs to: the path it was cloned
  // from, moved under the union this type sits in on that route, so each op checks its own
  // selection. Undefined for a field that is not a clone. #208 #242
  //   e.g. (shared-union-fields.yaml) RObject.amount on /o -> get:/o>…>union:type:#/c/s/R>obj:type:#/c/s/Money>prop:scalar:amount
  private findClonePath(prop: Prop, path: string): string | undefined {
    if (!prop.pathInSelection) {
      return undefined;
    }
    const clonedFrom = prop.pathInSelection.split(Naming.PATH_SEPARATOR);
    const route = path.split(Naming.PATH_SEPARATOR);
    for (const ancestor of this.ancestors().reverse()) {
      const clonedAt = clonedFrom.lastIndexOf(ancestor.id);
      const routeAt = route.lastIndexOf(ancestor.id);
      if (clonedAt !== -1 && routeAt !== -1) {
        return [...route.slice(0, routeAt), ...clonedFrom.slice(clonedAt)].join(Naming.PATH_SEPARATOR);
      }
    }
    return prop.pathInSelection;
  }

  // Returns every route from this node to a member whose fields it reads, passing no field, breadth
  // first: one entry per occurrence, so a member reached twice is listed twice, in the order the
  // parts were always merged. A member already on its own route is not entered again. #242
  //   e.g. (shared-allof-members.yaml) D: allOf [$ref A, $ref E], E: allOf [$ref A, …] -> A, E, E>A
  public findMemberRoutes(): MemberRoute[] {
    const routes: MemberRoute[] = [];
    const queue: MemberRoute[] = [{ member: this, ids: [], passed: [this] }];
    while (queue.length > 0) {
      const route = queue.shift()!;
      for (const child of route.member.children) {
        if (child instanceof Prop || route.passed.includes(child)) continue;
        const next = { member: child, ids: [...route.ids, child.id], passed: [...route.passed, child] };
        routes.push(next);
        queue.push(next);
      }
    }
    return routes;
  }

  // Returns the nodes this node's written output needs, each with its path when this node sits at
  // `path`: by default dependencies(), each under this node's path. #242
  //   e.g. (petstore) get:/pet/{petId}>res:r -> Pet at get:/pet/{petId}>res:r>obj:type:#/c/s/Pet
  public findDependencies(context: OasContext, selection: ExpandedSelection, path: string): QueuedNode[] {
    return this.dependencies(context, selection, path).map((child) => ({
      node: child,
      path: Naming.pathUnder(path, child.id),
    }));
  }

  // Returns the field as this type writes it: the comment standing in for it (a field that closes a
  // loop, #10 #89 #242, or one no route selects, #125), else the field itself.
  //   e.g. (cycle-on-some-routes.yaml) Space.homepage -> `# homepage: Content - circular reference omitted`
  public emittedProp(context: OasContext, prop: Prop): Prop {
    return (context.propOverrides.get(this.id)?.get(prop.name) as Prop | undefined) ?? prop;
  }

  // Returns the selection path of `child`, one of the nodes dependencies() returned, when this node
  // sits at `path`, for a caller with no selection (the web's tree rows). A comment standing in for
  // a field takes the path of the field it replaced.
  //   e.g. (cycle-on-some-routes.yaml) Space.homepage
  public childPath(context: OasContext, child: IType, path: string): string {
    if (!(child instanceof Prop)) {
      return Naming.pathUnder(path, child.id);
    }
    const field = this.props.get(child.name);
    const replacedField = field && field !== child && this.emittedProp(context, field) === child ? field : undefined;
    return this.propPath(replacedField ?? child, path);
  }

  nameSuffix(): string {
    return this.kind === 'input' ? 'Input' : '';
  }
}
