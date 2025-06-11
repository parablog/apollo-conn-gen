import {
  Arr,
  Body,
  CircularRef,
  Composed,
  Delete,
  En,
  Get,
  IType,
  Obj,
  Param,
  Patch,
  Post,
  Prop,
  PropArray,
  PropCircRef,
  PropComp,
  PropObj,
  PropScalar,
  Put,
  ReferenceObject,
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
import { APOLLO_SYNTHETIC_OBJ } from '../schemas/index.js';
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

    // array case
    if (schemaObj.type === 'array' && schemaObj.items) {
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
      const oneOfs = schema.oneOf || [];
      result = new Union(parent, ref || _.get(schema, 'name'), oneOfs as SchemaObject[]);
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

      // if we want to syntethise an object:
      if (schema.format == APOLLO_SYNTHETIC_OBJ) {
        (result as Obj).synthetic = true;
      }
    }

    return result;
  }

  private static createArrayType(parent: IType | Res, schema: SchemaObject | null, context: OasContext) {
    // Array schema case.
    let parentName = parent.name;
    if (parent instanceof Res) {
      const get = parent.parent as Get; // Assume parent.parent is a GetOp.
      parentName = _.upperFirst(get.getGqlOpName());
    }

    const arr = new Arr(parent, parentName);
    const items = _.get(schema, 'items') as ArraySchemaObject;
    arr.items = items;

    // TODO: check this
    arr.itemsType = Factory.fromSchema(context, arr, items);
    arr.add(arr.itemsType); // add it to the children

    return arr;
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
    const type = schemaObj.type;

    if (type) {
      // 1st case is if the type is an array
      if (type === 'array') {
        const array = new PropArray(parent, propName, schema!);
        // const itemsName = Naming.genArrayItems(propName);

        const itemsSchema = _.get(schemaObj, 'items') as ArraySchemaObject;
        // const itemsType = Factory.fromProp(context, array, itemsName, itemsSchema); // TODO: re-test
        const itemsType = Factory.fromSchema(context, array, itemsSchema);

        array.setItems(itemsType);
        prop = array;
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
          inner.comp = new Union(inner, ref || _.get(schemaObj, 'name'), schemaObj.oneOf as SchemaObject[]);
          prop = inner;
        } else if (schemaObj.allOf) {
          const propComp: PropComp = new PropComp(parent, propName, schemaObj);
          propComp.comp = new Composed(propComp, ref || _.get(schemaObj, 'name'), schemaObj);
          prop = propComp;
        } else if (schemaObj.properties != null) {
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        } else {
          // the type of the property will be an object, which needs to be added as a child
          const propType: IType = new Obj(parent, ref || propName, schemaObj);
          prop = new PropObj(parent, propName, schemaObj, propType);
        }
      } else if (ref && schemaObj?.enum) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- for options
        const stringEnum = _.every(schemaObj.enum, (value: any, _: string) => typeof value === 'string');
        const en: En = new En(parent, ref, schemaObj, stringEnum ? (schemaObj.enum as string[]) : []);

        prop = new PropEn(parent, propName, ref, schemaObj);
        prop.add(en);
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
    } else if (schemaObj.properties != null) {
      const propType: IType = new Obj(parent, ref || propName, schemaObj);
      prop = new PropObj(parent, propName, schemaObj, propType);
    }
    // default case, we don't know what to do so we'll create a scalar of type JSON
    else {
      prop = new PropScalar(parent, propName, 'JSON', schemaObj);
    }

    if (parent.ancestors().find((a) => a.id === prop.id)) {
      console.warn('[factory] Recursion detected! Ancestors already contain this type: \n' + prop.id);
      prop = new PropCircRef(parent, prop);
    }

    return prop;
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
