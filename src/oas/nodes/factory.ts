import {
  Get,
  Post,
  IType,
  Ref,
  ReferenceObject,
  Arr,
  Composed,
  Obj,
  En,
  Scalar,
  Prop,
  PropRef,
  PropArray,
  PropObj,
  PropScalar,
  CircularRef,
  Union,
  Response,
  Param,
  Body,
  Put,
  Patch,
  Delete,
  PropComp,
} from './internal.js';
import { Operation } from 'oas/operation';
import { ParameterObject, SchemaObject } from 'oas/types';
import { OpenAPIV3 } from 'openapi-types';
import ArraySchemaObject = OpenAPIV3.ArraySchemaObject;
import _ from 'lodash';
import { trace, warn } from '../log/trace.js';
import { OasContext } from '../oasContext.js';
import { Naming } from '../utils/naming.js';
import { GqlUtils } from '../utils/gql.js';
import { APOLLO_SYNTHETIC_OBJ } from '../schemas/index.js';

export class Factory {
  public static createGet(name: string, op: Operation): Get {
    return new Get(name, op);
  }

  public static fromSchema(parent: IType, schema: SchemaObject | ReferenceObject): IType {
    let result: IType | null = null;

    if ('$ref' in schema) {
      result = new Ref(parent, schema.$ref as string, schema as ReferenceObject);
    }
    // array case
    else if (schema.type === 'array' && schema.items) {
      // Array schema case.
      let parentName = parent.name;
      if (parent instanceof Response) {
        // Assume parent.parent is a GetOp.
        const get = parent.parent as Get;
        parentName = _.upperFirst(get.getGqlOpName());
      } else {
        trace(null, '[factory]', 'Factory.fromSchema >>> HERE');
      }

      // result = new Arr(parent, parentName, schema.items as ArraySchemaObject);
      // (result as Arr).itemsType = Factory.fromSchema(result, schema.items as ArraySchemaObject);
      const arr = new Arr(parent, parentName);

      const items = schema.items as ArraySchemaObject;
      arr.items = items;
      arr.itemsType = Factory.fromSchema(arr, items);

      result = arr;
    }
    // array case
    else if (schema.type === 'object') {
      // it's either a union or a composed object
      if (schema.allOf) {
        result = new Composed(parent, _.get(schema, 'name') || parent.name, schema);
      } else if (schema.oneOf) {
        const oneOfs = schema.oneOf || [];
        result = new Union(parent, _.get(schema, 'name') || parent.name, oneOfs as SchemaObject[]);
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

        result = new Obj(parent, _.get(schema, 'name') || null, schema);
        if (schema.format == APOLLO_SYNTHETIC_OBJ) {
          (result as Obj).synthetic = true;
        }
      }
    }
    // Composed schema case.
    else if (schema.oneOf) {
      const oneOfs = schema.oneOf || [];
      result = new Union(parent, _.get(schema, 'name') || parent.name, oneOfs as SchemaObject[]);
    } else if (schema.allOf) {
      result = new Composed(parent, _.get(schema, 'name') || parent.name, schema);
    }
    // scalar
    else {
      const typeStr = schema.type;
      if (typeStr != null) {
        if (typeStr === 'array') {
          throw new Error(`Should have been handled already? ${typeStr}, schema: ${JSON.stringify(schema)}`);
        } else if (schema.enum != null) {
          result = new En(parent, schema, schema.enum! as string[]);
        }
        // scalar case
        else if (GqlUtils.gqlScalar(typeStr as string)) {
          const scalarType = GqlUtils.getGQLScalarType(schema);
          result = new Scalar(parent, scalarType, schema);
        }
        // or we have no idea how to handle this
        else {
          throw new Error(`Cannot handle property type ${typeStr}, schema: ${JSON.stringify(schema)}`);
        }
      } else if (schema.enum != null) {
        result = new En(parent, schema, _.get(schema, 'enum') as string[]);
      }
      // or we have no idea how to handle this
      else {
        throw new Error(`Cannot handle schema ${parent.pathToRoot()}, schema: ${JSON.stringify(schema)}`);
      }
    }

    if (result != null) {
      parent.add(result);
    }
    // we could not infer a proper type
    else {
      throw new Error(`Not yet implemented for ${JSON.stringify(schema)}`);
    }

    return result;
  }

  public static fromProp(context: OasContext, parent: IType, propertyName: string, schema: SchemaObject): Prop {
    if (!schema) {
      throw new Error(`Should have a schema defined for property '${propertyName}' (parent: '${parent.name}')`);
    }

    const type = schema.type;
    let prop: Prop;

    if (!type && '$ref' in schema) {
      prop = new PropRef(parent, propertyName, schema, (schema as ReferenceObject).$ref);
    }
    // uses the type of the schema to find out what kind of property it is
    else if (type) {
      // 1st case is if the type is an array
      if (type === 'array') {
        const array = new PropArray(parent, propertyName, schema);

        const itemsName = Naming.genArrayItems(propertyName);
        const itemsType = Factory.fromProp(context, array, itemsName, schema.items as ArraySchemaObject);

        array.setItems(itemsType);

        prop = array;
      }
      // 2nd checks for obj property
      else if (type === 'object') {
        // the type of the property will be an object, which needs to be added as a child
        const propType: IType = new Obj(parent, propertyName, schema);
        prop = new PropObj(parent, propertyName, schema, propType);
      }
      // 3rd tries for scalar
      else if (GqlUtils.gqlScalar(type as string)) {
        const scalar = GqlUtils.gqlScalar(type as string);
        prop = new PropScalar(parent, propertyName, scalar as string, schema);
      }
      // or we don't know how to handle this
      else {
        throw new Error('Cannot handle property type ' + type);
      }
    }
    // otherwise let's use the properties instead and assume an Obj
    else if (schema.properties != null) {
      const propType: IType = new Obj(parent, propertyName, schema);
      prop = new PropObj(parent, propertyName, schema, propType);
    } else if (schema.oneOf) {
      const propComp: PropComp = new PropComp(parent, propertyName, schema);
      propComp.comp = new Union(propComp, _.get(schema, 'name') || parent.name, schema.oneOf as SchemaObject[]);
      prop = propComp;
    } else if (schema.allOf) {
      const propComp: PropComp = new PropComp(parent, propertyName, schema);
      propComp.comp = new Composed(propComp, _.get(schema, 'name') || parent.name, schema);
      prop = propComp;
    }
    // default case, we don't know what to do so we'll create a scalar of type JSON
    else {
      prop = new PropScalar(parent, propertyName, 'JSON', schema);
    }

    if (parent.ancestors().includes(prop)) {
      console.warn('[factory] Recursion detected! Ancestors already contain this type: \n' + prop.pathToRoot());
    }

    return prop;
  }

  public static fromResponse(_context: OasContext, parent: IType, mediaSchema: SchemaObject): IType {
    return new Response(parent, 'r', mediaSchema);
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
