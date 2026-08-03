import {
  Arr,
  CircularRef,
  Composed,
  En,
  Get,
  IType,
  Obj,
  Op,
  Prop,
  PropArray,
  PropComp,
  PropEn,
  PropObj,
  PropScalar,
  ReferenceObject,
  Scalar,
  Union,
} from './internal.js';
import _ from 'lodash';
import { Naming } from '../utils/naming.js';
import type { OasContext } from '../oasContext.js';
import type { Writer } from '../io/writer.js';
import type { SchemaObject } from 'oas/types';

export class T {
  public static isLeaf(type: IType): boolean {
    return (
      type instanceof Scalar ||
      type instanceof PropScalar ||
      type instanceof En ||
      type instanceof PropEn ||
      type instanceof CircularRef ||
      (type instanceof PropArray && type.items instanceof Scalar) ||
      (type instanceof Obj && _.isEmpty(type.props)) ||
      T.isScalarArray(type)
    );
  }

  public static isPropScalar(type: IType): boolean {
    return type instanceof PropScalar;
  }

  // every operation node (Get, Post, Put, Patch, Delete) derives from Get
  public static isOp(type: IType): type is IType & Op {
    return type instanceof Get;
  }

  public static traverse(node: IType, callback: (node: IType) => void): void {
    const traverseNode = (n: IType): void => {
      callback(n);

      for (const c of n.children) {
        traverseNode(c);
      }
    };

    traverseNode(node);
  }

  static isMutationType(type: IType): boolean {
    return (
      type.id.startsWith('post:') ||
      type.id.startsWith('put:') ||
      type.id.startsWith('patch:') ||
      type.id.startsWith('del:')
    );
  }

  static isScalar(type: IType): boolean {
    return type.id.startsWith('scalar:');
  }

  public static containers(node: IType) {
    return Array.from(node.children.values())
      .filter((child) => !(child instanceof Prop) && T.isContainer(child))
      .map((child) => child);
  }

  // emitted as its own definition in the schema (`type X` / `enum X`), unlike props, wrappers,
  // scalars and cycle cuts which only appear inside other definitions
  public static isEmittable(node: IType): boolean {
    return T.isContainer(node) || node.id.startsWith('enum:');
  }

  public static isContainer(node: IType): boolean {
    return (
      node.id.startsWith('obj:') ||
      node.id.startsWith('comp:') ||
      node.id.startsWith('union:') ||
      node.id.startsWith('map:')
    );
  }

  static composables(node: IType): IType[] {
    return _.filter(T.containers(node), (e: IType) => e.id.startsWith('comp:')); // || e.id.startsWith('union:'));
  }

