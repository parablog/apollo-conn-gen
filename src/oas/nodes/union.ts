import {
  Arr,
  Composed,
  Factory,
  Get,
  IType,
  Param,
  Prop,
  PropScalar,
  Res,
  Scalar,
  T,
  Type,
  selectionPrefixes,
} from './internal.js';
import { SchemaObject } from 'oas/types';
import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';

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

  // set by TypesCollector when one op reaches this component top-level and another nests it,
  // forcing the shared merged-object form everywhere. see docs/FIXED.md #121
  // e.g.:
  //   /media: get -> $ref Media                    # top level: real union, ->match selection
  //   /shelf: get -> { featured: $ref Media, ... }  # nested: merged/flat object
  //   Media: oneOf [Book, Movie], discriminator kind
  public forcedFlat = false;

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
      const type = Factory.fromSchema(context, this, refSchema);
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

    this.visited = true;
    trace(context, '<- [union:visit]', 'out: ' + schemas);
    context.leave(this);
  }

  // True when this union IS the op's response (optionally under a bare array), not nested inside a
  // field. This composes fine:
  //   get:/item -> oneOf [Book, Movie]
  // This doesn't — launch library's real shape, rover won't resolve anything inside the match:
  //   PaginatedAgencyList.results: [ oneOf [AgencyMini, AgencyNormal, AgencyDetailed] ]
  // see docs/FIXED.md #38
  public isTopLevelResponse(): boolean {
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
    return this.forcedFlat || this.kind === 'input' || !this.discriminator || !this.isTopLevelResponse();
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
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
      if (this.isFlat() && !this.hasSelectedProps(selection, keep)) {
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
        // an empty merge writes no type — its field was written as JSON  #80
        if (!this.hasSelectedProps(selection, keep)) {
          trace(context, '   [union::generate]', `[union] no fields to merge, skipping: ${this.name}`);
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
        const filtered = this.selectedMembers(selection);

        this.writeMemberJsonNote(writer);
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
    selection: string[],
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
    this.writeMemberJsonNote(writer);
    writer
      .write(this.kind + ' ')
      .write(name)
      .write(this.nameSuffix())
      .write(' { #### replacement for Union ')
      .write(name)
      .write('\n');

    for (const prop of this.dedupedSelectedProps(selection, keep)) {
      trace(context, '   [union::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
      prop.generate(context, writer, selection);
    }

    writer.write('} \n### End replacement for ').write(this.name).write('\n\n');
  }

  // Members can give the same field name two different shapes. Both objects — keep the first,
  // picking common fields out of differently-shaped payloads is fine (launch library):
  //   LaunchNormal:   { rocket: { allOf: [{ $ref: '#/…/RocketNormal' }] } }
  //   LaunchDetailed: { rocket: { allOf: [{ $ref: '#/…/RocketDetailed' }] } }
  // A list of allowed values next to a plain string — no single field fits both, so fall back to
  // the JSON scalar rather than pick a member (TMF717):
  //   Individual: { status: { $ref: '#/…/IndividualStateType' } }   # enum
  //   PartyRole:  { status: { type: string } }
  // see docs/FIXED.md #39, #44
  private dedupedSelectedProps(selection: string[], keep: boolean): Prop[] {
    const kindOf = (prop: Prop) => prop.id.split(':')[1];

    const firstByName = new Map<string, Prop>();
    const kindByName = new Map<string, string>();
    const incompatible = new Set<string>();

    for (const prop of this.selectedProps(selection, keep)) {
      const kind = kindOf(prop);
      const existingKind = kindByName.get(prop.name);
      if (existingKind === undefined) {
        firstByName.set(prop.name, prop);
        kindByName.set(prop.name, kind);
      } else if (kind !== existingKind) {
        incompatible.add(prop.name);
      }
    }

    // two members can spell the same field differently — number the later twin instead of writing
    // it twice. e.g. (trello) boards: prefs/background + prefs_background. see docs/FIXED.md #113
    return T.numberTwinFields(
      Array.from(firstByName.entries()).map(([name, prop]) => {
        if (!incompatible.has(name)) {
          return prop;
        }
        const reason =
          'different branches of a merged type declare this field differently, and no single GraphQL type fits both — sent as raw JSON.';
        warn(null, '[union]', reason);
        return new PropScalar(prop.parent!, name, 'JSON', Schemas.withJsonNote({}, reason));
      }),
      keep,
    );
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
  private writeMemberJsonNote(writer: Writer): void {
    const reasons = this.memberJsonReasons();
    if (reasons.length === 0) return;
    const note = Schemas.withJsonNote({}, reasons.join(' ')).description!;
    writer.write('"""\n').write(note).write('\n"""\n');
  }

  // two inline members easily share a name (`[inline:Input]` twice) — same suffixing as Composed
  add(child: IType): IType {
    return super.add(this.withUniqueName(child));
  }

  // the members that carry at least one selected field — what the `union X = …` line lists and
  // what `->match` branches over. Composed members fold their allOf parts in first. see #34
  private selectedMembers(selection: string[]): IType[] {
    return this.children.filter((child) => {
      if (child instanceof Composed && child.schema.allOf != null && !child.consolidated) {
        child.consolidate(selection);
      }
      // prefix-set membership, not a scan per prop — 55M path() rebuilds on hubspot lists. #10 #118
      const prefixes = selectionPrefixes(selection);
      return Array.from(child.props.values()).some((p) => prefixes.has(p.path()));
    });
  }

  // a real `union X = Book | Movie` needs its members (and a member's shared $ref base, which
  // the writer may promote to an interface — R2); a merged one needs its flat fields instead
  dependencies(context: OasContext, selection: string[]): IType[] {
    if (this.isFlat()) {
      // consolidate first, like generateMergedObject does: merging picks which member's copy of a
      // shared field is kept, so reading the fields before the merge can name a different type than
      // the writer emits — box collected enum WebLinkBaseType but wrote `type: FileBaseType!`. #57
      this.consolidateMembers(context, selection);
      const keep = context.generateOptions?.keepFieldNames === true;
      return this.dedupedSelectedProps(selection, keep);
    }
    // only members with a selected field are reachable (#26, #36); an allOf member also pulls in the
    // $ref base it extends — `Book: allOf [$ref Product, …]` -> Product (r2-interface-shared-base.yaml).
    return this.selectedMembers(selection).flatMap((member) => [
      member,
      // expand the list with all those that are referenced by this type, so we can filter them too
      ...(member instanceof Composed ? T.containers(member).filter((c) => T.isRef(c.name)) : []),
    ]);
  }

  public select(context: OasContext, writer: Writer, selection: string[]): void {
    trace(context, '-> [union::select]', `-> in: ${this.name}`);
    const keep = context.generateOptions?.keepFieldNames === true;

    if (!this.consolidated) {
      this.consolidate(selection, keep);
    }

    // R2: for a real output `union X = A | B` (output position + discriminator) produce the
    // composable abstract-type selection (connect v0.4): a spread `->match` whose branches set a
    // string-literal __typename per member. Merged-object unions (input position or no discriminator)
    // fall back to the flat selection below. see docs/FIXED.md #25, #36
    if (!this.isFlat()) {
      this.selectAbstract(context, writer, selection);
      trace(context, '<- [union::select]', `-> out: ${this.name}`);
      return;
    }

    for (const prop of this.dedupedSelectedProps(selection, keep)) {
      prop.select(context, writer, selection);
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
  private selectAbstract(context: OasContext, writer: Writer, selection: string[]): void {
    const base = context.indent;
    const pad = (n: number) => ' '.repeat(Math.max(n, 0));

    // The match operates on the *source* JSON field; quote it if not a bare identifier
    // (e.g. OAS discriminators like `@type`).
    const field = /^[_A-Za-z][_0-9A-Za-z]*$/.test(this.discriminator!)
      ? this.discriminator!
      : `"${this.discriminator!}"`;

    // Only members with at least one selected prop participate.
    const members = this.selectedMembers(selection);

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
      child.select(context, writer, selection);
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

  // Merging inlines the members' fields, so each loses one reference of its own — but a member can
  // carry the union's own name, and zeroing that skips the type the body still asks for. #94
  //   e.g. (confluence) ContentRestrictionAddOrUpdateArray: oneOf [ {object}, {array of $ref} ]
  private consolidateMembers(context: OasContext, selection: string[]): void {
    if (this.consolidated) {
      return;
    }
    const keep = context.generateOptions?.keepFieldNames === true;
    for (const member of this.consolidate(selection, keep)) {
      if (member.name !== this.name) {
        context.decRefCount(member.name);
      }
    }
  }

  public consolidate(selection: string[], keep: boolean): Set<IType> {
    T.composables(this).forEach((child) => {
      (child as Composed).consolidate(selection);
    });

    const ids: Set<IType> = new Set();
    const props: Prop[] = [];
    const prefixes = selectionPrefixes(selection);
    const discriminator = this.discriminator;

    this.children?.forEach((child) => {
      // .filter((prop) => selection.find((s) => s.startsWith(prop.path())))
      ids.add(child);

      // go deeper to get the fields from those inner members, if needed, and only those selected
      if (child instanceof Union) {
        props.push(...child.selectedProps(selection, keep));
        return;
      }

      Array.from(child.props.values())
        .filter((prop) => prefixes.has(prop.path()))
        .forEach((prop) => props.push(prop));

      // props.push(...child.props.values());
    });

    // add the discriminator, if we have one
    if (discriminator) {
      const prop = (this.children || [])
        .map((child) => child.props.get(discriminator))
        .find((prop) => prop !== undefined);

      if (prop) props.push(prop);
    }

    // and finally sort the props and copy them to our original
    props.sort((a, b) => a.name.localeCompare(b.name)).forEach((prop) => this.props.set(prop.name, prop));

    // and return the set of types we've used
    this.consolidated = true;

    // now remove every added ID
    const queue: IType[] = Array.from(this.children.values());
    while (queue.length > 0) {
      const node = queue.shift()!;
      const containers = T.containers(node);
      containers.forEach((c) => ids.add(c));
      // queue.push(...node.children);
    }

    return ids;
  }

  private visitProperties(_context: OasContext): void {
    // TODO: pending
  }

  // False when merging finds no fields at all — such a union is written as JSON, not as an empty type.
  // Merged fields sit on this.props; the op line asks with no selection at hand, so read them first.
  // e.g. (github) get stargazers answers anyOf [array of simple-user, array of stargazer] — no fields  #80
  public hasSelectedProps(selection: string[], keep: boolean): boolean {
    if (this.consolidated) {
      return this.props.size > 0;
    }
    return this.dedupedSelectedProps(selection, keep).length > 0;
  }

  // Why generate() above writes JSON instead of a real return type, or undefined if it doesn't.
  // The op's own docstring (get.ts/post.ts) reads this before this union writes anything. #132
  //   e.g. (github) get stargazers answers anyOf [array of simple-user, array of stargazer] — no
  //   fields to merge, so the operation answers JSON instead of an empty type
  public emptyMergeReason(selection: string[], keep: boolean): string | undefined {
    return this.isFlat() && !this.hasSelectedProps(selection, keep)
      ? "this union merges every member's fields into one type, but none were selected — sent as raw JSON instead."
      : undefined;
  }

  public selectedProps(selection: string[], keep: boolean) {
    const collected: Prop[] = [];
    const prefixes = selectionPrefixes(selection);

    this.children.forEach((child) => {
      // a member that is itself a union has no fields of its own — take its members' fields.
      // e.g. (stripe) del bank_accounts answers anyOf [payment_source, deleted_payment_source], both anyOf too  #80
      if (child instanceof Union) {
        collected.push(...child.selectedProps(selection, keep));
        return;
      }
      Array.from(child.props.values())
        .filter((prop) => prefixes.has(prop.path()))
        .forEach((prop) => collected.push(prop));
    });

    return collected;
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
