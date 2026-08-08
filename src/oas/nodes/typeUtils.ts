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
  Res,
  Scalar,
  Union,
} from './internal.js';
import _ from 'lodash';
import { Naming } from '../utils/naming.js';
import type { OasContext } from '../oasContext.js';
import type { Writer } from '../io/writer.js';
import type { SchemaObject } from 'oas/types';

// where the R10 loop walk stands with a type: currently on the path being walked, or done
type VisitState = 'visiting' | 'finished';

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

  // R10: the type name a `->Type` mapping call must use — exactly what the definition line emits;
  // undefined when the child has no @mapping of its own (inputs, interfaces, unions, maps, free JSON).
  // e.g. (petstore) `Pet.category` -> `Category`
  public static mappingCallName(child: IType | undefined, selection: string[]): string | undefined {
    // a list calls its item type's @mapping
    let type = child;
    while (type instanceof Arr) {
      type = type.itemsType;
    }
    if (!type || type.kind === 'input') {
      return undefined;
    }
    if (type instanceof Composed && type.schema.allOf != null && !type.consolidated) {
      type.consolidate(selection);
    }
    if (!T.hasOwnMapping(type) || _.isEmpty((type as Obj | Composed).props)) {
      return undefined;
    }
    const target = type as Obj | Composed;
    return Naming.genTypeName(target.name) + target.nameSuffix();
  }

  // a plain object or an allOf type carries its own @mapping; interfaces and everything else do not
  private static hasOwnMapping(type: IType): boolean {
    if (type instanceof Obj) {
      return !type.emitAsInterface;
    }
    return type instanceof Composed && type.schema.allOf != null;
  }

  // R10: the child type a field's mapping call goes to, or undefined for scalar/enum/etc.
  public static mappingCallChild(prop: Prop): IType | undefined {
    if (prop instanceof PropObj) return prop.obj;
    if (prop instanceof PropArray) return prop.items;
    if (prop instanceof PropComp) return prop.comp;
    return undefined;
  }

  // R10: whether the field's GraphQL type is an object/interface/union — those must not take the
  // bare @mapping form. e.g. (petstore) `Pet.category` is; `Pet.photoUrls` (`[String]`) is not.
  public static isObjectTypedProp(prop: Prop): boolean {
    let child = T.mappingCallChild(prop);
    while (child instanceof Arr) {
      child = child.itemsType;
    }
    return child instanceof Obj || child instanceof Composed || child instanceof Union;
  }

  // R10: mark the mapping calls that would make the @mapping graph loop; those spots render the
  // child inline. e.g. (r10-recursive) A -> B -> A: the B -> A call is marked. see R10_STATUS.md
  public static computeInlinedMappingEdges(
    types: Map<string, IType>,
    selection: string[],
    context: OasContext,
  ): void {
    const callsOf = new Map<string, Set<string>>();

    types.forEach((type) => {
      const name = T.mappingCallName(type, selection);
      if (!name || callsOf.has(name)) {
        return;
      }
      const calls = new Set<string>();
      for (const prop of (type as Obj | Composed).selectedProps(selection)) {
        const childName = T.mappingCallName(T.mappingCallChild(prop), selection);
        if (childName) {
          calls.add(childName);
        }
      }
      callsOf.set(name, calls);
    });

    const loopClosers = new Set<string>();
    const state = new Map<string, VisitState>();
    const stillToVisit = (typeName: string) => state.get(typeName) !== 'finished' && callsOf.has(typeName);

    const visit = (typeName: string): void => {
      state.set(typeName, 'visiting');
      for (const called of callsOf.get(typeName) ?? []) {
        if (state.get(called) === 'visiting') {
          loopClosers.add(`${typeName}|${called}`);
        } else if (stillToVisit(called)) {
          visit(called);
        }
      }
      state.set(typeName, 'finished');
    };

    for (const typeName of callsOf.keys()) {
      if (!state.has(typeName)) {
        visit(typeName);
      }
    }

    context.inlinedMappingEdges = loopClosers;
  }

  // R10: true when this field's mapping call is one of the marked loop-closers.
  public static isInlinedBackEdge(prop: Prop, callName: string, context: OasContext, selection: string[]): boolean {
    const owner = T.mappingCallName(T.findNonPropParent(prop.parent!), selection);
    return !!owner && context.inlinedMappingEdges.has(`${owner}|${callName}`);
  }

  // What the operation gives back, with the response wrapper removed. A list stays a list.
  // e.g. (petstore) get:/pet/findByStatus returns a list of pets:
  //   responses: { '200': { schema: { type: array, items: { $ref: '#/c/s/Pet' } } } }
  //   get:/pet/findByStatus
  //    └─ res:r
  //        └─ array:#/components/schemas/Pet        <- this is what comes back
  //            └─ obj:type:#/components/schemas/Pet
  // This is the shape of the whole answer. Callers that want one item use responseItemType.
  public static responseType(op: Op): IType | undefined {
    return T.unwrapRes(op.resultType);
  }

  // the node behind the response wrapper, or the node itself when there is no wrapper
  public static unwrapRes(node: IType | undefined): IType | undefined {
    return node instanceof Res ? node.response : node;
  }

  // One item of what the operation gives back, with any list wrappers taken off. A list of pages,
  // each of which is one of several kinds, answers "a page":
  //   get:/pages
  //    └─ res:r
  //        └─ array:#/components/schemas/AnyPage
  //            └─ union:#/components/schemas/AnyPage    <- this
  public static responseItemType(op: Op): IType | undefined {
    let node = T.responseType(op);
    while (node instanceof Arr) {
      node = node.itemsType;
    }
    return node;
  }

  // The part of the response a selection is written against. A list answers the shape of one item,
  // because the selection is written once and used for every item. e.g. (petstore) both give Pet:
  //   get:/pet/{petId}       -> { id, name, category, photoUrls, tags, status }
  //   get:/pet/findByStatus  -> { id, name, category, photoUrls, tags, status }
  public static responseItemSchema(op: Op): SchemaObject | undefined {
    const node = T.responseItemType(op);
    return node instanceof Obj || node instanceof Composed ? node.schema : undefined;
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

  // Qualify a colliding inline name with its container, bumping `2`, `3`… until free.
  // e.g. (googlebooks.yaml) `listPrice` under `offersItem` -> `OffersItemListPrice`. Both parts go
  // through genTypeName so the result is always a valid identifier. see docs/issues.md #9
  public static resolveNameConflict(node: IType, context: OasContext): void {
    const base = Naming.genTypeName(T.findNonPropParent(node.parent!).name) + Naming.genTypeName(node.name);
    // a made-up enum name must also stay off component names that are never visited — the
    // component cannot rename itself. e.g. (petstore.yaml) `Category` is taken in every op. #57
    const schemas = node instanceof En ? context.resolvePointer('#/components/schemas') : undefined;
    const reserved = new Set(Object.keys((schemas as Record<string, unknown>) ?? {}).map(Naming.genTypeName));
    let candidate = base;
    for (let n = 2; context.types.has(candidate) || reserved.has(candidate); n++) {
      if (context.types.has(candidate) && T.canConvergeOn(node, context.types.get(candidate), candidate)) {
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
