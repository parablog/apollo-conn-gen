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
      // result = new Ref(parent, schema.$ref as string, schema as ReferenceObject);
      ref = schema?.$ref;
      if (ref) schema = context.lookupRef(ref) as SchemaObject;
    }

    if (!schema) throw new Error('Unknown or undefined schema');
    const schemaObj: SchemaObject = schema as SchemaObject;
    // OAS 3.1 nullable syntax (`type: [string, 'null']`) would crash every plain-string `type` read below. #23
    this.normalizeTypeArray(schemaObj);

    // Cycle cut (see docs/issues.md #10): a recursive schema can only close through a component `$ref`,
    // and `lookupRef` returns the same `SchemaObject` instance for a given ref. So if this resolved ref's
    // schema is already on the expansion path (an ancestor was built from it), re-entering would recurse
    // forever / emit a circular connector selection. Stop with a `RefCircRef` sentinel (commented in both
    // SDL and selection, traversal-terminating) instead of building + lazily expanding the recursion.
    const cyclic = ref ? this.cyclicAncestor(parent, schemaObj) : undefined;
    if (cyclic) {
      return this.fromRefCircRef(parent, cyclic, ref!);
    }

    // github's "maybe empty" anyOf (`anyOf: [member, {}]`): the fieldless member renders
    // nothing, so a single real member collapses to it. see docs/issues.md #20
    if (schemaObj.anyOf && !schemaObj.oneOf && !schemaObj.allOf) {
      const real = schemaObj.anyOf.filter((m) => !this.isShapelessObject(m as SchemaObject));
      if (real.length === 1) {
        return this.fromSchema(context, parent, real[0] as SchemaObject | ReferenceObject);
      }
    }

    // implied array: `items` present even without an explicit `type: array`. see docs/issues.md #4
    if (_.get(schemaObj, 'items') && (schemaObj.type === 'array' || schemaObj.type == null)) {
      result = this.createArrayType(parent, schemaObj, context);
    }
    // array case
    else if (
      schemaObj?.type === 'object' ||
      schemaObj?.oneOf ||
      schemaObj?.allOf ||
      schemaObj?.anyOf ||
      !_.isEmpty(schemaObj.properties)
    ) {
      result = this.createContainerType(parent, schemaObj, ref);
    }
    // a shapeless object (nothing but a boolean `additionalProperties`, or `{}`) declares no fields:
    // fall back to the JSON scalar — NOT an empty Obj, which generate() would skip, dangling the
    // reference. see docs/issues.md #19
    else if (this.isShapelessObject(schemaObj)) {
      result = new Scalar(parent, 'JSON', schemaObj);
    }
    // scalar
    else {
      result = this.createScalarType(schemaObj, parent);
    }

    // we could not infer a proper type
    if (result == null) {
      throw new Error(`Not yet implemented for ${JSON.stringify(schemaObj)}`);
    }

    return result;
  }

  /**
   * OAS 3.1 type arrays (`type: ["string","null"]`) collapse to their first non-null entry:
   * GraphQL fields are nullable by default, so the "null" disjunct adds nothing. Normalized
   * in place (idempotent; `lookupRef` shares schema instances, so every reader sees it).
   * see docs/issues.md #23
   */
  private static normalizeTypeArray(schema: SchemaObject): void {
    const s = schema as Record<string, unknown>;
    if (Array.isArray(s.type)) {
      const real = (s.type as unknown[]).filter((t) => t && t !== 'null');
      s.type = real[0];
    }
  }

  // every member is a legal GraphQL enum value once trimmed (TMF637 ships `'aborted '`): a bare
  // identifier that isn't a boolean/null literal. Anything else (numbers, "+1", "fast-forward",
  // true) has no enum form. see #24
  private static isGqlEnum(schema: SchemaObject): boolean {
    const VALID_ENUM_VALUE = /^[_A-Za-z][_0-9A-Za-z]*$/;
    const RESERVED = new Set(['true', 'false', 'null']);
    return _.every(schema.enum, (value) => {
      if (typeof value !== 'string') return false;
      const trimmed = value.trim();
      return VALID_ENUM_VALUE.test(trimmed) && !RESERVED.has(trimmed);
    });
  }

  // Keywords that give a schema a renderable GraphQL shape; a schema with none is metadata-only. #5
  private static readonly SHAPE_KEYWORDS = [
    '$ref',
    'type',
    'enum',
    'items',
    'allOf',
    'oneOf',
    'anyOf',
    'additionalProperties',
  ];

  /** True when a schema carries no renderable content (metadata only). see docs/issues.md #5 */
  public static isEmptySchema(schema: SchemaObject | ReferenceObject): boolean {
    const s = schema as Record<string, unknown>;
    return Factory.SHAPE_KEYWORDS.every((k) => s[k] == null) && _.isEmpty(s.properties);
  }

  /**
   * True for an object with no declared fields: no shape keyword except (at most) an explicit
   * object `type` and a boolean `additionalProperties` (`{}`, `{ additionalProperties: false }`,
   * `{ type: object, properties: {} }` — googlebooks `Empty`). A real map
   * (`additionalProperties: <schema>`) is NOT shapeless. see docs/issues.md #19, #31
   */
  public static isShapelessObject(schema: SchemaObject): boolean {
    const s = schema as Record<string, unknown>;
    const noShape = ['$ref', 'enum', 'items', 'allOf', 'oneOf', 'anyOf'].every((k) => s[k] == null);
    const objectOrUntyped = s.type == null || s.type === 'object';
    return noShape && objectOrUntyped && _.isEmpty(s.properties) && typeof s.additionalProperties !== 'object';
  }

  private static createScalarType(schema: SchemaObject | null, parent: IType) {
    const typeStr = schema?.type;
    if (typeStr != null) {
      if (typeStr === 'array') {
        throw new Error(`Should have been handled already? ${typeStr}, schema: ${JSON.stringify(schema)}`);
      } else if (schema?.enum != null) {
        return new En(parent, 'enum', schema, schema.enum! as string[]);
      }
      // scalar case
      else if (GqlUtils.gqlScalar(typeStr as string)) {
        const scalarType = GqlUtils.getGQLScalarType(schema!);
        return new Scalar(parent, scalarType, schema!);
      }
      // or we have no idea how to handle this
      else {
        throw new Error(`Cannot handle property type ${typeStr}, schema: ${JSON.stringify(schema)}`);
      }
    } else if (schema?.enum != null) {
      return new En(parent, 'enum', schema, _.get(schema, 'enum') as string[]);
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
      // none and writes an empty block (digitalocean's create-record body). see docs/issues.md #50
      //   schema: { anyOf: [ { allOf: [ … ] }, { … } ] }
      const members = schema.oneOf || schema.anyOf || [];
      result = new Union(
        parent,
        ref || _.get(schema, 'name'),
        members as SchemaObject[],
        false,
        _.get(schema, 'discriminator'),
      );
    }
    // map (object with only additionalProperties)
    else if (this.isMapSchema(schema)) {
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

  private static isMapSchema(schema: SchemaObject): boolean {
    // A schema is considered a map if:
    // 1. It has additionalProperties defined as an object
    // 2. It has no explicit properties OR has empty properties
    return Boolean(
      schema.additionalProperties &&
        typeof schema.additionalProperties === 'object' &&
        (!schema.properties || _.isEmpty(schema.properties)),
    );
  }

  private static createArrayType(parent: IType | Res, schema: SchemaObject | null, context: OasContext) {
    // Array schema case.
    let parentName = parent.name;
    if (parent instanceof Res) {
      const get = parent.parent as Get; // Assume parent.parent is a GetOp.
      parentName = _.upperFirst(get.getGqlOpName());
    }

    const arr = new Arr(parent, parentName);
    const items = Factory.unwrapRedundantArrayItems(context, _.get(schema, 'items') as ArraySchemaObject);
    arr.items = items as ArraySchemaObject;

    // TODO: check this
    arr.itemsType = Factory.fromSchema(context, arr, items);
    arr.add(arr.itemsType); // add it to the children

    return arr;
  }

  // An array's items can point at a schema that is itself an array (docker-engine):
  //   Containers:       { type: array, items: { $ref: '#/…/ContainerSummary' } }
  //   ContainerSummary: { type: array, items: { …the real object… } }
  // The payload is still one list of objects, so take the inner items — a property's items must
  // always be the real element. see docs/issues.md #46
  private static unwrapRedundantArrayItems(
    context: OasContext,
    items: SchemaObject | ReferenceObject,
  ): SchemaObject | ReferenceObject {
    if (!items || !('$ref' in items)) {
      return items;
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
    const schemaObj = schema as SchemaObject;
    // OAS 3.1 nullable syntax (`type: [string, 'null']`) would crash every plain-string `type` read below. #23
    this.normalizeTypeArray(schemaObj);
    const type = schemaObj.type;

    if (type) {
      // 1st case is if the type is an array
      if (type === 'array') {
        const array = new PropArray(parent, propName, schema!);
        // const itemsName = Naming.genArrayItems(propName);

        const itemsSchema = Factory.unwrapRedundantArrayItems(context, _.get(schemaObj, 'items') as ArraySchemaObject);
        // const itemsType = Factory.fromProp(context, array, itemsName, itemsSchema); // TODO: re-test
        const itemsType = Factory.fromSchema(context, array, itemsSchema);

        array.setItems(itemsType);
        prop = array;

        // Array items resolve eagerly here, so if the item ref re-entered a schema on the path
        // (fromSchema returned the circular sentinel), bubble the cut up to the whole list field:
        // render `# children: [Node] — circular reference omitted`. see docs/issues.md #10
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
          const inner: PropComp = new PropComp(parent, propName, schemaObj);
          inner.comp = new Union(
            inner,
            ref || _.get(schemaObj, 'name'),
            schemaObj.oneOf as SchemaObject[],
            false,
            _.get(schemaObj, 'discriminator'),
          );
          prop = inner;
        } else if (schemaObj.allOf) {
          const propComp: PropComp = new PropComp(parent, propName, schemaObj);
          propComp.comp = new Composed(propComp, ref || _.get(schemaObj, 'name'), schemaObj);
          prop = propComp;
        } else if (this.isMapSchema(schemaObj)) {
          // Map property: object with only additionalProperties
          const mapType: Map = new Map(parent, ref || propName, schemaObj);
          prop = new PropMap(parent, propName, schemaObj, mapType);
        } else if (schemaObj.properties != null) {
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        } else {
          // the type of the property will be an object, which needs to be added as a child
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        }
      } else if (ref && schemaObj?.enum) {
        if (this.isGqlEnum(schemaObj)) {
          const en: En = new En(
            parent,
            ref,
            schemaObj,
            (schemaObj.enum as string[]).map((v) => v.trim()),
          );
          prop = new PropEn(parent, propName, ref, schemaObj);
          prop.add(en);
        } else {
          // No GraphQL enum form for this one — degrade to the base scalar instead of emitting
          // an invalid definition: boolean/number enums (slack `ok: { enum: [true] }` ->
          // `ok: Boolean`) and string enums with non-identifier values (github reactions
          // `enum: ["+1", "-1", …]` -> String). see docs/issues.md #24
          prop = new PropScalar(parent, propName, GqlUtils.getGQLScalarType(schemaObj), schemaObj);
        }
      }
      // 3rd tries for scalar
      else if (GqlUtils.gqlScalar(type as string)) {
        const scalar = GqlUtils.gqlScalar(type as string);
        prop = new PropScalar(parent, propName, scalar as string, schemaObj);
      }
      // or we don't know how to handle this
      else {
        throw new Error('Cannot handle property type ' + type);
      }
    }
    // otherwise let's use the properties instead and assume an Obj
    // TODO: repeated code
    else if (schemaObj.oneOf) {
      const inner: PropComp = new PropComp(parent, propName, schemaObj);
      inner.comp = new Union(inner, ref || _.get(schemaObj, 'name'), schemaObj.oneOf as SchemaObject[]);
      prop = inner;
    } else if (schemaObj.allOf) {
      const propComp: PropComp = new PropComp(parent, propName, schemaObj);
      propComp.comp = new Composed(propComp, ref || _.get(schemaObj, 'name'), schemaObj);
      prop = propComp;
    } else if (this.isMapSchema(schemaObj)) {
      // Map property: object with only additionalProperties (no explicit type)
      const mapType: Map = new Map(parent, ref || propName, schemaObj);
      prop = new PropMap(parent, propName, schemaObj, mapType);
    } else if (schemaObj.properties != null) {
      const propType: IType = new Obj(parent, ref || propName, schemaObj);
      prop = new PropObj(parent, propName, schemaObj, propType);
    }
    // default case, we don't know what to do so we'll create a scalar of type JSON
    else {
      prop = new PropScalar(parent, propName, 'JSON', schemaObj);
    }

    // Cut only a real loop: a field pointing back to a type we already passed through. Compare the schema,
    // not the field name — different types reuse field names (e.g. Adobe `extension_attributes`). docs/issues.md #36
    const cyclic = this.cyclicAncestor(parent, schemaObj);
    if (cyclic) {
      prop = new PropCircRef(parent, prop);
    }

    return prop;
  }

  /**
   * The nearest ancestor built from the same resolved component `$ref` (compared by `SchemaObject`
   * identity — `lookupRef` returns the same instance per ref), or undefined. Scoped to the current
   * expansion path (`ancestors()`), so a shared non-recursive component used by sibling fields is NOT
   * cut — only a schema that is its own ancestor. `schema` is undefined for inline (non-`$ref`) nodes,
   * which can never match an ancestor. see docs/issues.md #10
   */
  private static cyclicAncestor(parent: IType, schema?: SchemaObject): IType | undefined {
    if (!schema) return undefined;
    return parent.ancestors().find((a) => a.schema === schema);
  }

  /** Build the `fromSchema` circular sentinel (commented in both SDL + selection). see docs/issues.md #10 */
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

    const schema = param.schema as SchemaObject;
    const required = param.required === true;

    return new Param(parent, param.name, schema, required, schema.default, param);
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

  public static fromBody(_context: OasContext, parent: IType, schema: SchemaObject): IType {
    const body = new Body(parent, 'b', schema);
    parent.add(body);
    return body;
  }
}
