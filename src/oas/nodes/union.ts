import {
  Arr,
  Composed,
  En,
  Factory,
  Get,
  IType,
  Map as MapType,
  MixedValue,
  Param,
  Prop,
  PropArray,
  PropComp,
  PropEn,
  PropObj,
  PropScalar,
  QueuedNode,
  ReferenceObject,
  Res,
  Scalar,
  SelectedField,
  T,
  Type,
} from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { GqlUtils } from '../utils/gql.js';
import { Naming } from '../utils/naming.js';
import { Schemas, MixedValueShape } from '../utils/schemas.js';
import { JsonDegradeReasons } from '../utils/jsonReasons.js';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export class Union extends Type {
  public schemas: SchemaObject[];
  // OAS discriminator: `propertyName` is the source JSON field carrying the type tag,
  // `discriminatorMapping` maps each tag value to a schema ref (value -> "#/.../Type").
  public discriminator?: string;
  public discriminatorMapping?: Record<string, string>;

  // R2: when this discriminated union's members all share one allOf base, it is promoted to a
  // GraphQL interface. `interfaceBaseRef` is the base schema ref ("#/.../Product"); when set,
  // generate() returns the interface name (not the union name) and emits no `union` line. Set by
  // promoteAllOfBase (a post-collect pass) — never in visit().
  public interfaceBaseRef?: string;

  // Set by TypesCollector per run: whether every selected route reaches this union as the op's
  // response, and whether every one reaches it as a field, list item or map value. One op reaching
  // it top-level and another nested forces the merged form everywhere. see docs/FIXED.md #121 #242
  //   e.g. (per-op-green-whole-red.yaml) /media returns Media, /shelf has featured: Media -> merged
  public everyRouteTopLevel?: boolean;
  public everyRouteValueOrItem?: boolean;

  // set once by consolidate() when this flat union mixes a plain value with a real object. see docs/FIXED.md #208
  public mixedValue?: MixedValue;

  // Members an op's walk found leading back to this union, left out of it on that op's routes, by
  // op id: a member loops back on one op's route and not another's. #242
  //   e.g. (TMF632) get:/individual/{id}'s PartyOrPartyRole leaves out its member Individual
  private readonly leftOutMembers = new Map<string, Set<IType>>();

  constructor(
    parent: IType,
    name: string,
    schemas: SchemaObject[],
    public consolidated: boolean = false,
    disc?: { propertyName?: string; mapping?: Record<string, string> },
  ) {
    super(parent, name);
    this.schemas = schemas;
    this.discriminator = disc?.propertyName;
    this.discriminatorMapping = disc?.mapping;
    this.updateName();
  }

  get id(): string {
    // The same `oneOf` sent in a request body and returned in a response is two nodes, like obj/comp/map:
    // without the kind here one of them overwrites the other (QuickBooks `Bill.Line`). see docs/FIXED.md #48
    return `union:${this.kind}:${this.name}`;
  }

  public forPrompt(_context: OasContext): string {
    return `[union] ${Naming.getRefName(this.name)}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }
    // set before the members are built, as Composed does: a member can reach this union again. #242
    this.visited = true;

    const schemas = this.schemas.map((s) => s.type);

    context.enter(this);
    trace(context, '-> [union:visit]', 'in: ' + schemas);

    if (!context.inContextOf(Composed, this)) {
      trace(context, '[union]', 'In union: ' + this.parent?.name);
    }

    for (const refSchema of this.schemas) {
      // OAS 3.1 writes nullability as a `{ type: "null" }` member — GraphQL fields are
      // nullable by default, so it adds nothing (the member form of #23's type arrays). #33
      if (refSchema && refSchema.type === 'null') {
        continue;
      }
      const type = this.buildMember(context, refSchema);
      this.add(type);

      type.visit(context);
      trace(context, ' [union:visit]', 'of type: ' + type);
    }

    if (!context.inContextOf(Param, this)) {
      this.visitProperties(context);
    }

    if (this.name != null) {
      // two unions can share a name but hold different members — the second one takes a new name (#104).
      // e.g. (github) an object body and a oneOf body are both named Input, and wrote InputInput twice
      const ownedByOtherSide = T.ownedByOtherSide(this, context);
      if (!ownedByOtherSide && T.collidesWithStoredType(this, context)) {
        T.resolveNameConflict(this, context);
      }
      // same store guard as Map (#78): a response union must not take the entry over from a body
      // union — the next body union would read its own name as free and keep it. see #112
      if (!ownedByOtherSide && !context.types.has(this.name)) {
        context.store(this.name, this);
      }
    }

    trace(context, '<- [union:visit]', 'out: ' + schemas);
    context.leave(this);
  }

  // True when this union IS the op's response (optionally under a bare array), not nested inside a
  // field. This composes fine:
  //   get:/item -> oneOf [Book, Movie]
  // This doesn't — launch library's real shape, rover won't resolve anything inside the match:
  //   PaginatedAgencyList.results: [ oneOf [AgencyMini, AgencyNormal, AgencyDetailed] ]
  // Reads the collector's answer over every route in a run; a caller with no selection reads the parent.
  // see docs/FIXED.md #38 #242
  public isTopLevelResponse(): boolean {
    if (this.everyRouteTopLevel !== undefined) {
      return this.everyRouteTopLevel;
    }
    let node: IType | undefined = this.parent;
    while (node instanceof Arr) {
      node = node.parent;
    }
    return node instanceof Res;
  }

  // A union becomes one flat merged type, not a real `union`/interface, when: it's a request body
  // (GraphQL has no input unions), it has no tag field to pick a branch (#25), or it's nested
  // inside a field rather than being the op's own response (#38). see docs/FIXED.md #25, #38
  public isFlat(): boolean {
    return this.kind === 'input' || !this.discriminator || !this.isTopLevelResponse();
  }

  public generate(context: OasContext, writer: Writer, selection: ExpandedSelection): void {
    context.enter(this);
    const schemas = this.schemas.map((s) => s.type);
    const keep = context.generateOptions?.keepFieldNames === true;
    trace(context, '-> [union::generate]', 'in: ' + schemas);

    /* params with Unions are weird, but here's an example:
     * id: oneOf [string, Enum {me}] */
    if (context.inContextOf(Param, this)) {
      for (const child of this.children) {
        child.generate(context, writer, selection);
      }
    } else if (context.inContextOf(Res, this)) {
      // a merge with no fields is never written — the field answers JSON instead  #80
      if (this.isFlat() && !this.hasSelectedProps(context, selection, keep, selection.writtenPath(this))) {
        writer.write('JSON');
      } else {
        // R2: when promoted to an interface, the field returns the base interface, not the union name.
        writer.write(Naming.genTypeName(this.interfaceBaseRef ?? this.name));
      }
    }
    // generate traditional union
    else {
      // Definition/reference agreement, like comp.ts: references emit genTypeName(name), so the
      // union line (and its consolidate-downgrade type) must too. see docs/FIXED.md #15, #6
      const name = Union.resolvedTypeName(this.name);

      if (this.isFlat()) {
        // the mixed-value analysis must run before hasSelectedProps below reads this.props. #208
        this.consolidateMembers(context, selection);

        // an empty merge writes no type — its field was written as JSON  #80
        if (!this.hasSelectedProps(context, selection, keep, selection.writtenPath(this))) {
          trace(context, '   [union::generate]', `[union] no fields to merge, skipping: ${this.name}`);
        }
        // FIXED #208: a mixed oneOf — every branch kept as a field, not merged away.
        else if (this.mixedValue) {
          this.mixedValue.generate(context, writer, name);
        }
        // No real union here: an input-position oneOf (GraphQL has no input unions) or no
        // discriminator (no tag for `->match`). Emit the merged object — the selection falls back to
        // the same flat form (see select), so SDL and selection agree. see docs/FIXED.md #25, #36
        else {
          this.generateMergedObject(context, writer, selection, name, '#### union degraded to a merged object: ');
        }
      } else if (this.interfaceBaseRef) {
        // R2: promoted to an interface — the base (emitted as `interface`) and the members
        // (each `... implements Base`) carry the type system; emit no `union X = A | B` line.
        trace(context, '   [union::generate]', `[interface] suppressing union line for ${this.name}`);
      } else {
        // output + discriminator: a real `union X = A | B`. Filtering by prop-parent identity broke
        // for allOf members (their folded props keep the inner part as parent -> `union X = `). #34
        // Members are listed under the name their own `type` line uses: a component named
        // `http_rule_response` is written as `HttpRuleResponse`. see docs/FIXED.md #43
        const filtered = this.selectedMembers(selection, selection.writtenPath(this));

        this.writeMemberJsonNote(context, writer);
        writer
          .write('union ')
          .write(name)
          .write(this.nameSuffix())
          .write(' = ')
          .write(filtered.map((child) => Union.resolvedTypeName(child.name)).join(' | '))
          .write('\n\n');
      }
    }

    trace(context, '<- [union::generate]', 'out: ' + schemas);
    context.leave(this);
  }

  // The downgrade shape both passes share: an info comment naming the original union, then one
  // object type carrying every member's selected fields (the selection selects the same flat set).
  private generateMergedObject(
    context: OasContext,
    writer: Writer,
    selection: ExpandedSelection,
    name: string,
    headline: string,
  ): void {
    const keep = context.generateOptions?.keepFieldNames === true;
    this.consolidateMembers(context, selection);

    const childrenTypes = this.children.map((child) => Naming.getRefName(child.name));
    writer.write(headline).write(name).write(' = ').write(childrenTypes.join(' | ')).write('\n\n');

    trace(context, '   [union::generate]', `[union] -> object: ${this.name}`);

    // `this.kind` (not a hardcoded 'type ') picks the keyword: 'type' for a response, 'input' for a
    // request body (body.ts). e.g. (r2-input-union-consolidated.yaml) POST /create's `oneOf` body
    // merges to one object — hardcoding 'type ' here would emit it as an invalid mutation argument.
    this.writeMemberJsonNote(context, writer);
    writer
      .write(this.kind + ' ')
      .write(name)
      .write(this.nameSuffix())
      .write(' { #### replacement for Union ')
      .write(name)
      .write('\n');

    for (const field of this.findMergedFields(context, selection, keep, selection.writtenPath(this))) {
      trace(context, '   [union::generate]', `-> property: ${field.prop.name} (parent: ${field.prop.parent!.name})`);
      field.prop.generate(context, writer, selection, field.name);
    }

    writer.write('} \n### End replacement for ').write(this.name).write('\n\n');
  }

  private dedupedSelectedProps(context: OasContext, selection: ExpandedSelection, keep: boolean, path: string): Prop[] {
    return this.findMergedFields(context, selection, keep, path).map((field) => field.prop);
  }

  // Returns the merged object's fields at `path`, one per name, each as written (a loop left out on
  // the member that declares it is its comment here too) and with the path it was selected at. #242
  //   e.g. (composed-loops.yaml) Choice: oneOf [Base, Tree] -> Tree's children as its comment
  private findMergedFields(
    context: OasContext,
    selection: ExpandedSelection,
    keep: boolean,
    path: string,
  ): SelectedField[] {
    return Union.dedupeByName(this.findSelectedFields(selection, path), context, keep, this, path).map((field) => ({
      prop: this.emittedProp(context, field.prop),
      path: field.path,
      name: field.name,
    }));
  }

  // Members can give the same field name three outcomes: the same written shape keeps the first, an
  // all-enum clash merges every value, and two same-named objects fold under declaresEveryKeptField.
  // Each field keeps the path its first occurrence was selected at, or the path of the field made here.
  //   e.g. Individual: { status: enum-ref }, PartyRole: { status: { type: string } } -> status: JSON
  public static dedupeByName(
    fields: SelectedField[],
    context: OasContext,
    keep: boolean,
    union: Union,
    path: string,
  ): SelectedField[] {
    const firstByName = new Map<string, SelectedField>();
    const allByName = new Map<string, Prop[]>();

    for (const field of fields) {
      const clashing = allByName.get(field.prop.name);
      if (clashing) {
        clashing.push(field.prop);
      } else {
        allByName.set(field.prop.name, [field.prop]);
        firstByName.set(field.prop.name, field);
      }
    }

    const incompatible = new Set<string>();
    for (const [name, group] of allByName) {
      if (group.length === 1) {
        continue;
      }
      const kept = group[0];
      const later = group.slice(1);
      const compatible = group.every((p) => Union.objectOf(p) !== undefined)
        ? later.every((other) => Union.declaresEveryKeptField(kept, other, context))
        : later.every((other) => Union.shapeOf(context, other) === Union.shapeOf(context, kept));
      if (!compatible) {
        incompatible.add(name);
      }
    }

    const merged = Array.from(firstByName.entries()).map(([name, first]): SelectedField => {
      if (!incompatible.has(name)) {
        return first;
      }
      const clashing = allByName.get(name)!;
      if (clashing.every((p): p is PropEn => p instanceof PropEn)) {
        const en = Union.mergeEnums(context, name, clashing, union);
        return { prop: en, path: Naming.pathUnder(path, en.id) };
      }
      // one branch's enum value is not a legal name, so its field is String: the merged field is String, not JSON. #234
      const stringEnumMember = Union.findStringEnumMember(clashing);
      if (stringEnumMember) {
        const illegalValue = (stringEnumMember.schema.enum as unknown[]).find(
          (value) => !GqlUtils.isGqlEnumValue(value),
        );
        warn(
          null,
          '[union]',
          `\`${name}\` is an enum on some branches but the value \`${illegalValue}\` is not a legal GraphQL enum name, so the merged field is String`,
        );
        const stringField = new PropScalar(first.prop.parent!, name, 'String', { type: 'string' });
        stringField.required = clashing.every((p) => p.required);
        return { prop: stringField, path: Union.replaceLastId(first.path, stringField.id) };
      }
      const reason = JsonDegradeReasons.incompatibleMergedField();
      warn(null, '[union]', reason);
      const jsonField = new PropScalar(first.prop.parent!, name, 'JSON', Schemas.withJsonNote(context, {}, reason));
      return { prop: jsonField, path: Union.replaceLastId(first.path, jsonField.id) };
    });

    // two members can spell the same field differently — number the later twin instead of writing
    // it twice. e.g. (trello) boards: prefs/background + prefs_background. see docs/FIXED.md #113
    union.numberFieldNames(merged, keep);
    return merged;
  }

  // Returns `path` with its last id swapped for `id`: where a field made in place of a member's
  // field sits, beside the field it replaces.
  //   e.g. (flat-merge-incompatible-scalar-types.yaml) …>obj:type:#/c/s/A>prop:scalar:status -> same, as JSON
  private static replaceLastId(path: string, id: string): string {
    return Naming.pathUnder(path.slice(0, path.lastIndexOf(Naming.PATH_SEPARATOR)), id);
  }

  // The written shape dedupeByName keys same-named non-object fields on: an enum also carries its
  // sorted values, a wide integer read through ->jsonStringify is not the same read as a plain
  // string. e.g. { data: int64 } vs { data: string } -> data: JSON, not merged as both "String"
  private static shapeOf(context: OasContext, prop: Prop): string {
    const written = prop.getValue(context);
    if (prop instanceof PropEn) {
      const values = ((prop.schema.enum ?? []) as string[]).slice().sort();
      return `${written}:${values.join(',')}`;
    }
    if (prop instanceof PropScalar && prop.stringifiedNumber) {
      return `${written}->jsonStringify`;
    }
    return written;
  }

  // The object a prop resolves to: PropObj's $ref/inline object, or PropComp's allOf/oneOf type — undefined otherwise.
  private static objectOf(prop: Prop): IType | undefined {
    if (prop instanceof PropObj) return prop.obj;
    if (prop instanceof PropComp) return prop.comp;
    return undefined;
  }

  // Whether two objects are known to match without comparing their fields: the same `$ref` (an
  // inline name is not enough, unrelated objects can share one), or the same schema text.
  //   e.g. (launch library) agency: $ref AgencyMini on every branch -> match
  private static sameComponentOrSchema(a: IType, b: IType): boolean {
    if (T.isRef(a.name) && a.id === b.id) {
      return true;
    }
    return T.sameSchemaAs(a, b);
  }

  // Whether a value shaped like `other` can be read through `kept`'s type: `other` is at least as
  // required, and the two match by $ref or schema, or every field of `kept` exists in `other` the same way.
  //   e.g. detail: DetailBasic! vs detail: DetailRich, same fields -> no (required differs), JSON
  private static declaresEveryKeptField(
    kept: Prop,
    other: Prop,
    context: OasContext,
    visited: Set<string> = new Set(),
  ): boolean {
    if (kept.required && !other.required) {
      return false;
    }

    const keptObj = Union.objectOf(kept);
    const otherObj = Union.objectOf(other);
    if (keptObj && otherObj) {
      if (Union.sameComponentOrSchema(keptObj, otherObj)) {
        return true;
      }
      if (keptObj.props.size === 0) {
        return false;
      }
      const pairId = `${keptObj.id}|${otherObj.id}`;
      if (visited.has(pairId)) {
        return true;
      }
      visited.add(pairId);
      for (const [fieldName, keptField] of keptObj.props) {
        const otherField = otherObj.props.get(fieldName);
        if (!otherField || !Union.declaresEveryKeptField(keptField, otherField, context, visited)) {
          return false;
        }
      }
      return true;
    }

    return Union.shapeOf(context, kept) === Union.shapeOf(context, other);
  }

  // Every member's version of a field is an enum: one enum holding every value, first-seen order.
  //   e.g. Individual: { status: enum [active] }, PartyRole: { status: enum [suspended] } -> status: enum [active, suspended]
  private static mergeEnums(context: OasContext, name: string, props: PropEn[], union: Union): PropEn {
    const owner = union;
    const values: string[] = [];
    for (const prop of props) {
      values.push(...((prop.schema.enum ?? []) as string[]));
    }

    const en = new En(owner, name, { type: 'string', enum: values }, values);
    en.visit(context);

    const prop = new PropEn(owner, name, en, props[0].schema);
    prop.add(en);
    // present on every branch only when every branch requires it
    prop.required = props.every((p) => p.required);
    return prop;
  }

  // Finds, among the branches' fields of one name, the field that is a String only because its enum
  // holds a value GraphQL cannot use as a name, and only when every other branch has a real enum.
  // Any other mix (a plain string, an Int or Boolean enum) returns undefined and the field stays JSON. #234
  //   e.g. (omni) ControlReadExternal.config.fieldSelection: oneOf of three inline objects, each with
  //   mode: enum [full-model] / enum [auto] / enum [specific] -> the full-model branch's field, so mode: String!
  private static findStringEnumMember(props: Prop[]): PropScalar | undefined {
    const isStringEnumMember = (prop: Prop): prop is PropScalar =>
      prop instanceof PropScalar && prop.type === 'String' && prop.schema.enum != null;

    const stringEnumMember = props.find(isStringEnumMember);

    const isMixedEnumGroup =
      stringEnumMember != null &&
      props.some((prop) => prop instanceof PropEn) &&
      props.every((prop) => prop instanceof PropEn || isStringEnumMember(prop));

    return isMixedEnumGroup ? stringEnumMember : undefined;
  }

  // Reasons behind any member that gave up its own shape and became plain JSON — such a member has
  // no fields, so selectedMembers() below drops it silently, which is how its reason survives.
  // e.g. (union-member-json-degrade.yaml) `oneOf: [ $ref Book, {} ]` — the empty member becomes JSON.
  private memberJsonReasons(): string[] {
    return this.children
      .filter((c): c is Scalar => c instanceof Scalar && c.jsonReason != null)
      .map((c) => c.jsonReason!);
  }

  // Writes a block-quoted note above the union/type line for every reason memberJsonReasons()
  // found; writes nothing when every member kept a real shape.
  private writeMemberJsonNote(context: OasContext, writer: Writer): void {
    const reasons = this.memberJsonReasons();
    if (reasons.length === 0) return;
    const note = Schemas.withJsonNote(context, {}, reasons.join(' ')).description;
    if (!note) return;
    writer.write('"""\n').write(note).write('\n"""\n');
  }

  // two inline members easily share a name (`[inline:Input]` twice) — same suffixing as Composed
  add(child: IType): IType {
    return super.add(this.withUniqueName(child));
  }

  // the members that carry at least one selected field — what the `union X = …` line lists and
  // what `->match` branches over. A Composed member reads its allOf parts' fields. see #34
  private selectedMembers(selection: ExpandedSelection, path: string): IType[] {
    return this.findMembersOn(path).filter(
      (child) => child.findSelectedFields(selection, Naming.pathUnder(path, child.id)).length > 0,
    );
  }

  // Leaves `member` out of this union on `opId`'s routes. #242
  //   e.g. (TMF632) get:/individual/{id}, member Individual
  public leaveOutMember(opId: string, member: IType): void {
    (this.leftOutMembers.get(opId) ?? this.leftOutMembers.set(opId, new Set()).get(opId)!).add(member);
  }

  // Returns the members this union has on the op `path` starts with: the ones its walk kept.
  //   e.g. (TMF632) PartyOrPartyRole on get:/individual/{id} -> every member but Individual
  public findMembersOn(path: string): IType[] {
    const leftOut = this.leftOutMembers.get(path.split(Naming.PATH_SEPARATOR, 1)[0]);
    return leftOut ? this.children.filter((member) => !leftOut.has(member)) : this.children;
  }

  // a real `union X = Book | Movie` needs its members (and a member's shared $ref base, which
  // the writer may promote to an interface — R2); a merged one needs its flat fields instead
  dependencies(context: OasContext, selection: ExpandedSelection, path: string): IType[] {
    return this.findDependencies(context, selection, path).map((dependency) => dependency.node);
  }

  // What dependencies() returns, each at its path: a merged union's fields at the paths they were
  // selected at, a mixed value's fields under this union, a real union's members and their $ref
  // bases under their member. #242
  //   e.g. (r2-interface-shared-base.yaml) Book: allOf [$ref Product, …] ->
  //   get:/item>res:r>union:type:#/c/s/ItemResponse>comp:type:#/c/s/Book>obj:type:#/c/s/Product
  public override findDependencies(context: OasContext, selection: ExpandedSelection, path: string): QueuedNode[] {
    if (this.isFlat()) {
      // consolidate first, like generateMergedObject does: the mixed value is built there. #57 #208
      this.consolidateMembers(context, selection);
      // FIXED #208: the mixed-value fields, so the collector reaches the object type through PropObj.
      if (this.mixedValue) {
        return this.mixedValue.dependencies().map((field) => ({ node: field, path: Naming.pathUnder(path, field.id) }));
      }
      const keep = context.generateOptions?.keepFieldNames === true;
      return this.findMergedFields(context, selection, keep, path).map((field) => ({
        node: field.prop,
        path: field.path,
      }));
    }
    // only members with a selected field are reachable (#26, #36); an allOf member also pulls in the
    // $ref base it extends — `Book: allOf [$ref Product, …]` -> Product (r2-interface-shared-base.yaml).
    return this.selectedMembers(selection, path).flatMap((member) => [
      { node: member, path: Naming.pathUnder(path, member.id) },
      ...(member instanceof Composed ? T.containers(member).filter((c) => T.isRef(c.name)) : []).map((base) => ({
        node: base,
        path: Naming.pathUnder(path, member.id, base.id),
      })),
    ]);
  }

  // Returns the selection path of a node dependencies() returned, for a caller with no selection:
  // a member's $ref base sits under its member, not under this union. Fields go to Type.
  //   e.g. (r2-interface-shared-base.yaml) …>union:type:#/c/s/ItemResponse>comp:type:#/c/s/Book>obj:type:#/c/s/Product
  public override childPath(context: OasContext, child: IType, path: string): string {
    const route = this.findMemberRoutes().find((memberRoute) => memberRoute.member === child);
    return route ? Naming.pathUnder(path, ...route.ids) : super.childPath(context, child, path);
  }

  public select(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string): void {
    trace(context, '-> [union::select]', `-> in: ${this.name}`);
    const keep = context.generateOptions?.keepFieldNames === true;

    this.consolidateMembers(context, selection);

    // R2: for a real output `union X = A | B` (output position + discriminator) produce the
    // composable abstract-type selection (connect v0.4): a spread `->match` whose branches set a
    // string-literal __typename per member. Merged-object unions (input position or no discriminator)
    // fall back to the flat selection below. see docs/FIXED.md #25, #36
    if (!this.isFlat()) {
      this.selectAbstract(context, writer, selection, path);
      trace(context, '<- [union::select]', `-> out: ${this.name}`);
      return;
    }

    if (this.mixedValue) {
      this.mixedValue.writeSelection(context, writer, selection, path);
      trace(context, '<- [union::select]', `-> out: ${this.name}`);
      return;
    }

    for (const field of this.findMergedFields(context, selection, keep, path)) {
      field.prop.select(context, writer, selection, field.path, field.name);
    }

    /* TODO: better selection for Unions
    dataPoints: dataFormat->match(
    ["raw", $.dataPoints],
    ["normal", $.dataPoints {
      priceDateTime
      # all other fields
    }],
    [@, $ { # optimized
      priceDateTime
      # all other fields
      }
    ])
     */

    trace(context, '<- [union::select]', `-> out: ${this.name}`);
  }

  /**
   * R2: emit the connect-v0.4 abstract-type selection for a real union. Shape (verified to
   * compose under fed v2.13 / connect v0.4):
   *
   *   ... <discriminator>->match(
   *     ["<value>", $ { __typename: $("Book") <Book fields> }],
   *     ["<value>", $ { __typename: $("Movie") <Movie fields> }]
   *   )
   *
   * `__typename` is a string literal (required by the composer); per-member fields come from
   * each member's own `select`, scoped by the current selection.
   */
  private selectAbstract(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string): void {
    const base = context.indent;
    const pad = (n: number) => ' '.repeat(Math.max(n, 0));

    // The match operates on the *source* JSON field; quote it if not a bare identifier
    // (e.g. OAS discriminators like `@type`).
    const field = /^[_A-Za-z][_0-9A-Za-z]*$/.test(this.discriminator!)
      ? this.discriminator!
      : `"${this.discriminator!}"`;

    // Only members with at least one selected prop participate.
    const members = this.selectedMembers(selection, path);

    writer.write(pad(base)).write(`... ${field}->match(\n`);

    members.forEach((child, idx) => {
      // `__typename` is the written name (`http_rule_response` -> `HttpRuleResponse`), or the router
      // can't match what comes back to a member. see docs/FIXED.md #43
      const typeName = Union.resolvedTypeName(child.name);
      // With no `mapping`, the value the service sends is the plain ref name — "Book", not "book".
      // It is compared against real payloads, so it keeps the name the OAS uses, unsanitised.
      const value = this.discriminatorValue(child) ?? Naming.getRefName(child.name)!;

      writer.write(pad(base + 2)).write(`["${value}", $ {\n`);
      writer.write(pad(base + 4)).write(`__typename: $("${typeName}")\n`);

      // Member fields via the child's own select (scoped by selection). `select` writes at
      // `context.indent + stack.length`, so offset indent to land fields at base + 4.
      const savedIndent = context.indent;
      context.indent = base + 4 - context.stack.length;
      child.select(context, writer, selection, Naming.pathUnder(path, child.id));
      context.indent = savedIndent;

      writer
        .write(pad(base + 2))
        .write(idx < members.length - 1 ? '}],' : '}]')
        .write('\n');
    });

    writer.write(pad(base)).write(')\n');
  }

  // The name a ref is written as: `http_rule_response` -> `HttpRuleResponse`. Same rule `Obj` and
  // `Composed` use for their own `type X {` line. see docs/FIXED.md #15, #43
  private static resolvedTypeName(ref: string): string {
    const sanitised = Naming.genTypeName(ref);
    const refName = Naming.getRefName(ref);
    return sanitised === refName ? refName : sanitised;
  }

  /** Reverse-lookup the explicit discriminator `mapping` value for a member — e.g. given
   * `mapping: { book: '#/components/schemas/Book' }`, returns "book" for the Book member.
   * Null when there's no explicit mapping (the caller then uses the bare ref name). */
  private discriminatorValue(child: IType): string | null {
    const mapping = this.discriminatorMapping;
    if (!mapping) return null;
    const childRef = Naming.getRefName(child.name);
    for (const [value, ref] of Object.entries(mapping)) {
      if (Naming.getRefName(ref) === childRef) return value;
    }
    return null;
  }

  // Returns the members' $refs, sorted and joined after the union's side, when every member other than
  // null is a $ref: the same set on one side is the same choice wherever it is spelled. Else undefined.
  // see docs/FIXED.md #118 #242
  //   e.g. (hubspot) oneOf: [$ref OrBranch, $ref AndBranch] and [$ref AndBranch, $ref OrBranch] -> one set
  public findMemberRefs(): string | undefined {
    const real = this.schemas.filter((member) => member && member.type !== 'null');
    const refs = real.map((member) => (member as ReferenceObject).$ref).filter((ref): ref is string => ref != null);
    return refs.length >= 2 && refs.length === real.length ? `${this.kind}:${refs.sort().join('|')}` : undefined;
  }

  // Consolidates once, the first time a writer or walk needs the merged fields or the mixed value.
  //   e.g. (ashby) CustomField.value's mixed value, built when its type is first written
  private consolidateMembers(context: OasContext, selection: ExpandedSelection): void {
    if (!this.consolidated) {
      this.consolidate(context, selection);
    }
  }

  // Merges the members' fields selected on this union's written route into this.props, the tag field
  // included, or builds the mixed value from them. The op line reads this.props with no selection at
  // hand (#80); a writer reads the fields per route through findMergedFields. #208 #242
  //   e.g. (ashby) OverlayCustomField.value: oneOf [boolean, { currencyCode, value }, string] -> text, boolean, object
  public consolidate(context: OasContext, selection: ExpandedSelection): void {
    // A flat union under a field, list item or map value that mixes plain values with objects keeps
    // every branch as its own field, instead of the field merge below that keeps only the objects. #208
    const shape = this.isFlat() ? this.analyzeMixedValue(context) : undefined;
    if (shape) {
      this.mixedValue = new MixedValue(this, shape, context, selection, [selection.writtenPath(this)]);
      this.mixedValue.dependencies().forEach((prop) => this.props.set(prop.name, prop));
    } else {
      const props = this.findSelectedFields(selection, selection.writtenPath(this)).map((field) => field.prop);
      const discriminator = this.discriminator;

      // add the discriminator, if we have one
      if (discriminator) {
        const prop = this.children.map((child) => child.props.get(discriminator)).find((prop) => prop !== undefined);
        if (prop) props.push(prop);
      }

      // and finally sort the props and copy them to our original
      props.sort((a, b) => a.name.localeCompare(b.name)).forEach((prop) => this.props.set(prop.name, prop));
    }

    this.consolidated = true;
  }

  // Builds the mixed value again from the routes this union is now reached on: the object type holds
  // the fields they select, and the comments recorded for the old one are dropped. #242
  //   e.g. (mixed-value-nested-object.yaml) Pick.value from /s's route, x: String instead of M1's comment
  public rebuildMixedValue(context: OasContext, selection: ExpandedSelection, routes: string[]): void {
    const old = this.mixedValue;
    const shape = old ? this.analyzeMixedValue(context, true) : undefined;
    if (!old || !shape) {
      return;
    }
    if (old.objectType) {
      context.propOverrides.delete(old.objectType.id);
    }
    old.dependencies().forEach((field) => this.props.delete(field.name));
    this.mixedValue = new MixedValue(this, shape, context, selection, routes);
    this.mixedValue.dependencies().forEach((field) => this.props.set(field.name, field));
  }

  // Whether this union mixes a plain value with a real object, or undefined when it doesn't:
  // input side, not under a field/list/map, not mixed, or a wide integer member (open gap, #208).
  // Under a field, list or map means on every selected route, or on the route the walk is on.
  //   e.g. (ashby) OverlayCustomField.value: oneOf [boolean, { currencyCode, value }, string] -> text, boolean, object
  public analyzeMixedValue(
    context: OasContext,
    quiet: boolean = false,
    parentOnRoute?: IType,
  ): MixedValueShape | undefined {
    if (this.kind === 'input') {
      return undefined;
    }
    const underValueOrItem = parentOnRoute
      ? Union.isValueOrItemParent(parentOnRoute)
      : (this.everyRouteValueOrItem ?? Union.isValueOrItemParent(this.parent));
    if (!underValueOrItem) {
      return undefined;
    }

    const members = this.schemas.filter((s) => s?.type !== 'null');
    const shape = Schemas.analyzeMixedValue(context, members);
    if (!shape && !quiet && Union.hasWideIntegerMember(context, members)) {
      warn(null, '[union]', `wide-integer member in a mixed oneOf keeps today's merge: ${this.name}`);
    }
    return shape;
  }

  // True for a node a union can sit under as a field's value, a list item or a map value.
  //   e.g. (ashby) CustomField's prop:comp:value -> true; get:/…'s res:r -> false
  public static isValueOrItemParent(node: IType | undefined): boolean {
    return node instanceof PropComp || node instanceof PropArray || node instanceof MapType;
  }

  // Whether a member is an integer too wide for Int: the one reason analyzeMixedValue declines,
  // and worth a warning since the field then merges away its plain branches. #208
  private static hasWideIntegerMember(context: OasContext, members: SchemaObject[]): boolean {
    return members.some((m) => {
      const resolved = '$ref' in m ? (context.resolvePointer((m as { $ref: string }).$ref) as SchemaObject) : m;
      return resolved?.type === 'integer' && GqlUtils.gqlScalarFor(resolved, 'integer') === 'String';
    });
  }

  private visitProperties(_context: OasContext): void {
    // TODO: pending
  }

  // False when merging finds no fields at all — such a union is written as JSON, not as an empty type.
  // Merged fields sit on this.props; the op line asks with no selection at hand, so read them first.
  // e.g. (github) get stargazers answers anyOf [array of simple-user, array of stargazer] — no fields  #80
  public hasSelectedProps(context: OasContext, selection: ExpandedSelection, keep: boolean, path: string): boolean {
    if (this.consolidated) {
      return this.props.size > 0;
    }
    return this.dedupedSelectedProps(context, selection, keep, path).length > 0;
  }

  // Why generate() above writes JSON instead of a real return type, or undefined if it doesn't.
  // The op's own docstring (get.ts/post.ts) reads this before this union writes anything. #132
  //   e.g. (github) get stargazers answers anyOf [array of simple-user, array of stargazer] — no
  //   fields to merge, so the operation answers JSON instead of an empty type
  public emptyMergeReason(context: OasContext, selection: ExpandedSelection, keep: boolean): string | undefined {
    return this.isFlat() && !this.hasSelectedProps(context, selection, keep, selection.writtenPath(this))
      ? JsonDegradeReasons.emptyMerge()
      : undefined;
  }

  // A mixed-value union reads the whole value, e.g. (ashby) `value?->echo({ raw: @ })`. #208
  public selectionSuffix(_context: OasContext): string | undefined {
    return this.mixedValue?.selectionSuffix();
  }

  public selectedProps(selection: ExpandedSelection, _keep: boolean, path: string): Prop[] {
    return this.findSelectedFields(selection, path).map((field) => field.prop);
  }

  // Every member's selected fields in member order, one entry per occurrence (a name two members
  // declare is listed twice, for dedupeByName to settle), each at the path it was selected at. A
  // member that is a union or allOf reads its own members' fields under its own id. #80 #242
  //   e.g. (stripe) del bank_accounts answers anyOf [payment_source, deleted_payment_source], both anyOf too
  public override findSelectedFields(selection: ExpandedSelection, path: string): SelectedField[] {
    return this.findMembersOn(path).flatMap((member) => this.findMemberFields(member, selection, path));
  }

  // One member's selected fields when this union sits at `path`, each at the path it was selected at.
  //   e.g. (nested-oneof-branch-loss.yaml) the Currency member's currencyCode at …>obj:type:[inline:valueUnion]:1>prop:scalar:currencyCode
  public findMemberFields(member: IType, selection: ExpandedSelection, path: string): SelectedField[] {
    const memberPath = Naming.pathUnder(path, member.id);
    if (member instanceof Union || member instanceof Composed) {
      return member.findSelectedFields(selection, memberPath);
    }
    return Array.from(member.props.values())
      .map((prop) => ({ prop, path: prop.pathInSelection ?? Naming.pathUnder(memberPath, prop.id) }))
      .filter((field) => selection.isSelected(field.prop, field.path));
  }

  private updateName(): void {
    let name = this.name;
    if (!name) {
      if (this.parent instanceof Res) {
        const op = this.parent!.parent as Get;
        name = op.getGqlOpName() + 'Response';
      } else {
        name = this.parent!.name + `Union`;
      }
    }

    this.name = name;
  }
}
