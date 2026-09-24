import {
  Body,
  Get,
  IType,
  MemberRoute,
  Param,
  Prop,
  QueuedNode,
  ReferenceObject,
  Res,
  SelectedField,
  T,
  Type,
} from './internal.js';
import { SchemaObject } from 'oas/types';

import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import _ from 'lodash';
import { ExpandedSelection } from '../utils/expandedSelection.js';

export class Composed extends Type {
  // R2: GraphQL interface this member implements (a shared allOf base of a discriminated
  // oneOf). When set, generate() appends `implements <Base>`. Set by promoteAllOfBase.
  public implementsInterface?: string;

  constructor(
    parent: IType | undefined,
    public name: string,
    public schema: SchemaObject,
    public consolidated: boolean = false,
  ) {
    super(parent, name);
    this.updateName();
  }

  get id(): string {
    return `comp:${this.kind}:${this.name}`;
  }

  public forPrompt(_context: OasContext): string {
    return `[comp] ${Naming.getRefName(this.name)}`;
  }

  public visit(context: OasContext): void {
    if (this.visited) {
      return;
    }
    // set before the parts are built: a part can reach this node again through the one node built
    // per $ref, and must find it already started. see docs/FIXED.md #242
    this.visited = true;

    context.enter(this);
    trace(context, '-> [composed:visit]', 'in: ' + (this.name == null ? '[object]' : this.name));

    // If not in the context of a Composed or Param, log the composed schema.
    if (!context.inContextOf(Composed, this) && !context.inContextOf(Param, this)) {
      trace(context, '[comp]', '   in composed schema: ' + this.name);
    }

    // a PropComp-named inline allOf clashing with a stored type (different class, same-class via a
    // #/paths ref back to its twin, or a reserved component name) must rename. #22, #124, #126
    // e.g.:
    //   POST /things     -> thing: allOf[{id}, {region}]         # Composed built directly, named Thing
    //   PUT /things/{id} -> thing: $ref '#/paths/.../thing'      # same shape via a raw pointer, must rename
    if (
      this.parent instanceof Prop &&
      (T.collidesWithStoredType(this, context) ||
        T.collidesAcrossNodeClasses(this, context) ||
        T.collidesWithReservedComponentName(this, context))
    ) {
      T.resolveNameConflict(this, context);
    }

    const composedSchema = this.schema;

    // this will be a type declaration
    if (composedSchema.allOf != null) {
      this.visitAllOfNode(context, composedSchema);
    }
    // represents a Union type and should be handled elsewhere
    else if (composedSchema.oneOf != null) {
      throw new Error('Unions should be constructed by its own object');
    }
    // can't hand this yet
    else {
      throw new Error('Composed.visit: unsupported composed schema: ' + this.schema);
    }

    trace(context, '<- [composed:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: ExpandedSelection): void {
    context.enter(this);
    trace(context, '-> [comp::generate]', `-> in: ${this.name}`);

    if (context.inContextOf(Res, this)) {
      writer.write(Naming.genTypeName(this.name));
    } else if (this.schema.allOf != null) {
      const keep = context.generateOptions?.keepFieldNames === true;
      const selected = this.findWrittenFields(selection, keep, selection.writtenPath(this));

      if (selected.length > 0) {
        // Definition and reference must agree: references emit genTypeName(name), so the definition
        // does too (upperFirst(getRefName) kept separators: `Billing_historyResponse` vs the
        // reference's `BillingHistoryResponse`). Mirrors obj.ts. see docs/FIXED.md #15, #6
        const sanitised = Naming.genTypeName(this.name);
        const refName = Naming.getRefName(this.name);
        writer.write(this.kind + ' ');
        writer.write(sanitised === refName ? refName : sanitised);
        writer.write(this.nameSuffix());
        // R2: a promoted member implements the shared base interface.
        if (this.implementsInterface) {
          writer.write(` implements ${this.implementsInterface}`);
        }
        writer.write(' {\n');

        // Writes the comment in place of a field left out on another route or to end a loop, same
        // as obj.ts. #89 #242
        for (const field of selected) {
          const emitted = this.emittedProp(context, field.prop);
          trace(context, '   [comp::generate]', `-> property: ${emitted.name} (parent: ${emitted.parent!.name})`);
          emitted.generate(context, writer, selection, field.name);
        }

        writer.write('}\n\n');
      }
    }

    trace(context, '<- [comp::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  // Returns the selected props, the allOf parts' fields folded in (same shape select writes)
  dependencies(context: OasContext, selection: ExpandedSelection, path: string): IType[] {
    return this.findFieldDependencies(context, selection, path).map((dependency) => dependency.node);
  }

  public override findDependencies(context: OasContext, selection: ExpandedSelection, path: string): QueuedNode[] {
    return this.findFieldDependencies(context, selection, path);
  }

  public select(context: OasContext, writer: Writer, selection: ExpandedSelection, path: string) {
    trace(context, '-> [comp::select]', `-> in: ${this.name}`);

    const composedSchema = this.schema;
    if (composedSchema.allOf != null) {
      // a route that kept the field writes the same comment as the routes where it was removed. #89
      const keep = context.generateOptions?.keepFieldNames === true;
      for (const field of this.findWrittenFields(selection, keep, path)) {
        this.emittedProp(context, field.prop).select(context, writer, selection, field.path, field.name);
      }
    } else if (composedSchema.oneOf != null) {
      if (this.children.length === 1) {
        this.children[0].select(context, writer, selection, Naming.pathUnder(path, this.children[0].id));
      } else {
        throw new Error('Expected exactly one child for a oneOf schema');
      }
    }

    trace(context, '<- [comp::select]', `-> out: ${this.name}`);
  }

  // Returns the parts' selected fields, sorted by name the way the folded fields always were; a name
  // two parts select keeps the later occurrence. The allOf parts are read at every call, so each
  // route selects from all of them. see docs/FIXED.md #242
  //   e.g. (shared-allof-members.yaml) C: allOf [$ref A, $ref B], C>A>id selected -> A's id
  public override findSelectedFields(
    selection: ExpandedSelection,
    path: string,
    routes?: MemberRoute[],
  ): SelectedField[] {
    const byName = super
      .findSelectedFields(selection, path, routes)
      .map((field): [string, SelectedField] => [field.prop.name, field]);
    return byName.sort().map(([, field]) => field);
  }

  // Returns the type this allOf only wraps: its one part, when that part is the $ref this allOf is
  // named after; undefined for any other allOf. #238
  //   e.g. (jira-platform) templateEvent: allOf [ $ref NotificationEvent ] -> NotificationEvent
  public findWrappedType(): IType | undefined {
    const parts = this.children.filter((child) => !(child instanceof Prop));
    return parts.length === 1 && parts[0].name === this.name ? parts[0] : undefined;
  }

  // Folds every part's fields into this.props, for a reader with no route to select at (the CLI
  // prompt, the web tree); returns the ids of the parts. A name two parts declare keeps the later one.
  //   e.g. (simple-allOf-example.yaml) User: allOf [ $ref Address, { name } ] -> city, name, …
  public consolidate(): Set<string> {
    const ids: Set<string> = new Set();
    const props: Map<string, Prop> = new Map();

    for (const route of this.findMemberRoutes()) {
      ids.add(route.member.id);
      route.member.props.forEach((prop) => props.set(prop.name, prop));
    }

    // copy all collected props from children into this node, sorted by name
    new Map([...props.entries()].sort()).forEach((prop, name) => this.props.set(name, prop));

    this.consolidated = true;

    // and return the types we've used
    return ids;
  }

  private visitAllOfNode(context: OasContext, schema: SchemaObject): void {
    const allOfs = schema.allOf || [];
    const refs = allOfs.map((s) => (s as ReferenceObject).$ref);

    trace(context, '-> [composed::all-of]', `in: '${this.name}' of: ${allOfs.length} - refs: ${refs}`);

    for (let i = 0; i < allOfs.length; i++) {
      const allOfItemSchema = allOfs[i];

      // skip metadata-only allOf members (they contribute no fields). see docs/FIXED.md #5
      if (Schemas.isEmpty(allOfItemSchema as SchemaObject)) {
        trace(context, '   [composed::all-of]', `skipping empty allOf member #${i}`);
        continue;
      }

      const type = this.buildMember(context, allOfItemSchema as SchemaObject | ReferenceObject);
      this.add(type);

      trace(context, '   [composed::all-of]', 'allOf type: ' + type);

      if (type) {
        type.visit(context);
      }
    }

    // two inline allOf bodies can share a name but hold different fields — the second one
    // takes a new name instead of reusing the first one's stored input type. see docs/FIXED.md #123
    if (this.parent instanceof Body) {
      const ownedByOtherSide = T.ownedByOtherSide(this, context);
      if (!ownedByOtherSide && T.collidesWithStoredType(this, context)) {
        T.resolveNameConflict(this, context);
      }
      if (!ownedByOtherSide && !context.types.has(this.name)) {
        context.store(this.name, this);
      }
    } else {
      context.store(this.name, this);
    }
    trace(context, '<- [composed::all-of]', `out: '${this.name}' of: ${allOfs.length} - refs: ${refs}`);
  }

  add(child: IType): IType {
    return super.add(this.withUniqueName(child));
  }

  private updateName(): void {
    if (this.name) {
      return;
    }

    if (this.parent instanceof Res) {
      const op = this.parent.parent as Get;
      this.name = op.getGqlOpName() + 'Response';
      return;
    }

    if (this.schema?.allOf?.length === 1) {
      // A single-member allOf with a $ref is just a wrapper around that component:
      // `allOf: [{ $ref: "#/components/schemas/Field" }]` emits `Field`.
      // A single inline member has no component name, so `fields.items.allOf: [{ type: object }]`
      // falls through and is named from the parent field as `Fields`.
      const ref = _.get(this.schema.allOf[0], '$ref') as string | undefined;
      if (ref) {
        this.name = ref;
        return;
      }
    }

    if (this.parent instanceof Prop) {
      this.name = Naming.genTypeName(Naming.getRefName(this.parent.name));
      return;
    }

    // Consolidated allOf members keep the internal id that selection paths reference.
    this.name = `[inline:${this.parent!.name}]`;
  }
}
