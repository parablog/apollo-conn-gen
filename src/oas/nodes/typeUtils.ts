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
  PropEn,
  PropScalar,
  ReferenceObject,
  Res,
  Scalar,
} from './internal.js';
import _ from 'lodash';
import { Naming } from '../utils/naming.js';
import type { OasContext } from '../oasContext.js';
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

  // What the operation gives back, with the response wrapper removed. A list stays a list.
  // e.g. (petstore) get:/pet/findByStatus returns a list of pets:
  //   responses: { '200': { schema: { type: array, items: { $ref: '#/c/s/Pet' } } } }
  //   get:/pet/findByStatus
  //    └─ res:r
  //        └─ array:#/components/schemas/Pet        <- this is what comes back
  //            └─ obj:type:#/components/schemas/Pet
  // This is the shape of the whole answer. Callers that want one item use responseItemType.
  public static responseType(op: Op): IType | undefined {
    const node: IType | undefined = op.resultType;
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
