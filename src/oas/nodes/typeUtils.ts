import {
  Arr,
  Body,
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
  PropCircRef,
  PropEn,
  PropMap,
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
      T.isComposedEmpty(type) ||
      T.isScalarArray(type)
    );
  }
  // True when every field of the type was removed (to break a loop, #10, or on every route, #89):
  // the written body would hold only comments, which GraphQL refuses to parse. see docs/FIXED.md #101
  //   e.g. (confluence) Contributors: { properties: { publishers: { $ref: UsersUserKeys } } }
  //        -> publishers loops back and is removed on every route; no field is left
  public static everyFieldRemoved(type: IType, context: OasContext): boolean {
    if (!(type instanceof Obj) || type.props.size === 0) {
      return false;
    }
    const overrides = context.propOverrides.get(type.id);
    return Array.from(type.props.values()).every((prop) => (overrides?.get(prop.name) ?? prop) instanceof PropCircRef);
  }

  // Traverses a Composed to check for props. Useful when consolidate has not been invoked.
  // e.g. (map-empty-composed-value.yaml) mergedPorts: { additionalProperties: allOf two empty objects }  #77
  public static isComposedEmpty(type: IType): boolean {
    if (!(type instanceof Composed)) {
      return false;
    }

    let empty = true;
    T.traverse(type, (node) => {
      if (node !== type && !(node instanceof Prop) && !_.isEmpty(node.props)) {
        empty = false;
      }
    });
    return empty;
  }

  // A map value the selection reads whole (scalar, enum, or empty object degraded to JSON).
  // A cycle-cut ref is not one — its SDL type is a composite that would need a sub-selection.
  // e.g. (ccs) alternatives: { additionalProperties: $ref Amount } inside Amount itself  #76
  public static isWholeMapValue(value: IType): boolean {
    return T.isLeaf(value) && !T.isCircular(value);
  }

  public static isCircular(type: IType): boolean {
    return type instanceof CircularRef;
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

  // True for anything under a request body — `input` is set on the body and inherited from there.
  //   e.g. (docker-engine) post:/containers/create > body:b > comp:input:Input -> true    #84
  public static isParentAnInput(parent: IType): boolean {
    return parent.kind === 'input';
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

  // What is at the bottom of a list, however many lists deep it goes.
  //   e.g. (box) name_conflicts is a list of lists of objects -> the object          #59
  public static findLastArrayItemIn(node?: IType): IType | undefined {
    let inner = node;
    while (inner instanceof Arr) {
      inner = inner.itemsType;
    }
    return inner;
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
    return T.findLastArrayItemIn(T.responseType(op));
  }

  // What the parent contains, when it contains exactly one thing — a list has one item type, a
  // field has one value, a response has one body. e.g. (digitalocean.yaml)
  //   prop:array:#deployments      prop:obj:#spec      res:r / body:b
  //    └─ items                     └─ obj              └─ children[0], when it is the only child
  // A parent with several things inside (an object's fields, a choice's options) gives nothing.
  public static innerChild(parent: IType | undefined): IType | undefined {
    if (parent instanceof PropObj) return parent.obj;
    if (parent instanceof PropArray) return parent.items;
    if (parent instanceof PropComp) return parent.comp;
    if (parent instanceof PropMap) return parent.map;
    if (parent instanceof Arr) return parent.itemsType;
    if (parent instanceof Res || parent instanceof Body) {
      return parent.children.length === 1 ? parent.children[0] : undefined;
    }
    return undefined;
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

  // e.g. (confluence) inline `group` writes `GroupInput`, same as component `Group`. #100
  public static collidesWithReservedComponentName(node: IType, context: OasContext): boolean {
    if (!(node instanceof Obj) || T.isExemptFromRename(node)) {
      return false;
    }
    const emitted = Naming.genTypeName(node.name);
    if (!T.reservedComponentNames(context).has(emitted)) return false;
    // a scalar component writes no type — no collision. e.g. (inline-wrapper-vs-component) `Status`
    const schemas = (context.resolvePointer('#/components/schemas') as Record<string, SchemaObject>) ?? {};
    const component = Object.entries(schemas).find(([name]) => Naming.genTypeName(name) === emitted);
    return component != null && T.emitsTypeDefinition(component[1]);
  }

  // ponytail: rebuilds on every call; cache if profiling shows it matters
  // e.g. (confluence) component schemas `Group`, `GroupCreate` -> reserved `Group`, `GroupCreate`
  private static reservedComponentNames(context: OasContext): Set<string> {
    const schemas = context.resolvePointer('#/components/schemas');
    return new Set(Object.keys((schemas as Record<string, unknown>) ?? {}).map(Naming.genTypeName));
  }

  // e.g. (inline-wrapper-vs-component) `Status: { type: string }` -> false, `Group: { properties }` -> true
  private static emitsTypeDefinition(schema: SchemaObject | ReferenceObject): boolean {
    if ('$ref' in schema) return true;
    const raw = schema as SchemaObject;
    const hasStructure = raw.type === 'object' || raw.properties || raw.allOf || raw.oneOf || raw.anyOf;
    const hasMapShape = raw.additionalProperties && typeof raw.additionalProperties === 'object';
    return !!(hasStructure || raw.enum || hasMapShape);
  }

  // Siblings whose names clean to one field are never dropped: each keeps its own wire key, and
  // later twins take numbered names both the type and the mapping write. see docs/FIXED.md #69 #113
  //   e.g. (trello) boards: prefs/background + prefs_background -> prefsBackground, prefsBackground2
  public static numberTwinFields(props: Prop[]): Prop[] {
    const taken = new Map<string, Prop>();
    const kept: Prop[] = [];
    for (const prop of props) {
      // a name allocated on an earlier pass stays put — reallocating in another prop order could
      // flip which twin holds the base name between generate and select. #113
      if (prop.renamedTo) {
        taken.set(prop.renamedTo, prop);
        kept.push(prop);
        continue;
      }
      const field = Naming.sanitiseField(prop.name);
      if (!taken.has(field)) {
        taken.set(field, prop);
        kept.push(prop);
        continue;
      }
      const numbered = Naming.numberedName(field, (n) => taken.has(n));
      prop.renamedTo = numbered;
      taken.set(numbered, prop);
      kept.push(prop);
    }
    return kept;
  }

  // Qualify a colliding inline name with its container, bumping `2`, `3`… until free.
  // e.g. (googlebooks.yaml) `listPrice` under `offersItem` -> `OffersItemListPrice`. Both parts go
  // through genTypeName so the result is always a valid identifier. see docs/FIXED.md #9
  public static resolveNameConflict(node: IType, context: OasContext): void {
    const base = Naming.genTypeName(T.findNonPropParent(node.parent!).name) + Naming.genTypeName(node.name);
    const reserved = T.reservedComponentNames(context);
    const taken = (name: string) =>
      (context.types.has(name) || reserved.has(name)) && !T.canConvergeOn(node, context.types.get(name), name);
    node.name = taken(base) ? Naming.numberedName(base, taken) : base;
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

  // the name's occupant sits on the other side of the wire — both keep the name, the kind's
  // nameSuffix splits the emitted forms. see #78, #48
  // e.g. (quickbooks) the same Line oneOf is the POST body and comes back in the response:
  //   requestBody -> union:input:Line -> input LineUnionInput { … }
  //   response    -> union:type:Line  -> type LineUnion { … }
  public static ownedByOtherSide(node: IType, context: OasContext): boolean {
    const occupant = T.storedOccupant(node, context);
    return occupant != null && occupant.kind !== node.kind;
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
    // a union carries no single raw schema — its member list and tag are its shape. see #73
    // e.g. (stripe) ten ops reach subscription_item.discounts: one anyOf, ten identical twins
    if (node instanceof Union && occupant instanceof Union) {
      return _.isEqual(node.schemas, occupant.schemas) && node.discriminator === occupant.discriminator;
    }
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
