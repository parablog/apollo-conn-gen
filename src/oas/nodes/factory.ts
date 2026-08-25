import {
  Arr,
  Body,
  CircularRef,
  Composed,
  Delete,
  En,
  Get,
  IType,
  Map,
  Obj,
  Param,
  Patch,
  Post,
  Prop,
  PropArray,
  PropCircRef,
  PropComp,
  PropMap,
  PropObj,
  PropScalar,
  Put,
  ReferenceObject,
  RefCircRef,
  Res,
  Scalar,
  T,
  Union,
  PropEn,
} from './internal.js';
import { Operation } from 'oas/operation';
import { ParameterObject, SchemaObject } from 'oas/types';
import { OpenAPIV3 } from 'openapi-types';
import _ from 'lodash';
import { warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { GqlUtils } from '../utils/gql.js';
import { Naming } from '../utils/naming.js';
import { Schemas } from '../utils/schemas.js';
import { Nullability } from '../utils/nullability.js';
import ArraySchemaObject = OpenAPIV3.ArraySchemaObject;

export class Factory {
  public static createGet(name: string, op: Operation): Get {
    return new Get(name, op);
  }

  public static fromSchema(context: OasContext, parent: IType, inputSchema: SchemaObject | ReferenceObject): IType {
    let result: IType | null = null;
    let schema: SchemaObject | ReferenceObject | undefined = inputSchema;
    let ref: string | undefined;

    // resolve first if reference
    if ('$ref' in schema) {
      ref = schema?.$ref;
      if (ref) schema = context.lookupRef(ref) as SchemaObject;
      // a $ref that points nowhere is read as free-form JSON instead of stopping the run.
      //   e.g. (common-room) del:/user/{email} 200: { $ref: '#../' }  see docs/FIXED.md #99
      if (!schema) {
        const reason = `the reference '${ref}' doesn't point to anything in this API description — sent as raw JSON instead.`;
        warn(null, '[factory]', reason);
        return new Scalar(parent, 'JSON', Schemas.withJsonNote(inputSchema as SchemaObject, reason), reason);
      }
    }

    if (!schema) throw new Error('Unknown or undefined schema');
    const schemaObj: SchemaObject = schema as SchemaObject;
    // OAS 3.1 nullable syntax (`type: [string, 'null']`) would crash every plain-string `type` read below. #23
    Nullability.normalize(schemaObj);

    // Cycle cut (see docs/FIXED.md #10): a recursive schema can only close through a component `$ref`,
    // and `lookupRef` returns the same `SchemaObject` instance for a given ref. So if this resolved ref's
    // schema is already on the expansion path (an ancestor was built from it), re-entering would recurse
    // forever / emit a circular connector selection. Stop with a `RefCircRef` sentinel (commented in both
    // SDL and selection, traversal-terminating) instead of building + lazily expanding the recursion.
    const cyclic = ref ? this.cyclicAncestor(parent, schemaObj) : undefined;
    if (cyclic) {
      return this.fromRefCircRef(parent, cyclic, ref!);
    }

    // github's "maybe empty" anyOf (`anyOf: [member, {}]`): the fieldless member renders
    // nothing, so a single real member collapses to it. see docs/FIXED.md #20
    if (schemaObj.anyOf && !schemaObj.oneOf && !schemaObj.allOf) {
      const real = schemaObj.anyOf.filter((m) => !Schemas.isShapelessObject(m as SchemaObject));
      if (real.length === 1) {
        return this.fromSchema(context, parent, real[0] as SchemaObject | ReferenceObject);
      }
    }

    // implied array: `items` present even without an explicit `type: array`. see docs/FIXED.md #4
    if (_.get(schemaObj, 'items') && (schemaObj.type === 'array' || schemaObj.type == null)) {
      result = this.createArrayType(parent, schemaObj, context);
    }
    // an object with no fields of its own and an `items` beside it: the example next to slack's
    // spelling is one object, so the items schema is the real shape. see docs/FIXED.md #97
    //   e.g. (slack) reactions.get 200: { type: object, items: { anyOf: [ …three objects… ] } }
    else if (Schemas.isFieldlessObjectWithItems(schemaObj)) {
      warn(null, '[factory]', `object stamped on a list — reading its items in: ${parent.pathToRoot()}`);
      result = this.fromSchema(context, parent, _.get(schemaObj, 'items') as SchemaObject);
    }
    // array case
    else if (
      schemaObj?.type === 'object' ||
      schemaObj?.oneOf ||
      schemaObj?.allOf ||
      schemaObj?.anyOf ||
      Schemas.isMap(schemaObj) ||
      !_.isEmpty(schemaObj.properties)
    ) {
      result = this.createContainerType(parent, schemaObj, ref);
    }
    // a shapeless object (nothing but a boolean `additionalProperties`, or `{}`) declares no fields:
    // fall back to the JSON scalar — NOT an empty Obj, which generate() would skip, dangling the
    // reference. see docs/FIXED.md #19
    else if (Schemas.isShapelessObject(schemaObj)) {
      // e.g. a map value's `additionalProperties: { additionalProperties: false }` becomes JSON —
      // map.ts reads this reason back to note its own `value:` line. see docs/FIXED.md #155
      const reason = 'this object declares no properties of its own — sent as raw JSON instead.';
      result = new Scalar(parent, 'JSON', Schemas.withJsonNote(schemaObj, reason), reason);
    }
    // scalar
    else {
      result = this.createScalarType(schemaObj, parent, ref);
    }

    // we could not infer a proper type
    if (result == null) {
      throw new Error(`Not yet implemented for ${JSON.stringify(schemaObj)}`);
    }

    return result;
  }

  private static createScalarType(schema: SchemaObject | null, parent: IType, ref?: string) {
    const typeStr = schema?.type;
    if (typeStr != null) {
      if (typeStr === 'array') {
        throw new Error(`Should have been handled already? ${typeStr}, schema: ${JSON.stringify(schema)}`);
      } else if (schema?.enum != null) {
        // a bare (non-property) enum keeps its component name, same as Obj/Union/Composed above —
        // otherwise every such enum collides on the generic name 'enum'. see docs/FIXED.md #120
        return new En(parent, ref ?? 'enum', schema, schema.enum! as string[]);
      }
      // scalar case — gqlScalar knows `date`/`date-time` mean String, like fromProp's branch below
      const scalarType = GqlUtils.gqlScalar(typeStr as string);
      if (scalarType) {
        return new Scalar(parent, scalarType, schema!);
      }
      // a type that is no JSON Schema type is read as free-form JSON instead of stopping the run.
      //   e.g. (common-room) value: { oneOf: [{ type: url }, { type: date }] }  see docs/FIXED.md #98
      warn(null, '[factory]', `unknown scalar type '${typeStr}' becomes JSON in: ${parent.pathToRoot()}`);
      // when this is a whole response body (e.g. a get's 200 is `{ type: 'url' }` directly), the
      // reason above now also reaches the op's own docstring, not just the build log. see docs/FIXED.md #155
      const reason = `this schema's type '${typeStr}' has no GraphQL scalar equivalent — sent as raw JSON instead.`;
      return new Scalar(parent, 'JSON', Schemas.withJsonNote(schema!, reason), reason);
    } else if (schema?.enum != null) {
      return new En(parent, ref ?? 'enum', schema, _.get(schema, 'enum') as string[]);
    }
    // or we have no idea how to handle this
    else {
      throw new Error(`Cannot handle schema ${parent.pathToRoot()}, schema: ${JSON.stringify(schema)}`);
    }
  }

  private static createContainerType(parent: IType, schema: SchemaObject, ref?: string) {
    let result: IType | null;

    // composed object
    if (schema.allOf) {
      result = new Composed(parent, ref || _.get(schema, 'name'), schema);
    }
    // union
    else if (schema.oneOf || schema.anyOf) {
      // an `anyOf` lists members just like a `oneOf` — read them too, or the union is built with
      // none and writes an empty block (digitalocean's create-record body). see docs/FIXED.md #50
      //   schema: { anyOf: [ { allOf: [ … ] }, { … } ] }
      const members = schema.oneOf || schema.anyOf || [];
      // re-entering the same member set on this path is the union form of a cycle — without this
      // cut a mutually-recursive clique expands once per member ordering and never returns. #118
      const cyclicUnion = this.cyclicUnionAncestor(parent, members as SchemaObject[]);
      if (cyclicUnion) {
        return this.fromRefCircRef(parent, cyclicUnion, ref ?? cyclicUnion.name);
      }
      result = new Union(
        parent,
        ref || _.get(schema, 'name'),
        members as SchemaObject[],
        false,
        _.get(schema, 'discriminator'),
      );
    }
    // map (object with only additionalProperties)
    else if (Schemas.isMap(schema)) {
      result = new Map(parent, ref || _.get(schema, 'name') || null, schema);
    }
    // or a plain obj
    else {
      if (!schema.properties) {
        warn(
          null,
          '[factory]',
          'Object has no properties: ' + JSON.stringify(schema, null, 2) + ' in: ' + parent.pathToRoot(),
        );
      }

      result = new Obj(parent, ref || _.get(schema, 'name') || null, schema);
    }

    return result;
  }

  // What a list holds. An object with no fields becomes JSON — an empty type would take the whole
  // field with it. e.g. archivedChannels: { type: array, items: { type: object } } -> [JSON]. #56
  public static fromArrayItems(context: OasContext, parent: IType, items: SchemaObject | ReferenceObject): IType {
    // a $ref'd shapeless object is still shapeless — resolve before checking, same idiom as get.ts.
    // e.g. (pagerduty) items: { $ref: IncidentReference }, IncidentReference: { additionalProperties: true }  #110
    // resolvePointer, not lookupRef: a sniff that may discard the ref must not bump refCount.
    const resolved = '$ref' in items ? (context.resolvePointer(items.$ref!) as SchemaObject) : items;
    if (resolved && Schemas.isShapelessObject(resolved)) {
      warn(context, '[factory]', `items in array have types that declare no fields - returning JSON type`);
      return new Scalar(parent, 'JSON', resolved);
    }
    // a list holding one of several plain values is JSON too — a union of scalars has no fields to
    // select, so the whole field used to disappear. e.g. (confluence) post:/content/convert-ids-to-types
    //   contentIds: { type: array, items: { anyOf: [string, number] } }  ->  [JSON]      #86
    if (!('$ref' in items) && Schemas.holdsPlainValues(context, items)) {
      warn(context, '[factory]', `items in array have mixed array types - returning JSON type`);
      return new Scalar(parent, 'JSON', items);
    }
    // a mixed choice (plain value + real object) merges away the plain branch's fields if left to
    // Union — e.g. (stripe) owners: { items: { anyOf: [string, $ref Owner] } } -> [JSON]      #131
    if (!('$ref' in items) && Schemas.holdsMixedPlainAndObjectValues(context, items)) {
      warn(context, '[factory]', `items in array have both plain and object values - returning JSON type`);
      return new Scalar(parent, 'JSON', items);
    }
    return Factory.fromSchema(context, parent, items);
  }

  private static createArrayType(parent: IType | Res, schema: SchemaObject | null, context: OasContext) {
    // Array schema case.
    let parentName = parent.name;
    if (parent instanceof Res || parent instanceof Body) {
      // Name an inline array the same way its op names any other inline payload — e.g. operation
      // createUploads sending `{ type: array, items: { type: object, ... } }` names the item
      // CreateUploads, not the placeholder body name "b". #157
      const op = parent.parent as Get; // Assume parent.parent is a GetOp.
      parentName = _.upperFirst(op.getGqlOpName());
    } else if (parent instanceof Union && T.isRef(parentName)) {
      // an Arr is a wrapper, not a component of its own — carrying the raw $ref would alias it with
      // the parent in name-keyed maps (context.refCount, context.types). #95
      parentName = Naming.getRefName(parentName);
    }

    const arr = new Arr(parent, parentName);
    const items = Factory.unwrapRedundantArrayItems(context, _.get(schema, 'items') as ArraySchemaObject);
    arr.items = items as ArraySchemaObject;

    // TODO: check this
    arr.itemsType = Factory.fromArrayItems(context, arr, items);
    arr.add(arr.itemsType); // add it to the children

    return arr;
  }

  // An array's items sometimes hold another array instead of the real element — a property's items
  // must always be the element itself, so take the inner one. Two ways a spec writes it:
  //
  // through a `$ref` to a component that is itself a list (docker-engine). see docs/FIXED.md #46
  //   Containers:       { type: array, items: { $ref: '#/…/ContainerSummary' } }
  //   ContainerSummary: { type: array, items: { …the real object… } }
  //
  // inline, as a wrapper holding nothing but `items` (slack). see docs/FIXED.md #52
  //   messages: { type: array, items: { items: { anyOf: [ … ] } } }
  //
  // Inline needs the stricter test: an explicit `type: array` there is a real list of lists (docker
  // `top` rows, metric [time, value] pairs) and must stay nested, so only a `type`-less wrapper with
  // no fields of its own unwraps. A named component is treated as the "list of X" artifact it is.
  private static unwrapRedundantArrayItems(
    context: OasContext,
    items: SchemaObject | ReferenceObject,
  ): SchemaObject | ReferenceObject {
    if (!items) {
      return items;
    }

    if (!('$ref' in items)) {
      const wrapped = _.get(items, 'items') as SchemaObject | undefined;
      const isWrapper = wrapped != null && items.type == null && _.isEmpty(items.properties);
      return isWrapper ? wrapped : items;
    }

    const resolved = context.lookupRef(items.$ref as string);
    const resolvedItems = resolved && (_.get(resolved, 'items') as ArraySchemaObject | undefined);
    if (resolvedItems && (resolved!.type === 'array' || resolved!.type == null)) {
      return resolvedItems;
    }
    return items;
  }

  public static fromProp(
    context: OasContext,
    parent: IType,
    propName: string,
    inputSchema: SchemaObject | ReferenceObject,
  ): Prop {
    if (!inputSchema) {
      throw new Error(`Should have a schema defined for property '${propName}' (parent: '${parent.name}')`);
    }

    let schema: SchemaObject | ReferenceObject | null = inputSchema;

    let prop: Prop;
    let ref: string | undefined;

    if (!_.get(schema, 'type') && '$ref' in schema) {
      ref = (schema as ReferenceObject).$ref;
      schema = context.lookupRef(ref);
      // this was a prop ref, but now needs to be returned as the ref directly?
      // prop = new PropRef(parent, propName, schema, ref);
      // return prop;
    }

    // uses the type of the schema to find out what kind of property it is
    let schemaObj = schema as SchemaObject;
    // OAS 3.1 nullable syntax (`type: [string, 'null']`) would crash every plain-string `type` read below. #23
    Nullability.normalize(schemaObj);

    // An `allOf` that only decorates one non-object schema IS that schema — merging it as an
    // object gives zero fields and the field vanishes. e.g. (digitalocean) tags:
    //   { allOf: [ $ref -> { type: array, items: {type: string} }, { description: … } ] } -> [String]  #67
    // the same #97 shape one level down dropped the field entirely on this route. see #114
    if (Schemas.isFieldlessObjectWithItems(schemaObj)) {
      warn(null, '[factory]', `object stamped on a list — reading its items in: ${parent.pathToRoot()}`);
      return this.fromProp(context, parent, propName, _.get(schemaObj, 'items') as SchemaObject);
    }

    const allOfSchema = this.findAllOfSchema(context, schemaObj);
    if (allOfSchema) {
      schemaObj = allOfSchema;
      schema = allOfSchema;
    }

    const type = schemaObj.type;

    if (type) {
      // 1st case is if the type is an array
      if (type === 'array') {
        const array = new PropArray(parent, propName, schema!);
        // const itemsName = Naming.genArrayItems(propName);

        const itemsSchema = Factory.unwrapRedundantArrayItems(context, _.get(schemaObj, 'items') as ArraySchemaObject);
        // const itemsType = Factory.fromProp(context, array, itemsName, itemsSchema); // TODO: re-test
        const itemsType = Factory.fromArrayItems(context, array, itemsSchema);

        array.setItems(itemsType);
        prop = array;

        // Array items resolve eagerly here, so if the item ref re-entered a schema on the path
        // (fromSchema returned the circular sentinel), bubble the cut up to the whole list field:
        // render `# children: [Node] — circular reference omitted`. see docs/FIXED.md #10
        if (itemsType instanceof CircularRef) {
          return new PropCircRef(parent, array);
        }
      }
      // 2nd checks for obj property
      else if (
        schemaObj?.type === 'object' ||
        schemaObj?.oneOf ||
        schemaObj?.allOf ||
        !_.isEmpty(schemaObj.properties)
      ) {
        if (schemaObj.oneOf) {
          if (Schemas.holdsPlainValues(context, schemaObj)) {
            // a oneOf of only plain scalars/enums has no object member a union can hold — same
            // empty-type family as #108 (map)/#110 (array item), just at a plain property. #134
            const reason =
              'a oneOf of only plain scalar/enum values has no GraphQL union member to build — sent as raw JSON instead.';
            warn(context, '[factory]', reason);
            prop = new PropScalar(parent, propName, 'JSON', Schemas.withJsonNote(schemaObj, reason));
          } else {
            const inner: PropComp = new PropComp(parent, propName, schemaObj);
            inner.comp = new Union(
              inner,
              ref || _.get(schemaObj, 'name'),
              schemaObj.oneOf as SchemaObject[],
              false,
              _.get(schemaObj, 'discriminator'),
            );
            prop = inner;
          }
        } else if (schemaObj.allOf) {
          const propComp: PropComp = new PropComp(parent, propName, schemaObj);
          propComp.comp = new Composed(propComp, ref || _.get(schemaObj, 'name'), schemaObj);
          prop = propComp;
        } else if (Schemas.isMap(schemaObj)) {
          if (T.isParentAnInput(parent)) {
            // GraphQL input types can't take arbitrary keys, so a map in input position has no
            // typed shape to write — send it as JSON instead. #133
            const reason =
              "a map (object with arbitrary keys) can't be an input type in GraphQL — sent as raw JSON instead of a typed structure.";
            warn(context, '[factory]', reason);
            prop = new PropScalar(parent, propName, 'JSON', Schemas.withJsonNote(schemaObj, reason));
          } else {
            // Map property: object with only additionalProperties
            const mapType: Map = new Map(parent, ref || propName, schemaObj);
            prop = new PropMap(parent, propName, schemaObj, mapType);
          }
        } else if (schemaObj.properties != null) {
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        } else {
          // the type of the property will be an object, which needs to be added as a child
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        }
      } else if (schemaObj?.enum) {
        if (GqlUtils.isGqlEnum(schemaObj)) {
          // an inline enum starts under its field's name; En.visit gives it the owning type's name
          // in front: (petstore.yaml) Order's `status` -> OrderStatus. see docs/FIXED.md #57
          const en: En = new En(
            parent,
            ref ?? propName,
            schemaObj,
            (schemaObj.enum as string[]).map((v) => v.trim()),
          );
          prop = new PropEn(parent, propName, en, schemaObj);
          prop.add(en);
        } else {
          // No GraphQL enum form for this one — degrade to the base scalar instead of emitting
          // an invalid definition: boolean/number enums (slack `ok: { enum: [true] }` ->
          // `ok: Boolean`) and string enums with non-identifier values (github reactions
          // `enum: ["+1", "-1", …]` -> String). see docs/FIXED.md #24
          prop = new PropScalar(parent, propName, GqlUtils.getGQLScalarType(schemaObj), schemaObj);
        }
      }
      // 3rd tries for scalar
      else if (GqlUtils.gqlScalar(type as string)) {
        let scalar = GqlUtils.gqlScalar(type as string) as string;
        // A property named "id"/"*Id"/"*ID" reads as GraphQL's ID scalar regardless of the spec's
        // declared type, e.g. `id: { type: integer, format: uuid }` -> ID, not Int. #142/#146
        const looksLikeId = propName === 'id' || propName.endsWith('Id') || propName.endsWith('ID');
        if (looksLikeId) {
          scalar = 'ID';
        }
        prop = new PropScalar(parent, propName, scalar, schemaObj);
      }
      // or we don't know how to handle this
      else {
        throw new Error('Cannot handle property type ' + type);
      }
    }
    // otherwise let's use the properties instead and assume an Obj
    // TODO: repeated code
    else if (schemaObj.oneOf) {
      if (Schemas.holdsPlainValues(context, schemaObj)) {
        // same guard as the typed branch above, reached here because this schema has no `type` key. #134
        const reason =
          'a oneOf of only plain scalar/enum values has no GraphQL union member to build — sent as raw JSON instead.';
        warn(context, '[factory]', reason);
        prop = new PropScalar(parent, propName, 'JSON', Schemas.withJsonNote(schemaObj, reason));
      } else {
        const inner: PropComp = new PropComp(parent, propName, schemaObj);
        inner.comp = new Union(inner, ref || _.get(schemaObj, 'name'), schemaObj.oneOf as SchemaObject[]);
        prop = inner;
      }
    } else if (schemaObj.allOf) {
      const propComp: PropComp = new PropComp(parent, propName, schemaObj);
      propComp.comp = new Composed(propComp, ref || _.get(schemaObj, 'name'), schemaObj);
      prop = propComp;
    } else if (Schemas.isMap(schemaObj)) {
      if (T.isParentAnInput(parent)) {
        // same as the typed branch above, reached here because this schema has no `type` key. #133
        const reason =
          "a map (object with arbitrary keys) can't be an input type in GraphQL — sent as raw JSON instead of a typed structure.";
        warn(context, '[factory]', reason);
        prop = new PropScalar(parent, propName, 'JSON', Schemas.withJsonNote(schemaObj, reason));
      } else {
        // Map property: object with only additionalProperties (no explicit type)
        const mapType: Map = new Map(parent, ref || propName, schemaObj);
        prop = new PropMap(parent, propName, schemaObj, mapType);
      }
    } else if (schemaObj.properties != null) {
      const propType: IType = new Obj(parent, ref || propName, schemaObj);
      prop = new PropObj(parent, propName, schemaObj, propType);
    }
    // default case: no type, no oneOf/allOf, not a map, no properties — an unrecognised shape. #133
    else {
      const reason =
        "this field's shape didn't match any known pattern and defaulted to JSON — worth checking the source OAS schema.";
      warn(context, '[factory]', reason);
      prop = new PropScalar(parent, propName, 'JSON', Schemas.withJsonNote(schemaObj, reason));
    }

    // Cut only a real loop: a field pointing back to a type we already passed through. Compare the schema,
    // not the field name — different types reuse field names (e.g. Adobe `extension_attributes`). docs/FIXED.md #36
    const unionMembers = (schemaObj.oneOf ?? schemaObj.anyOf) as SchemaObject[] | undefined;

    // the union-set form of the same loop: PropComp builds its Union without createContainerType. #118
    const cyclic =
      this.cyclicAncestor(parent, schemaObj) ??
      (unionMembers ? this.cyclicUnionAncestor(parent, unionMembers) : undefined);
    if (cyclic) {
      prop = new PropCircRef(parent, prop);
    }

    return prop;
  }

  // Discards all the empty schemas from an allOf and finds the real target schema. Resolves the ref if needed.
  // e.g. (allof-array-body.yaml) tags: { allOf: [ $ref -> array of string, { description: … } ] }  #67
  private static findAllOfSchema(context: OasContext, schema: SchemaObject): SchemaObject | undefined {
    if (!schema.allOf) {
      return undefined;
    }

    const targets = schema.allOf.filter((member) => !Schemas.isEmpty(member as SchemaObject));
    if (targets.length !== 1) {
      return undefined;
    }

    const target = targets[0] as SchemaObject | ReferenceObject;
    const resolved =
      '$ref' in target
        ? (context.resolvePointer(target.$ref as string) as SchemaObject | null)
        : (target as SchemaObject);

    if (!resolved) {
      return undefined;
    }

    const objectLike =
      resolved.type === 'object' || resolved.properties || resolved.allOf || resolved.oneOf || resolved.anyOf;

    return objectLike ? undefined : resolved;
  }

  /**
   * The nearest ancestor built from the same resolved component `$ref` (compared by `SchemaObject`
   * identity — `lookupRef` returns the same instance per ref), or undefined. Scoped to the current
   * expansion path (`ancestors()`), so a shared non-recursive component used by sibling fields is NOT
   * cut — only a schema that is its own ancestor. `schema` is undefined for inline (non-`$ref`) nodes,
   * which can never match an ancestor. see docs/FIXED.md #10
   */
  private static cyclicAncestor(parent: IType, schema?: SchemaObject): IType | undefined {
    if (!schema) return undefined;
    return parent.ancestors().find((a) => a.schema === schema);
  }

  // A union's cycle identity: its sorted member-$ref set. Undefined when any non-null member is
  // inline or <2 are $refs — keeps e.g. (stripe) `anyOf: [string, $ref]` out of the cut. see docs/FIXED.md #118
  private static unionRefSignature(members: (SchemaObject | ReferenceObject)[]): string | undefined {
    const real = members.filter((m) => m && (m as SchemaObject).type !== 'null');
    const refs = real
      .filter((m) => (m as ReferenceObject).$ref != null)
      .map((m) => (m as ReferenceObject).$ref as string);
    if (refs.length < 2 || refs.length !== real.length) return undefined;
    return refs.slice().sort().join('|');
  }

  // Union analog of cyclicAncestor (#10): mutual recursion through a oneOf clique closes through
  // the member LIST, which a Union carries as raw $refs, never as one `.schema`. see docs/FIXED.md #118
  //   e.g. (hubspot lists) OrBranch.orBranches items: oneOf [OrBranch, AndBranch, …] — the same
  //   7-way member set re-entered under every branch, never the same single schema.
  private static cyclicUnionAncestor(parent: IType, members: (SchemaObject | ReferenceObject)[]): Union | undefined {
    const signature = this.unionRefSignature(members);
    if (!signature) return undefined;
    return parent.ancestors().find((a) => a instanceof Union && this.unionRefSignature(a.schemas) === signature) as
      | Union
      | undefined;
  }

  /** Build the `fromSchema` circular sentinel (commented in both SDL + selection). see docs/FIXED.md #10 */
  public static fromRefCircRef(parent: IType, ancestor: IType, ref: string): IType {
    const node = new RefCircRef(parent, Naming.getRefName(ref) ?? ancestor.name);
    node.ref = ancestor;
    return node;
  }

  public static fromResponse(_context: OasContext, parent: IType, mediaSchema: SchemaObject): IType {
    return new Res(parent, 'r', mediaSchema);
  }

  public static fromParam(context: OasContext, parent: IType, p: ParameterObject | ReferenceObject): Param {
    let param: ParameterObject;

    if ('$ref' in p) {
      const ref: ReferenceObject = p as ReferenceObject;
      const schema = context.lookupParam(ref.$ref);

      if (!schema) {
        throw new Error('Schema not found for ref: ' + ref.$ref);
      }
      param = schema as ParameterObject;
    } else {
      param = p as ParameterObject;
    }

    // Takes the schema from `content` when a parameter has no `schema:` — without this the run
    // crashed. e.g. (param-via-content.yaml) filter: { content: { application/json: { schema: $ref Filter } } }  #75
    const media = param.content ? Object.values(param.content)[0] : undefined;
    const schema = (param.schema ?? media?.schema) as SchemaObject;
    const required = param.required === true;

    return new Param(parent, param.name, schema, required, schema?.default, param);
  }

  public static fromCircularRef(parent: IType, child: IType): IType {
    const _tree = T.print(parent);

    const circularRef = new CircularRef(parent, child.name);
    circularRef.ref = child;
    return circularRef;
  }

  public static fromUnion(_context: OasContext, parent: IType, oneOfs: SchemaObject[]): IType {
    const union = new Union(parent, parent.name, oneOfs);
    parent.add(union);
    return union;
  }

  public static fromPost(name: string, op: Operation): Post {
    return new Post(name, op);
  }

  public static fromPut(name: string, op: Operation): Post {
    return new Put(name, op);
  }

  public static fromPatch(name: string, op: Operation): Post {
    return new Patch(name, op);
  }

  public static fromDelete(name: string, op: Operation): Post {
    return new Delete(name, op);
  }

  public static fromBody(_context: OasContext, parent: IType, schema: SchemaObject, mediaType: string): IType {
    const body = new Body(parent, 'b', schema, mediaType);
    parent.add(body);
    return body;
  }
}
