import { Factory, Get, IType, Param, Prop, ReferenceObject, Res, T, Type } from './internal.js';
import { SchemaObject } from 'oas/types';

import { trace } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import _ from 'lodash';

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

    context.enter(this);
    trace(context, '-> [composed:visit]', 'in: ' + (this.name == null ? '[object]' : this.name));

    // If not in the context of a Composed or Param, log the composed schema.
    if (!context.inContextOf(Composed, this) && !context.inContextOf(Param, this)) {
      trace(context, '[comp]', '   in composed schema: ' + this.name);
    }

    // a PropComp-named inline allOf (#7) that clashes with a stored type of a different class
    // must rename — otherwise the same type name is defined twice. see docs/issues.md #22
    if (this.parent instanceof Prop && T.collidesAcrossNodeClasses(this, context)) {
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

    this.visited = true;
    trace(context, '<- [composed:visit]', 'out: ' + this.name);
    context.leave(this);
  }

  public generate(context: OasContext, writer: Writer, selection: string[]): void {
    context.enter(this);
    trace(context, '-> [comp::generate]', `-> in: ${this.name}`);

    if (context.inContextOf(Res, this)) {
      writer.write(Naming.genTypeName(this.name));
      return;
    }

    if (this.schema.allOf != null) {
      const selected = this.selectedProps(selection);

      if (selected.length > 0) {
        // Definition and reference must agree: references emit genTypeName(name), so the definition
        // does too (upperFirst(getRefName) kept separators: `Billing_historyResponse` vs the
        // reference's `BillingHistoryResponse`). Mirrors obj.ts. see docs/issues.md #15, #6
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

        for (const prop of selected) {
          trace(context, '   [comp::generate]', `-> property: ${prop.name} (parent: ${prop.parent!.name})`);
          prop.generate(context, writer, selection);
        }

        writer.write('}\n\n');
      }
    }

    trace(context, '<- [comp::generate]', `-> out: ${this.name}`);
    context.leave(this);
  }

  // the selected props, once the allOf members are folded in (same shape select writes)
  dependencies(_context: OasContext, selection: string[]): IType[] {
    if (this.schema.allOf != null && !this.consolidated) {
      this.consolidate(selection);
    }
    return this.selectedProps(selection);
  }

  public select(context: OasContext, writer: Writer, selection: string[]) {
    trace(context, '-> [comp::select]', `-> in: ${this.name}`);
    if (!this.consolidated) {
      this.consolidate(selection);
    }

    const composedSchema = this.schema;
    if (composedSchema.allOf != null) {
      const selected = this.selectedProps(selection);

      for (const prop of selected) {
        prop.select(context, writer, selection);
      }
    } else if (composedSchema.oneOf != null) {
      if (this.children.length === 1) {
        this.children[0].select(context, writer, selection);
      } else {
        throw new Error('Expected exactly one child for a oneOf schema');
      }
    }

    trace(context, '<- [comp::select]', `-> out: ${this.name}`);
  }

  public consolidate(selection: string[]): Set<string> {
    const ids: Set<string> = new Set();
    let props: Map<string, Prop> = new Map();

    const tree = T.print(this);
    const queue: IType[] = Array.from(this.children.values()).filter((child) => !(child instanceof Prop));

    while (queue.length > 0) {
      const node = queue.shift()!;
      ids.add(node.id);

      if (selection.length > 0) {
        node.props.forEach((prop) => {
          if (selection.find((s) => s.startsWith(prop.path()))) {
            props.set(prop.name, prop);
          }
        });
      } else {
        node.props.forEach((prop) => props.set(prop.name, prop));
      }

      // sort props
      props = new Map([...props.entries()].sort());

      const children = Array.from(node.children.values()).filter((child) => !(child instanceof Prop));
      queue.push(...children);
    }

    // copy all collected props from children into this node
    props.forEach((prop, name) => this.props.set(name, prop));

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

      // skip metadata-only allOf members (they contribute no fields). see docs/issues.md #5
      if (Schemas.isEmpty(allOfItemSchema as SchemaObject)) {
        trace(context, '   [composed::all-of]', `skipping empty allOf member #${i}`);
        continue;
      }

      const type = Factory.fromSchema(context, this, allOfItemSchema as SchemaObject);
      this.add(type);

      trace(context, '   [composed::all-of]', 'allOf type: ' + type);

      if (type) {
        type.visit(context);
      }
    }

    const tree = T.print(this);
    context.store(this.name, this);
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