  public static print(node: IType, prefix: string = '', isLast: boolean = true): string {
    // Build the current line with the appropriate connector.
    const connector = prefix === '' ? '' : isLast ? '└─ ' : '├─ ';
    let result = prefix + connector + node.id + '\n';

    // Prepare the prefix for the children.
    const childPrefix = prefix + (isLast ? '   ' : '│  ');

    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      result += T.print(child, childPrefix, last);
    });

    return result;
  }

  // A missing name is not a component reference.
  public static isRef(name: string | undefined) {
    return !!name && name.startsWith('#/components/');
  }

  public static findNonPropParent(type: IType) {
    let parent = type;
    while (parent instanceof Prop) {
      parent = parent.parent!;
    }
    return parent;
  }

  public static isScalarArray(type: IType) {
    return type instanceof Arr && type.itemsType instanceof Scalar;
  }

  // R10: the bare GraphQL name a `...Type` spread must reference — the exact name the type's
  // own definition emits (genTypeName + nameSuffix; any drift breaks composition). Returns
  // undefined when the child carries no @mapping to spread: inputs, promoted interfaces,
  // free-form JSON (no props), unions (->match stays co-located) and maps (->entries).
  public static mappingSpreadName(input: IType | undefined, selection: string[]): string | undefined {
    // unwrap array nesting: the spread targets the item type's @mapping
    let type = input;
    while (type instanceof Arr) {
      type = type.itemsType;
    }
    if (!type || type.kind === 'input') {
      return undefined;
    }
    if (type instanceof Composed && type.schema.allOf != null && !type.consolidated) {
      type.consolidate(selection);
    }
    const target =
      type instanceof Obj && !type.emitAsInterface
        ? type
        : type instanceof Composed && type.schema.allOf != null
          ? type
          : undefined;
    if (!target || _.isEmpty(target.props)) {
      return undefined;
    }
    return Naming.genTypeName(target.name) + target.nameSuffix();
  }

  // R10: how a field hands its value to the child's @mapping. The form is always
  // `alias: path->Type`, so a plain field repeats its own name: `category: category->Category`.
  // An already-aliased field just gets the arrow: `photo: "photo-url"` -> `photo: "photo-url"->Photo`.
  public static mappingSpreadSuffix(sanitised: string, spread: string): string {
    return sanitised.includes(': ') ? `->${spread}` : `: ${sanitised}->${spread}`;
  }

  // R10: the child type a prop's selection would spread to, or undefined for scalar/enum/etc.
  private static spreadChildOf(prop: Prop): IType | undefined {
    if (prop instanceof PropObj) return prop.obj;
    if (prop instanceof PropArray) return prop.items;
    if (prop instanceof PropComp) return prop.comp;
    return undefined;
  }

  // R10: whether a prop lands on an object/interface/union GraphQL field — the exact set the
  // router refuses to auto-derive a mapping for. Array nesting is unwrapped, so a scalar list is
  // not object-typed; an `emitAsInterface` Obj still is (it becomes a GraphQL interface).
  private static isObjectTypedProp(prop: Prop): boolean {
    let child = T.spreadChildOf(prop);
    while (child instanceof Arr) {
      child = child.itemsType;
    }
    return child instanceof Obj || child instanceof Composed || child instanceof Union;
  }

  // R10 cycle pre-pass: a per-type emission stack cannot catch multi-type cycles (each @mapping
  // body is rendered from its own emitted instance), so before any body is emitted, build the
  // spread graph over the *emitted* instances and mark every DFS back edge "Parent|Child" for
  // inline fallback. Only back edges are marked — the minimum set that breaks each cycle.
  public static computeInlinedMappingEdges(
    types: Map<string, IType>,
    selection: string[],
    context: OasContext,
  ): void {
    const adjacency = new Map<string, Set<string>>();

    types.forEach((type) => {
      const name = T.mappingSpreadName(type, selection);
      if (!name || adjacency.has(name)) {
        return;
      }
      const edges = new Set<string>();
      for (const prop of (type as Obj | Composed).selectedProps(selection)) {
        const childName = T.mappingSpreadName(T.spreadChildOf(prop), selection);
        if (childName) {
          edges.add(childName);
        }
      }
      adjacency.set(name, edges);
    });

    const backEdges = new Set<string>();
    const colour = new Map<string, 'grey' | 'black'>();

    const visit = (node: string): void => {
      colour.set(node, 'grey');
      for (const child of adjacency.get(node) ?? []) {
        if (colour.get(child) === 'grey') {
          backEdges.add(`${node}|${child}`);
        } else if (colour.get(child) !== 'black' && adjacency.has(child)) {
          visit(child);
        }
      }
      colour.set(node, 'black');
    };

    for (const node of adjacency.keys()) {
      if (!colour.has(node)) {
        visit(node);
      }
    }

    context.inlinedMappingEdges = backEdges;
  }

  // R10: true when this prop's spread closes a cycle (a pre-computed back edge) — the caller
  // must render the child subtree fully inline instead of spreading.
  public static isInlinedBackEdge(prop: Prop, spreadName: string, context: OasContext, selection: string[]): boolean {
    const owner = T.mappingSpreadName(T.findNonPropParent(prop.parent!), selection);
    return !!owner && context.inlinedMappingEdges.has(`${owner}|${spreadName}`);
  }

  // R10: emit the type's @mapping directive (connect v0.5). The body is the type's own selection
  // rendered in reusable mode (nested fields collapse to `field { ...Child }` spreads). When the
  // body is exactly the SDL field names, the auto-map form (bare `@mapping`) maps 1:1 by name;
  // anything aliased, defaulted or nested needs the explicit `@mapping(selection: """…""")`.
  public static writeMappingDirective(
    type: Obj | Composed,
    context: OasContext,
    writer: Writer,
    selection: string[],
  ): void {
    if (!context.generateOptions.reusableMappings || type.kind === 'input') {
      return;
    }
    if (type instanceof Obj && type.emitAsInterface) {
      return;
    }

    const body = writer.capture(() => {
      const saved = context.indent;
      // `select` indents by `context.indent + stack.length`; this type is mid-generation (on
      // the stack), so offset to land the body lines at column 2 (the reference format).
      context.indent = 2 - context.stack.length;
      type.select(context, writer, selection);
      context.indent = saved;
    });

    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return;
    }

    const selected = type.selectedProps(selection);
    const fields = selected.map((prop) => Naming.sanitiseField(prop.name));
    // The bare form asks the router to derive the mapping from the SDL field list, and it refuses
    // to do that for a type with any object/interface/union field — a check it makes against the
    // *field types*, not against this body. Deciding it from the body alone would agree only by
    // coincidence (nested props render as `field { … }`, never a bare name), so gate on the field
    // types directly and let anything object-shaped take the explicit form.
    const autoMap =
      lines.length === fields.length &&
      lines.every((line, i) => line === fields[i]) &&
      !selected.some((prop) => T.isObjectTypedProp(prop));

    if (autoMap) {
      writer.write(' @mapping');
    } else {
      // close at the body's column (2) so the directive reads as one aligned block, like @connect
      writer.write(' @mapping(selection: """\n').write(body).write('  """)');
    }
  }

  // The occupant is the type already stored under our name: a different shape collides (rename,
  // see #9/#12); a same-schema occupant dedups instead — renaming it would orphan it (see #18).
  // e.g. (googlebooks):
  //   saleInfo:   { listPrice: { amount } }          <- visited first, stored as `listPrice`
  //   offersItem: { listPrice: { amountInMicros } }  <- same name, different shape -> collides
  public static collidesWithStoredType(node: IType, context: OasContext): boolean {
    if (T.isExemptFromRename(node)) {
      return false;
    }
    const occupant = T.storedOccupant(node, context);
    if (!occupant) {
      return false;
    }
    return !T.isSameInlineDefinition(node, occupant);
  }

  // Detects an inline object that shares its name with a component it holds — the wrapper `group`
  // holding `results: [#/components/schemas/Group]`. Renaming it avoids a duplicate `type Group`. We
  // read the object's own schema (rather than the built tree) because the `Group` component is reached
  // through `results`, which the parser expands only after this object is built. see #12, #37.
  //   group:
  //     type: object
  //     properties:
  //       results: { type: array, items: { $ref: '#/components/schemas/Group' } }
  //       size: { type: integer }
  public static collidesWithContainedComponent(node: IType): boolean {
    if (!(node instanceof Obj) || T.isExemptFromRename(node)) {
      return false;
    }
    const ownName = Naming.genTypeName(node.name);
    return Object.values(node.schema?.properties ?? {}).some((prop) => {
      const ref = T.componentSchemaRef(prop);
      return ref != null && Naming.genTypeName(Naming.getRefName(ref)) === ownName;
    });
  }

  // The schema component ref a property targets — directly, or as the items of an array — or null.
  // An "array" includes the implied form (`items` with no `type`, per factory.ts:83). Schema refs are
  // the ones that become a `type X`.
  //   group:   { $ref: '#/components/schemas/Group' }                          -> #/components/schemas/Group
  //   results: { type: array, items: { $ref: '#/components/schemas/Group' } }  -> #/components/schemas/Group
  //   results: { items: { $ref: '#/components/schemas/Group' } }               -> #/components/schemas/Group
  private static componentSchemaRef(schema: SchemaObject | ReferenceObject | undefined): string | null {
    if (schema == null) return null;

    let ref: string | undefined;
    if ('$ref' in schema) {
      ref = schema.$ref;
    }
    // array (explicit, or implied via `items`) — take the items' ref
    else if (schema.type === 'array' || schema.type == null) {
      const itemsRef = _.get(schema, 'items.$ref');
      ref = typeof itemsRef === 'string' ? itemsRef : undefined;
    }

    // keep only schema-component refs (the ones that emit a clashing type)
    if (ref == null || !ref.startsWith('#/components/schemas/')) {
      return null;
    }

    return ref;
  }

  // an occupant of a DIFFERENT class always emits a second definition of the name — ids start
  // with the class (`obj:`/`comp:`), so the collector can never dedup the two. A same-class
  // occupant keeps the old dedup-by-id behaviour: renaming those orphans twins that differ only
  // in description (File/Folder `created_by`). see #22. e.g. (box):
  //   SharedLink: { permissions: { type: object, … } }  <- Obj, stored as `permissions`
  //   File--Full: { permissions: { allOf: […] } }       <- Composed `Permissions` -> must rename
  public static collidesAcrossNodeClasses(node: IType, context: OasContext): boolean {
    if (T.isExemptFromRename(node)) {
      return false;
    }
    const occupant = T.storedOccupant(node, context);
    return !!occupant && occupant.constructor !== node.constructor;
  }

  // Qualify a colliding inline name with its container (nearest non-prop ancestor), e.g. `listPrice`
  // under `offersItem` -> `OffersItemListPrice`, bumping `2`, `3`… until free. Both parts go through
  // genTypeName so the result is always a valid identifier (the container name may itself be an
  // `[inline:…]` placeholder) and is idempotent under emission. see docs/issues.md #9
  public static resolveNameConflict(node: IType, context: OasContext): void {
    const base = Naming.genTypeName(T.findNonPropParent(node.parent!).name) + Naming.genTypeName(node.name);
    let candidate = base;
    for (let n = 2; context.types.has(candidate); n++) {
      if (T.canConvergeOn(node, context.types.get(candidate), candidate)) {
        break;
      }
      candidate = `${base}${n}`;
    }
    node.name = candidate;
  }

  // only inline types named after a property key get renamed (#9 Obj, #7/#22 Composed). The rest
  // must keep their name: a `$ref` name is one shared definition, and an `[inline:…]` member is
  // never emitted on its own — both are found by that id, renaming would break it. see #9 e.g.:
  //   `listPrice`                  <- from a property key: can rename
  //   `#/components/schemas/User`  <- $ref name: keep
  //   `[inline:Permissions]`       <- consolidated allOf member: keep
  private static isExemptFromRename(node: IType): boolean {
    return !node.name || T.isRef(node.name) || node.name.startsWith('[inline:');
  }

  // the type already stored under our name, raw or emitted. see #12 e.g.:
  //   user: { type: object, … }  <- stored under `user` AND its emitted name `User`; found by either
  private static storedOccupant(node: IType, context: OasContext): IType | undefined {
    return context.types.get(node.name) ?? context.types.get(Naming.genTypeName(node.name));
  }

  // the same definition duplicated inline: same name-derived id AND a deeply-equal raw schema —
  // an id mismatch (pointer-named #8, component #12) would emit two definitions of one name.
  // see #18 e.g. (box):
  //   File:   { shared_link: { url: {type: string} } }  <- stored
  //   Folder: { shared_link: { url: {type: string} } }  <- identical copy -> dedup, keep the name
  private static isSameInlineDefinition(node: IType, occupant: IType): boolean {
    if (occupant.id !== node.id) {
      return false;
    }
    return T.sameSchemaAs(node, occupant);
  }

  // deeply-equal raw schemas: the same inline definition duplicated, not a different shape that
  // happens to share the name. see #18 e.g.:
  //   { url: {type: string} } vs { url: {type: string} }                -> same
  //   { url: {type: string} } vs { url: {type: string}, vanity: {…} }  -> different
  private static sameSchemaAs(node: IType, occupant: IType): boolean {
    if (!node.schema || !occupant.schema) {
      return false;
    }
    return _.isEqual(node.schema, occupant.schema);
  }

  // a twin with the same schema was already renamed to `candidate` — take the same name (and so
  // the same id) instead of adding `2`, `3`, …, which would orphan on fold. see #18
  // Same node class only: ids start with the class, so the ids would differ anyway. see #22 e.g.:
  //   Folder A: { created_by: {…X…} }  <- collided earlier, renamed to `FolderCreatedBy`
  //   Folder B: { created_by: {…X…} }  <- same schema -> reuse `FolderCreatedBy`, not `…2`
  private static canConvergeOn(node: IType, occupant: IType | undefined, candidate: string): boolean {
    if (!occupant || occupant.constructor !== node.constructor || occupant.name !== candidate) {
      return false;
    }
    return T.sameSchemaAs(node, occupant);
  }
}
